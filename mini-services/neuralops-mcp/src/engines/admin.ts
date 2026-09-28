// Admin operations: workspace policies, direct authority, token lifecycle.
//
// Every admin change is (1) validated, (2) applied through applyAdmin(), which
// writes a ledger event (actType "admin") and a journal record — so admin
// changes are audited and replayable exactly like acts.

import { z } from 'zod'
import { sha256, store } from '../state/store.js'
import type { AdminRecord, AuthorityScope, Policy } from '../state/types.js'
import { conflict, invalid, notFound, forbidden } from '../errors.js'
import { formatZodError } from '../protocol/payloads.js'
import { AuthorityInput, addSeconds, newToken } from './agents.js'

export const PolicyInput = z.object({
  action: z.string().min(1).max(64),
  scope: z.string().min(1).max(64),
  approver: z.string().min(1).max(128),
})

export const TokenInput = z.object({
  ttlSeconds: z.number().int().min(60).max(365 * 24 * 3600).optional(),
})

function parse<T extends z.ZodType>(schema: T, raw: unknown, what: string): z.infer<T> {
  const r = schema.safeParse(raw ?? {})
  if (!r.success) throw invalid(`Invalid ${what} — ${formatZodError(r.error)}`)
  return r.data
}

function requireAgent(id: string) {
  const a = store.agents.get(id)
  if (!a) throw notFound(`Agent ${id} not found`)
  return a
}

function audit(rec: AdminRecord, before: Record<string, unknown>, after: Record<string, unknown>, summary: string) {
  store.appendLedger({
    workspaceId: [...store.workspaces.keys()][0] ?? 'ws_default',
    actId: `adm_${String(store.journal.length + 1).padStart(6, '0')}`,
    actType: 'admin',
    actor: rec.by,
    via: rec.by === 'admin' ? 'system' : 'token',
    taskId: null,
    intent: null,
    before,
    after,
    references: [],
    deltaSummary: summary,
    timestamp: rec.at,
  })
}

/** Apply a validated admin record (live or replay). */
export function applyAdmin(rec: AdminRecord): void {
  switch (rec.k) {
    case 'policy_set': {
      store.policies.set(rec.policy.id, structuredClone(rec.policy))
      store.noteId(rec.policy.id)
      audit(rec, {}, { policy: rec.policy }, `${rec.by} set policy ${rec.policy.id}: ${rec.policy.action}/${rec.policy.scope} → approver ${rec.policy.approver}`)
      break
    }
    case 'policy_delete': {
      const before = store.policies.get(rec.id)
      store.policies.delete(rec.id)
      audit(rec, { policy: before ?? null }, {}, `${rec.by} deleted policy ${rec.id}`)
      break
    }
    case 'authority_set': {
      const agent = store.agents.get(rec.agentId)!
      const before = structuredClone(agent.authority)
      agent.authority = structuredClone(rec.authority)
      audit(rec, { authority: before }, { authority: rec.authority }, `${rec.by} set authority of ${rec.agentId}: ${rec.authority.map((a) => `${a.action}/${a.scope}`).join(', ') || '(none)'}`)
      break
    }
    case 'token': {
      const agent = store.agents.get(rec.agentId)!
      if (rec.replaceExisting) {
        for (const [h, info] of store.tokenHashes) if (info.agentId === rec.agentId) store.tokenHashes.delete(h)
      }
      store.tokenHashes.set(rec.tokenHash, { agentId: rec.agentId, expiresAt: rec.expiresAt })
      const wasRevoked = !!agent.revokedAt
      agent.revokedAt = null
      if (wasRevoked) agent.status = 'online'
      audit(rec, { revoked: wasRevoked }, { expiresAt: rec.expiresAt }, `${rec.by} issued a new token for ${rec.agentId}${rec.replaceExisting ? ' (old tokens invalidated)' : ''}${rec.expiresAt ? `, expires ${rec.expiresAt}` : ''}`)
      break
    }
    case 'revoke': {
      const agent = store.agents.get(rec.agentId)!
      for (const [h, info] of store.tokenHashes) if (info.agentId === rec.agentId) store.tokenHashes.delete(h)
      agent.revokedAt = rec.at
      agent.status = 'offline'
      for (const r of store.reservations.values()) {
        if (r.agentId === rec.agentId && !r.releasedAt) {
          r.releasedAt = rec.at
          r.releasedBy = rec.by
          r.releaseReason = 'agent revoked'
        }
      }
      audit(rec, { revokedAt: null }, { revokedAt: rec.at }, `${rec.by} REVOKED ${rec.agentId} — all its tokens are invalid`)
      break
    }
    case 'preset_set': {
      const before = store.presets.get(rec.preset.name) ?? null
      store.presets.set(rec.preset.name, structuredClone(rec.preset))
      audit(rec, { preset: before }, { preset: rec.preset }, `${rec.by} ${before ? 'updated' : 'defined'} preset ${rec.preset.name}: ${rec.preset.policies.map((p) => `${p.action}/${p.scope}`).join(', ')}`)
      break
    }
    case 'preset_delete': {
      const before = store.presets.get(rec.name) ?? null
      store.presets.delete(rec.name)
      audit(rec, { preset: before }, {}, `${rec.by} deleted preset ${rec.name}`)
      break
    }
    case 'freeze': {
      const before = store.freeze
      store.freeze = rec.frozen ? { reason: rec.reason, by: rec.by, at: rec.at } : null
      audit(
        rec,
        { frozen: !!before, freeze: before },
        { frozen: rec.frozen, freeze: store.freeze },
        rec.frozen
          ? `${rec.by} FROZE the workspace (kill switch): ${rec.reason} — all acts and gates are blocked`
          : `${rec.by} unfroze the workspace: ${rec.reason}`
      )
      break
    }
  }
  store.journalAppend(structuredClone(rec))
}

const now = () => new Date().toISOString()

export function setPolicy(raw: unknown, by: string, at = now()): Policy {
  const p = parse(PolicyInput, raw, 'policy')
  requireAgent(p.approver)
  const dup = [...store.policies.values()].find((x) => x.action === p.action && x.scope === p.scope)
  const policy: Policy = { id: dup?.id ?? store.nextId('policy', (id) => store.policies.has(id)), ...p }
  applyAdmin({ k: 'policy_set', policy, by, at })
  return policy
}

export function deletePolicy(id: string, by: string, at = now()): void {
  if (!store.policies.has(id)) throw notFound(`Policy ${id} not found`)
  applyAdmin({ k: 'policy_delete', id, by, at })
}

export function setAuthority(agentId: string, raw: unknown, by: string, at = now()): AuthorityScope[] {
  requireAgent(agentId)
  const list = parse(z.object({ authority: AuthorityInput }), raw, 'authority').authority
  const authority: AuthorityScope[] = list.map((a) => ({ ...a, requiresApproval: false, approver: agentId }))
  applyAdmin({ k: 'authority_set', agentId, authority, by, at })
  return authority
}

/** Issue a fresh token, invalidating the agent's previous tokens. Re-activates a revoked agent. */
export function rotateToken(
  agentId: string,
  raw: unknown,
  by: string,
  at = now()
): { token: string; expiresAt: string | null } {
  const agent = requireAgent(agentId)
  const { ttlSeconds } = parse(TokenInput, raw, 'token request')
  if (by === agentId && agent.revokedAt) throw forbidden(`${agentId} is revoked; only an admin can re-issue its token`)
  const token = newToken()
  const expiresAt = ttlSeconds ? addSeconds(at, ttlSeconds) : null
  applyAdmin({ k: 'token', agentId, tokenHash: sha256(token), expiresAt, replaceExisting: true, by, at })
  return { token, expiresAt }
}

export function revokeAgent(agentId: string, by: string, at = now()): void {
  const agent = requireAgent(agentId)
  if (agent.revokedAt) return
  applyAdmin({ k: 'revoke', agentId, by, at })
}

export const FreezeInput = z.object({ reason: z.string().trim().min(1).max(500) })

/** Kill switch: stop every agent at once (incident mode). Admin only. */
export function freezeWorkspace(raw: unknown, by: string, at = now()) {
  const { reason } = parse(FreezeInput, raw, 'freeze request')
  if (store.freeze) throw conflict(`Workspace is already frozen (by ${store.freeze.by} at ${store.freeze.at}: ${store.freeze.reason})`)
  applyAdmin({ k: 'freeze', frozen: true, reason, by, at })
  return store.freeze!
}

export function unfreezeWorkspace(raw: unknown, by: string, at = now()) {
  const { reason } = parse(z.object({ reason: z.string().trim().min(1).max(500).default('incident resolved') }), raw ?? {}, 'unfreeze request')
  if (!store.freeze) throw conflict('Workspace is not frozen')
  applyAdmin({ k: 'freeze', frozen: false, reason, by, at })
}

/** Throws if the kill switch is on. */
export function assertNotFrozen(): void {
  const f = store.freeze
  if (f) throw forbidden(`Workspace is FROZEN (incident mode) since ${f.at} by ${f.by}: ${f.reason}. No acts are accepted until an admin unfreezes it.`)
}
