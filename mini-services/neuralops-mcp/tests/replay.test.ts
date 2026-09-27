// Event sourcing: the journal rebuilds identical state; tampering is detected;
// state survives a restart.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { act, freshDemo, ok, store } from './helpers.js'
import { replay, verifyIntegrity } from '../src/engines/replay.js'
import { bootstrapState } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { registerAgent } from '../src/engines/agents.js'
import type { LedgerEvent } from '../src/state/types.js'

function busyDay() {
  ok(act('agent.security', 'claim', { taskId: 'task_43' }))
  ok(act('agent.backend', 'handoff', { taskId: 'task_42', to: 'agent.security', intent: 'review' }))
  ok(act('agent.security', 'accept_handoff', { taskId: 'task_42' }))
  act('agent.qa', 'claim', { taskId: 'task_42' }) // rejected, must not matter
  const gate = ok(act('agent.security', 'complete', { taskId: 'task_42', summary: 'ship' }))
  ok(act('agent.architect', 'authorize', { approvalId: gate.approval!.id }))
  ok(act('agent.security', 'complete', { taskId: 'task_42', summary: 'ship', evidence: [{ type: 'deploy', summary: 'd', ref: 'ci://9' }] }))
  const q = ok(act('agent.qa', 'question', { to: 'role:architect', about: 'runner image?' }))
  ok(act('agent.architect', 'answer', { questionId: q.ledgerEvent!.after.questionId as string, payload: 'node20+redis7' }))
  registerAgent({ id: 'agent.devops', name: 'DevOps', model: 'GPT', role: 'devops', reportsTo: 'agent.architect' }, { asAdmin: false })
  ok(act('agent.qa', 'escalate', { taskId: 'task_44', reason: 'need image', to: 'agent.devops' }))
  ok(act('agent.devops', 'claim', { taskId: 'task_44' }))
}

describe('replay', () => {
  beforeEach(freshDemo)

  test('replaying the journal reproduces the exact state', () => {
    busyDay()
    const report = verifyIntegrity()
    expect(report.chainValid).toBe(true)
    expect(report.replayError).toBeNull()
    expect(report.replayMatches).toBe(true)
    // live state was restored after the check
    expect(store.tasks.get('task_42')!.status).toBe('completed')
  })

  test('replay into a fresh store gives the same state hash', () => {
    busyDay()
    const hash = store.stateHash()
    const journal = structuredClone([...store.journal])
    store.reset()
    replay(journal)
    expect(store.stateHash()).toBe(hash)
  })

  test('tampering with the ledger breaks the hash chain', () => {
    busyDay()
    const e = store.ledger[3] as LedgerEvent
    e.deltaSummary = 'nothing to see here'
    const chain = store.verifyChain()
    expect(chain.valid).toBe(false)
    expect(chain.brokenAt).toBe(4)
  })
})

describe('persistence', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'neuralops-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const cfg = () => loadConfig({ NEURALOPS_DATA_DIR: dir })

  test('state survives a restart', () => {
    const first = bootstrapState(cfg())
    expect(first.restored).toBe(false)
    busyDay()
    const hash = store.stateHash()
    first.journal!.detach()

    store.reset()
    const second = bootstrapState(cfg())
    expect(second.restored).toBe(true)
    expect(store.stateHash()).toBe(hash)
    // …and keeps journaling after restore
    ok(act('agent.architect', 'decision', { taskId: 'task_42', text: 'after restart' }))
    second.journal!.detach()
    const lines = readFileSync(join(dir, 'journal.jsonl'), 'utf8').trim().split('\n')
    expect(JSON.parse(lines.at(-1)!).act.payload.text).toBe('after restart')
    // Tokens are never written in clear text
    expect(readFileSync(join(dir, 'journal.jsonl'), 'utf8')).not.toContain('nops_')
  })

  test('a torn final line (crash mid-write) is tolerated', () => {
    const b = bootstrapState(cfg())
    ok(act('agent.architect', 'decision', { taskId: 'task_42', text: 'kept' }))
    b.journal!.detach()
    appendFileSync(join(dir, 'journal.jsonl'), '{"k":"act","act":{"id":"act_0')
    store.reset()
    const r = bootstrapState(cfg())
    r.journal!.detach()
    expect(r.restored).toBe(true)
    expect(store.decisionsForTask('task_42').some((d) => d.text === 'kept')).toBe(true)
  })

  test('a diverging journal refuses to replay instead of silently wiping history', () => {
    freshDemo()
    const journal = structuredClone([...store.journal])
    const bogus = { k: 'act' as const, act: { id: 'act_x', type: 'claim' as const, from: 'agent.qa', payload: { taskId: 'task_42' }, references: [], timestamp: '2026-01-01T00:00:00.000Z', seq: 1, via: 'token' as const } }
    expect(() => replay([...journal, bogus])).toThrow(/diverged/)
  })

  test('an unsigned line appended to a signed journal refuses to boot', () => {
    const b = bootstrapState(cfg())
    b.journal!.detach()
    const bogus = { k: 'act', act: { id: 'act_x', type: 'claim', from: 'agent.qa', payload: { taskId: 'task_42' }, references: [], timestamp: '2026-01-01T00:00:00.000Z', seq: 1, via: 'token' } }
    appendFileSync(join(dir, 'journal.jsonl'), JSON.stringify(bogus) + '\n')
    store.reset()
    expect(() => bootstrapState(cfg())).toThrow(/integrity check failed/)
  })

  test('seeding a new demo truncates the journal to a fresh genesis', () => {
    const b = bootstrapState(cfg())
    ok(act('agent.architect', 'decision', { taskId: 'task_42', text: 'old' }))
    freshDemo()
    b.journal!.detach()
    const lines = readFileSync(join(dir, 'journal.jsonl'), 'utf8').trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]).k).toBe('genesis')
    writeFileSync(join(dir, 'x'), '')
  })
})
