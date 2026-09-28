// Shared helpers for the NeuralOps CLIs and hooks (run outside the core).

import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Per-worktree git dir (where install-git-hook stores this agent's token/url). */
export function gitDir(): string | null {
  try {
    return execSync('git rev-parse --absolute-git-dir', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null
  } catch {
    return null
  }
}

function fromGitDir(name: string): string {
  const dir = gitDir()
  const p = dir ? join(dir, name) : null
  return p && existsSync(p) ? readFileSync(p, 'utf8').trim() : ''
}

export const BASE = (process.env.NEURALOPS_URL || fromGitDir('neuralops-url') || 'http://127.0.0.1:3031').replace(/\/$/, '')
export const TOKEN = process.env.NEURALOPS_TOKEN || fromGitDir('neuralops-token')

export async function call<T = unknown>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  timeoutMs = 5000
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' }
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`
  else if (process.env.NEURALOPS_AGENT) headers['X-Agent-Id'] = process.env.NEURALOPS_AGENT
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await res.text()
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    data = { error: text.slice(0, 300) }
  }
  return { status: res.status, data: data as T }
}

/**
 * Record in the ledger that an enforcer stopped this agent. Best effort and
 * quick: a hook must never hang or fail because the report could not be sent.
 */
export async function reportBlock(payload: {
  enforcer: 'claude-code' | 'codex' | 'gemini' | 'git-pre-commit' | 'guard' | 'ci' | 'other'
  tool: string
  reason: string
  target?: string
}): Promise<void> {
  if (process.env.NEURALOPS_REPORT_BLOCKS === '0') return
  try {
    await call('POST', '/api/acts', {
      type: 'report_block',
      payload: { ...payload, tool: payload.tool.slice(0, 100), reason: payload.reason.slice(0, 1000), ...(payload.target ? { target: payload.target.slice(0, 500) } : {}) },
    }, 1500)
  } catch {
    /* the block stands whether or not it was recorded */
  }
}

// Task ids never contain hyphens, so a branch like task_42-auth-module yields task_42.
export const TASK_ID_RE = /\btask_[A-Za-z0-9_]+/

export function currentBranch(): string | null {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null
  } catch {
    return null
  }
}

/** First task id found in: explicit value, NEURALOPS_TASK, CI branch/PR env, current git branch. */
export function findTaskId(...extra: Array<string | null | undefined>): string | null {
  const sources = [
    ...extra,
    process.env.NEURALOPS_TASK,
    process.env.GITHUB_HEAD_REF,
    process.env.GITHUB_REF_NAME,
    process.env.PR_TITLE,
    process.env.PR_BODY,
    currentBranch(),
  ]
  for (const s of sources) {
    const m = s?.match(TASK_ID_RE)
    if (m) return m[0]
  }
  return null
}

export function arg(name: string, argv = process.argv): string | null {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null
}

export function flag(name: string, argv = process.argv): boolean {
  return argv.includes(`--${name}`)
}
