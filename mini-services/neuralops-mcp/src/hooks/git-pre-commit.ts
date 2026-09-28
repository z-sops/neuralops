#!/usr/bin/env bun
// git pre-commit hook — blocks commits that touch files another agent has
// exclusively reserved in NeuralOps.
//
// Works for EVERY agent and human that commits through git (Claude Code,
// Codex CLI, Gemini CLI, you), because git runs it, not the model.
//
// Identity: NEURALOPS_TOKEN, else <git-dir>/neuralops-token (written by
// install-git-hook). URL: NEURALOPS_URL, else <git-dir>/neuralops-url.
// Core unreachable → commit allowed with a warning (CI still gates the merge);
// NEURALOPS_HOOK_STRICT=1 blocks instead.
// Emergency bypass is git's own `git commit --no-verify` — the merge gate
// (gate-check) is what makes that visible and non-final.

import { execSync } from 'node:child_process'
import { BASE, TOKEN, call } from '../cli/client.js'

interface Check {
  path: string
  blocked: boolean
  heldBy: { reservationId: string; agentId: string; exclusive: boolean; expiresAt: string; taskId: string | null }[]
}

function stagedFiles(): string[] {
  const out = execSync('git diff --cached --name-only --diff-filter=ACMRD -z', { stdio: ['ignore', 'pipe', 'ignore'] })
  return out.toString('utf8').split('\0').filter(Boolean)
}

async function main(): Promise<number> {
  const files = stagedFiles()
  if (files.length === 0) return 0
  if (!TOKEN) {
    console.error('NeuralOps pre-commit: no agent token (NEURALOPS_TOKEN or .git/neuralops-token) — skipping reservation check.')
    return process.env.NEURALOPS_HOOK_STRICT === '1' ? 1 : 0
  }
  let results: Check[]
  try {
    const { status, data } = await call<{ results?: Check[]; frozen?: { reason: string; by: string } | null; error?: string }>('POST', '/api/reservations/check', { paths: files })
    if (status !== 200 || !data.results) throw new Error(data.error ?? `HTTP ${status}`)
    if (data.frozen) {
      console.error(`NeuralOps pre-commit: BLOCKED — the workspace is FROZEN (incident mode) by ${data.frozen.by}: ${data.frozen.reason}`)
      return 1
    }
    results = data.results
  } catch (e) {
    const msg = `NeuralOps pre-commit: core unreachable at ${BASE} (${(e as Error).message})`
    if (process.env.NEURALOPS_HOOK_STRICT === '1') {
      console.error(`${msg} — commit blocked (NEURALOPS_HOOK_STRICT=1).`)
      return 1
    }
    console.error(`${msg} — commit allowed; the merge gate still applies.`)
    return 0
  }
  const blocked = results.filter((r) => r.blocked)
  if (blocked.length === 0) return 0
  console.error('NeuralOps pre-commit: BLOCKED — these staged files are reserved by another agent:')
  for (const r of blocked) {
    const h = r.heldBy.find((x) => x.exclusive) ?? r.heldBy[0]
    console.error(`  ${r.path}  ← ${h.agentId} [${h.reservationId}${h.taskId ? `, ${h.taskId}` : ''}] until ${h.expiresAt}`)
  }
  console.error('Unstage them (git restore --staged <file>), ask the holder to release, or wait for the reservation to expire.')
  return 1
}

process.exit(await main())
