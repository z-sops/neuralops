// NeuralOps Coordination Protocol — Act Envelope
//
// Every coordination operation is wrapped in a typed Act envelope.
// The payload is deliberately small. Rich state lives in the Coordination Core,
// not in messages.

import { z } from 'zod'
import { ACT_TYPES, type ActType } from './act-types.js'

export const ActSchema = z.object({
  id: z
    .string()
    .regex(/^[A-Za-z0-9_.:-]{1,128}$/)
    .optional()
    .describe('Client-chosen id for idempotency; assigned by the server if absent'),
  type: z.enum(ACT_TYPES as [ActType, ...ActType[]]),
  from: z.string().min(1).max(128), // agent id, e.g. "agent.architect"
  to: z.string().max(128).optional(),
  taskId: z.string().max(128).optional(),
  intent: z.string().max(64).optional(),
  references: z.array(z.string().max(256)).max(50).default([]),
  payload: z.record(z.string(), z.unknown()).default({}),
  authorityRef: z.string().max(128).optional(),
  ttl: z.number().int().positive().max(7 * 24 * 3600).optional(),
})

export type ActInput = z.input<typeof ActSchema>
export type ActEnvelope = z.output<typeof ActSchema>

// How the caller's identity was established. Recorded on every act + ledger event.
export type ActVia = 'token' | 'impersonated' | 'system' | 'link' | 'delegated'

export interface Act extends ActEnvelope {
  id: string
  timestamp: string
  seq: number // monotonic act sequence number
  via: ActVia
}
