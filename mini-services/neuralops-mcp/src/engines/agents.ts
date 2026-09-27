// Agent registry + token identity.
//
// Tokens are random 32-byte secrets returned exactly once at registration.
// Only their sha256 is stored (and journaled), so the journal can be shared
// without leaking credentials.

import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { sha256, store } from '../state/store.js'
import { AGENT_MODELS, type Agent, type AuthorityScope } from '../state/types.js'
import { conflict, invalid, notFound } from '../errors.js'
import { formatZodError } from '../protocol/payloads.js'

export const RegisterSchema = z.object({
  id: z
    .string()
    .regex(/^agent\.[a-z0-9][a-z0-9_-]{1,62}$/, 'agent ids look like agent.<name> (lowercase)')
    .describe('Agent id, e.g. "agent.reviewer"'),
  name: z.string().min(1).max(80),
  model: z.enum(AGENT_MODELS),
  role: z.string().regex(/^[a-z0-9_-]{1,40}$/, 'lowercase role, e.g. "qa"'),
  reportsTo: z.string().max(128).nullable().optional(),
  authority: z
    .array(z.object({ action: z.string().min(1).max(64), scope: z.string().min(1).max(64) }))
    .max(50)
    .optional()
    .describe('Direct grants. Only honoured when the caller is an admin.'),
})
export type RegisterInput = z.input<typeof RegisterSchema>

export function newToken(): string {
  return `nops_${randomBytes(32).toString('base64url')}`
}

/** Deterministic, obviously-insecure tokens for the demo seed only. */
export function demoToken(agentId: string): string {
  return `nops_demo_${agentId.replace(/^agent\./, '')}`
}

export function agentForToken(token: string): string | null {
  return store.tokenHashes.get(sha256(token)) ?? null
}

/** Applies a registration (live or replayed). No validation — callers validate. */
export function applyRegister(agent: Agent, tokenHash: string, at: string): void {
  store.agents.set(agent.id, agent)
  store.tokenHashes.set(tokenHash, agent.id)
  store.journalAppend({ k: 'register', agent: structuredClone(agent), tokenHash, at })
}

export function registerAgent(
  raw: unknown,
  opts: { asAdmin: boolean; token?: string; now?: string; workspaceId?: string }
): { agent: Agent; token: string } {
  const r = RegisterSchema.safeParse(raw)
  if (!r.success) throw invalid(`Invalid registration — ${formatZodError(r.error)}`)
  const input = r.data
  if (store.agents.has(input.id)) throw conflict(`Agent ${input.id} already exists`)
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
  }
  const token = opts.token ?? newToken()
  applyRegister(agent, sha256(token), at)
  return { agent, token }
}
