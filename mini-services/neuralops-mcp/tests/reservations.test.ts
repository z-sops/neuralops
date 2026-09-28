// File reservations: glob overlap, engine rules, lifecycle, HTTP, and the two
// enforcement points (Claude Code hook for edits, git pre-commit for commits).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { act, freshDemo, ok, store, task, SEEDED_AT } from './helpers.js'
import { matchesPath, normalizePath, patternsOverlap } from '../src/engines/paths.js'
import { checkPaths, activeReservations } from '../src/engines/reservations.js'
import { processAct } from '../src/engines/task-manager.js'
import { revokeAgent } from '../src/engines/admin.js'
import { verifyIntegrity, genesis } from '../src/engines/replay.js'
import { formatCompactedContext, getCompactedContext, getInbox } from '../src/engines/context.js'
import { createApp, type App } from '../src/app.js'
import { loadConfig } from '../src/config.js'

const AUTH = 'api-gateway/src/auth/session.ts' // covered by backend's seeded reservation

describe('path patterns', () => {
  test('normalization', () => {
    expect(normalizePath('./src/a.ts')).toBe('src/a.ts')
    expect(normalizePath('src\\auth\\a.ts')).toBe('src/auth/a.ts')
    expect(normalizePath('src/auth/')).toBe('src/auth/**')
    for (const bad of ['/etc/passwd', '../secret', 'src/../../x', 'C:/Windows/x']) expect(() => normalizePath(bad)).toThrow()
  })

  test('matching', () => {
    expect(matchesPath('src/**/*.ts', 'src/a.ts')).toBe(true)
    expect(matchesPath('src/**/*.ts', 'src/x/y/z.ts')).toBe(true)
    expect(matchesPath('src/**/*.ts', 'src/a.tsx')).toBe(false)
    expect(matchesPath('src/*.ts', 'src/x/a.ts')).toBe(false)
    expect(matchesPath('src/auth/**', 'src/auth/a/b.ts')).toBe(true)
    expect(matchesPath('src/a?.ts', 'src/ab.ts')).toBe(true)
  })

  test('overlap is conservative but not blind', () => {
    const yes: [string, string][] = [
      ['src/auth/**', 'src/**/*.ts'],
      ['src/auth/**', 'src/auth/session.ts'],
      ['**', 'README.md'],
      ['src/**', 'src/db/**'],
    ]
    const no: [string, string][] = [
      ['src/**/*.ts', 'src/**/*.css'],
      ['src/auth/**', 'src/db/**'],
      ['docs/a.md', 'src/a.md'],
      ['src/a.ts', 'src/b.ts'],
    ]
    for (const [a, b] of yes) expect([a, b, patternsOverlap(a, b), patternsOverlap(b, a)]).toEqual([a, b, true, true])
    for (const [a, b] of no) expect([a, b, patternsOverlap(a, b), patternsOverlap(b, a)]).toEqual([a, b, false, false])
  })
})

describe('reservation rules', () => {
  beforeEach(freshDemo)

  test('seeded: backend holds the auth module', () => {
    const [c] = checkPaths('agent.security', [AUTH])
    expect(c.blocked).toBe(true)
    expect(c.heldBy[0].agentId).toBe('agent.backend')
    expect(checkPaths('agent.backend', [AUTH])[0]).toMatchObject({ blocked: false, mine: true })
  })

  test('exclusive conflicts name the holder; shared + shared is fine; shared vs exclusive conflicts', () => {
    ok(act('agent.security', 'claim', { taskId: 'task_43' }))
    const clash = act('agent.security', 'reserve_files', { taskId: 'task_43', patterns: ['api-gateway/src/**/*.ts'] })
    expect(clash.errorCode).toBe('conflict')
    expect(clash.error).toMatch(/agent\.backend/)
    ok(act('agent.qa', 'reserve_files', { patterns: ['docs/**'], exclusive: false }))
    ok(act('agent.architect', 'reserve_files', { patterns: ['docs/adr/**'], exclusive: false }))
    expect(act('agent.security', 'reserve_files', { patterns: ['docs/adr/001.md'] }).errorCode).toBe('conflict')
  })

  test('you must own the task you reserve for', () => {
    expect(act('agent.qa', 'reserve_files', { taskId: 'task_42', patterns: ['x/**'] }).errorCode).toBe('forbidden')
  })

  test('re-reserving renews instead of stacking', () => {
    const a = ok(act('agent.qa', 'reserve_files', { taskId: 'task_44', patterns: ['ci/**'], ttlSeconds: 600 }))
    const b = ok(act('agent.qa', 'reserve_files', { taskId: 'task_44', patterns: ['ci/'], ttlSeconds: 7200 }))
    expect(b.reservation!.id).toBe(a.reservation!.id)
    expect(b.reservation!.expiresAt > a.reservation!.expiresAt).toBe(true)
    expect(activeReservations().filter((r) => r.agentId === 'agent.qa')).toHaveLength(1)
  })

  test('expired reservations stop blocking', () => {
    const t0 = new Date(Date.now()).toISOString()
    const r = processAct({ type: 'reserve_files', from: 'agent.qa', payload: { patterns: ['tmp/**'], ttlSeconds: 60 } }, { now: t0 })
    expect(r.ok).toBe(true)
    const later = new Date(Date.now() + 120_000).toISOString()
    const s = processAct({ type: 'reserve_files', from: 'agent.security', payload: { patterns: ['tmp/x.txt'] } }, { now: later })
    expect(s.ok).toBe(true)
  })

  test('release by holder, force-release by a manager, not by a peer', () => {
    const id = activeReservations().find((r) => r.agentId === 'agent.backend')!.id
    expect(act('agent.qa', 'release_files', { reservationId: id }).errorCode).toBe('forbidden')
    const forced = ok(act('agent.architect', 'release_files', { reservationId: id })) // architect is backend's manager
    expect(forced.ledgerEvent!.deltaSummary).toMatch(/FORCE-released/)
    expect(checkPaths('agent.security', [AUTH])[0].blocked).toBe(false)
    expect(act('agent.backend', 'release_files', { all: true }).errorCode).toBe('conflict') // nothing left
  })

  test('completing a task releases its reservations', () => {
    ok(act('agent.architect', 'create_task', { id: 'task_r', title: 'r', objective: 'o' }))
    ok(act('agent.qa', 'claim', { taskId: 'task_r' }))
    ok(act('agent.qa', 'reserve_files', { taskId: 'task_r', patterns: ['web/**'] }))
    const done = ok(act('agent.qa', 'complete', { taskId: 'task_r', summary: 'done' }))
    expect(done.ledgerEvent!.deltaSummary).toMatch(/released 1 file reservation/)
    expect(checkPaths('agent.security', ['web/index.html'])[0].heldBy).toHaveLength(0)
  })

  test('releasing a task releases its reservations', () => {
    ok(act('agent.backend', 'release', { taskId: 'task_42', reason: 'reprioritised' }))
    expect(checkPaths('agent.security', [AUTH])[0].blocked).toBe(false)
  })

  test('accepting a handoff moves the task’s reservations to the new owner', () => {
    ok(act('agent.backend', 'handoff', { taskId: 'task_42', to: 'agent.security', intent: 'review' }))
    const acc = ok(act('agent.security', 'accept_handoff', { taskId: 'task_42' }))
    expect(acc.ledgerEvent!.deltaSummary).toMatch(/took over 1 file reservation/)
    expect(checkPaths('agent.security', [AUTH])[0]).toMatchObject({ blocked: false, mine: true })
    expect(checkPaths('agent.backend', [AUTH])[0].blocked).toBe(true)
  })

  test('revoking an agent releases its reservations', () => {
    revokeAgent('agent.backend', 'admin')
    expect(checkPaths('agent.security', [AUTH])[0].heldBy).toHaveLength(0)
  })

  test('context, inbox and replay know about reservations', () => {
    ok(act('agent.qa', 'reserve_files', { taskId: 'task_44', patterns: ['.github/workflows/**'] }))
    expect(formatCompactedContext(getCompactedContext('task_42'))).toMatch(/FILES RESERVED\n- api-gateway\/src\/auth\/\*\* — exclusive by agent\.backend/)
    expect(getInbox('agent.qa').myReservations[0].patterns).toEqual(['.github/workflows/**'])
    expect(verifyIntegrity().replayMatches).toBe(true)
    void task
  })
})

// ------------------------------------------------------------------ HTTP + enforcement (real processes)

let app: App
let base: string
let repo: string

async function sh(cmd: string[], opts: { cwd: string; env?: Record<string, string>; stdin?: string }) {
  const p = Bun.spawn(cmd, {
    cwd: opts.cwd,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
      ...(opts.env ?? {}),
    },
    stdin: opts.stdin === undefined ? 'ignore' : new TextEncoder().encode(opts.stdin),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
  return { code, out, err }
}

const ROOT = join(import.meta.dir, '..')

beforeAll(async () => {
  app = createApp(loadConfig({ NEURALOPS_DATA_DIR: 'off', NEURALOPS_RATE_LIMIT: 'off' }))
  base = `http://127.0.0.1:${await app.listen(0)}`
})
afterAll(async () => {
  await app.close()
  if (repo) rmSync(repo, { recursive: true, force: true })
})

describe('HTTP', () => {
  beforeEach(() => genesis('demo', SEEDED_AT))

  test('list and check reservations', async () => {
    const list = await (await fetch(`${base}/api/reservations?agentId=agent.backend`)).json()
    expect(list[0].patterns).toEqual(['api-gateway/src/auth/**'])
    const chk = await (
      await fetch(`${base}/api/reservations/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer nops_demo_security' },
        body: JSON.stringify({ paths: [AUTH, 'README.md'] }),
      })
    ).json()
    expect(chk.results.map((r: { blocked: boolean }) => r.blocked)).toEqual([true, false])
  })
})

describe('git pre-commit hook (every agent)', () => {
  beforeAll(async () => {
    genesis('demo', SEEDED_AT)
    repo = mkdtempSync(join(tmpdir(), 'neuralops-repo-'))
    await sh(['git', 'init', '-q', '-b', 'main'], { cwd: repo })
    mkdirSync(join(repo, 'api-gateway/src/auth'), { recursive: true })
    writeFileSync(join(repo, AUTH), 'export {}\n')
    writeFileSync(join(repo, 'README.md'), '# app\n')
    const inst = await sh([process.execPath, join(ROOT, 'src/cli/install-git-hook.ts'), '--repo', repo, '--token', 'nops_demo_security', '--url', base], { cwd: repo })
    expect(inst.code).toBe(0)
  })

  test('installer writes the hook and keeps the token inside .git', () => {
    expect(readFileSync(join(repo, '.git/hooks/pre-commit'), 'utf8')).toContain('neuralops-pre-commit')
    expect(existsSync(join(repo, '.git/neuralops-token'))).toBe(true)
  })

  test('committing a file another agent reserved is blocked', async () => {
    await sh(['git', 'add', AUTH], { cwd: repo })
    const r = await sh(['git', 'commit', '-q', '-m', 'touch auth'], { cwd: repo })
    expect(r.code).not.toBe(0)
    expect(r.err).toMatch(/reserved by another agent/)
    expect(r.err).toMatch(/agent\.backend/)
    await sh(['git', 'rm', '-q', '--cached', AUTH], { cwd: repo }) // repo has no HEAD yet
  })

  test('committing free files works', async () => {
    await sh(['git', 'add', 'README.md'], { cwd: repo })
    const r = await sh(['git', 'commit', '-q', '-m', 'readme'], { cwd: repo })
    expect(r.code).toBe(0)
  })

  test('the holder itself can commit its reserved files', async () => {
    await sh(['git', 'add', AUTH], { cwd: repo })
    const r = await sh(['git', 'commit', '-q', '-m', 'auth by backend'], { cwd: repo, env: { NEURALOPS_TOKEN: 'nops_demo_backend' } })
    expect(r.code).toBe(0)
  })
})

describe('Claude Code hook: edits vs reservations', () => {
  const HOOK = join(ROOT, 'src/hooks/claude-pretooluse.ts')
  let proj: string
  beforeAll(() => {
    proj = mkdtempSync(join(tmpdir(), 'neuralops-proj-'))
  })
  beforeEach(() => genesis('demo', SEEDED_AT))

  const edit = (token: string, file: string, env: Record<string, string> = {}) =>
    sh([process.execPath, HOOK], {
      cwd: proj,
      env: { NEURALOPS_URL: base, NEURALOPS_TOKEN: token, CLAUDE_PROJECT_DIR: proj, ...env },
      stdin: JSON.stringify({ tool_name: 'Edit', cwd: proj, tool_input: { file_path: join(proj, file) } }),
    })

  test('editing a file another agent reserved is blocked, with the holder named', async () => {
    ok(act('agent.security', 'claim', { taskId: 'task_43' }))
    const r = await edit('nops_demo_security', AUTH)
    expect(r.code).toBe(2)
    expect(r.err).toMatch(/reserved by agent\.backend/)
    expect((await edit('nops_demo_security', 'docs/review.md')).code).toBe(0)
  })

  test('the holder can edit; strict mode requires a reservation', async () => {
    expect((await edit('nops_demo_backend', AUTH)).code).toBe(0)
    const strict = await edit('nops_demo_backend', 'README.md', { NEURALOPS_REQUIRE_RESERVATION: '1' })
    expect(strict.code).toBe(2)
    expect(strict.err).toMatch(/reserve README\.md first/)
  })
})
