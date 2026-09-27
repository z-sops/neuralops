// NeuralOps Coordination Protocol — Act Types
// Acts mutate state; messages do not become the state.

export type ActFamily =
  | 'task'
  | 'handoff'
  | 'information'
  | 'conversation'
  | 'authority'
  | 'lifecycle'

export type ActType =
  // task family
  | 'claim'
  | 'release'
  | 'complete'
  | 'block'
  | 'status'
  // handoff family
  | 'handoff'
  | 'accept_handoff'
  | 'reject_handoff'
  // information family
  | 'evidence'
  | 'decision'
  | 'update'
  // conversation family
  | 'question'
  | 'answer'
  | 'proposal'
  | 'counter'
  // authority family
  | 'request_approval'
  | 'authorize'
  | 'deny'
  | 'escalate'
  // lifecycle family
  | 'subscribe'
  | 'unsubscribe'
  | 'ack'

export const ACT_FAMILY: Record<ActType, ActFamily> = {
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
}

export const ACT_TYPES: ActType[] = Object.keys(ACT_FAMILY) as ActType[]

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
  task: 'Lifecycle mutations on tasks (claim, release, complete, block, status)',
  handoff: 'Transfer ownership of a task between agents',
  information: 'Record durable facts (evidence, decisions, structured updates)',
  conversation: 'Short, tagged exchanges — always reference shared state',
  authority: 'Formal approval / escalation workflow (audit-able)',
  lifecycle: 'Subscription & acknowledgement signals',
}
