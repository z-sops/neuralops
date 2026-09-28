// Gap 3: enforcement outside NeuralOps — CI gate-check CLI, CI evidence
// reporter, and the Claude Code PreToolUse hook, run as real processes.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { createApp, type App } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { genesis } from '../src/engines/replay.js'
import { freezeWorkspace, unfreezeWorkspace } from '../src/engines/admin.js'
import { act, ok, SEEDED_AT, store } from './helpers.js'

const ROOT = join(import.meta.dir, '..')
const GATE = join(ROOT, 'src/cli/gate-check.ts')
const REPORT = join(ROOT, 'src/cli/report-evidence.ts')
const HOOK = join(ROOT, 'src/hooks/claude-pretooluse.ts')

let app: App
let base: string

async function run(script: string, args: string[], env: Record<string, string>, stdin?: string) {
  const proc = Bun.spawn([process.execPath, script, ...args], {
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', NEURALOPS_URL: base, ...env },
    stdin: stdin === undefined ? 'ignore' : new TextEncoder().encode(stdin),
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: '/', // not inside a git repo: branch detection finds nothing
  })
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return { code, out, err }
}

const hook = (token: string, payload: unknown, env: Record<string, string> = {}) =>
  run(HOOK, [], { NEURALOPS_TOKEN: token, ...env }, JSON.stringify(payload))

/** Drive task_42 through approval to completed (as security). */
function completeTask42() {
  ok(act('agent.backend', 'handoff', { taskId: 'task_42', to: 'agent.security', intent: 'review' }))
  ok(act('agent.security', 'accept_handoff', { taskId: 'task_42' }))
  const g = ok(act('agent.security', 'complete', { taskId: 'task_42', summary: 'ship' }))
  ok(act('agent.architect', 'authorize', { approvalId: g.approval!.id }))
  ok(act('agent.security', 'complete', { taskId: 'task_42', summary: 'ship' }))
}

beforeAll(async () => {
  app = createApp(loadConfig({ NEURALOPS_DATA_DIR: 'off', NEURALOPS_RATE_LIMIT: 'off' }))
  base = `http://127.0.0.1:${await app.listen(0)}`
})
afterAll(() => app.close())
beforeEach(() => genesis('demo', SEEDED_AT))

describe('gate-check CLI (CI required status check)', () => {
  const env = { NEURALOPS_TOKEN: 'nops_demo_ci' }

  test('blocks merge while the task is open (exit 1), allows it once cleared (exit 0)', async () => {
    const blocked = await run(GATE, ['--task', 'task_42'], env)
    expect(blocked.code).toBe(1)
    expect(blocked.err).toMatch(/BLOCKED/)
    completeTask42()
    const allowed = await run(GATE, ['--task', 'task_42'], env)
    expect(allowed.code).toBe(0)
    expect(allowed.out).toMatch(/ALLOWED .*cleared via approval/)
  })

  test('finds the task id in the PR title / branch', async () => {
    completeTask42()
    expect((await run(GATE, [], { ...env, PR_TITLE: 'task_42: session auth' })).code).toBe(0)
    expect((await run(GATE, [], { ...env, GITHUB_HEAD_REF: 'task_43-review' })).code).toBe(1)
  })

  test('no task id fails unless --allow-untracked', async () => {
    expect((await run(GATE, [], env)).code).toBe(1)
    expect((await run(GATE, ['--allow-untracked'], env)).code).toBe(0)
  })

  test('fails closed when the core is unreachable or the token is bad', async () => {
    expect((await run(GATE, ['--task', 'task_42'], { ...env, NEURALOPS_URL: 'http://127.0.0.1:9' })).code).toBe(2)
    expect((await run(GATE, ['--task', 'task_42'], { NEURALOPS_TOKEN: 'nops_bogus' })).code).toBe(2)
  })

  test('deploy gate', async () => {
    expect((await run(GATE, ['--task', 'task_42', '--action', 'deploy'], env)).code).toBe(1)
    const r = ok(act('agent.backend', 'request_approval', { taskId: 'task_42', action: 'deploy', scope: 'production' }))
    ok(act('agent.architect', 'authorize', { approvalId: r.approval!.id }))
    expect((await run(GATE, ['--task', 'task_42', '--action', 'deploy'], env)).code).toBe(0)
  })
})

describe('report-evidence CLI', () => {
  test('CI token records VERIFIED evidence; an agent token records self-reported evidence', async () => {
    const ci = await run(REPORT, ['--task', 'task_42', '--type', 'test', '--summary', '212 passed', '--ref', 'https://ci/1'], { NEURALOPS_TOKEN: 'nops_demo_ci' })
    expect(ci.code).toBe(0)
    expect(ci.out).toMatch(/VERIFIED/)
    const self = await run(REPORT, ['--task', 'task_42', '--type', 'test', '--summary', 'trust me', '--ref', 'x'], { NEURALOPS_TOKEN: 'nops_demo_backend' })
    expect(self.code).toBe(0)
    expect(self.out).not.toMatch(/VERIFIED/)
    const ev = store.evidenceForTask('task_42').filter((e) => e.type === 'test')
    expect(ev.map((e) => [e.producedBy, e.verified])).toContainEqual(['agent.ci', true])
    expect(ev.map((e) => [e.producedBy, e.verified])).toContainEqual(['agent.backend', false])
  })
})

describe('Claude Code PreToolUse hook', () => {
  const edit = { tool_name: 'Edit', tool_input: { file_path: 'src/a.ts' } }
  const bash = (command: string) => ({ tool_name: 'Bash', tool_input: { command } })

  test('kill switch: a frozen workspace blocks edits and deploys', async () => {
    const deploy = bash('vercel --prod')
    expect((await hook('nops_demo_backend', edit)).code).toBe(0)
    freezeWorkspace({ reason: 'incident 12' }, 'admin')
    const e = await hook('nops_demo_backend', edit)
    expect(e.code).toBe(2)
    expect(e.err).toMatch(/FROZEN .*incident 12/)
    const d = await hook('nops_demo_architect', deploy, { NEURALOPS_TASK: 'task_42' })
    expect(d.code).toBe(2)
    expect(d.err).toMatch(/FROZEN/)
    unfreezeWorkspace({}, 'admin')
    expect((await hook('nops_demo_backend', edit)).code).toBe(0)
  })

  test('edits need an in-progress task owned by this agent', async () => {
    expect((await hook('nops_demo_backend', edit)).code).toBe(0) // owns task_42
    const qa = await hook('nops_demo_qa', edit) // owns task_44, but it is blocked
    expect(qa.code).toBe(2)
    expect(qa.err).toMatch(/claim a task/)
    expect((await hook('nops_demo_security', edit)).code).toBe(2) // owns nothing
    ok(act('agent.security', 'claim', { taskId: 'task_43' }))
    expect((await hook('nops_demo_security', edit)).code).toBe(0)
  })

  test('push to main needs the task completed and cleared', async () => {
    const blocked = await hook('nops_demo_backend', bash('git push origin main'), { NEURALOPS_TASK: 'task_42' })
    expect(blocked.code).toBe(2)
    expect(blocked.err).toMatch(/push to main/)
    completeTask42()
    expect((await hook('nops_demo_backend', bash('git push origin main'), { NEURALOPS_TASK: 'task_42' })).code).toBe(0)
  })

  test('feature-branch push needs an owned in-progress task', async () => {
    expect((await hook('nops_demo_backend', bash('git push -u origin task_42-auth'))).code).toBe(0)
    expect((await hook('nops_demo_security', bash('git push -u origin feature-x'))).code).toBe(2)
  })

  test('deploy commands need an approved deploy gate', async () => {
    const cmd = bash('vercel deploy --prod')
    expect((await hook('nops_demo_backend', cmd, { NEURALOPS_TASK: 'task_42' })).code).toBe(2)
    const r = ok(act('agent.backend', 'request_approval', { taskId: 'task_42', action: 'deploy', scope: 'production' }))
    ok(act('agent.architect', 'authorize', { approvalId: r.approval!.id }))
    expect((await hook('nops_demo_backend', cmd, { NEURALOPS_TASK: 'task_42' })).code).toBe(0)
    expect((await hook('nops_demo_backend', bash('npm publish'))).code).toBe(2) // no task id → blocked
  })

  test('other tools and harmless commands pass straight through', async () => {
    expect((await hook('nops_demo_security', { tool_name: 'Read', tool_input: {} })).code).toBe(0)
    expect((await hook('nops_demo_security', bash('ls -la && git status'))).code).toBe(0)
  })

  test('core unreachable: edits allowed with a warning, push/deploy fail closed', async () => {
    const down = { NEURALOPS_URL: 'http://127.0.0.1:9' }
    const e = await hook('nops_demo_backend', edit, down)
    expect(e.code).toBe(0)
    expect(e.err).toMatch(/unreachable/)
    expect((await hook('nops_demo_backend', edit, { ...down, NEURALOPS_HOOK_STRICT: '1' })).code).toBe(2)
    expect((await hook('nops_demo_backend', bash('git push origin main'), { ...down, NEURALOPS_TASK: 'task_42' })).code).toBe(2)
  })
})
