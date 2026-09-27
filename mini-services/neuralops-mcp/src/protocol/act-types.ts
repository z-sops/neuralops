// NeuralOps Coordination Protocol — Act Types
// Acts mutate state; messages do not become the state.
//
// 23 act types in 6 families. V0.1.1 adds `create_task` so real agents can
// open work through the protocol instead of relying on the demo seed.

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
  task: 'Lifecycle mutations on tasks (create, claim, release, complete, block, status)',
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
  escalate: 'Escalate a task to another agent. The task becomes blocked and the target may take it over by claiming it.',
  subscribe: 'Subscribe to a task, `workspace`, or `role:<name>`.',
  unsubscribe: 'Unsubscribe from a task, `workspace`, or `role:<name>`.',
  ack: 'Acknowledge an act by id.',
}
