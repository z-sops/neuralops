// Context Engine — Compaction
//
// An agent requesting task context receives a small, structured snapshot
// (OBJECTIVE / COMPLETED / DECISIONS / CONSTRAINTS / EVIDENCE / OPEN / NEXT)
// instead of inheriting another agent's history. Detail is fetched on demand
// by reference (get_evidence / get_decision / get_original_context).
//
// Token counts are a chars/4 ESTIMATE (`method` says so on every response).
// "Full" = everything NeuralOps itself holds about the task (records + act
// log). It is not a measurement against an agent's real conversation.

import { store } from '../state/store.js'
import type { Approval, Decision, Evidence, Proposal, Question, Task } from '../state/types.js'
import { estimateTokens, formatTokens, TOKEN_METHOD } from '../state/token-estimate.js'
import { isExpired } from './task-manager.js'
import { notFound } from '../errors.js'
import { UNTRUSTED_NOTICE, untrusted } from './guard.js'

export interface CompactedContext {
  taskId: string
  title: string
  objective: string
  completed: string[]
  decisions: { id: string; text: string; decidedBy: string }[]
  constraints: string[]
  evidence: { id: string; type: string; summary: string; ref: string; verified: boolean; verifiedBy: string | null }[]
  open: string[]
  next: string[]
  gates: string[]
  clearances: string[]
  owner: string | null
  status: string
  tokens: number
  method: string
  notice: string
}

export interface FullContext {
  taskId: string
  tokens: number
  method: string
  rawActs: unknown[]
  fullTask: unknown
  allDecisions: unknown[]
  allEvidence: unknown[]
  allApprovals: unknown[]
}

export interface ContextComparison {
  taskId: string
  fullTokens: number
  compactedTokens: number
  reductionPct: number
  method: string
  fullFormatted: string
  compactedFormatted: string
}

function requireTask(taskId: string): Task {
  const task = store.tasks.get(taskId)
  if (!task) throw notFound(`Task ${taskId} not found`)
  return task
}

const nowIso = () => new Date().toISOString()

export function exchangeStatus(x: Question | Proposal, now = nowIso()): string {
  return x.status === 'open' && isExpired(x.expiresAt, now) ? 'expired' : x.status
}

export function getCompactedContext(taskId: string): CompactedContext {
  const task = requireTask(taskId)
  const decisions: Decision[] = store.decisionsForTask(taskId)
  const evidence: Evidence[] = store.evidenceForTask(taskId)
  const approvals: Approval[] = store.approvalsForTask(taskId)
  const now = nowIso()

  const completed: string[] = []
  if (task.status === 'completed') completed.push(untrusted(task.resultRef || task.objective))
  for (const e of evidence) if (e.type === 'result') completed.push(untrusted(e.summary))
  for (const h of task.handoffs) {
    if (h.accepted === true) completed.push(`Handoff ${h.from} → ${h.to} (${h.intent}) accepted`)
  }

  const open = task.openItems.map((x) => untrusted(x))
  if (task.status === 'blocked' && task.blockedReason) open.push(`BLOCKED: ${untrusted(task.blockedReason)}`)
  if (task.pendingHandoffTo) open.push(`Handoff pending to ${task.pendingHandoffTo}`)
  for (const a of approvals) {
    if (a.status === 'pending') open.push(`Approval ${a.id} pending: ${a.action}/${a.scope} for ${a.requestedBy} (approver ${a.approver})`)
    if (a.status === 'approved' && !a.consumedAt) open.push(`Approval ${a.id} granted, not yet used: ${a.action}/${a.scope} for ${a.requestedBy}`)
    if (a.status === 'denied') open.push(`Approval ${a.id} DENIED by ${a.decidedBy}: ${untrusted(a.reason)}`)
  }
  for (const q of store.questions.values()) {
    if (q.taskId === taskId && exchangeStatus(q, now) === 'open') open.push(`Q ${q.id} ${q.from} → ${q.to}: ${untrusted(q.about)}`)
  }
  for (const p of store.proposals.values()) {
    if (p.taskId === taskId && exchangeStatus(p, now) === 'open') open.push(`Proposal ${p.id} ${p.from} → ${p.to}: ${untrusted(p.what)}`)
  }

  const next = task.nextSteps.map((x) => untrusted(x))
  if (task.eta) next.push(`ETA: ${untrusted(task.eta, 100)}`)

  const compacted: CompactedContext = {
    taskId,
    title: untrusted(task.title, 200),
    objective: untrusted(task.objective, 2000),
    completed,
    decisions: decisions.map((d) => ({ id: d.id, text: untrusted(d.text), decidedBy: d.decidedBy })),
    constraints: task.constraints.map((x) => untrusted(x)),
    evidence: evidence.map((e) => ({
      id: e.id,
      type: untrusted(e.type, 64),
      summary: untrusted(e.summary),
      ref: untrusted(e.ref, 300),
      verified: e.verified,
      verifiedBy: e.verifiedBy,
    })),
    open,
    next,
    gates: task.gates.map((g) => `${g.action}/${g.scope}${g.requireVerified?.length ? ` (needs verified: ${g.requireVerified.join(', ')})` : ''}`),
    clearances: (task.clearances ?? []).map((c) => `${c.action}/${c.scope} cleared via ${c.via}${c.approvalId ? ` ${c.approvalId}` : ''} by ${c.by}`),
    owner: task.assignee,
    status: task.status,
    tokens: 0,
    method: TOKEN_METHOD,
    notice: UNTRUSTED_NOTICE,
  }
  compacted.tokens = estimateTokens(formatCompactedContext(compacted))
  return compacted
}

export function getFullContext(taskId: string): FullContext {
  const task = requireTask(taskId)
  const rawActs = store.ledgerForTask(taskId).map((e) => ({
    seq: e.seq,
    type: e.actType,
    actor: e.actor,
    via: e.via,
    intent: e.intent,
    before: e.before,
    after: e.after,
    deltaSummary: e.deltaSummary,
    references: e.references,
    timestamp: e.timestamp,
  }))
  const ctx: FullContext = {
    taskId,
    tokens: 0,
    method: TOKEN_METHOD,
    rawActs,
    fullTask: task,
    allDecisions: store.decisionsForTask(taskId),
    allEvidence: store.evidenceForTask(taskId),
    allApprovals: store.approvalsForTask(taskId),
  }
  ctx.tokens = estimateTokens(formatFullContext(ctx))
  return ctx
}

export function getContextComparison(taskId: string): ContextComparison {
  const full = getFullContext(taskId)
  const compacted = getCompactedContext(taskId)
  const reductionPct = full.tokens > 0 ? Math.max(0, Math.round((1 - compacted.tokens / full.tokens) * 100)) : 0
  return {
    taskId,
    fullTokens: full.tokens,
    compactedTokens: compacted.tokens,
    reductionPct,
    method: TOKEN_METHOD,
    fullFormatted: formatFullContext(full),
    compactedFormatted: formatCompactedContext(compacted),
  }
}

function section(lines: string[], title: string, items: string[], empty: string) {
  lines.push(title)
  if (items.length === 0) lines.push(empty)
  else for (const x of items) lines.push(`- ${x}`)
  lines.push('')
}

export function formatCompactedContext(c: CompactedContext): string {
  const lines: string[] = [`TASK ${c.taskId} — ${c.title}`, c.notice, '', 'OBJECTIVE', c.objective, '']
  section(lines, 'COMPLETED', c.completed, '(none yet)')
  section(lines, 'DECISIONS', c.decisions.map((d) => `[${d.id}] ${d.text} (by ${d.decidedBy})`), '(none yet)')
  section(lines, 'CONSTRAINTS', c.constraints, '(none)')
  section(
    lines,
    'EVIDENCE',
    c.evidence.map((e) => `[${e.id}] (${e.type}, ${e.verified ? `VERIFIED by ${e.verifiedBy}` : 'self-reported'}) ${e.summary} → ${e.ref}`),
    '(none yet)'
  )
  section(lines, 'OPEN', c.open, '(none)')
  section(lines, 'NEXT', c.next, '(none)')
  if (c.gates.length) section(lines, 'GATES', c.gates, '')
  if (c.clearances.length) section(lines, 'CLEARED', c.clearances, '')
  lines.push(`OWNER: ${c.owner || '(unclaimed)'}   STATUS: ${c.status}`)
  return lines.join('\n')
}

export function formatFullContext(f: FullContext): string {
  const lines: string[] = [`=== FULL RAW CONTEXT (records + act log) for ${f.taskId} ===`, '']
  lines.push('--- TASK ---', JSON.stringify(f.fullTask, null, 2), '')
  lines.push(`--- DECISIONS (${f.allDecisions.length}) ---`, JSON.stringify(f.allDecisions, null, 2), '')
  lines.push(`--- EVIDENCE (${f.allEvidence.length}) ---`, JSON.stringify(f.allEvidence, null, 2), '')
  lines.push(`--- APPROVALS (${f.allApprovals.length}) ---`, JSON.stringify(f.allApprovals, null, 2), '')
  lines.push(`--- ACT LOG (${f.rawActs.length} events) ---`)
  for (const a of f.rawActs) lines.push(JSON.stringify(a))
  return lines.join('\n')
}

// ---- on-demand deep retrieval ----
export function getEvidenceById(id: string) {
  const e = store.evidence.get(id)
  if (!e) throw notFound(`Evidence ${id} not found`)
  return e
}
export function getDecisionById(id: string) {
  const d = store.decisions.get(id)
  if (!d) throw notFound(`Decision ${id} not found`)
  return d
}
export function getOriginalContext(actId: string) {
  const a = store.acts.get(actId)
  if (!a) throw notFound(`Act ${actId} not found`)
  return a
}

// ---- inbox: everything waiting on this agent ----
export function getInbox(agentId: string) {
  const agent = store.agents.get(agentId)
  if (!agent) throw notFound(`Agent ${agentId} not found`)
  const now = nowIso()
  const forMe = (to: string) => to === agentId || (to.startsWith('role:') && to.slice(5) === agent.role)
  const tasks = [...store.tasks.values()]
  return {
    agentId,
    myTasks: tasks
      .filter((t) => t.assignee === agentId && t.status !== 'completed' && t.status !== 'failed')
      .map((t) => ({ id: t.id, title: untrusted(t.title, 200), status: t.status, progress: t.progress })),
    handoffsToAccept: tasks
      .filter((t) => t.status === 'handoff_pending' && t.pendingHandoffTo === agentId)
      .map((t) => ({ taskId: t.id, from: t.assignee, intent: t.handoffs.at(-1)?.intent ?? null })),
    escalatedToMe: tasks
      .filter((t) => t.escalatedTo === agentId)
      .map((t) => ({ taskId: t.id, reason: t.blockedReason })),
    approvalsToDecide: [...store.approvals.values()].filter(
      (a) => a.status === 'pending' && a.approver === agentId
    ),
    myPendingApprovals: [...store.approvals.values()].filter(
      (a) => a.requestedBy === agentId && (a.status === 'pending' || (a.status === 'approved' && !a.consumedAt))
    ),
    questions: [...store.questions.values()]
      .filter((q) => forMe(q.to) && exchangeStatus(q, now) === 'open')
      .map((q) => ({ id: q.id, from: q.from, about: untrusted(q.about), taskId: q.taskId, expiresAt: q.expiresAt })),
    proposals: [...store.proposals.values()]
      .filter((p) => forMe(p.to) && exchangeStatus(p, now) === 'open')
      .map((p) => ({ id: p.id, from: p.from, what: untrusted(p.what), why: untrusted(p.why), taskId: p.taskId, expiresAt: p.expiresAt })),
  }
}

export { formatTokens }
