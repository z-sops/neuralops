// Read scopes. With NEURALOPS_AGENT_READ=involved (the default in secure
// mode) an agent sees only what it is part of: tasks it owns, created,
// claimed, was handed or escalated, subscribes to, or manages (someone below
// it owns them); approvals it requested or decides; and ledger entries about
// those tasks or its own acts. Governors (`govern/*`), wildcard holders and
// the admin see the whole workspace.

import { store } from '../state/store.js'
import type { Approval, LedgerEvent, Task } from '../state/types.js'
import { hasAuthority, hasWildcard, isAbove } from './authority.js'
import { forbidden } from '../errors.js'

export function seesEverything(agentId: string): boolean {
  return hasWildcard(agentId) || hasAuthority(agentId, 'govern', '*')
}

export function canSeeTask(agentId: string, t: Task): boolean {
  if (t.assignee === agentId || t.createdBy === agentId) return true
  if (t.pendingHandoffTo === agentId || t.escalatedTo === agentId) return true
  if (t.claims.some((c) => c.agentId === agentId)) return true
  if (t.handoffs.some((h) => h.from === agentId || h.to === agentId)) return true
  if (store.agents.get(agentId)?.subscriptions.includes(t.id)) return true
  if (t.assignee && isAbove(agentId, t.assignee)) return true
  for (const a of store.approvals.values()) {
    if (a.taskId === t.id && (a.requestedBy === agentId || a.approver === agentId)) return true
  }
  return false
}

export function canSeeApproval(agentId: string, a: Approval): boolean {
  if (a.requestedBy === agentId || a.approver === agentId || isAbove(agentId, a.approver)) return true
  const t = a.taskId ? store.tasks.get(a.taskId) : undefined
  return !!t && canSeeTask(agentId, t)
}

export function canSeeEvent(agentId: string, e: LedgerEvent): boolean {
  if (e.actor === agentId) return true
  if ((e.after as Record<string, unknown>)?.agentId === agentId) return true
  const t = e.taskId ? store.tasks.get(e.taskId) : undefined
  if (t && canSeeTask(agentId, t)) return true
  return e.references.some((r) => {
    const a = r.startsWith('approval_') ? store.approvals.get(r) : undefined
    return !!a && canSeeApproval(agentId, a)
  })
}

/** Throws 403 unless this scoped agent may read the task. */
export function requireTaskVisible(agentId: string, taskId: string): void {
  const t = store.tasks.get(taskId)
  if (t && !canSeeTask(agentId, t)) throw forbidden(`${agentId} is not part of ${taskId} (read scope "involved").`)
}

export interface ScopedCaller {
  agentId: string | null
  scoped?: boolean
}

/** Apply a caller's read scope to lists. Unscoped callers get everything. */
export const view = {
  tasks: (c: ScopedCaller, list: Task[]) => (c.scoped && c.agentId ? list.filter((t) => canSeeTask(c.agentId!, t)) : list),
  approvals: (c: ScopedCaller, list: Approval[]) => (c.scoped && c.agentId ? list.filter((a) => canSeeApproval(c.agentId!, a)) : list),
  events: (c: ScopedCaller, list: readonly LedgerEvent[]) => (c.scoped && c.agentId ? list.filter((e) => canSeeEvent(c.agentId!, e)) : [...list]),
}
