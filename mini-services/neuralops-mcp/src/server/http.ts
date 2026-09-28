// HTTP REST door. The Protocol Inspector, the MCP stdio proxy and any
// HTTP-speaking agent all come through here. Same handlers as the MCP tools.

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Config } from '../config.js'
import { store } from '../state/store.js'
import { processAct } from '../engines/task-manager.js'
import {
  getCompactedContext,
  getContextComparison,
  getDecisionById,
  getEvidenceById,
  getFullContext,
  getInbox,
} from '../engines/context.js'
import { approverFor } from '../engines/authority.js'
import { demoToken, registerAgent } from '../engines/agents.js'
import { deletePolicy, freezeWorkspace, revokeAgent, rotateToken, setAuthority, setPolicy, unfreezeWorkspace } from '../engines/admin.js'
import { handleMcpRequest } from '../mcp/http.js'
import { canSeeApproval, requireTaskVisible, view } from '../engines/visibility.js'
import { allPresets, applyPreset, definePreset, deletePreset, getPreset } from '../engines/presets.js'
import { approvalLinks, decideApproval, showApproval } from './links.js'
import { webhookDeliveries } from './webhook.js'
import { gateStatus } from '../engines/gate.js'
import { activeReservations, checkPaths } from '../engines/reservations.js'
import { genesis, verifyIntegrity, type JournalFile } from '../engines/replay.js'
import { sha256 } from '../state/store.js'
import { TOOL_DEFS, callTool, type Caller } from '../mcp/tools.js'
import { ACT_FAMILY, FAMILY_COLOR, FAMILY_DESCRIPTION } from '../protocol/act-types.js'
import { HTTP_STATUS, NeuralOpsError, forbidden, notFound } from '../errors.js'
import { bearer, canAdminister, resolveCaller } from './identity.js'
import { RateLimiter } from './ratelimit.js'

const MAX_BODY = 256 * 1024

class BodyTooLarge extends Error {}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return readJson(req).then((v) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}))
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0
    let tooLarge = false
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      if (tooLarge) return // drain without buffering
      size += c.length
      if (size > MAX_BODY) {
        tooLarge = true
        chunks.length = 0
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      if (tooLarge) return reject(new BodyTooLarge())
      const text = Buffer.concat(chunks).toString('utf8')
      if (!text) return resolve({})
      try {
        resolve(JSON.parse(text))
      } catch {
        reject(new NeuralOpsError('invalid', 'Body is not valid JSON'))
      }
    })
    req.on('error', reject)
  })
}

export function snapshotState(config?: Pick<Config, 'mode'>, caller?: Caller) {
  const c = caller ?? { agentId: null }
  const ledger = view.events(c, store.ledger)
  return {
    mode: config?.mode ?? 'demo',
    workspace: [...store.workspaces.values()][0] ?? null,
    agents: [...store.agents.values()].map((a) => ({ ...a, approverFor: approverFor(a.id) })),
    tasks: view.tasks(c, [...store.tasks.values()]),
    approvals: view.approvals(c, [...store.approvals.values()]),
    policies: [...store.policies.values()],
    reservations: activeReservations(),
    freeze: store.freeze,
    ledger: ledger.slice(-50).reverse(),
    ledgerTotal: ledger.length,
    ledgerHead: store.ledgerHead,
  }
}

/** What a read-only audit identity may call. */
export const AUDIT_READABLE = new Set(['/api/whoami', '/api/ledger', '/api/integrity', '/api/approvals', '/api/policies', '/api/freeze'])

function enforceAuditScope(caller: Caller, method: string, path: string): void {
  if (!caller.agentId || store.agents.get(caller.agentId)?.access !== 'audit') return
  if (method === 'GET' && AUDIT_READABLE.has(path)) return
  throw forbidden(`${caller.agentId} is a read-only audit identity: it may only GET ${[...AUDIT_READABLE].join(', ')}.`)
}

export function createHttpHandler(config: Config, deps: { journal?: JournalFile | null } = {}) {
  const limiter = config.rateLimit ? new RateLimiter(config.rateLimit.perSecond, config.rateLimit.burst) : null

  function send(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      ...extra,
    }
    if (config.corsOrigin) {
      headers['Access-Control-Allow-Origin'] = config.corsOrigin
      headers['Access-Control-Allow-Methods'] = 'GET,POST,PUT,DELETE,OPTIONS'
      headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization,X-Agent-Id'
    }
    res.writeHead(status, headers)
    res.end(status === 204 ? undefined : JSON.stringify(body))
  }

  const fail = (res: ServerResponse, e: unknown) => {
    if (e instanceof BodyTooLarge) return send(res, 413, { ok: false, error: 'Body too large', errorCode: 'too_large' })
    if (e instanceof NeuralOpsError) return send(res, HTTP_STATUS[e.code], { ok: false, error: e.message, errorCode: e.code })
    console.error('[neuralops] unhandled', e)
    return send(res, 500, { ok: false, error: 'Internal error' })
  }

  const header = (req: IncomingMessage, name: string) => {
    const v = req.headers[name]
    return (Array.isArray(v) ? v[0] : v) || null
  }

  function callerFor(req: IncomingMessage, claimed: string | null): Caller {
    const caller = resolveCaller(config, bearer(req.headers.authorization), claimed)
    enforceAuditScope(caller, req.method || 'GET', new URL(req.url || '/', 'http://localhost').pathname)
    return caller
  }

  function requireDemo(caller: Caller) {
    if (config.mode !== 'demo') throw notFound('Demo endpoints are disabled in secure mode')
    void caller
  }

  function requireAdmin(caller: Caller) {
    if (!canAdminister(config, caller)) throw forbidden('This endpoint needs the admin token')
  }

  /** Who performed an admin action, for the audit trail. */
  const actorOf = (caller: Caller) => (caller.isAdmin ? 'admin' : config.mode === 'demo' ? 'admin(demo)' : caller.agentId ?? 'unknown')

  function rateLimitKey(req: IncomingMessage): string {
    const token = bearer(req.headers.authorization)
    return token ? `t:${sha256(token)}` : `ip:${req.socket.remoteAddress ?? '?'}`
  }

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === 'OPTIONS') return send(res, 204, null)
    const url = new URL(req.url || '/', 'http://localhost')
    const path = url.pathname
    const method = req.method || 'GET'

    try {
      if (method === 'GET' && path === '/api/health') {
        return send(res, 200, { ok: true, mode: config.mode, ledgerLength: store.ledger.length, frozen: !!store.freeze })
      }

      if (limiter) {
        const wait = limiter.take(rateLimitKey(req))
        if (wait > 0) {
          return send(res, 429, { ok: false, error: `Rate limit exceeded; retry in ${wait}s`, errorCode: 'rate_limited' }, { 'Retry-After': String(wait) })
        }
      }

      // ---- one-click approval links (the link itself is the credential) ----
      const al = path.match(/^\/approve\/([A-Za-z0-9_]+)$/)
      if (al) {
        if (!config.links) throw notFound('Approval links are off (set NEURALOPS_PUBLIC_URL and NEURALOPS_LINK_SECRET)')
        if (method === 'GET') return showApproval(config.links, res, al[1], url.searchParams.get('exp'), url.searchParams.get('sig'))
        if (method === 'POST') return await decideApproval(config.links, req, res, al[1])
        return send(res, 405, { ok: false, error: 'Method not allowed' })
      }

      // ---- MCP over streamable HTTP (NeuralOps Nexus, remote MCP hosts) ----
      const mcpPath = path === '/mcp' ? { token: null as string | null } : path.match(/^\/mcp\/([A-Za-z0-9_\-.]+)$/) ? { token: path.slice(5) } : null
      if (mcpPath) {
        if (mcpPath.token && !config.mcpUrlTokens) throw notFound('Tokens in the MCP URL are disabled (set NEURALOPS_MCP_URL_TOKENS=1); send Authorization: Bearer <token> to /mcp')
        const token = mcpPath.token ?? bearer(req.headers.authorization)
        const caller = resolveCaller(config, token, token ? null : header(req, 'x-agent-id'))
        enforceAuditScope(caller, method, path)
        const body = method === 'POST' ? await readJson(req) : undefined
        return await handleMcpRequest(req, res, body, caller)
      }

      if (method === 'GET') {
        const caller = callerFor(req, header(req, 'x-agent-id'))
        const q = (k: string) => url.searchParams.get(k)

        const seeTask = (id: string | null | undefined) => {
          if (caller.scoped && caller.agentId && id) requireTaskVisible(caller.agentId, id)
        }
        if (path === '/api/state') return send(res, 200, snapshotState(config, caller))
        if (path === '/api/agents') return send(res, 200, snapshotState(config).agents)
        if (path === '/api/tasks') return send(res, 200, view.tasks(caller, [...store.tasks.values()]))
        if (path === '/api/approvals') return send(res, 200, view.approvals(caller, [...store.approvals.values()]))
        const apl = path.match(/^\/api\/approvals\/([A-Za-z0-9_]+)\/links$/)
        if (apl) {
          requireAdmin(caller)
          if (!config.links) throw notFound('Approval links are off (set NEURALOPS_PUBLIC_URL and NEURALOPS_LINK_SECRET)')
          const a = store.approvals.get(apl[1])
          if (!a) throw notFound(`Approval ${apl[1]} not found`)
          return send(res, 200, approvalLinks(config.links, a))
        }
        if (path === '/api/webhooks/deliveries') {
          requireAdmin(caller)
          return send(res, 200, webhookDeliveries())
        }
        const apm = path.match(/^\/api\/approvals\/([A-Za-z0-9_]+)$/)
        if (apm) {
          const a = store.approvals.get(apm[1])
          if (!a || (caller.scoped && caller.agentId && !canSeeApproval(caller.agentId, a))) throw notFound(`Approval ${apm[1]} not found`)
          return send(res, 200, a)
        }
        if (path === '/api/policies') return send(res, 200, [...store.policies.values()])
        if (path === '/api/tools') return send(res, 200, TOOL_DEFS)
        if (path === '/api/families') {
          return send(res, 200, { family: ACT_FAMILY, color: FAMILY_COLOR, description: FAMILY_DESCRIPTION })
        }
        if (path === '/api/ledger') {
          const limit = Math.min(Math.max(parseInt(q('limit') || '100', 10) || 100, 1), 1000)
          const taskId = q('taskId')
          seeTask(taskId)
          const events = view.events(caller, taskId ? store.ledgerForTask(taskId) : store.ledger)
          return send(res, 200, events.slice(-limit).reverse())
        }
        if (path === '/api/presets') return send(res, 200, allPresets())
        const pm = path.match(/^\/api\/presets\/([a-z0-9-]+)$/)
        if (pm) return send(res, 200, getPreset(pm[1]))
        if (path === '/api/freeze') return send(res, 200, { frozen: !!store.freeze, freeze: store.freeze })
        if (path === '/api/integrity') return send(res, 200, verifyIntegrity(deps.journal))
        if (path === '/api/reservations') {
          const agentId = q('agentId')
          const taskId = q('taskId')
          return send(res, 200, activeReservations().filter((r) => (!agentId || r.agentId === agentId) && (!taskId || r.taskId === taskId)))
        }
        if (path === '/api/reservations/check') {
          const paths = url.searchParams.getAll('path')
          if (paths.length === 0) throw new NeuralOpsError('invalid', 'at least one ?path= is required')
          return send(res, 200, { agentId: caller.agentId, frozen: store.freeze, results: checkPaths(caller.agentId, paths.slice(0, 500)) })
        }
        if (path === '/api/gate/status') {
          const taskId = q('taskId')
          if (!taskId) throw new NeuralOpsError('invalid', 'taskId is required')
          const status = gateStatus(taskId, q('action') || 'complete', q('scope') || 'production')
          return send(res, 200, status)
        }
        if (path === '/api/whoami') {
          return send(res, 200, {
            agent: caller.agentId ? store.agents.get(caller.agentId) ?? null : null,
            via: caller.via,
            isAdmin: caller.isAdmin,
            mode: config.mode,
          })
        }
        if (path === '/api/inbox') {
          if (!caller.agentId) throw forbidden('Inbox needs an agent identity')
          return send(res, 200, { ...getInbox(caller.agentId), frozen: store.freeze })
        }
        if (path === '/api/evidence' && q('id')) {
          const ev = getEvidenceById(q('id')!)
          seeTask(ev.taskId)
          return send(res, 200, ev)
        }
        if (path === '/api/decisions' && q('id')) {
          const d = getDecisionById(q('id')!)
          seeTask(d.taskId)
          return send(res, 200, d)
        }
        if (path === '/api/demo/tokens') {
          requireDemo(caller)
          return send(res, 200, Object.fromEntries([...store.agents.keys()].map((id) => [id, demoToken(id)])))
        }

        const tm = path.match(/^\/api\/tasks\/([^/]+)/)
        if (tm) seeTask(decodeURIComponent(tm[1]))
        let m = path.match(/^\/api\/tasks\/([^/]+)\/context\/comparison$/)
        if (m) return send(res, 200, getContextComparison(decodeURIComponent(m[1])))
        m = path.match(/^\/api\/tasks\/([^/]+)\/context\/full$/)
        if (m) return send(res, 200, getFullContext(decodeURIComponent(m[1])))
        m = path.match(/^\/api\/tasks\/([^/]+)\/context$/)
        if (m) return send(res, 200, getCompactedContext(decodeURIComponent(m[1])))
        m = path.match(/^\/api\/tasks\/([^/]+)$/)
        if (m) {
          const t = store.tasks.get(decodeURIComponent(m[1]))
          if (!t) throw notFound('Task not found')
          return send(res, 200, {
            task: t,
            decisions: store.decisionsForTask(t.id),
            evidence: store.evidenceForTask(t.id),
            approvals: store.approvalsForTask(t.id),
            ledger: store.ledgerForTask(t.id).slice(-50).reverse(),
          })
        }
        throw notFound(`No route GET ${path}`)
      }

      if (method === 'POST') {
        const body = await readBody(req)
        const claimed = header(req, 'x-agent-id') ?? (typeof body.from === 'string' ? body.from : null)

        if (path === '/api/acts') {
          const caller = callerFor(req, claimed)
          if (!caller.agentId) throw forbidden('Acts need an agent identity (bearer token, or `from` in demo mode)')
          const result = processAct({ ...body, from: caller.agentId }, { via: caller.via })
          return send(res, result.ok ? 200 : HTTP_STATUS[result.errorCode ?? 'invalid'], result)
        }

        if (path === '/api/reservations/check') {
          const caller = callerFor(req, claimed)
          const paths = Array.isArray(body.paths) ? body.paths.map(String).slice(0, 500) : []
          if (paths.length === 0) throw new NeuralOpsError('invalid', 'paths[] is required')
          return send(res, 200, { agentId: caller.agentId, frozen: store.freeze, results: checkPaths(caller.agentId, paths) })
        }

        const toolMatch = path.match(/^\/api\/tools\/([a-zA-Z_]+)$/)
        if (toolMatch) {
          const { _agent, from: _from, ...args } = body
          const claimedTool =
            header(req, 'x-agent-id') ??
            (typeof _agent === 'string' ? _agent : typeof _from === 'string' ? _from : null)
          const caller = callerFor(req, claimedTool)
          const result = callTool(toolMatch[1], args, caller)
          return send(res, result.ok ? 200 : HTTP_STATUS[result.errorCode ?? 'invalid'], result)
        }

        if (path === '/api/agents') {
          const caller = callerFor(req, null)
          const broker = !caller.isAdmin && caller.via === 'token' && caller.agentId && store.agents.get(caller.agentId)?.access === 'broker' ? caller.agentId : null
          if (!broker) requireAdmin(caller)
          const { agent, token, expiresAt } = registerAgent(body, broker ? { asAdmin: false, broker } : { asAdmin: canAdminister(config, caller) })
          return send(res, 201, { ok: true, agent, token, expiresAt })
        }

        if (path === '/api/policies') {
          const caller = callerFor(req, null)
          requireAdmin(caller)
          return send(res, 201, { ok: true, policy: setPolicy(body, actorOf(caller)) })
        }

        const pa = path.match(/^\/api\/presets\/([a-z0-9-]+)\/apply$/)
        if (pa) {
          const caller = callerFor(req, null)
          requireAdmin(caller)
          return send(res, 200, { ok: true, ...applyPreset(pa[1], body, actorOf(caller)) })
        }

        if (path === '/api/presets') {
          const caller = callerFor(req, null)
          requireAdmin(caller)
          return send(res, 201, { ok: true, preset: definePreset(body, actorOf(caller)) })
        }

        if (path === '/api/admin/freeze') {
          const caller = callerFor(req, null)
          requireAdmin(caller)
          return send(res, 200, { ok: true, frozen: true, freeze: freezeWorkspace(body, actorOf(caller)) })
        }
        if (path === '/api/admin/unfreeze') {
          const caller = callerFor(req, null)
          requireAdmin(caller)
          unfreezeWorkspace(body, actorOf(caller))
          return send(res, 200, { ok: true, frozen: false })
        }

        const am = path.match(/^\/api\/agents\/([^/]+)\/(revoke|rotate)$/)
        if (am) {
          const agentId = decodeURIComponent(am[1])
          if (am[2] === 'revoke') {
            const caller = callerFor(req, null)
            requireAdmin(caller)
            revokeAgent(agentId, actorOf(caller))
            return send(res, 200, { ok: true, agentId, revoked: true })
          }
          // rotate: admin for anyone, or an agent for itself with its current token
          const caller = callerFor(req, null)
          const isSelf = caller.via === 'token' && caller.agentId === agentId
          if (!isSelf) requireAdmin(caller)
          const out = rotateToken(agentId, body, isSelf ? agentId : actorOf(caller))
          return send(res, 200, { ok: true, agentId, ...out, note: 'Store this token now — previous tokens no longer work.' })
        }

        if (path === '/api/demo/seed') {
          requireDemo(callerFor(req, null))
          genesis('demo')
          return send(res, 200, { ok: true, state: snapshotState(config) })
        }
        if (path === '/api/demo/reset') {
          requireDemo(callerFor(req, null))
          genesis('empty')
          return send(res, 200, { ok: true, state: snapshotState(config) })
        }
        throw notFound(`No route POST ${path}`)
      }

      if (method === 'PUT') {
        const body = await readBody(req)
        const m = path.match(/^\/api\/agents\/([^/]+)\/authority$/)
        if (m) {
          const caller = callerFor(req, null)
          requireAdmin(caller)
          const authority = setAuthority(decodeURIComponent(m[1]), body, actorOf(caller))
          return send(res, 200, { ok: true, authority })
        }
        throw notFound(`No route PUT ${path}`)
      }

      if (method === 'DELETE') {
        const dp = path.match(/^\/api\/presets\/([a-z0-9-]+)$/)
        if (dp) {
          const caller = callerFor(req, null)
          requireAdmin(caller)
          deletePreset(dp[1], actorOf(caller))
          return send(res, 200, { ok: true })
        }
        const m = path.match(/^\/api\/policies\/([^/]+)$/)
        if (m) {
          const caller = callerFor(req, null)
          requireAdmin(caller)
          deletePolicy(decodeURIComponent(m[1]), actorOf(caller))
          return send(res, 200, { ok: true })
        }
        throw notFound(`No route DELETE ${path}`)
      }

      return send(res, 405, { ok: false, error: 'Method not allowed' })
    } catch (e) {
      return fail(res, e)
    }
  }
}
