// HTTP REST API — the door the Protocol Inspector (and future MCP-over-HTTP
// adapter) walks through. Same handlers power the MCP tool surface.

import type { IncomingMessage, ServerResponse } from 'node:http'
import { store } from '../state/store.js'
import { processAct } from '../engines/task-manager.js'
import {
  getCompactedContext,
  getFullContext,
  getContextComparison,
  getEvidenceById,
  getDecisionById,
  TOOL_DEFS,
  callTool,
  actFamilies,
} from '../mcp/tools.js'
import type { ActInput } from '../protocol/envelope.js'
import { seedDemo } from '../seed/demo.js'
import { ACT_FAMILY, FAMILY_COLOR, FAMILY_DESCRIPTION } from '../protocol/act-types.js'

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-Agent-Id',
  })
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk) => (data += chunk))
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch {
        resolve({})
      }
    })
  })
}

export async function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === 'OPTIONS') {
    send(res, 204, {})
    return
  }
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const path = url.pathname
  const method = req.method || 'GET'

  try {
    // ---- GET routes ----
    if (method === 'GET') {
      if (path === '/api/state') {
        return send(res, 200, snapshotState())
      }
      if (path === '/api/agents') {
        return send(res, 200, Array.from(store.agents.values()))
      }
      if (path === '/api/tasks') {
        return send(res, 200, Array.from(store.tasks.values()))
      }
      if (path === '/api/ledger') {
        const limit = parseInt(url.searchParams.get('limit') || '100', 10)
        const taskId = url.searchParams.get('taskId') || undefined
        const events = taskId
          ? store.ledger.filter((e) => e.taskId === taskId)
          : store.ledger
        return send(res, 200, events.slice(-limit).reverse())
      }
      if (path === '/api/approvals') {
        return send(res, 200, Array.from(store.approvals.values()))
      }
      if (path === '/api/tools') {
        return send(res, 200, TOOL_DEFS)
      }
      if (path === '/api/families') {
        return send(res, 200, {
          family: ACT_FAMILY,
          color: FAMILY_COLOR,
          description: FAMILY_DESCRIPTION,
        })
      }
      const taskCtxMatch = path.match(/^\/api\/tasks\/([^/]+)\/context\/comparison$/)
      if (taskCtxMatch) {
        return send(res, 200, getContextComparison(taskCtxMatch[1]))
      }
      const taskFullMatch = path.match(/^\/api\/tasks\/([^/]+)\/context\/full$/)
      if (taskFullMatch) {
        return send(res, 200, getFullContext(taskFullMatch[1]))
      }
      const taskContextMatch = path.match(/^\/api\/tasks\/([^/]+)\/context$/)
      if (taskContextMatch) {
        return send(res, 200, getCompactedContext(taskContextMatch[1]))
      }
      const taskMatch = path.match(/^\/api\/tasks\/([^/]+)$/)
      if (taskMatch) {
        const t = store.tasks.get(taskMatch[1])
        if (!t) return send(res, 404, { error: 'Task not found' })
        return send(res, 200, {
          task: t,
          decisions: store.decisionsForTask(t.id),
          evidence: store.evidenceForTask(t.id),
          ledger: store.ledgerForTask(t.id).slice(-50).reverse(),
        })
      }
      if (path === '/api/evidence' && url.searchParams.get('id')) {
        return send(res, 200, getEvidenceById(url.searchParams.get('id')!))
      }
      if (path === '/api/decisions' && url.searchParams.get('id')) {
        return send(res, 200, getDecisionById(url.searchParams.get('id')!))
      }
      return send(res, 404, { error: 'Not found', path })
    }

    // ---- POST routes ----
    if (method === 'POST') {
      if (path === '/api/acts') {
        const body = (await readBody(req)) as ActInput
        const result = processAct(body)
        return send(res, result.ok ? 200 : 400, result)
      }
      const toolMatch = path.match(/^\/api\/tools\/([a-zA-Z_]+)$/)
      if (toolMatch) {
        const toolName = toolMatch[1]
        const args = await readBody(req)
        const caller = (req.headers['x-agent-id'] as string) || (args._agent as string) || 'agent.architect'
        const { _agent, ...rest } = args
        const result = callTool(toolName, rest, caller)
        return send(res, result.ok ? 200 : 400, result)
      }
      if (path === '/api/demo/seed') {
        seedDemo()
        return send(res, 200, { ok: true, state: snapshotState() })
      }
      if (path === '/api/demo/reset') {
        store.reset()
        return send(res, 200, { ok: true })
      }
      return send(res, 404, { error: 'Not found', path })
    }

    return send(res, 405, { error: 'Method not allowed' })
  } catch (e) {
    return send(res, 500, { error: (e as Error).message })
  }
}

export function snapshotState() {
  return {
    workspace: Array.from(store.workspaces.values())[0] || null,
    agents: Array.from(store.agents.values()),
    tasks: Array.from(store.tasks.values()),
    approvals: Array.from(store.approvals.values()),
    ledger: store.ledger.slice(-50).reverse(),
    ledgerTotal: store.ledger.length,
  }
}
