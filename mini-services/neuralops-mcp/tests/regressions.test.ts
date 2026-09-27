// One test per defect found in the V0.1 review — each failed on the original code.

import { beforeEach, describe, expect, test } from 'bun:test'
import { act, freshDemo, gatedTask, ok, store, task } from './helpers.js'
import { genesis } from '../src/engines/replay.js'
import { registerAgent } from '../src/engines/agents.js'

beforeEach(freshDemo)

describe('V0.1 review regressions', () => {
  test('#1 request_approval works (was: RequestApprovalPayload is not defined)', () => {
    const r = ok(act('agent.backend', 'request_approval', { taskId: 'task_42', action: 'deploy', scope: 'production' }))
    expect(r.approval?.approver).toBe('agent.architect')
    expect(r.approval?.status).toBe('pending')
  })

  test('#2 reject_handoff works and restores the previous status (was: RejectHandoffPayload is not defined)', () => {
    ok(act('agent.backend', 'handoff', { taskId: 'task_42', to: 'agent.security', intent: 'review' }))
    expect(task('task_42').status).toBe('handoff_pending')
    ok(act('agent.security', 'reject_handoff', { taskId: 'task_42', reason: 'not ready' }))
    const t = task('task_42')
    expect(t.status).toBe('in_progress')
    expect(t.assignee).toBe('agent.backend')
    expect(t.pendingHandoffTo).toBeNull()
    expect(t.handoffs.at(-1)?.accepted).toBe(false)
  })

  test('#3 an agent cannot authorize its own approval', () => {
    const gate = ok(act('agent.backend', 'complete', { taskId: 'task_42', summary: 'ship' }))
    const id = gate.approval!.id
    const self = act('agent.backend', 'authorize', { approvalId: id })
    expect(self.ok).toBe(false)
    expect(self.errorCode).toBe('forbidden')
    // …and an unrelated peer cannot either
    const peer = act('agent.qa', 'authorize', { approvalId: id })
    expect(peer.errorCode).toBe('forbidden')
    expect(store.approvals.get(id)!.status).toBe('pending')
    expect(task('task_42').status).toBe('in_progress')
  })

  test('#4 gate cannot be bypassed by avoiding the word "production"', () => {
    for (const payload of [
      { taskId: 'task_42', summary: 'deployed to prod', resultRef: 'prod://live' },
      { taskId: 'task_42', summary: 'done' }, // no hint at all — task-level gate still applies
    ]) {
      const r = ok(act('agent.backend', 'complete', payload))
      expect(r.stateChanged).toBe(false)
      expect(r.approval).not.toBeNull()
      expect(task('task_42').status).toBe('in_progress')
    }
    // Both attempts share one pending approval instead of spamming new ones.
    expect([...store.approvals.values()].filter((a) => a.status === 'pending')).toHaveLength(1)
  })

  test('#5 approvals are single-use and bound to their task', () => {
    gatedTask('agent.backend', 'task_a')
    gatedTask('agent.backend', 'task_b')
    const gate = ok(act('agent.backend', 'complete', { taskId: 'task_a', summary: 'a' }))
    ok(act('agent.architect', 'authorize', { approvalId: gate.approval!.id }))

    // Approval for task_a does not unlock task_b
    const b = ok(act('agent.backend', 'complete', { taskId: 'task_b', summary: 'b' }))
    expect(b.approval?.id).not.toBe(gate.approval!.id)
    expect(task('task_b').status).toBe('in_progress')

    const a = ok(act('agent.backend', 'complete', { taskId: 'task_a', summary: 'a' }))
    expect(task('task_a').status).toBe('completed')
    const used = store.approvals.get(gate.approval!.id)!
    expect(used.consumedBy).toBe(a.act!.id)
    expect(used.consumedAt).not.toBeNull()
  })

  test('#6 registering cannot overwrite an existing agent (was: take over agent.ceo)', () => {
    expect(() => registerAgent({ id: 'agent.ceo', name: 'x', model: 'Custom', role: 'x' }, { asAdmin: false })).toThrow(
      /already exists/
    )
    expect(store.agents.get('agent.ceo')!.authority[0].action).toBe('*')
    // Non-admin registration never grants authority
    const { agent } = registerAgent(
      { id: 'agent.sneaky', name: 'S', model: 'Custom', role: 'dev', authority: [{ action: '*', scope: '*' }] },
      { asAdmin: false }
    )
    expect(agent.authority).toEqual([])
  })

  test('#7 unknown agents cannot act', () => {
    const r = act('agent.nobody', 'claim', { taskId: 'task_43' })
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('forbidden')
    expect(task('task_43').assignee).toBeNull()
  })

  test('#8 cannot complete (or block) while a handoff is pending', () => {
    ok(act('agent.backend', 'handoff', { taskId: 'task_42', to: 'agent.security', intent: 'review' }))
    const c = act('agent.backend', 'complete', { taskId: 'task_42', summary: 'done' })
    expect(c.errorCode).toBe('conflict')
    expect(act('agent.backend', 'block', { taskId: 'task_42', reason: 'x' }).errorCode).toBe('conflict')
    expect(task('task_42').status).toBe('handoff_pending')
  })

  test('#9 escalate is restricted and validates the target', () => {
    expect(act('agent.security', 'escalate', { taskId: 'task_44', reason: 'lol', to: 'agent.architect' }).errorCode).toBe('forbidden')
    expect(act('agent.qa', 'escalate', { taskId: 'task_44', reason: 'x', to: 'nobody' }).errorCode).toBe('not_found')
    ok(act('agent.qa', 'escalate', { taskId: 'task_44', reason: 'DevOps silent', to: 'agent.architect' }))
    expect(task('task_44').escalatedTo).toBe('agent.architect')
    // Escalation target can take the task over
    ok(act('agent.architect', 'claim', { taskId: 'task_44', note: 'taking over' }))
    expect(task('task_44').assignee).toBe('agent.architect')
    expect(task('task_44').status).toBe('in_progress')
  })

  test('#10 gated complete returns its ledger event; references never contain empty strings', () => {
    const gate = ok(act('agent.backend', 'complete', { taskId: 'task_42', summary: 's' }))
    expect(gate.ledgerEvent).not.toBeNull()
    ok(act('agent.architect', 'authorize', { approvalId: gate.approval!.id }))
    const done = ok(act('agent.backend', 'complete', {
      taskId: 'task_42',
      summary: 'shipped',
      evidence: [{ type: 'deploy', summary: 'deployed', ref: 'ci://deploy/1' }],
    }))
    const refs = done.ledgerEvent!.references
    expect(refs.every((r) => r.length > 0)).toBe(true)
    expect(refs).toContain(gate.approval!.id)
    expect(refs.some((r) => r.startsWith('evidence_'))).toBe(true)
  })

  test('#11 reset/seed notify observers (dashboard no longer goes stale)', () => {
    let snapshots = 0
    const off = store.onSnapshot(() => snapshots++)
    genesis('empty')
    genesis('demo')
    off()
    expect(snapshots).toBe(2)
  })

  test('#12 seed has no contradictory authority; gatekeeping lives in policies', () => {
    const arch = store.agents.get('agent.architect')!
    expect(arch.authority.every((a) => a.requiresApproval === false)).toBe(true)
    expect([...store.policies.values()].map((p) => `${p.action}/${p.scope}→${p.approver}`)).toContain(
      'complete/production→agent.architect'
    )
  })

  test('wildcard authority actually works (CEO "*/*" was ignored before)', () => {
    const gate = ok(act('agent.backend', 'complete', { taskId: 'task_42', summary: 's' }))
    ok(act('agent.ceo', 'authorize', { approvalId: gate.approval!.id }))
  })

  test('ledger seq is contiguous and the chain verifies', () => {
    ok(act('agent.security', 'claim', { taskId: 'task_43' }))
    act('agent.nobody', 'claim', { taskId: 'task_43' }) // rejected
    ok(act('agent.architect', 'decision', { taskId: 'task_42', text: 'use redis' }))
    const seqs = store.ledger.map((e) => e.seq)
    expect(seqs).toEqual(seqs.map((_, i) => i + 1))
    expect(store.verifyChain().valid).toBe(true)
  })
})
