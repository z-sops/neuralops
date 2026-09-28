// Protocol behaviour: all 23 act types, authority rules, conversations, validation.

import { beforeEach, describe, expect, test } from 'bun:test'
import { act, freshDemo, ok, store, task } from './helpers.js'
import { processAct } from '../src/engines/task-manager.js'
import { ACT_TYPES, type ActType } from '../src/protocol/act-types.js'
import { getCompactedContext, getContextComparison, getInbox } from '../src/engines/context.js'

beforeEach(freshDemo)

describe('golden path', () => {
  test('handoff → accept → evidence → gated complete → authorize → complete', () => {
    ok(act('agent.security', 'claim', { taskId: 'task_43', note: 'reviewing' }))
    ok(act('agent.backend', 'handoff', { taskId: 'task_42', to: 'agent.security', intent: 'review' }))
    ok(act('agent.security', 'accept_handoff', { taskId: 'task_42' }))
    ok(act('agent.security', 'evidence', { taskId: 'task_42', type: 'review', summary: 'no critical issues', ref: 'review://42' }))
    const gate = ok(act('agent.security', 'complete', { taskId: 'task_42', summary: 'deployed', resultRef: 'production://auth/v1' }))
    expect(gate.approval?.approver).toBe('agent.architect')
    ok(act('agent.architect', 'authorize', { approvalId: gate.approval!.id }))
    ok(act('agent.security', 'complete', { taskId: 'task_42', summary: 'deployed', resultRef: 'production://auth/v1' }))
    const t = task('task_42')
    expect(t.status).toBe('completed')
    expect(t.progress).toBe(100)
    expect(store.verifyChain().valid).toBe(true)
  })

  test('agents with direct authority are not gated', () => {
    ok(act('agent.architect', 'create_task', { id: 'task_arch', title: 'x', objective: 'y', gates: [{ action: 'complete', scope: 'production' }] }))
    ok(act('agent.architect', 'claim', { taskId: 'task_arch' }))
    const r = ok(act('agent.architect', 'complete', { taskId: 'task_arch', summary: 'done' }))
    expect(r.approval).toBeNull()
    expect(task('task_arch').status).toBe('completed')
  })

  test('declared scope gates an ungated task', () => {
    ok(act('agent.qa', 'create_task', { id: 'task_q', title: 'q', objective: 'o' }))
    ok(act('agent.qa', 'claim', { taskId: 'task_q' }))
    const r = ok(act('agent.qa', 'complete', { taskId: 'task_q', summary: 's', scope: 'production' }))
    expect(r.approval).not.toBeNull()
    // staging has no policy and no gate → not gated
    ok(act('agent.qa', 'create_task', { id: 'task_s', title: 's', objective: 'o' }))
    ok(act('agent.qa', 'claim', { taskId: 'task_s' }))
    expect(ok(act('agent.qa', 'complete', { taskId: 'task_s', summary: 's', scope: 'staging' })).approval).toBeNull()
  })
})

describe('every act type is implemented', () => {
  test('all 25 act types succeed in one scenario', () => {
    const seen = new Set<ActType>()
    const run = (from: string, type: ActType, payload: Record<string, unknown>) => {
      const r = ok(act(from, type, payload))
      seen.add(type)
      return r
    }
    run('agent.architect', 'create_task', { id: 'task_x', title: 'X', objective: 'o' })
    run('agent.qa', 'claim', { taskId: 'task_x' })
    run('agent.qa', 'status', { taskId: 'task_x', progress: 30, eta: 'tomorrow' })
    run('agent.qa', 'block', { taskId: 'task_x', reason: 'waiting' })
    run('agent.qa', 'claim', { taskId: 'task_x' }) // owner re-claim unblocks
    expect(task('task_x').status).toBe('in_progress')
    run('agent.qa', 'update', { taskId: 'task_x', field: 'nextSteps', value: ['write tests'] })
    run('agent.qa', 'reserve_files', { taskId: 'task_x', patterns: ['tests/x/**'] })
    run('agent.qa', 'release_files', { taskId: 'task_x' })
    run('agent.qa', 'handoff', { taskId: 'task_x', to: 'agent.backend', intent: 'implement' })
    run('agent.backend', 'reject_handoff', { taskId: 'task_x', reason: 'busy' })
    run('agent.qa', 'handoff', { taskId: 'task_x', to: 'agent.security', intent: 'review' })
    run('agent.security', 'accept_handoff', { taskId: 'task_x' })
    run('agent.security', 'evidence', { taskId: 'task_x', type: 'test', summary: 'ok', ref: 'ci://1' })
    run('agent.architect', 'decision', { taskId: 'task_x', text: 'use redis' })
    const q = run('agent.backend', 'question', { to: 'role:security', about: 'cookie flags?', taskId: 'task_x' })
    run('agent.security', 'answer', { questionId: q.ledgerEvent!.after.questionId as string, payload: 'Secure; HttpOnly' })
    const p = run('agent.backend', 'proposal', { to: 'agent.architect', what: 'add rate limit', why: 'brute force' })
    run('agent.architect', 'counter', { proposalId: p.ledgerEvent!.after.proposalId as string, alternative: 'captcha after 5 tries' })
    const ra = run('agent.qa', 'request_approval', { action: 'deploy', scope: 'production' })
    run('agent.security', 'deny', { approvalId: ra.approval!.id, reason: 'not reviewed' }) // veto power
    const ra2 = ok(act('agent.qa', 'request_approval', { action: 'deploy', scope: 'production' }))
    run('agent.architect', 'authorize', { approvalId: ra2.approval!.id })
    run('agent.security', 'escalate', { taskId: 'task_x', reason: 'need arch call', to: 'agent.architect' })
    run('agent.architect', 'claim', { taskId: 'task_x' }) // escalation target takes over
    run('agent.architect', 'release', { taskId: 'task_x', reason: 'back to the pool' })
    run('agent.qa', 'subscribe', { scope: 'role:security' })
    run('agent.qa', 'unsubscribe', { scope: 'role:security' })
    run('agent.qa', 'ack', { actId: ra2.act!.id })
    run('agent.qa', 'claim', { taskId: 'task_x' })
    run('agent.qa', 'complete', { taskId: 'task_x', summary: 'done' })
    expect([...seen].sort()).toEqual([...ACT_TYPES].sort())
    expect(store.verifyChain().valid).toBe(true)
  })
})

describe('authority', () => {
  test('manager chain: CEO may authorize approvals routed to the architect', () => {
    const r = ok(act('agent.backend', 'complete', { taskId: 'task_42', summary: 's' }))
    ok(act('agent.ceo', 'authorize', { approvalId: r.approval!.id }))
  })

  test('veto holders can deny but not authorize', () => {
    const r = ok(act('agent.backend', 'complete', { taskId: 'task_42', summary: 's' }))
    expect(act('agent.security', 'authorize', { approvalId: r.approval!.id }).errorCode).toBe('forbidden')
    ok(act('agent.security', 'deny', { approvalId: r.approval!.id, reason: 'found CSRF' }))
    expect(act('agent.architect', 'authorize', { approvalId: r.approval!.id }).errorCode).toBe('conflict')
  })

  test('denied approval does not unlock; a fresh request is created', () => {
    const r = ok(act('agent.backend', 'complete', { taskId: 'task_42', summary: 's' }))
    ok(act('agent.architect', 'deny', { approvalId: r.approval!.id, reason: 'no' }))
    const again = ok(act('agent.backend', 'complete', { taskId: 'task_42', summary: 's' }))
    expect(again.approval!.id).not.toBe(r.approval!.id)
    expect(task('task_42').status).toBe('in_progress')
  })

  test('request_approval without policy falls back to the manager, and is refused if already authorized', () => {
    const r = ok(act('agent.qa', 'request_approval', { action: 'merge', scope: 'main' }))
    expect(r.approval!.approver).toBe('agent.architect') // qa reports to architect
    expect(act('agent.ceo', 'request_approval', { action: 'merge', scope: 'main' }).errorCode).toBe('conflict')
  })

  test('removing gates needs govern authority; adding is allowed', () => {
    const rm = act('agent.backend', 'update', { taskId: 'task_42', field: 'gates', value: [] })
    expect(rm.errorCode).toBe('forbidden')
    ok(act('agent.backend', 'update', {
      taskId: 'task_42',
      field: 'gates',
      value: [{ action: 'complete', scope: 'production' }, { action: 'complete', scope: 'staging' }],
    }))
    ok(act('agent.architect', 'update', { taskId: 'task_42', field: 'gates', value: [] })) // governor, and above owner
    expect(task('task_42').gates).toEqual([])
  })

  test('only owner/managers/governors can update a task', () => {
    expect(act('agent.qa', 'update', { taskId: 'task_42', field: 'objective', value: 'hijack' }).errorCode).toBe('forbidden')
    ok(act('agent.architect', 'update', { taskId: 'task_42', field: 'objective', value: 'refined objective' }))
  })
})

describe('ownership rules', () => {
  test('claim conflicts, release cancels a pending handoff', () => {
    expect(act('agent.qa', 'claim', { taskId: 'task_42' }).errorCode).toBe('conflict')
    ok(act('agent.backend', 'handoff', { taskId: 'task_42', to: 'agent.qa', intent: 'test' }))
    ok(act('agent.backend', 'release', { taskId: 'task_42', reason: 'reprioritised' }))
    const t = task('task_42')
    expect(t.status).toBe('unclaimed')
    expect(t.pendingHandoffTo).toBeNull()
    expect(t.handoffs.at(-1)?.accepted).toBe(false)
    expect(act('agent.qa', 'accept_handoff', { taskId: 'task_42' }).errorCode).toBe('conflict')
  })

  test('status updates set eta instead of piling up nextSteps', () => {
    const before = task('task_42').nextSteps.length
    ok(act('agent.backend', 'status', { taskId: 'task_42', progress: 70, eta: 'Fri' }))
    ok(act('agent.backend', 'status', { taskId: 'task_42', progress: 80, eta: 'Sat' }))
    expect(task('task_42').nextSteps.length).toBe(before)
    expect(task('task_42').eta).toBe('Sat')
    expect(act('agent.qa', 'status', { taskId: 'task_42', progress: 1 }).errorCode).toBe('forbidden')
  })

  test('completed tasks are closed', () => {
    ok(act('agent.architect', 'create_task', { id: 'task_c', title: 'c', objective: 'o' }))
    ok(act('agent.qa', 'claim', { taskId: 'task_c' }))
    ok(act('agent.qa', 'complete', { taskId: 'task_c', summary: 'done' }))
    expect(act('agent.qa', 'complete', { taskId: 'task_c', summary: 'again' }).errorCode).toBe('conflict')
    expect(act('agent.backend', 'claim', { taskId: 'task_c' }).errorCode).toBe('conflict')
  })
})

describe('conversations', () => {
  test('only the recipient (or its role) can answer; answers are single', () => {
    const q = ok(act('agent.backend', 'question', { to: 'agent.architect', about: 'redis or memcached?' }))
    const qid = q.ledgerEvent!.after.questionId as string
    expect(act('agent.qa', 'answer', { questionId: qid, payload: 'x' }).errorCode).toBe('forbidden')
    ok(act('agent.architect', 'answer', { questionId: qid, payload: 'redis' }))
    expect(act('agent.architect', 'answer', { questionId: qid, payload: 'again' }).errorCode).toBe('conflict')
  })

  test('exchanges expire after their TTL', () => {
    const t0 = '2026-09-27T12:00:00.000Z'
    const q = processAct({ type: 'question', from: 'agent.backend', payload: { to: 'agent.qa', about: 'x', ttlSeconds: 60 } }, { now: t0 })
    const qid = q.ledgerEvent!.after.questionId as string
    const late = processAct({ type: 'answer', from: 'agent.qa', payload: { questionId: qid, payload: 'y' } }, { now: '2026-09-27T12:05:00.000Z' })
    expect(late.errorCode).toBe('conflict')
    expect(late.error).toMatch(/expired/)
    expect(getInbox('agent.qa').questions).toHaveLength(0)
  })

  test('targets must exist', () => {
    expect(act('agent.backend', 'question', { to: 'agent.ghost', about: 'x' }).errorCode).toBe('not_found')
    expect(act('agent.backend', 'proposal', { to: 'role:devops', what: 'x', why: 'y' }).errorCode).toBe('not_found')
  })
})

describe('validation & atomicity', () => {
  test('malformed envelopes and payloads are rejected with readable errors', () => {
    const noFrom = processAct({ type: 'claim', payload: { taskId: 'task_43' } })
    expect(noFrom.errorCode).toBe('invalid')
    expect(noFrom.error).toMatch(/from/)
    expect(processAct({ type: 'bogus', from: 'agent.qa' }).errorCode).toBe('invalid')
    const badPayload = act('agent.qa', 'status', { taskId: 'task_44', progress: 150 })
    expect(badPayload.errorCode).toBe('invalid')
    expect(badPayload.error).toMatch(/progress/)
    const mismatch = act('agent.qa', 'status', { taskId: 'task_44', progress: 5 }, { taskId: 'task_42' })
    expect(mismatch.errorCode).toBe('invalid')
  })

  test('rejected acts leave no trace', () => {
    const hash = store.stateHash()
    act('agent.qa', 'claim', { taskId: 'task_42' })
    act('agent.nobody', 'decision', { taskId: 'task_42', text: 'x' })
    act('agent.backend', 'authorize', { approvalId: 'approval_9999' })
    act('agent.backend', 'handoff', { taskId: 'task_42', to: 'agent.backend', intent: 'x' })
    expect(store.stateHash()).toBe(hash)
  })

  test('act ids are idempotency keys', () => {
    ok(act('agent.architect', 'decision', { taskId: 'task_42', text: 'once' }, { id: 'client-key-1' }))
    const dup = act('agent.architect', 'decision', { taskId: 'task_42', text: 'once' }, { id: 'client-key-1' })
    expect(dup.errorCode).toBe('conflict')
    expect(store.decisionsForTask('task_42').filter((d) => d.text === 'once')).toHaveLength(1)
  })
})

describe('context engine', () => {
  test('compacted context surfaces approvals, handoffs and gates', () => {
    const r = ok(act('agent.backend', 'complete', { taskId: 'task_42', summary: 's' }))
    const ctx = getCompactedContext('task_42')
    expect(ctx.open.some((o) => o.includes(r.approval!.id))).toBe(true)
    expect(ctx.gates).toEqual(['complete/production'])
    const cmp = getContextComparison('task_42')
    expect(cmp.compactedTokens).toBeLessThan(cmp.fullTokens)
    expect(cmp.method).toMatch(/estimate/)
  })

  test('inbox shows what is waiting on an agent', () => {
    const r = ok(act('agent.backend', 'complete', { taskId: 'task_42', summary: 's' }))
    ok(act('agent.backend', 'handoff', { taskId: 'task_42', to: 'agent.qa', intent: 'test' }))
    expect(getInbox('agent.architect').approvalsToDecide.map((a) => a.id)).toContain(r.approval!.id)
    expect(getInbox('agent.qa').handoffsToAccept.map((h) => h.taskId)).toContain('task_42')
    expect(getInbox('agent.backend').myPendingApprovals).toHaveLength(1)
  })
})
