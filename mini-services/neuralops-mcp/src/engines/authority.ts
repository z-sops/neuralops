// Authority Engine
//
// Direct grants live on agents (AuthorityScope). Gatekeeping lives in
// workspace Policies. Approvals are single-use, task-bound, and can never be
// decided by the agent that requested them.

import { store } from '../state/store.js'
import type { Agent, Approval, AuthorityScope, Policy } from '../state/types.js'
import { conflict, forbidden, notFound } from '../errors.js'

const matches = (pattern: string, value: string) => pattern === '*' || pattern === value

/** Direct grant for action/scope (wildcards honoured). */
export function hasAuthority(agentId: string, action: string, scope: string): boolean {
  const agent = store.agents.get(agentId)
  if (!agent) return false
  return agent.authority.some(
    (s: AuthorityScope) => !s.requiresApproval && matches(s.action, action) && matches(s.scope, scope)
  )
}

export function hasWildcard(agentId: string): boolean {
  return !!store.agents
    .get(agentId)
    ?.authority.some((s) => s.action === '*' && s.scope === '*' && !s.requiresApproval)
}

/** True if `ancestorId` is strictly above `agentId` in the reporting chain. */
export function isAbove(ancestorId: string, agentId: string): boolean {
  const seen = new Set<string>()
  let cur: Agent | undefined = store.agents.get(agentId)
  while (cur && cur.reportsTo && !seen.has(cur.id)) {
    seen.add(cur.id)
    if (cur.reportsTo === ancestorId) return true
    cur = store.agents.get(cur.reportsTo)
  }
  return false
}

export function policyFor(action: string, scope: string): Policy | null {
  // Most specific first: exact action+scope, then wildcards.
  const all = [...store.policies.values()]
  const rank = (p: Policy) => (p.action === '*' ? 2 : 0) + (p.scope === '*' ? 1 : 0)
  return (
    all
      .filter((p) => matches(p.action, action) && matches(p.scope, scope))
      .sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))[0] ?? null
  )
}

/** Who must approve `agentId` doing action/scope. null ⇒ nobody can. */
export function resolveApprover(agentId: string, action: string, scope: string): string | null {
  const policy = policyFor(action, scope)
  if (policy && policy.approver !== agentId) return policy.approver
  // Fallback: the requester's manager.
  const manager = store.agents.get(agentId)?.reportsTo
  return manager ?? null
}

/** Can `deciderId` authorize/deny this approval as an approver? */
export function canDecide(deciderId: string, approval: Approval): boolean {
  if (deciderId === approval.requestedBy) return false // separation of duties
  if (deciderId === approval.approver) return true
  if (isAbove(deciderId, approval.approver)) return true
  return hasWildcard(deciderId)
}

/** Veto: agents holding `deny` authority on the approval's scope may deny it. */
export function canVeto(agentId: string, approval: Approval): boolean {
  if (agentId === approval.requestedBy) return false
  return hasAuthority(agentId, 'deny', approval.scope)
}

export function findPendingApproval(
  requestedBy: string,
  action: string,
  scope: string,
  taskId: string | null
): Approval | null {
  for (const a of store.approvals.values()) {
    if (
      a.status === 'pending' &&
      a.requestedBy === requestedBy &&
      a.action === action &&
      a.scope === scope &&
      a.taskId === taskId
    )
      return a
  }
  return null
}

/** An approved, not yet consumed approval for exactly this request. */
export function findConsumableApproval(
  requestedBy: string,
  action: string,
  scope: string,
  taskId: string | null
): Approval | null {
  for (const a of store.approvals.values()) {
    if (
      a.status === 'approved' &&
      a.consumedAt === null &&
      a.requestedBy === requestedBy &&
      a.action === action &&
      a.scope === scope &&
      a.taskId === taskId
    )
      return a
  }
  return null
}

export function consumeApproval(a: Approval, actId: string, at: string): void {
  a.consumedAt = at
  a.consumedBy = actId
}

export function createApproval(args: {
  requestedBy: string
  action: string
  scope: string
  taskId: string | null
  references: string[]
  at: string
}): Approval {
  const approver = resolveApprover(args.requestedBy, args.action, args.scope)
  if (!approver) {
    throw forbidden(
      `No approver for ${args.action}/${args.scope}: no workspace policy and ${args.requestedBy} has no manager.`
    )
  }
  const approval: Approval = {
    id: store.nextId('approval', (id) => store.approvals.has(id)),
    workspaceId: store.agents.get(args.requestedBy)?.workspaceId ?? 'ws_engineering',
    taskId: args.taskId,
    action: args.action,
    scope: args.scope,
    requestedBy: args.requestedBy,
    approver,
    status: 'pending',
    decidedBy: null,
    decidedAt: null,
    reason: null,
    references: args.references,
    timestamp: args.at,
    consumedAt: null,
    consumedBy: null,
  }
  store.approvals.set(approval.id, approval)
  return approval
}

function getPending(approvalId: string): Approval {
  const approval = store.approvals.get(approvalId)
  if (!approval) throw notFound(`Approval ${approvalId} not found`)
  if (approval.status !== 'pending') throw conflict(`Approval ${approvalId} is already ${approval.status}`)
  return approval
}

export function authorize(approvalId: string, decidedBy: string, at: string): Approval {
  const approval = getPending(approvalId)
  if (decidedBy === approval.requestedBy) {
    throw forbidden(`${decidedBy} cannot authorize its own request ${approvalId}`)
  }
  if (!canDecide(decidedBy, approval)) {
    throw forbidden(
      `${decidedBy} cannot authorize ${approvalId}: approver is ${approval.approver} (or someone above them)`
    )
  }
  approval.status = 'approved'
  approval.decidedBy = decidedBy
  approval.decidedAt = at
  return approval
}

export function deny(approvalId: string, decidedBy: string, reason: string, at: string): Approval {
  const approval = getPending(approvalId)
  if (decidedBy === approval.requestedBy) {
    throw forbidden(`${decidedBy} cannot decide its own request ${approvalId}`)
  }
  if (!canDecide(decidedBy, approval) && !canVeto(decidedBy, approval)) {
    throw forbidden(
      `${decidedBy} cannot deny ${approvalId}: needs to be the approver chain or hold deny/${approval.scope}`
    )
  }
  approval.status = 'denied'
  approval.decidedBy = decidedBy
  approval.decidedAt = at
  approval.reason = reason
  return approval
}

/** Agents this agent is the named policy approver for (for the inspector). */
export function approverFor(agentId: string): string[] {
  return [...store.policies.values()]
    .filter((p) => p.approver === agentId)
    .map((p) => `${p.action}/${p.scope}`)
}
