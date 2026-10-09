// NeuralOps Coordination Core — State Types
//
// The act journal is the source of truth. Everything below is a materialized
// view that can be rebuilt by replaying the journal (see engines/replay.ts).

import type { ActType } from '../protocol/act-types.js'
import type { ActVia } from '../protocol/envelope.js'

export type AgentStatus = 'online' | 'busy' | 'offline'
export const AGENT_MODELS = ['Claude', 'Codex', 'Gemini', 'Qwen', 'GPT', 'Custom'] as const
export type AgentModel = (typeof AGENT_MODELS)[number]

// A direct grant. `action`/`scope` may be "*".
// `requiresApproval` is kept for wire compatibility with V0.1 clients; direct
// grants are always `false`. Gatekeeping lives in workspace Policies.
export interface AuthorityScope {
  action: string // "deploy" | "complete" | "deny" | "govern" | "*"
  scope: string // "production" | "staging" | "*"
  requiresApproval: boolean
  approver: string
}

// Workspace-level gatekeeping rule: doing `action` in `scope` without direct
// authority needs an approval from `approver`.
export interface Policy {
  id: string
  action: string
  scope: string
  approver: string
}

export interface Gate {
  action: string
  scope: string
  /** Evidence types that must exist VERIFIED on the task before this gate can be passed. */
  requireVerified?: string[]
}

/** Recorded when a gated completion passes, so external checks (CI, hooks) can see it. */
export interface Clearance {
  action: string
  scope: string
  via: 'authority' | 'approval'
  approvalId: string | null
  by: string
  actId: string
  at: string
}

export interface Agent {
  id: string // "agent.architect"
  workspaceId: string
  name: string
  model: AgentModel
  role: string
  reportsTo: string | null
  authority: AuthorityScope[]
  status: AgentStatus
  subscriptions: string[] // task ids | "role:qa" | "workspace"
  createdAt: string
  /** Set when an admin revokes the agent; revoked agents cannot act until re-issued a token. */
  revokedAt?: string | null
  /** "audit" = read-only identity (e.g. a client's auditor): may read the ledger and integrity, never act. Default "act". */
  access?: 'act' | 'audit' | 'broker'
  /** A broker identity (e.g. the Nexus worker) that may act on this identity's behalf (via "delegated"). */
  delegate?: string
  /** The person's id in an external sign-in system (JWT `sub`), for JWT identities. */
  externalId?: string
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
  accepted: boolean | null // null = pending, true = accepted, false = rejected/cancelled
  acceptedAt?: string
  rejectedReason?: string
  statusBefore?: TaskStatus
}

export interface Task {
  /** Client claims only. Never treated as remote approval or verified evidence. */
  clientOutcome?: {
    version: 'orbit-v1'; jobId: string; runId: string; sequence: number;
    state: 'review' | 'failed' | 'cancelled' | 'interrupted' | 'accepted_locally' | 'rejected_locally';
    verification: 'unverified' | 'files_checked' | 'failed';
    reportSha256: string; artifactsSha256: string; artifactCount: number;
    reportedBy: string; actId: string; at: string; verified: false;
  }
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
  gates: Gate[]
  clearances: Clearance[]
  resultRef: string | null
  progress: number
  eta: string | null
  blockedReason: string | null
  pendingHandoffTo: string | null
  escalatedTo: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export interface Decision {
  id: string
  taskId: string
  text: string
  rationale: string | null
  decidedBy: string
  references: string[]
  timestamp: string
}

export interface Evidence {
  id: string
  taskId: string
  type: string
  summary: string
  ref: string
  producedBy: string
  references: string[]
  timestamp: string
  /** true when produced by an agent holding `attest` authority for this evidence type (e.g. CI). */
  verified: boolean
  verifiedBy: string | null
}

/** A TTL'd claim on repo-relative path patterns (see engines/reservations.ts). */
export interface Reservation {
  id: string
  workspaceId: string
  agentId: string
  taskId: string | null
  patterns: string[]
  exclusive: boolean
  reason: string | null
  createdAt: string
  expiresAt: string
  releasedAt: string | null
  releasedBy: string | null
  releaseReason: string | null
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
  // Single use: an approved approval is consumed by the act it unlocked.
  consumedAt: string | null
  consumedBy: string | null // act id
  /** What exactly is being approved (e.g. the tool call and its arguments), shown to the approver. */
  detail?: string
  /** Multi-use approval: how many more acts it may unlock (absent = single use). */
  usesLeft?: number
  /** Time-boxed approval: not usable after this instant. */
  validUntil?: string | null
  /** Acts that used this approval (multi-use). */
  usedBy?: string[]
}

export type ExchangeStatus = 'open' | 'answered' | 'countered' | 'expired'

export interface Question {
  id: string
  taskId: string | null
  from: string
  to: string
  about: string
  contextRef: string | null
  status: ExchangeStatus
  answered: boolean
  answer: string | null
  answeredBy: string | null
  expiresAt: string
  timestamp: string
}

export interface Proposal {
  id: string
  taskId: string | null
  from: string
  to: string
  what: string
  why: string
  status: ExchangeStatus
  countered: boolean
  counter: string | null
  counteredBy: string | null
  expiresAt: string
  timestamp: string
}

// Tamper-evident ledger event. `hash` = sha256(prevHash + canonical body).
export type LedgerEventType = ActType | 'admin'

export interface LedgerEvent {
  id: string
  seq: number
  workspaceId: string
  actId: string
  actType: LedgerEventType
  actor: string
  via: ActVia
  taskId: string | null
  intent: string | null
  before: Record<string, unknown>
  after: Record<string, unknown>
  references: string[]
  deltaSummary: string
  timestamp: string
  history?: boolean // true for pre-seeded demo history
  prevHash: string
  hash: string
}

export interface Workspace {
  id: string
  name: string
  description: string
  createdAt: string
}

// ---- journal (source of truth) ----
export interface TokenInfo {
  agentId: string
  expiresAt: string | null
}

export type AdminRecord =
  | { k: 'policy_set'; policy: Policy; by: string; at: string }
  | { k: 'policy_delete'; id: string; by: string; at: string }
  | { k: 'authority_set'; agentId: string; authority: AuthorityScope[]; by: string; at: string }
  | { k: 'token'; agentId: string; tokenHash: string; expiresAt: string | null; replaceExisting: boolean; by: string; at: string }
  | { k: 'revoke'; agentId: string; by: string; at: string }
  | { k: 'freeze'; frozen: boolean; reason: string; by: string; at: string }
  | { k: 'preset_set'; preset: CustomPreset; by: string; at: string }
  | { k: 'preset_delete'; name: string; by: string; at: string }

/** A workspace-defined policy preset (built-in presets live in engines/presets.ts). */
export interface CustomPreset {
  name: string
  title: string
  description: string
  policies: { action: string; scope: string }[]
}

/** Kill switch state (incident mode). */
export interface FreezeState {
  reason: string
  by: string
  at: string
}

export type JournalRecord =
  | { k: 'genesis'; seed: 'demo' | 'empty'; seededAt: string; version: 1 }
  | { k: 'register'; agent: Agent; tokenHash: string; expiresAt?: string | null; at: string }
  | { k: 'act'; act: import('../protocol/envelope.js').Act }
  | AdminRecord
