// NeuralOps Coordination Protocol — Act Envelope
//
// Every coordination operation is wrapped in a typed Act envelope.
// The payload is deliberately small. Rich state lives in the Coordination Core,
// not in messages.

import { z } from 'zod'
import { ACT_TYPES } from './act-types.js'

export const ActSchema = z.object({
  id: z.string().optional(), // assigned by server if absent
  type: z.enum(ACT_TYPES as [string, ...string[]]),
  from: z.string(), // agent id, e.g. "agent.architect"
  to: z.string().optional(), // agent id | "role:qa" | "task#123" | "workspace"
  taskId: z.string().optional(),
  intent: z.string().optional(),
  references: z.array(z.string()).default([]), // ["decision:D7","evidence:E12"]
  payload: z.record(z.string(), z.unknown()).default({}),
  authorityRef: z.string().optional(),
  ttl: z.number().optional(),
})

export type ActInput = z.infer<typeof ActSchema>

export interface Act extends ActInput {
  id: string
  timestamp: string
  seq: number // monotonic sequence number for ledger ordering
}

export function makeId(prefix: string): string {
  const n = Math.random().toString(36).slice(2, 8)
  const t = Date.now().toString(36).slice(-5)
  return `${prefix}_${t}${n}`
}
