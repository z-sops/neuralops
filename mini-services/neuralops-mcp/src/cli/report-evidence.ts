#!/usr/bin/env bun
// neuralops report-evidence — record evidence on a task from CI.
//
// When NEURALOPS_TOKEN belongs to an agent with `attest` authority (the CI
// agent), the evidence is recorded as VERIFIED, which satisfies gates with
// requireVerified. Agents cannot produce verified evidence for themselves.
//
//   bun src/cli/report-evidence.ts --type test --summary "212 tests passed" --ref "$RUN_URL"
//   (task id from --task, NEURALOPS_TASK, branch or PR title)

import { arg, call, findTaskId } from './client.js'

async function main(): Promise<number> {
  const taskId = arg('task') ?? findTaskId()
  const type = arg('type')
  const summary = arg('summary')
  const ref = arg('ref')
  if (!taskId || !type || !summary || !ref) {
    console.error('usage: report-evidence --type <test|build|scan|…> --summary "<text>" --ref <url> [--task task_42]')
    return 2
  }
  try {
    const { status, data } = await call<{ ok: boolean; error?: string; ledgerEvent?: { deltaSummary: string } }>('POST', '/api/acts', {
      type: 'evidence',
      payload: { taskId, type, summary, ref },
    })
    if (status !== 200 || !data.ok) {
      console.error(`NeuralOps: evidence NOT recorded (${status}) — ${data.error}`)
      return 1
    }
    console.log(`NeuralOps: ${data.ledgerEvent?.deltaSummary}`)
    return 0
  } catch (e) {
    console.error(`NeuralOps: core unreachable — ${(e as Error).message}`)
    return 2
  }
}

process.exit(await main())
