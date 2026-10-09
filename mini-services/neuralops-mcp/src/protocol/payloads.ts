// NeuralOps Coordination Protocol — Per-Act Payload Schemas
//
// Every act type has exactly one payload schema, registered in PAYLOAD_SCHEMAS.
// The dispatcher validates against it before any handler runs, and the MCP
// tool registry derives its JSON Schemas from the same objects — so the
// protocol, the validator and the tool surface cannot drift apart.

import { z } from 'zod'
import type { ActType } from './act-types.js'

const id = z.string().min(1).max(128)
const text = (max = 4000) => z.string().min(1).max(max)
const list = z.array(text(1000)).max(100)
const target = z
  .string()
  .min(1)
  .max(128)
  .describe('Agent id (e.g. "agent.qa") or role target (e.g. "role:qa")')

export const GateSchema = z.object({
  action: text(64).describe('Gated action, e.g. "complete"'),
  scope: text(64).describe('Scope the gate applies to, e.g. "production"'),
  requireVerified: z
    .array(text(64))
    .max(10)
    .optional()
    .describe('Evidence types (e.g. ["test"]) that must be VERIFIED on the task — recorded by an agent with attest authority such as CI — before this gate can be passed, even with authority or approval'),
})

// ---- task family ----
export const CreateTaskPayload = z.object({
  id: z
    .string()
    .regex(/^task_[a-z0-9_]{1,48}$/i, 'task ids look like task_<letters/digits/underscores> (no hyphens, so branches can be named task_42-description)')
    .optional()
    .describe('Optional explicit id; generated when omitted'),
  title: text(200),
  objective: text(),
  constraints: list.optional(),
  openItems: list.optional(),
  nextSteps: list.optional(),
  gates: z.array(GateSchema).max(20).optional(),
})

export const ClaimPayload = z.object({
  taskId: id,
  note: text(1000).optional(),
})

export const ReleasePayload = z.object({
  taskId: id,
  reason: text(1000),
})

export const EvidenceItem = z.object({
  type: text(64).describe('"test" | "log" | "url" | "review" | "deploy" | "result" ...'),
  summary: text(1000),
  ref: text(1000).describe('Reference to the artifact (URL, repo path, CI run) — not the artifact itself'),
})

export const CompletePayload = z.object({
  taskId: id,
  summary: text(2000),
  resultRef: text(1000).optional(),
  scope: text(64)
    .optional()
    .describe('Declare the scope of this completion, e.g. "production". Gates for that scope apply.'),
  evidence: z.array(EvidenceItem).max(50).optional(),
})

export const BlockPayload = z.object({
  taskId: id,
  reason: text(1000),
})

export const StatusPayload = z.object({
  taskId: id,
  progress: z.number().int().min(0).max(100),
  eta: text(100).optional(),
  note: text(1000).optional(),
})

export const ReserveFilesPayload = z.object({
  patterns: z
    .array(z.string().min(1).max(300))
    .min(1)
    .max(50)
    .describe('Repo-relative paths or globs, e.g. ["src/auth/**", "src/db/schema.ts"]. A trailing "/" means the whole directory.'),
  taskId: id.optional().describe('Task this work belongs to (you must own it). Recommended: reservations then follow the task.'),
  ttlSeconds: z.number().int().min(60).max(24 * 3600).optional().describe('Default 3600 (1 hour)'),
  exclusive: z.boolean().optional().describe('Default true. false = shared (only conflicts with exclusive reservations)'),
  reason: text(500).optional(),
})

export const ReleaseFilesPayload = z
  .object({
    reservationId: id.optional(),
    taskId: id.optional(),
    all: z.boolean().optional(),
  })
  .refine((p) => !!(p.reservationId || p.taskId || p.all), 'reservationId, taskId or all=true is required')

// ---- handoff family ----
export const HandoffPayload = z.object({
  taskId: id,
  to: id.describe('Agent id receiving the task'),
  intent: text(64).describe('"implement" | "review" | "test" ...'),
})

export const AcceptHandoffPayload = z.object({ taskId: id })

export const RejectHandoffPayload = z.object({
  taskId: id,
  reason: text(1000),
})

// ---- information family ----
export const EvidencePayload = z.object({
  taskId: id,
  type: EvidenceItem.shape.type,
  summary: EvidenceItem.shape.summary,
  ref: EvidenceItem.shape.ref,
})

export const DecisionPayload = z.object({
  taskId: id,
  text: text(2000),
  rationale: text(4000).optional(),
})

export const UPDATABLE_FIELDS = ['objective', 'constraints', 'openItems', 'nextSteps', 'gates'] as const
export type UpdatableField = (typeof UPDATABLE_FIELDS)[number]

export const UpdatePayload = z.object({
  taskId: id,
  field: z.enum(UPDATABLE_FIELDS),
  value: z
    .union([text(), list, z.array(GateSchema).max(20)])
    .describe('String for objective, string[] for list fields, {action,scope}[] for gates'),
})

// ---- conversation family ----
const ttlSeconds = z
  .number()
  .int()
  .min(10)
  .max(7 * 24 * 3600)
  .optional()
  .describe('Seconds until this exchange expires if nothing durable comes of it (default 3600)')

export const QuestionPayload = z.object({
  to: target,
  about: text(2000),
  contextRef: text(256).optional(),
  taskId: id.optional(),
  ttlSeconds,
})

export const AnswerPayload = z.object({
  questionId: id,
  payload: text(4000).describe('The answer text'),
})

export const ProposalPayload = z.object({
  to: target,
  what: text(2000),
  why: text(2000),
  taskId: id.optional(),
  ttlSeconds,
})

export const CounterPayload = z.object({
  proposalId: id,
  alternative: text(2000),
})

// ---- authority family ----
export const RequestApprovalPayload = z.object({
  taskId: id.optional(),
  action: text(64).describe('"complete" | "deploy" | "merge" | "delete" ...'),
  scope: text(64).describe('"production" | "staging" ...'),
})

export const PerformPayload = z.object({
  action: text(64).describe('What you are about to do, e.g. "odoo.write", "email.send", "tool.create_invoice"'),
  scope: text(64).default('production').describe('"production" (default) | "staging" | ...'),
  taskId: id.optional().describe('Task this action belongs to, if any'),
  target: text(200).optional().describe('The tool or resource, e.g. "odoo/create_invoice"'),
  detail: text(1000).optional().describe('Exactly what will happen (tool arguments), shown to the approver'),
  binding: z.object({
    version: z.literal('orbit-v1'),
    jobId: z.string().regex(/^job-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/),
    runId: z.string().uuid(),
    tool: text(200),
    argumentsSha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict().optional().describe('Managed Orbit action: exact job, run, tool and arguments fingerprint'),
})

const Uses = z.number().int().min(1).max(1000)
const ValidFor = z.number().int().min(60).max(30 * 24 * 3600)

export const ReportBlockPayload = z.object({
  enforcer: z.enum(['claude-code', 'codex', 'gemini', 'git-pre-commit', 'guard', 'ci', 'other']).describe('What stopped the action'),
  tool: text(100).describe('The tool or command that was stopped, e.g. "Edit", "git push", "create_invoice"'),
  reason: text(1000),
  target: text(500).optional().describe('File, branch or resource involved'),
  taskId: id.optional(),
})

export const AuthorizePayload = z.object({
  approvalId: id,
  reason: text(1000).optional().describe('Why you approve (recorded in the ledger for the audit trail)'),
  uses: Uses.optional().describe('Let this approval unlock up to N acts (default 1)'),
  validForSeconds: ValidFor.optional().describe('Approval expires after this many seconds (default: no expiry)'),
})

export const GrantApprovalPayload = z.object({
  to: id.describe('Who may act (an agent or persona id)'),
  action: text(64),
  scope: text(64).default('production'),
  taskId: id.optional(),
  uses: Uses.default(1).describe('How many acts it may unlock'),
  validForSeconds: ValidFor.default(24 * 3600).describe('Expires after this many seconds (default 24h)'),
  reason: text(1000).describe('Why this standing approval is given'),
})

export const DenyPayload = z.object({
  approvalId: id,
  reason: text(1000),
})

export const EscalatePayload = z.object({
  taskId: id,
  reason: text(1000),
  to: id.describe('Agent id to escalate to'),
})

// ---- lifecycle family ----
export const SubscribePayload = z
  .object({
    taskId: id.optional(),
    scope: text(128).optional().describe('"workspace" | "role:<name>"'),
  })
  .refine((p) => !!(p.taskId || p.scope), 'taskId or scope is required')

export const UnsubscribePayload = SubscribePayload

export const AckPayload = z.object({ actId: id })

// ---- registry ----
export const PAYLOAD_SCHEMAS = {
  create_task: CreateTaskPayload,
  claim: ClaimPayload,
  release: ReleasePayload,
  complete: CompletePayload,
  block: BlockPayload,
  status: StatusPayload,
  reserve_files: ReserveFilesPayload,
  release_files: ReleaseFilesPayload,
  handoff: HandoffPayload,
  accept_handoff: AcceptHandoffPayload,
  reject_handoff: RejectHandoffPayload,
  evidence: EvidencePayload,
  decision: DecisionPayload,
  update: UpdatePayload,
  question: QuestionPayload,
  answer: AnswerPayload,
  proposal: ProposalPayload,
  counter: CounterPayload,
  request_approval: RequestApprovalPayload,
  authorize: AuthorizePayload,
  perform: PerformPayload,
  grant_approval: GrantApprovalPayload,
  report_block: ReportBlockPayload,
  deny: DenyPayload,
  escalate: EscalatePayload,
  subscribe: SubscribePayload,
  unsubscribe: UnsubscribePayload,
  ack: AckPayload,
} satisfies Record<ActType, z.ZodType>

export type PayloadOf<T extends ActType> = z.infer<(typeof PAYLOAD_SCHEMAS)[T]>

export function formatZodError(err: z.ZodError): string {
  return err.issues
    .map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`)
    .join('; ')
}
