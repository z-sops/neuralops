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
})

// ---- task family ----
export const CreateTaskPayload = z.object({
  id: z
    .string()
    .regex(/^task_[a-z0-9_-]{1,48}$/i, 'task ids look like task_<name>')
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

export const AuthorizePayload = z.object({ approvalId: id })

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
