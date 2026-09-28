import { store } from '../src/state/store.js'
import { genesis } from '../src/engines/replay.js'
import { processAct, type ActResult } from '../src/engines/task-manager.js'
import type { ActType } from '../src/protocol/act-types.js'

// Seed now so time-based state (e.g. the seeded 8h file reservation) is live during the run.
export const SEEDED_AT = new Date().toISOString()

export function freshDemo(): void {
  genesis('demo', SEEDED_AT)
}

export function act(
  from: string,
  type: ActType,
  payload: Record<string, unknown>,
  extra: Record<string, unknown> = {}
): ActResult {
  return processAct({ type, from, payload, ...extra }, { via: 'token' })
}

/** Assert an act succeeded; returns the result. */
export function ok(r: ActResult): ActResult {
  if (!r.ok) throw new Error(`expected ok, got ${r.errorCode}: ${r.error}`)
  return r
}

export function task(id: string) {
  const t = store.tasks.get(id)
  if (!t) throw new Error(`no task ${id}`)
  return t
}

/** Create a gated task owned by `owner`. */
export function gatedTask(owner: string, id: string) {
  ok(act(owner, 'create_task', { id, title: `Task ${id}`, objective: 'ship it', gates: [{ action: 'complete', scope: 'production' }] }))
  ok(act(owner, 'claim', { taskId: id }))
}

export { store }
