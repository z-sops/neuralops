// NeuralOps Coordination Protocol — Act Types
// Acts mutate state; messages do not become the state.
//
// 26 act types in 6 families. V0.1.1 added `create_task`; V0.1.3 added
// `reserve_files` / `release_files` (file reservations); V0.1.4 adds `perform`
// (a gated action such as an MCP tool call, checked and logged before it runs);
// V0.1.6 adds `grant_approval` (standing, multi-use, time-boxed approvals) and
// `report_block` (an enforcer recording what it stopped).

export type ActFamily =
  | 'task'
  | 'handoff'
  | 'information'
  | 'conversation'
  | 'authority'
  | 'lifecycle'

export const ACT_FAMILY = {
  create_task: 'task',
  claim: 'task',
  release: 'task',
  complete: 'task',
  block: 'task',
  status: 'task',
  reserve_files: 'task',
  release_files: 'task',
  handoff: 'handoff',
  accept_handoff: 'handoff',
  reject_handoff: 'handoff',
  evidence: 'information',
  decision: 'information',
  update: 'information',
  question: 'conversation',
  answer: 'conversation',
  proposal: 'conversation',
  counter: 'conversation',
  request_approval: 'authority',
  authorize: 'authority',
  deny: 'authority',
  escalate: 'authority',
  perform: 'authority',
  grant_approval: 'authority',
  report_block: 'lifecycle',
  subscribe: 'lifecycle',
  unsubscribe: 'lifecycle',
  ack: 'lifecycle',
} as const satisfies Record<string, ActFamily>

export type ActType = keyof typeof ACT_FAMILY

export const ACT_TYPES = Object.keys(ACT_FAMILY) as ActType[]

export function isActType(x: unknown): x is ActType {
  return typeof x === 'string' && Object.prototype.hasOwnProperty.call(ACT_FAMILY, x)
}

// Semantic color per family (used by the inspector). Tailwind-friendly hue names.
export const FAMILY_COLOR: Record<ActFamily, string> = {
  task: 'emerald',
  handoff: 'amber',
  information: 'sky',
  conversation: 'violet',
  authority: 'rose',
  lifecycle: 'slate',
}

export const FAMILY_DESCRIPTION: Record<ActFamily, string> = {
  task: 'Lifecycle mutations on tasks (create, claim, release, complete, block, status) and file reservations',
  handoff: 'Transfer ownership of a task between agents',
  information: 'Record durable facts (evidence, decisions, structured updates)',
  conversation: 'Short, tagged exchanges that expire unless they produce state',
  authority: 'Formal approval / escalation workflow (audit-able)',
  lifecycle: 'Subscription & acknowledgement signals',
}

// Human descriptions, reused as MCP tool descriptions.
export const ACT_DESCRIPTION: Record<ActType, string> = {
  create_task:
    'Open a new task in the workspace. Optional `gates` (e.g. [{action:"complete",scope:"production"}]) force an approval before the task can be completed in that scope.',
  claim:
    'Take ownership of an unclaimed task. The current owner can re-claim a blocked task to unblock it; the agent a task was escalated to can take it over.',
  release: 'Give up ownership of a task you own. Cancels any pending handoff.',
  complete:
    'Mark a task you own as complete. If the task (or the declared scope) is gated and you lack direct authority, an approval is requested instead and the task stays open. Retry after the approver authorizes.',
  block: 'Mark a task you own as blocked, with a reason.',
  status: 'Report progress (0-100) on a task you own, with optional ETA and note.',
  reserve_files:
    'Reserve repo-relative files/globs before editing them (e.g. ["src/auth/**", "package.json"]). Exclusive by default: other agents cannot reserve, edit (Claude Code hook) or commit (git pre-commit hook) overlapping files until you release them or the TTL (default 1h) ends. Re-reserving the same patterns renews the TTL. Released automatically when the task completes or is released; moves to the new owner on handoff.',
  release_files: 'Release your file reservations: one by reservationId, all for a taskId, or all=true. Managers/governors can force-release a stale reservation by id.',
  handoff: 'Offer a task you own to another agent with an intent (implement / review / test). Ownership moves only when they accept.',
  accept_handoff: 'Accept a handoff offered to you. You become the owner.',
  reject_handoff: 'Reject a handoff offered to you. The task returns to its previous status with the original owner.',
  evidence: 'Record a curated piece of evidence (test result, log, URL, review) on a task.',
  decision: 'Record a durable decision on a task, with rationale.',
  update: 'Change a task field: objective, constraints, openItems, nextSteps, or gates. Owner, their managers, or governors only. Removing gates needs govern authority.',
  question: 'Ask another agent (or `role:<name>`) a short question. Expires after its TTL unless answered.',
  answer: 'Answer a question addressed to you or your role.',
  proposal: 'Propose something to another agent (or `role:<name>`). Expires after its TTL unless countered or acted on.',
  counter: 'Counter a proposal addressed to you or your role with an alternative.',
  request_approval: 'Explicitly request approval for a gated action/scope. The approver comes from workspace policy, falling back to your manager.',
  authorize: 'Approve a pending approval. Allowed for the named approver, anyone above them in the reporting chain, or a wildcard authority — never for the requester.',
  deny: 'Deny a pending approval. Allowed for approvers (as above) and agents holding veto authority (`deny` on that scope).',
  perform:
    'Ask to perform a gated action BEFORE doing it (e.g. an MCP tool call that writes to a real system: action "odoo.write", scope "production"). Allowed at once with direct authority or when no policy governs the action; otherwise it consumes an approved single-use approval, or creates one and returns allowed=false. Every call is logged. Do not run the action unless the result says allowed=true.',
  grant_approval:
    'Approve in advance: let another identity perform action/scope up to `uses` times within `validForSeconds` (e.g. a scheduled persona run nobody watches). Only someone who could approve such a request may grant it, and never to themselves.',
  report_block:
    'Record that an enforcer (a pre-tool hook, the git pre-commit hook, the guard or CI) stopped this agent, and why. Sent automatically by the NeuralOps hooks so blocks show up in the ledger.',
  escalate: 'Escalate a task to another agent. The task becomes blocked and the target may take it over by claiming it.',
  subscribe: 'Subscribe to a task, `workspace`, or `role:<name>`.',
  unsubscribe: 'Unsubscribe from a task, `workspace`, or `role:<name>`.',
  ack: 'Acknowledge an act by id.',
}
