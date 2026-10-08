// Agent registry + token identity.
//
// Tokens are random 32-byte secrets returned exactly once. Only their sha256
// is stored (and journaled). Tokens may expire; agents may be revoked and
// re-issued tokens (see engines/admin.ts).

import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { sha256, store } from '../state/store.js'
import { AGENT_MODELS, type Agent, type AuthorityScope } from '../state/types.js'
import { conflict, invalid, notFound } from '../errors.js'
import { formatZodError } from '../protocol/payloads.js'

export const AuthorityInput = z
  .array(z.object({ action: z.string().min(1).max(64), scope: z.string().min(1).max(64) }))
  .max(50)

export const RegisterSchema = z.object({
  id: z
    .string()
    .regex(/^(agent|human)\.[a-z0-9][a-z0-9_-]{1,62}$/, 'ids look like agent.<name> or human.<name> (lowercase)')
    .describe('Identity id: "agent.reviewer" for an agent or persona, "human.noaman" for a person'),
  name: z.string().min(1).max(80),
  model: z.enum(AGENT_MODELS),
  role: z.string().regex(/^[a-z0-9_-]{1,40}$/, 'lowercase role, e.g. "qa"'),
  reportsTo: z.string().max(128).nullable().optional(),
  authority: AuthorityInput.optional().describe('Direct grants. Only honoured when the caller is an admin.'),
  tokenTtlSeconds: z
    .number()
    .int()
    .min(60)
    .max(365 * 24 * 3600)
    .optional()
    .describe('Token lifetime; omit for a non-expiring token'),
  externalId: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe('Id of this person in your sign-in system (the JWT `sub`, e.g. a Supabase user id)'),
  access: z
    .enum(['act', 'audit', 'broker'])
    .optional()
    .describe('"audit" = read-only (ledger, integrity, approvals, policies); "broker" = a service (e.g. the Nexus worker) that acts only on behalf of identities that name it as their delegate'),
  delegate: z.string().max(128).optional().describe('Broker identity allowed to act on behalf of this one (admin only)'),
})
export type RegisterInput = z.input<typeof RegisterSchema>

export function newToken(): string {
  return `nops_${randomBytes(32).toString('base64url')}`
}

/** Deterministic, obviously-insecure tokens for the demo seed only. */
export function demoToken(agentId: string): string {
  return `nops_demo_${agentId.replace(/^agent\./, '')}`
}

export type TokenCheck =
  | { ok: true; agentId: string }
  | { ok: false; reason: 'unknown' | 'expired' | 'revoked' }

export function checkToken(token: string, now = new Date().toISOString()): TokenCheck {
  const info = store.tokenHashes.get(sha256(token))
  if (!info) return { ok: false, reason: 'unknown' }
  if (info.expiresAt && now > info.expiresAt) return { ok: false, reason: 'expired' }
  const agent = store.agents.get(info.agentId)
  if (!agent || agent.revokedAt) return { ok: false, reason: 'revoked' }
  return { ok: true, agentId: info.agentId }
}

export function agentForToken(token: string, now?: string): string | null {
  const c = checkToken(token, now)
  return c.ok ? c.agentId : null
}

export function addSeconds(iso: string, seconds: number): string {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString()
}

/** Applies a registration (live or replayed). No validation — callers validate. */
function applyRegisterInternal(agent: Agent, tokenHash: string, at: string, expiresAt: string | null = null): void {
  store.agents.set(agent.id, agent)
  store.tokenHashes.set(tokenHash, { agentId: agent.id, expiresAt })
  store.appendLedger({
    workspaceId: agent.workspaceId,
    actId: `adm_${String(store.journal.length + 1).padStart(6, '0')}`,
    actType: 'admin',
    actor: 'admin',
    via: 'system',
    taskId: null,
    intent: null,
    before: {},
    after: { agentId: agent.id, role: agent.role, authority: agent.authority, reportsTo: agent.reportsTo },
    references: [],
    deltaSummary: `registered ${agent.id} (${agent.model}, role ${agent.role})${expiresAt ? `, token expires ${expiresAt}` : ''}`,
    timestamp: at,
  })
  store.journalAppend({ k: 'register', agent: structuredClone(agent), tokenHash, expiresAt, at })
}

function registerAgentInternal(
  raw: unknown,
  opts: { asAdmin: boolean; token?: string; now?: string; workspaceId?: string; broker?: string }
): { agent: Agent; token: string; expiresAt: string | null } {
  const r = RegisterSchema.safeParse(raw)
  if (!r.success) throw invalid(`Invalid registration — ${formatZodError(r.error)}`)
  const input = r.data
  if (opts.broker) {
    // A broker may only create plain identities it acts for: no authority, no special access.
    if (!input.id.startsWith('agent.')) throw invalid('A broker registers agent identities only (agent.<name>)')
    input.authority = undefined
    input.access = undefined
    input.delegate = opts.broker
  } else if (!opts.asAdmin) {
    input.delegate = undefined
    if (input.access === 'broker') throw invalid('Only the admin can create a broker identity')
  }
  if (input.delegate && store.agents.get(input.delegate)?.access !== 'broker') throw invalid(`delegate ${input.delegate} is not a broker identity`)
  if (store.agents.has(input.id)) throw conflict(`Agent ${input.id} already exists`)
  if (input.externalId && [...store.agents.values()].some((a) => a.externalId === input.externalId)) {
    throw conflict(`externalId ${input.externalId} is already linked to another identity`)
  }
  if (input.reportsTo && !store.agents.has(input.reportsTo)) throw notFound(`reportsTo ${input.reportsTo} not found`)
  const workspaceId = opts.workspaceId ?? [...store.workspaces.keys()][0]
  if (!workspaceId) throw conflict('No workspace exists yet')

  const authority: AuthorityScope[] = opts.asAdmin
    ? (input.authority ?? []).map((a) => ({ ...a, requiresApproval: false, approver: input.id }))
    : []
  const at = opts.now ?? new Date().toISOString()
  const agent: Agent = {
    id: input.id,
    workspaceId,
    name: input.name,
    model: input.model,
    role: input.role,
    reportsTo: input.reportsTo ?? null,
    authority,
    status: 'online',
    subscriptions: ['workspace'],
    createdAt: at,
    revokedAt: null,
    ...(input.access === 'audit' || input.access === 'broker' ? { access: input.access, subscriptions: [] } : {}),
    ...(input.delegate ? { delegate: input.delegate } : {}),
    ...(input.externalId ? { externalId: input.externalId } : {}),
  }
  const token = opts.token ?? newToken()
  const expiresAt = input.tokenTtlSeconds ? addSeconds(at, input.tokenTtlSeconds) : null
  applyRegister(agent, sha256(token), at, expiresAt)
  return { agent, token, expiresAt }
}

export function applyRegister(...args: Parameters<typeof applyRegisterInternal>): ReturnType<typeof applyRegisterInternal> {
  return store.transaction(() => applyRegisterInternal(...args))
}

export function registerAgent(...args: Parameters<typeof registerAgentInternal>): ReturnType<typeof registerAgentInternal> {
  return store.transaction(() => registerAgentInternal(...args))
}
