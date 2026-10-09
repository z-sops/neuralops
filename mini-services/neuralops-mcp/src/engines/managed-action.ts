// Optional Orbit contract. Ordinary clients retain their legacy perform API.
// This validates the recorded task and evidence before authority/approval.
import { createHash } from 'node:crypto'
import { store } from '../state/store.js'
import type { Task } from '../state/types.js'
import { forbidden } from '../errors.js'

export interface ManagedBinding {
  version: 'orbit-v1'
  jobId: string
  runId: string
  tool: string
  argumentsSha256: string
}
export function managedActionName(tool: string): string {
  return `tool.${createHash('sha256').update(tool).digest('hex').slice(0, 32)}`
}
export function managedDetail(b: ManagedBinding): string {
  return JSON.stringify({ version: b.version, jobId: b.jobId, runId: b.runId, tool: b.tool, argumentsSha256: b.argumentsSha256 })
}
export function validateManagedAction(actor: string, task: Task | null, action: string, scope: string, target: string | undefined, b: ManagedBinding): void {
  if (!task || task.assignee !== actor || task.status !== 'in_progress') throw forbidden('Managed action requires an in-progress task owned by the authenticated actor.')
  if (!task.constraints.includes(`orbit.job:${b.jobId}`) || !task.constraints.includes(`orbit.run:${b.runId}`)) throw forbidden('Managed action job/run does not match the recorded task.')
  if (scope !== `orbit:${b.jobId}` || action !== managedActionName(b.tool) || target !== b.tool) throw forbidden('Managed action tool/scope binding mismatch.')
  for (const gate of task.gates.filter(g => (g.action === '*' || g.action === action) && (g.scope === '*' || g.scope === scope))) {
    for (const type of gate.requireVerified ?? []) {
      if (!store.evidenceForTask(task.id).some(e => e.type === type && e.verified)) throw forbidden(`Managed action requires verified ${type} evidence.`)
    }
  }
}
