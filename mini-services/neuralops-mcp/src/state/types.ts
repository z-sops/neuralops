// NeuralOps Coordination Core — State Types
//
// The coordination core holds the source of truth. Acts mutate this state;
// the ledger records every mutation as an immutable event.

import type { ActType } from '../protocol/act-types.js'

export type AgentStatus = 'online' | 'busy' | 'offline'
export type AgentModel =
  | 'Claude'
  | 'Codex'
  | 'Gemini'
  | 'Qwen'
  | 'GPT'
  | 'Custom'

export interface AuthorityScope {
  action: string // "deploy" | "merge" | "delete"
  scope: string // "production" | "staging"
  requiresApproval: boolean
  approver: string // agent id
}

export interface Agent {
  id: string // "agent.architect"
  workspaceId: string
  name: string // "Architect"
  model: AgentModel
  role: string // "architect" | "backend" | "qa" | "security" | "ceo"
  reportsTo: string | null // agent id
  authority: AuthorityScope[]
  status: AgentStatus
  subscriptions: string[] // task ids | "role:qa" | "workspace"
  createdAt: string
}

export type TaskStatus =
  | 'unclaimed'
  | 'in_progress'
  | 'blocked'
  | 'handoff_pending'
  | 'completed'
  | 'failed'

export interface ClaimRecord {
  agentId: string
  timestamp: string
  note?: string
}

export interface HandoffRecord {
  from: string
  to: string
  intent: string
  timestamp: string
  accepted: boolean | null // null = pending, true = accepted, false = rejected
  acceptedAt?: string
  rejectedReason?: string
}

export interface Task {
  id: string // "task_42"
  workspaceId: string
  title: string
  objective: string
  status: TaskStatus
  assignee: string | null // current owner agent id
  claims: ClaimRecord[]
  handoffs: HandoffRecord[]
  decisionIds: string[]
  evidenceIds: string[]
  constraints: string[]
  openItems: string[]
  nextSteps: string[]
  resultRef: string | null
  progress: number // 0-100
  blockedReason: string | null
  pendingHandoffTo: string | null
  createdAt: string
  updatedAt: string
}

export interface Decision {
  id: string // "decision_D7"
  taskId: string
  text: string
  rationale: string | null
  decidedBy: string
  references: string[]
  timestamp: string
}

export interface Evidence {
  id: string // "evidence_E12"
  taskId: string
  type: string // "test" | "log" | "url" | "screenshot"
  summary: string
  ref: string
  producedBy: string
  references: string[]
  timestamp: string
}

export type ApprovalStatus = 'pending' | 'approved' | 'denied'

export interface Approval {
  id: string // "authority_A9"
  workspaceId: string
  taskId: string | null
  action: string
  scope: string
  requestedBy: string
  approver: string // agent id
  status: ApprovalStatus
  decidedBy: string | null
  decidedAt: string | null
  reason: string | null
  references: string[]
  timestamp: string
}

// Conversation thread artifacts (kept for audit; ledger also records them)
export interface Question {
  id: string
  taskId: string | null
  from: string
  to: string
  about: string
  contextRef: string | null
  answered: boolean
  answer: string | null
  timestamp: string
}

export interface Proposal {
  id: string
  taskId: string | null
  from: string
  to: string
  what: string
  why: string
  countered: boolean
  counter: string | null
  timestamp: string
}

// The immutable ledger event. Source of truth — everything else is a view.
export interface LedgerEvent {
  id: string
  seq: number
  workspaceId: string
  actId: string
  actType: ActType
  actor: string
  taskId: string | null
  intent: string | null
  before: Record<string, unknown>
  after: Record<string, unknown>
  references: string[]
  deltaSummary: string // human-readable one-liner
  timestamp: string
}

export interface Workspace {
  id: string
  name: string
  description: string
  createdAt: string
}
