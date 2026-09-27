#!/usr/bin/env bun
// Claude Code PreToolUse hook — enforces NeuralOps outside the model.
//
// Claude Code runs this before every matching tool call and passes the call as
// JSON on stdin. Exit code 2 blocks the call and shows stderr to Claude.
// The model cannot skip it: hooks run in Claude Code itself, not in the prompt.
//
// Rules
//   Edit / Write / MultiEdit / NotebookEdit
//       → this agent must own an in-progress NeuralOps task (claim one first).
//   Bash: git push to main/master (or while on main/master)
//       → gate complete/<scope> must be cleared for the task.
//   Bash: other git push
//       → this agent must own an in-progress task.
//   Bash: deploy/publish commands (vercel --prod, npm publish, fly deploy, …)
//       → gate deploy/<scope> must be cleared for the task.
//
// Task id: NEURALOPS_TASK, else task_… in the command, else the git branch.
// Env: NEURALOPS_URL, NEURALOPS_TOKEN (this agent's token), NEURALOPS_SCOPE (default production)
//      NEURALOPS_HOOK_STRICT=1 → also block edits when the core is unreachable
//      (push/deploy are always blocked when the core is unreachable).

import { call, currentBranch, findTaskId } from '../cli/client.js'

interface HookInput {
  tool_name?: string
  tool_input?: { command?: string; file_path?: string }
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const DEPLOY_RE =
  /\b(vercel\b[^\n;&|]*--prod\b|netlify\s+deploy\b[^\n;&|]*--prod\b|fly(ctl)?\s+deploy\b|firebase\s+deploy\b|railway\s+up\b|(npm|pnpm|bun)\s+publish\b|yarn\s+npm\s+publish\b|kubectl\s+apply\b|terraform\s+apply\b|helm\s+(upgrade|install)\b)/
const PUSH_RE = /\bgit\s+push\b/
const MAIN_RE = /\b(main|master)\b/
const scope = process.env.NEURALOPS_SCOPE || 'production'

function block(msg: string): never {
  process.stderr.write(`NeuralOps hook blocked this: ${msg}\n`)
  process.exit(2)
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const c of process.stdin) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

async function ownsActiveTask(): Promise<{ ok: boolean; tasks: string[] }> {
  const { status, data } = await call<{ myTasks?: Array<{ id: string; status: string }>; error?: string }>(
    'GET',
    '/api/inbox'
  )
  if (status !== 200) throw new Error(data.error ?? `HTTP ${status}`)
  const tasks = (data.myTasks ?? []).filter((t) => t.status === 'in_progress').map((t) => t.id)
  return { ok: tasks.length > 0, tasks }
}

async function gate(taskId: string, action: string): Promise<{ allowed: boolean; reason: string }> {
  const q = new URLSearchParams({ taskId, action, scope })
  const { status, data } = await call<{ allowed?: boolean; reason?: string; error?: string }>('GET', `/api/gate/status?${q}`)
  if (status !== 200) throw new Error(data.error ?? `HTTP ${status}`)
  return { allowed: !!data.allowed, reason: data.reason ?? '' }
}

async function main(): Promise<void> {
  let input: HookInput
  try {
    input = JSON.parse((await readStdin()) || '{}') as HookInput
  } catch {
    return // not our business
  }
  const tool = input.tool_name ?? ''
  const command = input.tool_input?.command ?? ''

  const isEdit = EDIT_TOOLS.has(tool)
  const isDeploy = tool === 'Bash' && DEPLOY_RE.test(command)
  const isPush = tool === 'Bash' && PUSH_RE.test(command)
  if (!isEdit && !isDeploy && !isPush) return

  try {
    if (isDeploy) {
      const taskId = findTaskId(command)
      if (!taskId) block('deploy commands need a NeuralOps task (set NEURALOPS_TASK or use a task_… branch).')
      const g = await gate(taskId, 'deploy')
      if (!g.allowed) block(`deploy/${scope} is not cleared for ${taskId}. ${g.reason}`)
      return
    }
    if (isPush) {
      const branch = currentBranch()
      const toMain = MAIN_RE.test(command.replace(/--[a-z-]+/g, '')) || branch === 'main' || branch === 'master'
      if (toMain) {
        const taskId = findTaskId(command)
        if (!taskId) block('pushing to main needs a completed NeuralOps task (set NEURALOPS_TASK).')
        const g = await gate(taskId, 'complete')
        if (!g.allowed) block(`push to main: ${g.reason}`)
        return
      }
      const own = await ownsActiveTask()
      if (!own.ok) block('claim a NeuralOps task (neuralops_claim) before pushing.')
      return
    }
    // edits
    const own = await ownsActiveTask()
    if (!own.ok) {
      block('you do not own an in-progress NeuralOps task. Call neuralops_inbox, then neuralops_claim a task before editing files.')
    }
  } catch (e) {
    const msg = `NeuralOps core unreachable at ${process.env.NEURALOPS_URL || 'http://127.0.0.1:3031'} (${(e as Error).message})`
    if (isEdit && process.env.NEURALOPS_HOOK_STRICT !== '1') {
      process.stderr.write(`${msg} — edit allowed (set NEURALOPS_HOOK_STRICT=1 to block).\n`)
      return
    }
    block(`${msg}. Push/deploy fail closed.`)
  }
}

await main()
