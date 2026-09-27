// Task Manager — the act dispatcher.
//
// This is the heart of the Coordination Core. It:
//   1. Validates the act envelope + typed payload.
//   2. Looks up current state (BEFORE).
//   3. Checks authority (may create an Approval and short-circuit).
//   4. Mutates state (produces AFTER).
//   5. Appends an immutable LedgerEvent capturing the state delta.
//
// Acts mutate state. Messages never become the state.

import { store } from '../state/store.js'
import { makeId, type Act } from '../protocol/envelope.js'
import type { ActType } from '../protocol/act-types.js'
import type { LedgerEvent, Task } from '../state/types.js'
import {
  AcceptHandoffPayload,
  AckPayload,
  AnswerPayload,
  AuthorizePayload,
  BlockPayload,
  ClaimPayload,
  CompletePayload,
  CounterPayload,
  DecisionPayload,
  DenyPayload,
  EscalatePayload,
  EvidencePayload,
  HandoffPayload,
  ProposalPayload,
  QuestionPayload,
  ReleasePayload,
  StatusPayload,
  SubscribePayload,
  UnsubscribePayload,
  UpdatePayload,
} from '../protocol/payloads.js'
import {
  hasAuthority,
  hasApprovedApproval,
  requestApproval,
  authorize as authorizeApproval,
  deny as denyApproval,
} from './authority.js'
import { ACT_FAMILY } from '../protocol/act-types.js'

export interface ActResult {
  ok: boolean
  act: Act
  ledgerEvent: LedgerEvent | null
  approval: import('../state/types.js').Approval | null
  error?: string
  stateChanged: boolean
  task?: Task
}

function snapshot(task: Task | undefined): Record<string, unknown> {
  if (!task) return {}
  const { ...rest } = task
  return JSON.parse(JSON.stringify(rest))
}

function recordLedger(
  act: Act,
  task: Task | undefined,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  deltaSummary: string,
  references: string[]
): LedgerEvent {
  const event: LedgerEvent = {
    id: store.newId('evt'),
    seq: store.nextSeq(),
    workspaceId:
      (task && task.workspaceId) ||
      store.agents.get(act.from)?.workspaceId ||
      'ws_engineering',
    actId: act.id,
    actType: act.type as ActType,
    actor: act.from,
    taskId: task?.id || act.taskId || null,
    intent: act.intent || null,
    before,
    after,
    references,
    deltaSummary,
    timestamp: act.timestamp,
  }
  store.appendLedger(event)
  return event
}

function fail(act: Act, error: string): ActResult {
  return {
    ok: false,
    act,
    ledgerEvent: null,
    approval: null,
    error,
    stateChanged: false,
  }
}

function getTask(act: Act): Task {
  const taskId = act.taskId
  if (!taskId) throw new Error('taskId required for this act')
  const task = store.tasks.get(taskId)
  if (!task) throw new Error(`Task ${taskId} not found`)
  return task
}

function getAgent(act: Act) {
  const agent = store.agents.get(act.from)
  if (!agent) throw new Error(`Agent ${act.from} not found`)
  return agent
}

// ---- the dispatcher ----
export function processAct(input: import('../protocol/envelope.js').ActInput): ActResult {
  // Finalize envelope
  const act: Act = {
    ...input,
    id: input.id || makeId('act'),
    timestamp: new Date().toISOString(),
    seq: store.nextSeq(),
  }
  // Normalize: most acts carry taskId in their payload. Promote it to the
  // envelope's top-level taskId so handlers (and the ledger) can rely on a
  // single field regardless of where the caller put it.
  if (!act.taskId && act.payload && typeof act.payload.taskId === 'string') {
    act.taskId = act.payload.taskId as string
  }
  // Ensure array/object fields always exist (zod defaults aren't applied
  // because we spread the raw input rather than parsing through ActSchema).
  if (!Array.isArray(act.references)) act.references = []
  if (!act.payload || typeof act.payload !== 'object') act.payload = {}
  store.acts.set(act.id, act)

  try {
    switch (act.type) {
      case 'claim':
        return handleClaim(act)
      case 'release':
        return handleRelease(act)
      case 'complete':
        return handleComplete(act)
      case 'block':
        return handleBlock(act)
      case 'status':
        return handleStatus(act)
      case 'handoff':
        return handleHandoff(act)
      case 'accept_handoff':
        return handleAcceptHandoff(act)
      case 'reject_handoff':
        return handleRejectHandoff(act)
      case 'evidence':
        return handleEvidence(act)
      case 'decision':
        return handleDecision(act)
      case 'update':
        return handleUpdate(act)
      case 'question':
        return handleQuestion(act)
      case 'answer':
        return handleAnswer(act)
      case 'proposal':
        return handleProposal(act)
      case 'counter':
        return handleCounter(act)
      case 'request_approval':
        return handleRequestApproval(act)
      case 'authorize':
        return handleAuthorize(act)
      case 'deny':
        return handleDeny(act)
      case 'escalate':
        return handleEscalate(act)
      case 'subscribe':
        return handleSubscribe(act)
      case 'unsubscribe':
        return handleUnsubscribe(act)
      case 'ack':
        return handleAck(act)
      default:
        return fail(act, `Unknown act type: ${act.type as string}`)
    }
  } catch (e) {
    return fail(act, (e as Error).message)
  }
}

// ============ task family ============

function handleClaim(act: Act): ActResult {
  const p = ClaimPayload.parse(act.payload)
  const task = store.tasks.get(p.taskId)
  if (!task) return fail(act, `Task ${p.taskId} not found`)
  if (task.status === 'completed' || task.status === 'failed')
    return fail(act, `Task is ${task.status}`)
  if (task.assignee && task.assignee !== act.from)
    return fail(
      act,
      `Task already claimed by ${task.assignee}. Use handoff instead.`
    )
  if (task.pendingHandoffTo && task.pendingHandoffTo !== act.from)
    return fail(
      act,
      `Task is pending handoff to ${task.pendingHandoffTo}.`
    )

  const before = snapshot(task)
  task.assignee = act.from
  task.status = 'in_progress'
  task.pendingHandoffTo = null
  task.blockedReason = null
  task.claims.push({
    agentId: act.from,
    timestamp: act.timestamp,
    note: p.note,
  })
  task.updatedAt = act.timestamp
  // auto-subscribe claimer
  subscribeTo(act.from, p.taskId)

  const evt = recordLedger(
    act,
    task,
    { status: before.status, assignee: before.assignee },
    { status: task.status, assignee: task.assignee },
    `${act.from} claimed task ${p.taskId}`,
    act.references
  )
  return { ok: true, act, ledgerEvent: evt, approval: null, stateChanged: true, task }
}

function handleRelease(act: Act): ActResult {
  const p = ReleasePayload.parse(act.payload)
  const task = getTask(act)
  if (task.assignee !== act.from)
    return fail(act, `Only the current owner can release. Owner is ${task.assignee}`)
  const before = snapshot(task)
  task.assignee = null
  task.status = 'unclaimed'
  task.updatedAt = act.timestamp
  unsubscribeFrom(act.from, p.taskId)
  const evt = recordLedger(
    act,
    task,
    { status: before.status, assignee: before.assignee },
    { status: task.status, assignee: task.assignee },
    `${act.from} released task ${p.taskId}: ${p.reason}`,
    act.references
  )
  return { ok: true, act, ledgerEvent: evt, approval: null, stateChanged: true, task }
}

function handleComplete(act: Act): ActResult {
  const p = CompletePayload.parse(act.payload)
  const task = getTask(act)
  if (task.assignee !== act.from)
    return fail(act, `Only the current owner can complete. Owner is ${task.assignee}`)

  // Authority check: "complete" with a deploy/production scope requires approval.
  // We infer this from evidence type "deploy" or resultRef containing "production".
  const isDeploy =
    p.evidence?.some((e) => e.type === 'deploy') ||
    (p.resultRef || '').includes('production')

  if (isDeploy && !hasAuthority(act.from, 'complete', 'production') && !hasApprovedApproval(act.from, 'complete', 'production', p.taskId)) {
    // Create approval request, do NOT complete yet.
    const approval = requestApproval(
      act.from,
      'complete',
      'production',
      p.taskId,
      act.references
    )
    recordLedger(
      act,
      task,
      { status: task.status },
      { status: task.status, pendingApproval: approval.id },
      `${act.from} requested approval to complete (deploy) task ${p.taskId} → approval ${approval.id}`,
      [...act.references, approval.id]
    )
    return {
      ok: true,
      act,
      ledgerEvent: null,
      approval,
      stateChanged: false,
      task,
    }
  }

  const before = snapshot(task)
  task.status = 'completed'
  task.resultRef = p.resultRef || p.summary
  task.progress = 100
  task.assignee = act.from
  // attach evidence
  for (const e of p.evidence || []) {
    const id = store.newId('evidence')
    store.evidence.set(id, {
      id,
      taskId: task.id,
      type: e.type,
      summary: e.summary,
      ref: e.ref,
      producedBy: act.from,
      references: act.references,
      timestamp: act.timestamp,
    })
    task.evidenceIds.push(id)
  }
  // move open→done by clearing nextSteps that were the completion
  task.updatedAt = act.timestamp
  const evt = recordLedger(
    act,
    task,
    { status: before.status, resultRef: before.resultRef, progress: before.progress },
    { status: task.status, resultRef: task.resultRef, progress: task.progress },
    `${act.from} completed task ${p.taskId}: ${p.summary}`,
    [...act.references, ...(p.evidence || []).map(() => '')]
  )
  return { ok: true, act, ledgerEvent: evt, approval: null, stateChanged: true, task }
}

function handleBlock(act: Act): ActResult {
  const p = BlockPayload.parse(act.payload)
  const task = getTask(act)
  if (task.assignee !== act.from)
    return fail(act, `Only the current owner can block.`)
  const before = snapshot(task)
  task.status = 'blocked'
  task.blockedReason = p.reason
  task.updatedAt = act.timestamp
  const evt = recordLedger(
    act,
    task,
    { status: before.status },
    { status: task.status, blockedReason: task.blockedReason },
    `${act.from} blocked task ${p.taskId}: ${p.reason}`,
    act.references
  )
  return { ok: true, act, ledgerEvent: evt, approval: null, stateChanged: true, task }
}

function handleStatus(act: Act): ActResult {
  const p = StatusPayload.parse(act.payload)
  const task = getTask(act)
  const before = { progress: task.progress }
  task.progress = p.progress
  if (p.eta) task.nextSteps = [...task.nextSteps, `ETA: ${p.eta}`]
  task.updatedAt = act.timestamp
  const evt = recordLedger(
    act,
    task,
    before,
    { progress: task.progress },
    `${act.from} status update on ${p.taskId}: ${p.progress}%${p.note ? ' — ' + p.note : ''}`,
    act.references
  )
  return { ok: true, act, ledgerEvent: evt, approval: null, stateChanged: true, task }
}

// ============ handoff family ============

function handleHandoff(act: Act): ActResult {
  const p = HandoffPayload.parse(act.payload)
  const task = getTask(act)
  if (task.assignee !== act.from)
    return fail(act, `Only the current owner can hand off.`)
  const target = store.agents.get(p.to)
  if (!target) return fail(act, `Target agent ${p.to} not found`)
  const before = snapshot(task)
  task.pendingHandoffTo = p.to
  task.status = 'handoff_pending'
  task.handoffs.push({
    from: act.from,
    to: p.to,
    intent: p.intent,
    timestamp: act.timestamp,
    accepted: null,
  })
  task.updatedAt = act.timestamp
  // notify target by auto-subscribing
  subscribeTo(p.to, p.taskId)
  const evt = recordLedger(
    act,
    task,
    { status: before.status, pendingHandoffTo: before.pendingHandoffTo },
    { status: task.status, pendingHandoffTo: task.pendingHandoffTo },
    `${act.from} → handoff ${p.taskId} to ${p.to} (intent: ${p.intent})`,
    act.references
  )
  return { ok: true, act, ledgerEvent: evt, approval: null, stateChanged: true, task }
}

function handleAcceptHandoff(act: Act): ActResult {
  const p = AcceptHandoffPayload.parse(act.payload)
  const task = getTask(act)
  if (task.pendingHandoffTo !== act.from)
    return fail(act, `No pending handoff to ${act.from}.`)
  const before = snapshot(task)
  const ho = [...task.handoffs].reverse().find((h) => h.to === act.from && h.accepted === null)
  if (ho) {
    ho.accepted = true
    ho.acceptedAt = act.timestamp
  }
  const previousOwner = task.assignee
  task.assignee = act.from
  task.pendingHandoffTo = null
  task.status = 'in_progress'
  task.updatedAt = act.timestamp
  const evt = recordLedger(
    act,
    task,
    { assignee: before.assignee, status: before.status },
    { assignee: task.assignee, status: task.status },
    `${act.from} accepted handoff of ${p.taskId} from ${previousOwner}`,
    act.references
  )
  return { ok: true, act, ledgerEvent: evt, approval: null, stateChanged: true, task }
}

function handleRejectHandoff(act: Act): ActResult {
  const p = RejectHandoffPayload.parse(act.payload)
  const task = getTask(act)
  if (task.pendingHandoffTo !== act.from)
    return fail(act, `No pending handoff to ${act.from}.`)
  const before = snapshot(task)
  const ho = [...task.handoffs].reverse().find((h) => h.to === act.from && h.accepted === null)
  if (ho) {
    ho.accepted = false
    ho.rejectedReason = p.reason
  }
  task.pendingHandoffTo = null
  task.status = 'in_progress'
  task.updatedAt = act.timestamp
  const evt = recordLedger(
    act,
    task,
    { pendingHandoffTo: before.pendingHandoffTo, status: before.status },
    { pendingHandoffTo: null, status: task.status },
    `${act.from} rejected handoff of ${p.taskId}: ${p.reason}`,
    act.references
  )
  return { ok: true, act, ledgerEvent: evt, approval: null, stateChanged: true, task }
}

// ============ information family ============

function handleEvidence(act: Act): ActResult {
  const p = EvidencePayload.parse(act.payload)
  const task = getTask(act)
  const id = store.newId('evidence')
  store.evidence.set(id, {
    id,
    taskId: task.id,
    type: p.type,
    summary: p.summary,
    ref: p.ref,
    producedBy: act.from,
    references: act.references,
    timestamp: act.timestamp,
  })
  task.evidenceIds.push(id)
  task.updatedAt = act.timestamp
  const evt = recordLedger(
    act,
    task,
    { evidenceIds: task.evidenceIds.slice(0, -1) },
    { evidenceIds: task.evidenceIds },
    `${act.from} recorded evidence [${id}] (${p.type}): ${p.summary}`,
    [...act.references, id]
  )
  return { ok: true, act, ledgerEvent: evt, approval: null, stateChanged: true, task }
}

function handleDecision(act: Act): ActResult {
  const p = DecisionPayload.parse(act.payload)
  const task = getTask(act)
  const id = store.newId('decision')
  store.decisions.set(id, {
    id,
    taskId: task.id,
    text: p.text,
    rationale: p.rationale || null,
    decidedBy: act.from,
    references: act.references,
    timestamp: act.timestamp,
  })
  task.decisionIds.push(id)
  task.updatedAt = act.timestamp
  const evt = recordLedger(
    act,
    task,
    { decisionIds: task.decisionIds.slice(0, -1) },
    { decisionIds: task.decisionIds },
    `${act.from} decided [${id}]: ${p.text}`,
    [...act.references, id]
  )
  return { ok: true, act, ledgerEvent: evt, approval: null, stateChanged: true, task }
}

function handleUpdate(act: Act): ActResult {
  const p = UpdatePayload.parse(act.payload)
  const task = getTask(act)
  const before = snapshot(task)
  const field = p.field as 'objective' | 'constraints' | 'openItems' | 'nextSteps'
  if (field === 'objective') {
    task.objective = String(p.value)
  } else {
    const arr = Array.isArray(p.value) ? p.value.map(String) : [String(p.value)]
    task[field] = arr
  }
  task.updatedAt = act.timestamp
  const evt = recordLedger(
    act,
    task,
    { [field]: before[field] },
    { [field]: task[field] },
    `${act.from} updated ${field} on ${p.taskId}`,
    act.references
  )
  return { ok: true, act, ledgerEvent: evt, approval: null, stateChanged: true, task }
}

// ============ conversation family ============

function handleQuestion(act: Act): ActResult {
  const p = QuestionPayload.parse(act.payload)
  const id = store.newId('question')
  store.questions.set(id, {
    id,
    taskId: p.taskId || act.taskId || null,
    from: act.from,
    to: p.to,
    about: p.about,
    contextRef: p.contextRef || null,
    answered: false,
    answer: null,
    timestamp: act.timestamp,
  })
  const evt = recordLedger(
    act,
    act.taskId ? store.tasks.get(act.taskId) : undefined,
    {},
    { questionId: id },
    `${act.from} → ${p.to}: Q "${p.about}"`,
    [...act.references, id]
  )
  return { ok: true, act, ledgerEvent: evt, approval: null, stateChanged: true }
}

function handleAnswer(act: Act): ActResult {
  const p = AnswerPayload.parse(act.payload)
  const q = store.questions.get(p.questionId)
  if (!q) return fail(act, `Question ${p.questionId} not found`)
  const before = { answered: q.answered, answer: q.answer }
  q.answered = true
  q.answer = p.payload
  const evt = recordLedger(
    act,
    q.taskId ? store.tasks.get(q.taskId) : undefined,
    before,
    { answered: true, answer: q.answer },
    `${act.from} answered ${p.questionId}`,
    [...act.references, p.questionId]
  )
  return { ok: true, act, ledgerEvent: evt, approval: null, stateChanged: true }
}

function handleProposal(act: Act): ActResult {
  const p = ProposalPayload.parse(act.payload)
  const id = store.newId('proposal')
  store.proposals.set(id, {
    id,
    taskId: p.taskId || act.taskId || null,
    from: act.from,
    to: p.to,
    what: p.what,
    why: p.why,
    countered: false,
    counter: null,
    timestamp: act.timestamp,
  })
  const evt = recordLedger(
    act,
    act.taskId ? store.tasks.get(act.taskId) : undefined,
    {},
    { proposalId: id },
    `${act.from} → ${p.to}: propose "${p.what}" (${p.why})`,
    [...act.references, id]
  )
  return { ok: true, act, ledgerEvent: evt, approval: null, stateChanged: true }
}

function handleCounter(act: Act): ActResult {
  const p = CounterPayload.parse(act.payload)
  const pr = store.proposals.get(p.proposalId)
  if (!pr) return fail(act, `Proposal ${p.proposalId} not found`)
  const before = { countered: pr.countered, counter: pr.counter }
  pr.countered = true
  pr.counter = p.alternative
  const evt = recordLedger(
    act,
    pr.taskId ? store.tasks.get(pr.taskId) : undefined,
    before,
    { countered: true, counter: pr.counter },
    `${act.from} counters ${p.proposalId}: ${p.alternative}`,
    [...act.references, p.proposalId]
  )
  return { ok: true, act, ledgerEvent: evt, approval: null, stateChanged: true }
}

// ============ authority family ============

function handleRequestApproval(act: Act): ActResult {
  const p = RequestApprovalPayload.parse(act.payload)
  const approval = requestApproval(
    act.from,
    p.action,
    p.scope,
    p.taskId || act.taskId || null,
    act.references
  )
  const task = p.taskId || act.taskId ? store.tasks.get(p.taskId || act.taskId!) : undefined
  const evt = recordLedger(
    act,
    task,
    {},
    { approvalId: approval.id, status: 'pending' },
    `${act.from} requested approval for ${p.action}/${p.scope} → ${approval.id} (approver: ${approval.approver || 'unassigned'})`,
    [...act.references, approval.id]
  )
  return { ok: true, act, ledgerEvent: evt, approval, stateChanged: true, task }
}

function handleAuthorize(act: Act): ActResult {
  const p = AuthorizePayload.parse(act.payload)
  const approval = authorizeApproval(p.approvalId, act.from)
  const task = approval.taskId ? store.tasks.get(approval.taskId) : undefined
  const evt = recordLedger(
    act,
    task,
    { approvalStatus: 'pending' },
    { approvalStatus: 'approved', decidedBy: act.from },
    `${act.from} AUTHORIZED ${approval.id} (${approval.action}/${approval.scope})`,
    [...act.references, approval.id]
  )
  return { ok: true, act, ledgerEvent: evt, approval, stateChanged: true, task }
}

function handleDeny(act: Act): ActResult {
  const p = DenyPayload.parse(act.payload)
  const approval = denyApproval(p.approvalId, act.from, p.reason)
  const task = approval.taskId ? store.tasks.get(approval.taskId) : undefined
  const evt = recordLedger(
    act,
    task,
    { approvalStatus: 'pending' },
    { approvalStatus: 'denied', decidedBy: act.from, reason: p.reason },
    `${act.from} DENIED ${approval.id} (${approval.action}/${approval.scope}): ${p.reason}`,
    [...act.references, approval.id]
  )
  return { ok: true, act, ledgerEvent: evt, approval, stateChanged: true, task }
}

function handleEscalate(act: Act): ActResult {
  const p = EscalatePayload.parse(act.payload)
  const task = store.tasks.get(p.taskId)
  if (!task) return fail(act, `Task ${p.taskId} not found`)
  const before = snapshot(task)
  task.status = 'blocked'
  task.blockedReason = `Escalated to ${p.to}: ${p.reason}`
  task.updatedAt = act.timestamp
  const evt = recordLedger(
    act,
    task,
    { status: before.status },
    { status: task.status, escalatedTo: p.to },
    `${act.from} escalated ${p.taskId} to ${p.to}: ${p.reason}`,
    act.references
  )
  return { ok: true, act, ledgerEvent: evt, approval: null, stateChanged: true, task }
}

// ============ lifecycle family ============

function subscribeTo(agentId: string, taskId: string) {
  const agent = store.agents.get(agentId)
  if (agent && !agent.subscriptions.includes(taskId)) {
    agent.subscriptions.push(taskId)
  }
}

function unsubscribeFrom(agentId: string, taskId: string) {
  const agent = store.agents.get(agentId)
  if (agent) {
    agent.subscriptions = agent.subscriptions.filter((s) => s !== taskId)
  }
}

function handleSubscribe(act: Act): ActResult {
  const p = SubscribePayload.parse(act.payload)
  const agent = getAgent(act)
  const target = p.taskId || p.scope
  if (target && !agent.subscriptions.includes(target)) {
    agent.subscriptions.push(target)
  }
  const evt = recordLedger(
    act,
    undefined,
    { subscriptions: agent.subscriptions.slice(0, -1) },
    { subscriptions: agent.subscriptions },
    `${act.from} subscribed to ${target}`,
    act.references
  )
  return { ok: true, act, ledgerEvent: evt, approval: null, stateChanged: true }
}

function handleUnsubscribe(act: Act): ActResult {
  const p = UnsubscribePayload.parse(act.payload)
  const agent = getAgent(act)
  const target = p.taskId || p.scope
  if (target) {
    agent.subscriptions = agent.subscriptions.filter((s) => s !== target)
  }
  const evt = recordLedger(
    act,
    undefined,
    {},
    { subscriptions: agent.subscriptions },
    `${act.from} unsubscribed from ${target}`,
    act.references
  )
  return { ok: true, act, ledgerEvent: evt, approval: null, stateChanged: true }
}

function handleAck(act: Act): ActResult {
  const p = AckPayload.parse(act.payload)
  const evt = recordLedger(
    act,
    undefined,
    {},
    { acked: p.actId },
    `${act.from} acked act ${p.actId}`,
    [...act.references, p.actId]
  )
  return { ok: true, act, ledgerEvent: evt, approval: null, stateChanged: true }
}

export { ACT_FAMILY }
