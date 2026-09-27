// Context Engine — Compaction
//
// The killer feature. An agent requesting task context receives a small,
// structured snapshot (OBJECTIVE / COMPLETED / DECISIONS / CONSTRAINTS /
// EVIDENCE / OPEN / NEXT) instead of inheriting another agent's entire
// conversation. Deeper detail is available on-demand via references.

import { store } from '../state/store.js'
import type { Decision, Evidence, Task } from '../state/types.js'
import { estimateTokens, formatTokens } from '../state/token-estimate.js'

export interface CompactedContext {
  taskId: string
  objective: string
  completed: string[]
  decisions: { id: string; text: string; decidedBy: string }[]
  constraints: string[]
  evidence: { id: string; type: string; summary: string; ref: string }[]
  open: string[]
  next: string[]
  owner: string | null
  status: string
  tokens: number
}

export interface FullContext {
  taskId: string
  tokens: number
  rawActs: unknown[]
  fullTask: unknown
  allDecisions: unknown[]
  allEvidence: unknown[]
}

export interface ContextComparison {
  taskId: string
  fullTokens: number
  compactedTokens: number
  reductionPct: number
  fullFormatted: string
  compactedFormatted: string
}

// Build the structured, compacted context an agent reads on handoff/claim.
export function getCompactedContext(taskId: string): CompactedContext {
  const task = store.tasks.get(taskId)
  if (!task) throw new Error(`Task ${taskId} not found`)

  const decisions: Decision[] = store.decisionsForTask(taskId)
  const evidence: Evidence[] = store.evidenceForTask(taskId)

  const completed: string[] = []
  if (task.status === 'completed') {
    completed.push(task.resultRef || task.objective)
  }
  // Treat each piece of evidence with type "result" as a completed item.
  for (const e of evidence) {
    if (e.type === 'result') completed.push(e.summary)
  }
  // Completed handoffs (accepted) also count as progress milestones.
  for (const h of task.handoffs) {
    if (h.accepted === true) {
      completed.push(`Handoff to ${h.to} (${h.intent}) — accepted`)
    }
  }

  const compacted: CompactedContext = {
    taskId,
    objective: task.objective,
    completed,
    decisions: decisions.map((d) => ({
      id: d.id,
      text: d.text,
      decidedBy: d.decidedBy,
    })),
    constraints: task.constraints,
    evidence: evidence.map((e) => ({
      id: e.id,
      type: e.type,
      summary: e.summary,
      ref: e.ref,
    })),
    open: task.openItems,
    next: task.nextSteps,
    owner: task.assignee,
    status: task.status,
    tokens: 0,
  }

  compacted.tokens = estimateTokens(compacted)
  return compacted
}

// The full raw context — every act log + full records. Used to demonstrate
// the reduction compaction produces.
export function getFullContext(taskId: string): FullContext {
  const task = store.tasks.get(taskId)
  if (!task) throw new Error(`Task ${taskId} not found`)
  const events = store.ledgerForTask(taskId)
  const decisions = store.decisionsForTask(taskId)
  const evidence = store.evidenceForTask(taskId)
  const rawActs = events.map((e) => ({
    seq: e.seq,
    type: e.actType,
    actor: e.actor,
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
    rawActs,
    fullTask: task,
    allDecisions: decisions,
    allEvidence: evidence,
  }
  ctx.tokens = estimateTokens(ctx)
  return ctx
}

export function getContextComparison(taskId: string): ContextComparison {
  const full = getFullContext(taskId)
  const compacted = getCompactedContext(taskId)
  const reductionPct =
    full.tokens > 0
      ? Math.round((1 - compacted.tokens / full.tokens) * 100)
      : 0
  return {
    taskId,
    fullTokens: full.tokens,
    compactedTokens: compacted.tokens,
    reductionPct,
    fullFormatted: formatFullContext(full),
    compactedFormatted: formatCompactedContext(compacted),
  }
}

export function formatCompactedContext(c: CompactedContext): string {
  const lines: string[] = []
  lines.push(`OBJECTIVE`)
  lines.push(c.objective)
  lines.push('')
  lines.push(`COMPLETED`)
  if (c.completed.length === 0) lines.push('(none yet)')
  else c.completed.forEach((x) => lines.push(`- ${x}`))
  lines.push('')
  lines.push(`DECISIONS`)
  if (c.decisions.length === 0) lines.push('(none yet)')
  else c.decisions.forEach((d) => lines.push(`- [${d.id}] ${d.text} (by ${d.decidedBy})`))
  lines.push('')
  lines.push(`CONSTRAINTS`)
  if (c.constraints.length === 0) lines.push('(none)')
  else c.constraints.forEach((x) => lines.push(`- ${x}`))
  lines.push('')
  lines.push(`EVIDENCE`)
  if (c.evidence.length === 0) lines.push('(none yet)')
  else c.evidence.forEach((e) => lines.push(`- [${e.id}] (${e.type}) ${e.summary} → ${e.ref}`))
  lines.push('')
  lines.push(`OPEN`)
  if (c.open.length === 0) lines.push('(none)')
  else c.open.forEach((x) => lines.push(`- ${x}`))
  lines.push('')
  lines.push(`NEXT`)
  if (c.next.length === 0) lines.push('(none)')
  else c.next.forEach((x) => lines.push(`- ${x}`))
  lines.push('')
  lines.push(`OWNER: ${c.owner || '(unclaimed)'}   STATUS: ${c.status}`)
  return lines.join('\n')
}

export function formatFullContext(f: FullContext): string {
  const lines: string[] = []
  lines.push(`=== FULL RAW CONTEXT (acts + records) for ${f.taskId} ===`)
  lines.push('')
  lines.push(`--- TASK ---`)
  lines.push(JSON.stringify(f.fullTask, null, 2))
  lines.push('')
  lines.push(`--- DECISIONS (${f.allDecisions.length}) ---`)
  lines.push(JSON.stringify(f.allDecisions, null, 2))
  lines.push('')
  lines.push(`--- EVIDENCE (${f.allEvidence.length}) ---`)
  lines.push(JSON.stringify(f.allEvidence, null, 2))
  lines.push('')
  lines.push(`--- ACT LOG (${f.rawActs.length} events) ---`)
  for (const a of f.rawActs) {
    lines.push(JSON.stringify(a))
  }
  return lines.join('\n')
}

// For on-demand deep retrieval (lazy loading).
export function getEvidenceById(id: string) {
  return store.evidence.get(id)
}
export function getDecisionById(id: string) {
  return store.decisions.get(id)
}
export function getOriginalContext(actId: string) {
  return store.acts.get(actId)
}

export { formatTokens }
