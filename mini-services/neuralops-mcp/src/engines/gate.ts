// Gate status — the question external enforcers ask.
//
// CI (GitHub required status check), Claude Code hooks and deploy scripts call
// this before merging / pushing / deploying. NeuralOps answers from recorded
// state only (task status, clearances, approvals, verified evidence), so an
// agent cannot talk its way past it.
//
//   action "complete" (merge / push to main):
//       allowed ⇔ task completed AND, if the task is gated for that scope,
//       a clearance for complete/<scope> was recorded when it completed.
//   any other action (e.g. "deploy"):
//       allowed ⇔ a usable (unexpired, unconsumed) approval exists for
//       task + action + scope, AND any verified-evidence
//       requirements on a matching gate are met.

import { store } from '../state/store.js'
import { notFound } from '../errors.js'
import { findConsumableApproval, findPendingApproval, hasAuthority, isUsable, policyFor, resolveApprover } from './authority.js'

export interface PerformCheck {
  action: string
  scope: string
  frozen: boolean
  /** A workspace policy covers this action/scope. */
  governed: boolean
  policyId: string | null
  approver: string | null
  /** The caller holds direct authority. */
  authority: boolean
  /** An approved, unused approval would be consumed by perform. */
  usableApprovalId: string | null
  pendingApprovalId: string | null
}

/** What `perform` would do right now, without recording or consuming anything. */
export function performCheck(agentId: string, action: string, scope: string, taskId: string | null): PerformCheck {
  store.assertWritable()
  const policy = policyFor(action, scope)
  const now = new Date().toISOString()
  return {
    action,
    scope,
    frozen: !!store.freeze,
    governed: !!policy,
    policyId: policy?.id ?? null,
    approver: policy ? resolveApprover(agentId, action, scope) : null,
    authority: hasAuthority(agentId, action, scope),
    usableApprovalId: findConsumableApproval(agentId, action, scope, taskId, now)?.id ?? null,
    pendingApprovalId: findPendingApproval(agentId, action, scope, taskId)?.id ?? null,
  }
}

export interface GateStatus {
  allowed: boolean
  reason: string
  taskId: string
  action: string
  scope: string
  taskStatus: string
  evidence: { type: string; verified: boolean }[]
  approvalId: string | null
}

export function gateStatus(taskId: string, action: string, scope: string): GateStatus {
  const task = store.tasks.get(taskId)
  if (!task) throw notFound(`Task ${taskId} not found`)
  const evidence = store.evidenceForTask(taskId).map((e) => ({ type: e.type, verified: e.verified }))
  const base = { taskId, action, scope, taskStatus: task.status, evidence, approvalId: null as string | null }

  if (store.persistenceFailure) {
    return { ...base, allowed: false, reason: 'Journal persistence failed; outcome uncertain. Restart and verify the journal before further clearance.' }
  }

  if (store.freeze) {
    const f = store.freeze
    return { ...base, allowed: false, reason: `Workspace is FROZEN (incident mode) by ${f.by} since ${f.at}: ${f.reason}.` }
  }

  const gates = task.gates.filter((g) => (g.action === action || g.action === '*') && g.scope === scope)
  for (const g of gates) {
    for (const type of g.requireVerified ?? []) {
      if (!store.evidenceForTask(taskId).some((e) => e.type === type && e.verified)) {
        return { ...base, allowed: false, reason: `Gate ${g.action}/${g.scope} needs VERIFIED "${type}" evidence (recorded by CI or another attest-authorized agent).` }
      }
    }
  }

  const clearance = task.clearances.find((c) => c.action === action && c.scope === scope)

  if (action === 'complete') {
    if (task.status !== 'completed') {
      return { ...base, allowed: false, reason: `Task ${taskId} is ${task.status}, not completed.` }
    }
    if (gates.length && !clearance) {
      return { ...base, allowed: false, reason: `Task ${taskId} is gated for complete/${scope} but no clearance was recorded.` }
    }
    return {
      ...base,
      allowed: true,
      approvalId: clearance?.approvalId ?? null,
      reason: clearance ? `Completed; complete/${scope} cleared via ${clearance.via}${clearance.approvalId ? ` ${clearance.approvalId}` : ''} by ${clearance.by}.` : `Completed; task is not gated for ${scope}.`,
    }
  }

  // A non-completion clearance is a historical receipt, never permission to
  // perform another action. Completion above deliberately checks that receipt.
  const now = new Date().toISOString()
  const approvals = store.approvalsForTask(taskId).filter((a) => a.action === action && a.scope === scope)
  const approved = approvals.find((a) => isUsable(a, now))
  if (approved) {
    return { ...base, allowed: true, approvalId: approved.id, reason: `${action}/${scope} approved by ${approved.decidedBy} (${approved.id}) for ${approved.requestedBy}.` }
  }
  const pending = approvals.find((a) => a.status === 'pending')
  if (pending) {
    return { ...base, allowed: false, approvalId: pending.id, reason: `${action}/${scope} approval ${pending.id} is still pending with ${pending.approver}.` }
  }
  return { ...base, allowed: false, reason: `No usable approval for ${action}/${scope} on ${taskId}. Request one with neuralops_request_approval.` }
}
