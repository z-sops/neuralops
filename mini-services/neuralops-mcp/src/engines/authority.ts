// Authority Engine
//
// Enforces organizational authority. An agent attempting a constrained action
// (e.g. "deploy to production") without direct authority must request approval.
// Approvals are first-class audit-able records.

import { store } from '../state/store.js'
import type { Approval, AuthorityScope } from '../state/types.js'

export interface AuthorityCheckResult {
  allowed: boolean
  approval?: Approval
  reason: string
}

// Does this agent have direct authority for action/scope?
export function hasAuthority(
  agentId: string,
  action: string,
  scope: string
): boolean {
  const agent = store.agents.get(agentId)
  if (!agent) return false
  return agent.authority.some(
    (s: AuthorityScope) =>
      s.action === action &&
      (s.scope === scope || s.scope === '*') &&
      !s.requiresApproval
  )
}

// Has a previously-requested approval for this agent/action/scope been granted?
// Allows the request → authorize → complete flow.
export function hasApprovedApproval(
  agentId: string,
  action: string,
  scope: string,
  taskId: string | null
): boolean {
  for (const a of store.approvals.values()) {
    if (
      a.requestedBy === agentId &&
      a.action === action &&
      (a.scope === scope || a.scope === '*') &&
      a.status === 'approved' &&
      (taskId === null || a.taskId === taskId || a.taskId === null)
    ) {
      return true
    }
  }
  return false
}

// Does this action require approval at all (and from whom)?
// An agent who already holds direct authority does NOT need approval.
export function approvalRequired(
  agentId: string,
  action: string,
  scope: string
): { required: boolean; approver: string | null } {
  // Direct grant → no approval needed.
  if (hasAuthority(agentId, action, scope)) {
    return { required: false, approver: null }
  }
  // Otherwise scan every agent's authority table for a gatekeeping rule
  // (requiresApproval: true) matching this action/scope. The approver named
  // on that rule is who must authorize.
  for (const candidate of store.agents.values()) {
    for (const rule of candidate.authority) {
      if (
        rule.action === action &&
        (rule.scope === scope || rule.scope === '*') &&
        rule.requiresApproval
      ) {
        return { required: true, approver: rule.approver }
      }
    }
  }
  return { required: false, approver: null }
}

export function requestApproval(
  requestedBy: string,
  action: string,
  scope: string,
  taskId: string | null,
  references: string[] = []
): Approval {
  const check = approvalRequired(requestedBy, action, scope)
  const approver = check.approver || ''
  const approval: Approval = {
    id: store.newId('authority'),
    workspaceId: store.agents.get(requestedBy)?.workspaceId || 'ws_engineering',
    taskId,
    action,
    scope,
    requestedBy,
    approver,
    status: 'pending',
    decidedBy: null,
    decidedAt: null,
    reason: null,
    references,
    timestamp: new Date().toISOString(),
  }
  store.approvals.set(approval.id, approval)
  return approval
}

export function authorize(approvalId: string, decidedBy: string): Approval {
  const approval = store.approvals.get(approvalId)
  if (!approval) throw new Error(`Approval ${approvalId} not found`)
  if (approval.status !== 'pending')
    throw new Error(`Approval ${approvalId} is already ${approval.status}`)
  approval.status = 'approved'
  approval.decidedBy = decidedBy
  approval.decidedAt = new Date().toISOString()
  return approval
}

export function deny(approvalId: string, decidedBy: string, reason: string): Approval {
  const approval = store.approvals.get(approvalId)
  if (!approval) throw new Error(`Approval ${approvalId} not found`)
  if (approval.status !== 'pending')
    throw new Error(`Approval ${approvalId} is already ${approval.status}`)
  approval.status = 'denied'
  approval.decidedBy = decidedBy
  approval.decidedAt = new Date().toISOString()
  approval.reason = reason
  return approval
}
