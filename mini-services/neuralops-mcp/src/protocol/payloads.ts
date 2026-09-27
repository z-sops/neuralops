// NeuralOps Coordination Protocol — Per-Act Payload Schemas
//
// Each act type has a typed payload. The task-manager validates the payload
// against its schema before mutating state.

import { z } from 'zod'

// ---- task family ----
export const ClaimPayload = z.object({
  taskId: z.string(),
  note: z.string().optional(),
})

export const ReleasePayload = z.object({
  taskId: z.string(),
  reason: z.string(),
})

export const CompletePayload = z.object({
  taskId: z.string(),
  summary: z.string(),
  resultRef: z.string().optional(),
  evidence: z
    .array(
      z.object({
        type: z.string(), // "test" | "log" | "url" | "screenshot" ...
        summary: z.string(),
        ref: z.string(),
      })
    )
    .optional(),
})

export const BlockPayload = z.object({
  taskId: z.string(),
  reason: z.string(),
})

export const StatusPayload = z.object({
  taskId: z.string(),
  progress: z.number().min(0).max(100),
  eta: z.string().optional(),
  note: z.string().optional(),
})

// ---- handoff family ----
export const HandoffPayload = z.object({
  taskId: z.string(),
  to: z.string(), // agent id
  intent: z.string(), // "implement" | "review" | "test" ...
})

export const AcceptHandoffPayload = z.object({
  taskId: z.string(),
})

export const RejectHandoffPayload = z.object({
  taskId: z.string(),
  reason: z.string(),
})

// ---- information family ----
export const EvidencePayload = z.object({
  taskId: z.string(),
  type: z.string(),
  summary: z.string(),
  ref: z.string(),
})

export const DecisionPayload = z.object({
  taskId: z.string(),
  text: z.string(),
  rationale: z.string().optional(),
})

export const UpdatePayload = z.object({
  taskId: z.string(),
  field: z.enum(['objective', 'constraints', 'openItems', 'nextSteps']),
  value: z.union([z.string(), z.array(z.string())]),
})

// ---- conversation family ----
export const QuestionPayload = z.object({
  to: z.string(),
  about: z.string(),
  contextRef: z.string().optional(),
  taskId: z.string().optional(),
})

export const AnswerPayload = z.object({
  questionId: z.string(),
  payload: z.string(),
})

export const ProposalPayload = z.object({
  to: z.string(),
  what: z.string(),
  why: z.string(),
  taskId: z.string().optional(),
})

export const CounterPayload = z.object({
  proposalId: z.string(),
  alternative: z.string(),
})

// ---- authority family ----
export const RequestApprovalPayload = z.object({
  taskId: z.string().optional(),
  action: z.string(), // "deploy" | "merge" | "delete" ...
  scope: z.string(), // "production" | "staging" ...
})

export const AuthorizePayload = z.object({
  approvalId: z.string(),
})

export const DenyPayload = z.object({
  approvalId: z.string(),
  reason: z.string(),
})

export const EscalatePayload = z.object({
  taskId: z.string(),
  reason: z.string(),
  to: z.string(),
})

// ---- lifecycle family ----
export const SubscribePayload = z.object({
  taskId: z.string().optional(),
  scope: z.string().optional(), // "workspace" | "role:qa"
})

export const UnsubscribePayload = z.object({
  taskId: z.string().optional(),
  scope: z.string().optional(),
})

export const AckPayload = z.object({
  actId: z.string(),
})
