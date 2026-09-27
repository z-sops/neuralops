#!/usr/bin/env bun
// neuralops gate-check — exit 0 if NeuralOps has cleared the action, 1 if not, 2 on error.
//
// Use it as a GitHub required status check (merge) or before a deploy step.
//
//   bun src/cli/gate-check.ts --task task_42 --action complete --scope production
//   bun src/cli/gate-check.ts --action deploy            # task id from branch / PR title / NEURALOPS_TASK
//
// Env: NEURALOPS_URL, NEURALOPS_TOKEN (any agent token, e.g. the CI agent's).
// --allow-untracked : exit 0 when no task id can be found (default: fail).

import { arg, call, findTaskId, flag } from './client.js'

interface GateStatus {
  allowed: boolean
  reason: string
  taskId: string
  action: string
  scope: string
  taskStatus: string
}

async function main(): Promise<number> {
  const action = arg('action') ?? 'complete'
  const scope = arg('scope') ?? 'production'
  const taskId = arg('task') ?? findTaskId()
  if (!taskId) {
    if (flag('allow-untracked')) {
      console.log('NeuralOps gate: no task id found (branch/PR/NEURALOPS_TASK) — allowed because --allow-untracked')
      return 0
    }
    console.error('NeuralOps gate: BLOCKED — no NeuralOps task id found. Name the branch or PR like "task_42-…" or set NEURALOPS_TASK.')
    return 1
  }
  try {
    const q = new URLSearchParams({ taskId, action, scope })
    const { status, data } = await call<GateStatus & { error?: string }>('GET', `/api/gate/status?${q}`)
    if (status !== 200) {
      console.error(`NeuralOps gate: ERROR (${status}) — ${data.error ?? 'unexpected response'}`)
      return 2
    }
    const line = `NeuralOps gate: ${data.allowed ? 'ALLOWED' : 'BLOCKED'} — ${action}/${scope} on ${taskId} (task ${data.taskStatus}). ${data.reason}`
    if (data.allowed) {
      console.log(line)
      return 0
    }
    console.error(line)
    return 1
  } catch (e) {
    console.error(`NeuralOps gate: ERROR — core unreachable: ${(e as Error).message}. Failing closed.`)
    return 2
  }
}

process.exit(await main())
