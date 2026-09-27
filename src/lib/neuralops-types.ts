// NeuralOps MCP — shared TypeScript types for the dashboard.
//
// These mirror the shapes the mini-service on port 3031 returns over its REST
// + WebSocket API. Keeping them in one place means the components and the
// `useNeuralOps` hook agree on the contract.

export type AgentModel = 'Claude' | 'Codex' | 'Gemini' | 'Qwen' | 'GPT' | 'Custom'
export type AgentStatus = 'online' | 'busy' | 'offline'

export interface AuthorityScope {
  action: string
  scope: string
  requiresApproval: boolean
  approver: string
}

export interface Agent {
  id: string
  workspaceId: string
  name: string
  model: AgentModel
  role: string
  reportsTo: string | null
  authority: AuthorityScope[]
  status: AgentStatus
  subscriptions: string[]
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
  accepted: boolean | null
  acceptedAt?: string
  rejectedReason?: string
}

export interface Task {
  id: string
  workspaceId: string
  title: string
  objective: string
  status: TaskStatus
  assignee: string | null
  claims: ClaimRecord[]
  handoffs: HandoffRecord[]
  decisionIds: string[]
  evidenceIds: string[]
  constraints: string[]
  openItems: string[]
  nextSteps: string[]
  resultRef: string | null
  progress: number
  blockedReason: string | null
  pendingHandoffTo: string | null
  createdAt: string
  updatedAt: string
}

export type ApprovalStatus = 'pending' | 'approved' | 'denied'

export interface Approval {
  id: string
  workspaceId: string
  taskId: string | null
  action: string
  scope: string
  requestedBy: string
  approver: string
  status: ApprovalStatus
  decidedBy: string | null
  decidedAt: string | null
  reason: string | null
  references: string[]
  timestamp: string
}

export type ActFamily =
  | 'task'
  | 'handoff'
  | 'information'
  | 'conversation'
  | 'authority'
  | 'lifecycle'

export type ActType =
  | 'claim' | 'release' | 'complete' | 'block' | 'status'
  | 'handoff' | 'accept_handoff' | 'reject_handoff'
  | 'evidence' | 'decision' | 'update'
  | 'question' | 'answer' | 'proposal' | 'counter'
  | 'request_approval' | 'authorize' | 'deny' | 'escalate'
  | 'subscribe' | 'unsubscribe' | 'ack'

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
  deltaSummary: string
  timestamp: string
}

export interface Workspace {
  id: string
  name: string
  description: string
  createdAt: string
}

export interface NeuralOpsState {
  workspace: Workspace | null
  agents: Agent[]
  tasks: Task[]
  approvals: Approval[]
  ledger: LedgerEvent[]
  ledgerTotal: number
}

export interface FamiliesResponse {
  family: Record<ActType, ActFamily>
  color: Record<ActFamily, string>
  description: Record<ActFamily, string>
}

export interface ContextComparison {
  taskId: string
  fullTokens: number
  compactedTokens: number
  reductionPct: number
  fullFormatted: string
  compactedFormatted: string
}

// POST /api/acts envelope.
export interface ActInput {
  type: ActType
  from: string
  to?: string
  taskId?: string
  intent?: string
  references?: string[]
  payload: Record<string, unknown>
}

export interface ActResult {
  ok: boolean
  act?: { id: string }
  ledgerEvent?: LedgerEvent
  approval?: Approval | null
  error?: string
  stateChanged: boolean
  task?: Task | null
}

// Tailwind hue names per family — sourced from /api/families.
export const FAMILY_HUE: Record<ActFamily, string> = {
  task: 'emerald',
  handoff: 'amber',
  information: 'sky',
  conversation: 'violet',
  authority: 'rose',
  lifecycle: 'slate',
}

// Static act → family map (fallback if /api/families hasn't loaded yet).
export const ACT_FAMILY_STATIC: Record<ActType, ActFamily> = {
  claim: 'task', release: 'task', complete: 'task', block: 'task', status: 'task',
  handoff: 'handoff', accept_handoff: 'handoff', reject_handoff: 'handoff',
  evidence: 'information', decision: 'information', update: 'information',
  question: 'conversation', answer: 'conversation', proposal: 'conversation', counter: 'conversation',
  request_approval: 'authority', authorize: 'authority', deny: 'authority', escalate: 'authority',
  subscribe: 'lifecycle', unsubscribe: 'lifecycle', ack: 'lifecycle',
}
