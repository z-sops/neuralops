// Task Manager — the act dispatcher.
//
// processAct():
//   1. Validates the envelope (ActSchema) and the typed payload (PAYLOAD_SCHEMAS).
//   2. Verifies the actor is a registered agent.
//   3. Runs the handler. Handlers check EVERY precondition before mutating
//      anything, so a rejected act leaves no trace (counters are restored too).
//   4. Appends a hash-chained LedgerEvent for each state change.
//   5. Journals the accepted act — the journal is the source of truth.
//
// Acts mutate state. Messages never become the state.

import { store } from '../state/store.js'
import { ActSchema, type Act, type ActVia } from '../protocol/envelope.js'
import type { ActType } from '../protocol/act-types.js'
import {
  PAYLOAD_SCHEMAS,
  formatZodError,
  type PayloadOf,
} from '../protocol/payloads.js'
import type { Approval, Gate, LedgerEvent, Task, TaskStatus } from '../state/types.js'
import {
  NeuralOpsError,
  conflict,
  forbidden,
  invalid,
  notFound,
  type ErrorCode,
} from '../errors.js'
import {
  authorize as authorizeApproval,
  consumeApproval,
  createApproval,
  deny as denyApproval,
  findConsumableApproval,
  findPendingApproval,
  hasAuthority,
  hasWildcard,
  isAbove,
  policyFor,
} from './authority.js'

export interface ActResult {
  ok: boolean
  act: Act | null
  ledgerEvent: LedgerEvent | null
  approval: Approval | null
  stateChanged: boolean
  task?: Task
  message?: string
  error?: string
  errorCode?: ErrorCode
}

export interface ProcessOptions {
  via?: ActVia
  /** Replaying a journaled act: keep its id/timestamp/seq, skip journaling side-effects. */
  replay?: boolean
  now?: string
}

type HandlerOut = Omit<ActResult, 'ok' | 'act'>
type Handler<T extends ActType> = (act: Act, p: PayloadOf<T>) => HandlerOut

const DEFAULT_TTL_SECONDS = 3600
const clone = <T>(v: T): T => structuredClone(v)

// ---------------------------------------------------------------- helpers

function record(
  act: Act,
  task: Task | null,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  deltaSummary: string,
  references: string[] = []
): LedgerEvent {
  return store.appendLedger({
    workspaceId: task?.workspaceId ?? store.agents.get(act.from)?.workspaceId ?? 'ws_engineering',
    actId: act.id,
    actType: act.type,
    actor: act.from,
    via: act.via,
    taskId: task?.id ?? act.taskId ?? null,
    intent: act.intent ?? null,
    before: clone(before),
    after: clone(after),
    references: [...new Set([...act.references, ...references])].filter(Boolean),
    deltaSummary,
    timestamp: act.timestamp,
  })
}

function requireTask(taskId: string): Task {
  const task = store.tasks.get(taskId)
  if (!task) throw notFound(`Task ${taskId} not found`)
  return task
}

function requireOwner(task: Task, agentId: string, verb: string): void {
  if (task.assignee !== agentId) {
    throw forbidden(
      `Only the current owner can ${verb} ${task.id}. Owner is ${task.assignee ?? '(nobody)'}.`
    )
  }
}

function requireNoPendingHandoff(task: Task, verb: string): void {
  if (task.status === 'handoff_pending') {
    throw conflict(
      `Cannot ${verb} ${task.id} while a handoff to ${task.pendingHandoffTo} is pending. Wait for accept/reject, or release the task.`
    )
  }
}

function requireOpen(task: Task, verb: string): void {
  if (task.status === 'completed' || task.status === 'failed') {
    throw conflict(`Cannot ${verb} ${task.id}: task is ${task.status}.`)
  }
}

function canGovern(agentId: string): boolean {
  return hasAuthority(agentId, 'govern', '*')
}

/** Owner, anyone above the owner, governors, or the creator of an unassigned task. */
function canManage(agentId: string, task: Task): boolean {
  if (task.assignee === agentId) return true
  if (task.assignee && isAbove(agentId, task.assignee)) return true
  if (!task.assignee && task.createdBy === agentId) return true
  return hasWildcard(agentId) || canGovern(agentId)
}

function requireAgent(id: string, what = 'Agent'): void {
  if (!store.agents.has(id)) throw notFound(`${what} ${id} not found`)
}

/** "agent.x" must exist; "role:x" must match at least one agent's role. */
function requireTarget(to: string): void {
  if (to.startsWith('role:')) {
    const role = to.slice(5)
    if (![...store.agents.values()].some((a) => a.role === role)) {
      throw notFound(`No agent has role "${role}"`)
    }
    return
  }
  requireAgent(to, 'Target agent')
}

function isRecipient(agentId: string, to: string): boolean {
  if (to === agentId) return true
  if (to.startsWith('role:')) return store.agents.get(agentId)?.role === to.slice(5)
  return false
}

function addSubscription(agentId: string, target: string): boolean {
  const agent = store.agents.get(agentId)
  if (!agent || agent.subscriptions.includes(target)) return false
  agent.subscriptions.push(target)
  return true
}

function removeSubscription(agentId: string, target: string): boolean {
  const agent = store.agents.get(agentId)
  if (!agent || !agent.subscriptions.includes(target)) return false
  agent.subscriptions = agent.subscriptions.filter((s) => s !== target)
  return true
}

function addSeconds(iso: string, seconds: number): string {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString()
}

function taskView(task: Task): Task {
  return clone(task)
}

const gateKey = (g: Gate) => `${g.action}/${g.scope}`

// ---------------------------------------------------------------- dispatcher

export function processAct(input: unknown, opts: ProcessOptions = {}): ActResult {
  const parsed = ActSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      act: null,
      ledgerEvent: null,
      approval: null,
      stateChanged: false,
      error: `Invalid act envelope — ${formatZodError(parsed.error)}`,
      errorCode: 'invalid',
    }
  }
  const env = parsed.data

  // Counters are restored if the act is rejected, so rejected acts leave no
  // trace and replay stays deterministic.
  const saved = store.exportCounters()

  let act: Act
  if (opts.replay) {
    const r = input as Partial<Act>
    act = {
      ...env,
      id: r.id!,
      timestamp: r.timestamp!,
      seq: r.seq!,
      via: r.via ?? 'system',
    }
    store.setActSeq(act.seq)
  } else {
    if (env.id && store.acts.has(env.id)) {
      return {
        ok: false,
        act: null,
        ledgerEvent: null,
        approval: null,
        stateChanged: false,
        error: `Duplicate act id ${env.id} — this act was already processed`,
        errorCode: 'conflict',
      }
    }
    const seq = store.nextActSeq()
    act = {
      ...env,
      id: env.id ?? `act_${String(seq).padStart(6, '0')}`,
      timestamp: opts.now ?? new Date().toISOString(),
      seq,
      via: opts.via ?? 'impersonated',
    }
  }

  try {
    if (!store.agents.has(act.from)) {
      throw forbidden(`Unknown agent ${act.from}. Register the agent before it can act.`)
    }
    const schema = PAYLOAD_SCHEMAS[act.type]
    const pr = schema.safeParse(act.payload)
    if (!pr.success) throw invalid(`Invalid ${act.type} payload — ${formatZodError(pr.error)}`)
    const payload = pr.data as Record<string, unknown>
    act.payload = payload

    // Normalize taskId: payload is authoritative; envelope must agree if set.
    if (typeof payload.taskId === 'string') {
      if (act.taskId && act.taskId !== payload.taskId) {
        throw invalid(`Envelope taskId ${act.taskId} ≠ payload taskId ${payload.taskId}`)
      }
      act.taskId = payload.taskId
    }

    const out = dispatch(act, payload)
    store.acts.set(act.id, act)
    store.journalAppend({ k: 'act', act: clone(act) })
    return { ok: true, act, ...out }
  } catch (e) {
    store.restoreCounters(saved)
    const err =
      e instanceof NeuralOpsError ? e : new NeuralOpsError('invalid', (e as Error).message)
    return {
      ok: false,
      act,
      ledgerEvent: null,
      approval: null,
      stateChanged: false,
      error: err.message,
      errorCode: err.code,
    }
  }
}

function dispatch(act: Act, p: Record<string, unknown>): HandlerOut {
  const h = HANDLERS[act.type] as Handler<ActType>
  return h(act, p as never)
}

// ---------------------------------------------------------------- task family

const handleCreateTask: Handler<'create_task'> = (act, p) => {
  const id = p.id ?? store.nextId('task', (x) => store.tasks.has(x))
  if (store.tasks.has(id)) throw conflict(`Task ${id} already exists`)
  const agent = store.agents.get(act.from)!
  const task: Task = {
    id,
    workspaceId: agent.workspaceId,
    title: p.title,
    objective: p.objective,
    status: 'unclaimed',
    assignee: null,
    claims: [],
    handoffs: [],
    decisionIds: [],
    evidenceIds: [],
    constraints: p.constraints ?? [],
    openItems: p.openItems ?? [],
    nextSteps: p.nextSteps ?? [],
    gates: dedupeGates(p.gates ?? []),
    resultRef: null,
    progress: 0,
    eta: null,
    blockedReason: null,
    pendingHandoffTo: null,
    escalatedTo: null,
    createdBy: act.from,
    createdAt: act.timestamp,
    updatedAt: act.timestamp,
  }
  store.tasks.set(id, task)
  addSubscription(act.from, id)
  act.taskId = id
  const evt = record(act, task, {}, { status: 'unclaimed', title: task.title, gates: task.gates }, `${act.from} created task ${id}: ${task.title}`)
  return { ledgerEvent: evt, approval: null, stateChanged: true, task: taskView(task) }
}

function dedupeGates(gates: Gate[]): Gate[] {
  const seen = new Map<string, Gate>()
  for (const g of gates) seen.set(gateKey(g), { action: g.action, scope: g.scope })
  return [...seen.values()].sort((a, b) => gateKey(a).localeCompare(gateKey(b)))
}

const handleClaim: Handler<'claim'> = (act, p) => {
  const task = requireTask(p.taskId)
  requireOpen(task, 'claim')
  requireNoPendingHandoff(task, 'claim')

  const isOwner = task.assignee === act.from
  const isEscalationTarget = task.escalatedTo === act.from
  if (task.assignee && !isOwner && !isEscalationTarget) {
    throw conflict(`Task ${task.id} is owned by ${task.assignee}. Ask for a handoff instead.`)
  }
  if (isOwner && task.status === 'in_progress') {
    throw conflict(`${act.from} already owns ${task.id} and it is in progress.`)
  }

  const before = { status: task.status, assignee: task.assignee, blockedReason: task.blockedReason }
  task.assignee = act.from
  task.status = 'in_progress'
  task.blockedReason = null
  task.escalatedTo = null
  task.claims.push({ agentId: act.from, timestamp: act.timestamp, ...(p.note ? { note: p.note } : {}) })
  task.updatedAt = act.timestamp
  addSubscription(act.from, task.id)

  const how = isOwner ? 're-claimed (unblocked)' : before.assignee ? `took over from ${before.assignee}` : 'claimed'
  const evt = record(act, task, before, { status: task.status, assignee: task.assignee, blockedReason: null }, `${act.from} ${how} task ${task.id}`)
  return { ledgerEvent: evt, approval: null, stateChanged: true, task: taskView(task) }
}

const handleRelease: Handler<'release'> = (act, p) => {
  const task = requireTask(p.taskId)
  requireOpen(task, 'release')
  requireOwner(task, act.from, 'release')
  const before = { status: task.status, assignee: task.assignee, pendingHandoffTo: task.pendingHandoffTo }
  if (task.pendingHandoffTo) {
    const ho = pendingHandoff(task)
    if (ho) {
      ho.accepted = false
      ho.rejectedReason = `cancelled: owner released the task (${p.reason})`
    }
    task.pendingHandoffTo = null
  }
  task.assignee = null
  task.status = 'unclaimed'
  task.blockedReason = null
  task.updatedAt = act.timestamp
  removeSubscription(act.from, task.id)
  const evt = record(act, task, before, { status: task.status, assignee: null, pendingHandoffTo: null }, `${act.from} released task ${task.id}: ${p.reason}`)
  return { ledgerEvent: evt, approval: null, stateChanged: true, task: taskView(task) }
}

// Scopes a completion touches: task gates on "complete", the declared scope,
// and — conservatively — production if the evidence/resultRef says so.
// Inference can only ADD gates, never remove them.
function completionScopes(task: Task, p: PayloadOf<'complete'>): string[] {
  const scopes = new Set<string>()
  for (const g of task.gates) if (g.action === 'complete' || g.action === '*') scopes.add(g.scope)
  if (p.scope) scopes.add(p.scope)
  const looksProduction =
    (p.evidence ?? []).some((e) => e.type === 'deploy') ||
    /\bprod(uction)?\b|^prod(uction)?:/i.test(p.resultRef ?? '')
  if (looksProduction) scopes.add('production')
  return [...scopes]
    .filter((s) => task.gates.some((g) => g.scope === s) || policyFor('complete', s) !== null)
    .sort()
}

const handleComplete: Handler<'complete'> = (act, p) => {
  const task = requireTask(p.taskId)
  requireOpen(task, 'complete')
  requireOwner(task, act.from, 'complete')
  requireNoPendingHandoff(task, 'complete')
  if (task.status === 'blocked') {
    throw conflict(`Task ${task.id} is blocked (${task.blockedReason}). Re-claim it to unblock first.`)
  }

  // ---- authority gate ----
  const toConsume: Approval[] = []
  for (const scope of completionScopes(task, p)) {
    if (hasAuthority(act.from, 'complete', scope)) continue
    const granted = findConsumableApproval(act.from, 'complete', scope, task.id)
    if (granted) {
      toConsume.push(granted)
      continue
    }
    const existing = findPendingApproval(act.from, 'complete', scope, task.id)
    if (existing) {
      return {
        ledgerEvent: null,
        approval: existing,
        stateChanged: false,
        task: taskView(task),
        message: `Approval ${existing.id} is still pending with ${existing.approver}.`,
      }
    }
    const approval = createApproval({
      requestedBy: act.from,
      action: 'complete',
      scope,
      taskId: task.id,
      references: act.references,
      at: act.timestamp,
    })
    const evt = record(
      act,
      task,
      { status: task.status },
      { status: task.status, pendingApproval: approval.id },
      `${act.from} tried to complete ${task.id} (${scope}) → approval ${approval.id} required from ${approval.approver}`,
      [approval.id]
    )
    return {
      ledgerEvent: evt,
      approval,
      stateChanged: false,
      task: taskView(task),
      message: `Gated: ${scope}. Approval ${approval.id} requested from ${approval.approver}. Retry complete after it is authorized.`,
    }
  }

  // ---- complete ----
  const before = { status: task.status, resultRef: task.resultRef, progress: task.progress }
  const evidenceIds: string[] = []
  for (const e of p.evidence ?? []) {
    const id = store.nextId('evidence', (x) => store.evidence.has(x))
    store.evidence.set(id, {
      id,
      taskId: task.id,
      type: e.type,
      summary: e.summary,
      ref: e.ref,
      producedBy: act.from,
      references: [...act.references],
      timestamp: act.timestamp,
    })
    task.evidenceIds.push(id)
    evidenceIds.push(id)
  }
  for (const a of toConsume) consumeApproval(a, act.id, act.timestamp)
  task.status = 'completed'
  task.resultRef = p.resultRef ?? p.summary
  task.progress = 100
  task.eta = null
  task.updatedAt = act.timestamp
  const evt = record(
    act,
    task,
    before,
    { status: task.status, resultRef: task.resultRef, progress: 100, consumedApprovals: toConsume.map((a) => a.id) },
    `${act.from} completed task ${task.id}: ${p.summary}`,
    [...evidenceIds, ...toConsume.map((a) => a.id)]
  )
  return { ledgerEvent: evt, approval: toConsume[0] ?? null, stateChanged: true, task: taskView(task) }
}

const handleBlock: Handler<'block'> = (act, p) => {
  const task = requireTask(p.taskId)
  requireOpen(task, 'block')
  requireOwner(task, act.from, 'block')
  requireNoPendingHandoff(task, 'block')
  if (task.status === 'blocked') throw conflict(`Task ${task.id} is already blocked.`)
  const before = { status: task.status, blockedReason: task.blockedReason }
  task.status = 'blocked'
  task.blockedReason = p.reason
  task.updatedAt = act.timestamp
  const evt = record(act, task, before, { status: task.status, blockedReason: p.reason }, `${act.from} blocked task ${task.id}: ${p.reason}`)
  return { ledgerEvent: evt, approval: null, stateChanged: true, task: taskView(task) }
}

const handleStatus: Handler<'status'> = (act, p) => {
  const task = requireTask(p.taskId)
  requireOpen(task, 'report status on')
  requireOwner(task, act.from, 'report status on')
  const before = { progress: task.progress, eta: task.eta }
  task.progress = p.progress
  if (p.eta !== undefined) task.eta = p.eta
  task.updatedAt = act.timestamp
  const evt = record(
    act,
    task,
    before,
    { progress: task.progress, eta: task.eta },
    `${act.from} status on ${task.id}: ${p.progress}%${p.eta ? ` (ETA ${p.eta})` : ''}${p.note ? ` — ${p.note}` : ''}`
  )
  return { ledgerEvent: evt, approval: null, stateChanged: true, task: taskView(task) }
}

// ---------------------------------------------------------------- handoff family

function pendingHandoff(task: Task) {
  return [...task.handoffs].reverse().find((h) => h.to === task.pendingHandoffTo && h.accepted === null)
}

const handleHandoff: Handler<'handoff'> = (act, p) => {
  const task = requireTask(p.taskId)
  requireOpen(task, 'hand off')
  requireOwner(task, act.from, 'hand off')
  requireNoPendingHandoff(task, 'hand off')
  requireAgent(p.to, 'Target agent')
  if (p.to === act.from) throw invalid('Cannot hand a task off to yourself.')

  const before = { status: task.status, pendingHandoffTo: task.pendingHandoffTo }
  task.handoffs.push({
    from: act.from,
    to: p.to,
    intent: p.intent,
    timestamp: act.timestamp,
    accepted: null,
    statusBefore: task.status,
  })
  task.pendingHandoffTo = p.to
  task.status = 'handoff_pending'
  task.updatedAt = act.timestamp
  addSubscription(p.to, task.id)
  const evt = record(act, task, before, { status: task.status, pendingHandoffTo: p.to }, `${act.from} → handoff ${task.id} to ${p.to} (intent: ${p.intent})`)
  return { ledgerEvent: evt, approval: null, stateChanged: true, task: taskView(task) }
}

const handleAcceptHandoff: Handler<'accept_handoff'> = (act, p) => {
  const task = requireTask(p.taskId)
  if (task.status !== 'handoff_pending' || task.pendingHandoffTo !== act.from) {
    throw conflict(`No pending handoff of ${task.id} to ${act.from}.`)
  }
  const ho = pendingHandoff(task)
  const before = { assignee: task.assignee, status: task.status, pendingHandoffTo: task.pendingHandoffTo }
  const previousOwner = task.assignee
  if (ho) {
    ho.accepted = true
    ho.acceptedAt = act.timestamp
  }
  task.assignee = act.from
  task.pendingHandoffTo = null
  task.status = 'in_progress'
  task.blockedReason = null
  task.updatedAt = act.timestamp
  task.claims.push({ agentId: act.from, timestamp: act.timestamp, note: `accepted handoff (${ho?.intent ?? 'unknown intent'})` })
  const evt = record(act, task, before, { assignee: task.assignee, status: task.status, pendingHandoffTo: null }, `${act.from} accepted handoff of ${task.id} from ${previousOwner}`)
  return { ledgerEvent: evt, approval: null, stateChanged: true, task: taskView(task) }
}

const handleRejectHandoff: Handler<'reject_handoff'> = (act, p) => {
  const task = requireTask(p.taskId)
  if (task.status !== 'handoff_pending' || task.pendingHandoffTo !== act.from) {
    throw conflict(`No pending handoff of ${task.id} to ${act.from}.`)
  }
  const ho = pendingHandoff(task)
  const before = { status: task.status, pendingHandoffTo: task.pendingHandoffTo }
  const restored: TaskStatus = ho?.statusBefore ?? 'in_progress'
  if (ho) {
    ho.accepted = false
    ho.rejectedReason = p.reason
  }
  task.pendingHandoffTo = null
  task.status = restored
  task.updatedAt = act.timestamp
  removeSubscription(act.from, task.id)
  const evt = record(act, task, before, { status: restored, pendingHandoffTo: null }, `${act.from} rejected handoff of ${task.id}: ${p.reason}`)
  return { ledgerEvent: evt, approval: null, stateChanged: true, task: taskView(task) }
}

// ---------------------------------------------------------------- information family

const handleEvidence: Handler<'evidence'> = (act, p) => {
  const task = requireTask(p.taskId)
  const id = store.nextId('evidence', (x) => store.evidence.has(x))
  const before = { evidenceIds: [...task.evidenceIds] }
  store.evidence.set(id, {
    id,
    taskId: task.id,
    type: p.type,
    summary: p.summary,
    ref: p.ref,
    producedBy: act.from,
    references: [...act.references],
    timestamp: act.timestamp,
  })
  task.evidenceIds.push(id)
  task.updatedAt = act.timestamp
  const evt = record(act, task, before, { evidenceIds: [...task.evidenceIds] }, `${act.from} recorded evidence [${id}] (${p.type}): ${p.summary}`, [id])
  return { ledgerEvent: evt, approval: null, stateChanged: true, task: taskView(task) }
}

const handleDecision: Handler<'decision'> = (act, p) => {
  const task = requireTask(p.taskId)
  const id = store.nextId('decision', (x) => store.decisions.has(x))
  const before = { decisionIds: [...task.decisionIds] }
  store.decisions.set(id, {
    id,
    taskId: task.id,
    text: p.text,
    rationale: p.rationale ?? null,
    decidedBy: act.from,
    references: [...act.references],
    timestamp: act.timestamp,
  })
  task.decisionIds.push(id)
  task.updatedAt = act.timestamp
  const evt = record(act, task, before, { decisionIds: [...task.decisionIds] }, `${act.from} decided [${id}]: ${p.text}`, [id])
  return { ledgerEvent: evt, approval: null, stateChanged: true, task: taskView(task) }
}

const handleUpdate: Handler<'update'> = (act, p) => {
  const task = requireTask(p.taskId)
  requireOpen(task, 'update')
  if (!canManage(act.from, task)) {
    throw forbidden(`${act.from} cannot update ${task.id}: only the owner, their managers, or governors can.`)
  }
  const field = p.field
  const before = { [field]: clone(task[field]) }

  if (field === 'objective') {
    if (typeof p.value !== 'string') throw invalid('objective must be a string')
    task.objective = p.value
  } else if (field === 'gates') {
    if (!Array.isArray(p.value) || p.value.some((g) => typeof g !== 'object')) {
      throw invalid('gates must be an array of {action, scope}')
    }
    const next = dedupeGates(p.value as Gate[])
    const removed = task.gates.filter((g) => !next.some((n) => gateKey(n) === gateKey(g)))
    if (removed.length && !canGovern(act.from)) {
      throw forbidden(
        `Removing gates (${removed.map(gateKey).join(', ')}) needs govern authority. Adding gates is allowed.`
      )
    }
    task.gates = next
  } else {
    const v = p.value
    if (typeof v === 'string') task[field] = [v]
    else if (Array.isArray(v) && v.every((x) => typeof x === 'string')) task[field] = v as string[]
    else throw invalid(`${field} must be a string or string[]`)
  }
  task.updatedAt = act.timestamp
  const evt = record(act, task, before, { [field]: clone(task[field]) }, `${act.from} updated ${field} on ${task.id}`)
  return { ledgerEvent: evt, approval: null, stateChanged: true, task: taskView(task) }
}

// ---------------------------------------------------------------- conversation family

export function isExpired(expiresAt: string, now: string): boolean {
  return now > expiresAt
}

const handleQuestion: Handler<'question'> = (act, p) => {
  requireTarget(p.to)
  const taskId = p.taskId ?? act.taskId ?? null
  if (taskId) requireTask(taskId)
  const id = store.nextId('question', (x) => store.questions.has(x))
  const ttl = p.ttlSeconds ?? act.ttl ?? DEFAULT_TTL_SECONDS
  store.questions.set(id, {
    id,
    taskId,
    from: act.from,
    to: p.to,
    about: p.about,
    contextRef: p.contextRef ?? null,
    status: 'open',
    answered: false,
    answer: null,
    answeredBy: null,
    expiresAt: addSeconds(act.timestamp, ttl),
    timestamp: act.timestamp,
  })
  const evt = record(act, taskId ? store.tasks.get(taskId)! : null, {}, { questionId: id, to: p.to }, `${act.from} → ${p.to}: Q "${p.about}"`, [id])
  return { ledgerEvent: evt, approval: null, stateChanged: true }
}

const handleAnswer: Handler<'answer'> = (act, p) => {
  const q = store.questions.get(p.questionId)
  if (!q) throw notFound(`Question ${p.questionId} not found`)
  if (!isRecipient(act.from, q.to)) throw forbidden(`${p.questionId} was asked to ${q.to}, not ${act.from}.`)
  if (q.status !== 'open') throw conflict(`Question ${p.questionId} is already ${q.status}.`)
  if (isExpired(q.expiresAt, act.timestamp)) throw conflict(`Question ${p.questionId} expired at ${q.expiresAt}.`)
  const before = { status: q.status, answer: q.answer }
  q.status = 'answered'
  q.answered = true
  q.answer = p.payload
  q.answeredBy = act.from
  const evt = record(act, q.taskId ? store.tasks.get(q.taskId) ?? null : null, before, { status: 'answered', answer: q.answer }, `${act.from} answered ${p.questionId}`, [p.questionId])
  return { ledgerEvent: evt, approval: null, stateChanged: true }
}

const handleProposal: Handler<'proposal'> = (act, p) => {
  requireTarget(p.to)
  const taskId = p.taskId ?? act.taskId ?? null
  if (taskId) requireTask(taskId)
  const id = store.nextId('proposal', (x) => store.proposals.has(x))
  const ttl = p.ttlSeconds ?? act.ttl ?? DEFAULT_TTL_SECONDS
  store.proposals.set(id, {
    id,
    taskId,
    from: act.from,
    to: p.to,
    what: p.what,
    why: p.why,
    status: 'open',
    countered: false,
    counter: null,
    counteredBy: null,
    expiresAt: addSeconds(act.timestamp, ttl),
    timestamp: act.timestamp,
  })
  const evt = record(act, taskId ? store.tasks.get(taskId)! : null, {}, { proposalId: id, to: p.to }, `${act.from} → ${p.to}: propose "${p.what}" (${p.why})`, [id])
  return { ledgerEvent: evt, approval: null, stateChanged: true }
}

const handleCounter: Handler<'counter'> = (act, p) => {
  const pr = store.proposals.get(p.proposalId)
  if (!pr) throw notFound(`Proposal ${p.proposalId} not found`)
  if (!isRecipient(act.from, pr.to)) throw forbidden(`${p.proposalId} was made to ${pr.to}, not ${act.from}.`)
  if (pr.status !== 'open') throw conflict(`Proposal ${p.proposalId} is already ${pr.status}.`)
  if (isExpired(pr.expiresAt, act.timestamp)) throw conflict(`Proposal ${p.proposalId} expired at ${pr.expiresAt}.`)
  const before = { status: pr.status, counter: pr.counter }
  pr.status = 'countered'
  pr.countered = true
  pr.counter = p.alternative
  pr.counteredBy = act.from
  const evt = record(act, pr.taskId ? store.tasks.get(pr.taskId) ?? null : null, before, { status: 'countered', counter: pr.counter }, `${act.from} counters ${p.proposalId}: ${p.alternative}`, [p.proposalId])
  return { ledgerEvent: evt, approval: null, stateChanged: true }
}

// ---------------------------------------------------------------- authority family

const handleRequestApproval: Handler<'request_approval'> = (act, p) => {
  const taskId = p.taskId ?? act.taskId ?? null
  const task = taskId ? requireTask(taskId) : null
  if (hasAuthority(act.from, p.action, p.scope)) {
    throw conflict(`${act.from} already holds direct authority for ${p.action}/${p.scope}; no approval needed.`)
  }
  const existing = findPendingApproval(act.from, p.action, p.scope, taskId)
  if (existing) throw conflict(`Approval ${existing.id} for ${p.action}/${p.scope} is already pending with ${existing.approver}.`)
  const approval = createApproval({
    requestedBy: act.from,
    action: p.action,
    scope: p.scope,
    taskId,
    references: act.references,
    at: act.timestamp,
  })
  const evt = record(act, task, {}, { approvalId: approval.id, status: 'pending', approver: approval.approver }, `${act.from} requested approval for ${p.action}/${p.scope} → ${approval.id} (approver: ${approval.approver})`, [approval.id])
  return { ledgerEvent: evt, approval, stateChanged: true, task: task ? taskView(task) : undefined }
}

const handleAuthorize: Handler<'authorize'> = (act, p) => {
  const approval = authorizeApproval(p.approvalId, act.from, act.timestamp)
  const task = approval.taskId ? store.tasks.get(approval.taskId) ?? null : null
  const evt = record(act, task, { approvalStatus: 'pending' }, { approvalStatus: 'approved', decidedBy: act.from }, `${act.from} AUTHORIZED ${approval.id} (${approval.action}/${approval.scope} for ${approval.requestedBy})`, [approval.id])
  return { ledgerEvent: evt, approval, stateChanged: true, task: task ? taskView(task) : undefined }
}

const handleDeny: Handler<'deny'> = (act, p) => {
  const approval = denyApproval(p.approvalId, act.from, p.reason, act.timestamp)
  const task = approval.taskId ? store.tasks.get(approval.taskId) ?? null : null
  const evt = record(act, task, { approvalStatus: 'pending' }, { approvalStatus: 'denied', decidedBy: act.from, reason: p.reason }, `${act.from} DENIED ${approval.id} (${approval.action}/${approval.scope}): ${p.reason}`, [approval.id])
  return { ledgerEvent: evt, approval, stateChanged: true, task: task ? taskView(task) : undefined }
}

const handleEscalate: Handler<'escalate'> = (act, p) => {
  const task = requireTask(p.taskId)
  requireOpen(task, 'escalate')
  requireNoPendingHandoff(task, 'escalate')
  requireAgent(p.to, 'Escalation target')
  if (p.to === act.from) throw invalid('Cannot escalate to yourself.')
  if (!canManage(act.from, task)) {
    throw forbidden(`${act.from} cannot escalate ${task.id}: only the owner, their managers, or governors can.`)
  }
  const before = { status: task.status, blockedReason: task.blockedReason, escalatedTo: task.escalatedTo }
  task.status = 'blocked'
  task.blockedReason = `Escalated to ${p.to}: ${p.reason}`
  task.escalatedTo = p.to
  task.updatedAt = act.timestamp
  addSubscription(p.to, task.id)
  const evt = record(act, task, before, { status: 'blocked', blockedReason: task.blockedReason, escalatedTo: p.to }, `${act.from} escalated ${task.id} to ${p.to}: ${p.reason}`)
  return { ledgerEvent: evt, approval: null, stateChanged: true, task: taskView(task) }
}

// ---------------------------------------------------------------- lifecycle family

function subscriptionTarget(p: { taskId?: string; scope?: string }): string {
  if (p.taskId) {
    requireTask(p.taskId)
    return p.taskId
  }
  const scope = p.scope!
  if (scope === 'workspace') return scope
  if (scope.startsWith('role:')) {
    requireTarget(scope)
    return scope
  }
  throw invalid(`scope must be "workspace" or "role:<name>", got "${scope}"`)
}

const handleSubscribe: Handler<'subscribe'> = (act, p) => {
  const target = subscriptionTarget(p)
  const agent = store.agents.get(act.from)!
  const before = { subscriptions: [...agent.subscriptions] }
  if (!addSubscription(act.from, target)) throw conflict(`${act.from} is already subscribed to ${target}.`)
  const evt = record(act, p.taskId ? store.tasks.get(p.taskId)! : null, before, { subscriptions: [...agent.subscriptions] }, `${act.from} subscribed to ${target}`)
  return { ledgerEvent: evt, approval: null, stateChanged: true }
}

const handleUnsubscribe: Handler<'unsubscribe'> = (act, p) => {
  const target = p.taskId ?? p.scope!
  const agent = store.agents.get(act.from)!
  const before = { subscriptions: [...agent.subscriptions] }
  if (!removeSubscription(act.from, target)) throw conflict(`${act.from} is not subscribed to ${target}.`)
  const evt = record(act, p.taskId ? store.tasks.get(p.taskId) ?? null : null, before, { subscriptions: [...agent.subscriptions] }, `${act.from} unsubscribed from ${target}`)
  return { ledgerEvent: evt, approval: null, stateChanged: true }
}

const handleAck: Handler<'ack'> = (act, p) => {
  const target = store.acts.get(p.actId)
  if (!target) throw notFound(`Act ${p.actId} not found`)
  const evt = record(act, target.taskId ? store.tasks.get(target.taskId) ?? null : null, {}, { acked: p.actId }, `${act.from} acked act ${p.actId}`, [p.actId])
  return { ledgerEvent: evt, approval: null, stateChanged: true }
}

// ---------------------------------------------------------------- registry

const HANDLERS: { [K in ActType]: Handler<K> } = {
  create_task: handleCreateTask,
  claim: handleClaim,
  release: handleRelease,
  complete: handleComplete,
  block: handleBlock,
  status: handleStatus,
  handoff: handleHandoff,
  accept_handoff: handleAcceptHandoff,
  reject_handoff: handleRejectHandoff,
  evidence: handleEvidence,
  decision: handleDecision,
  update: handleUpdate,
  question: handleQuestion,
  answer: handleAnswer,
  proposal: handleProposal,
  counter: handleCounter,
  request_approval: handleRequestApproval,
  authorize: handleAuthorize,
  deny: handleDeny,
  escalate: handleEscalate,
  subscribe: handleSubscribe,
  unsubscribe: handleUnsubscribe,
  ack: handleAck,
}
