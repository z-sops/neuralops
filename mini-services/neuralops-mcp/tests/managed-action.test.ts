import { beforeEach, test } from 'bun:test'
import assert from 'node:assert/strict'
import { store } from '../src/state/store.js'
import { processAct } from '../src/engines/task-manager.js'
import { managedActionName, managedDetail } from '../src/engines/managed-action.js'
import type { Agent, Approval, Task } from '../src/state/types.js'

const binding = { version: 'orbit-v1' as const, jobId: 'job-73d4bbef-2f69-4a1e-8fe7-448a1c99f8ee', runId: '701679a9-2b73-4291-bf8c-0bc5d7917b8c', tool: 'builtin/write_file', argumentsSha256: 'a'.repeat(64) }
const payload = () => ({ taskId: 'task_test', action: managedActionName(binding.tool), scope: `orbit:${binding.jobId}`, target: binding.tool, binding: { ...binding } })
const perform = (p = payload()) => processAct({ type: 'perform', from: 'agent.alex', payload: p })
beforeEach(() => {
  store.reset()
  for (const id of ['agent.alex', 'agent.bob', 'human.owner']) store.agents.set(id, { id, workspaceId: 'ws', name: id, model: 'Custom', role: 'test', reportsTo: id === 'human.owner' ? null : 'human.owner', authority: [], status: 'online', subscriptions: [], createdAt: new Date().toISOString() } as Agent)
  store.tasks.set('task_test', { id: 'task_test', workspaceId: 'ws', assignee: 'agent.alex', status: 'in_progress', constraints: [`orbit.job:${binding.jobId}`, `orbit.run:${binding.runId}`], gates: [], clearances: [] } as unknown as Task)
  store.policies.set('policy_test', { id: 'policy_test', action: '*', scope: '*', approver: 'human.owner' })
})
function approve(overrides: Partial<Approval> = {}) {
  const a = { id: 'approval_test', workspaceId: 'ws', taskId: 'task_test', action: payload().action, scope: payload().scope, requestedBy: 'agent.alex', approver: 'human.owner', status: 'approved', decidedBy: 'human.owner', decidedAt: new Date().toISOString(), reason: null, references: [], timestamp: new Date().toISOString(), consumedAt: null, consumedBy: null, detail: managedDetail(binding), ...overrides } as Approval
  store.approvals.set(a.id, a); return a
}
test('pending managed action stores exact immutable binding and does not allow the action', () => {
  const result = perform(); assert.equal(result.ok, true); assert.equal(result.allowed, false); assert.equal(result.approval?.detail, managedDetail(binding))
})
test('matching human approval is consumed once; another attempt creates a new pending approval', () => {
  approve(); const result = perform(); assert.equal(result.allowed, true); assert.ok(result.approval?.consumedAt); assert.equal(result.ledgerEvent?.after.performed, false); assert.equal(result.ledgerEvent?.after.authorized, true); assert.equal(perform().allowed, false)
})
test('changed arguments do not reuse either approved or pending permission', () => {
  approve(); const p = payload(); p.binding.argumentsSha256 = 'b'.repeat(64)
  const result = perform(p); assert.equal(result.allowed, false); assert.notEqual(result.approval?.id, 'approval_test'); assert.equal(store.approvals.get('approval_test')?.consumedAt, null)
  const next = payload(); next.binding.argumentsSha256 = 'c'.repeat(64); assert.notEqual(perform(next).approval?.id, result.approval?.id)
})
test('wrong owner and non-running task fail before approval consumption', () => {
  for (const patch of [{ assignee: 'agent.bob' }, { status: 'completed' }, { status: 'blocked' }]) {
    const t = store.tasks.get('task_test')!; t.assignee = 'agent.alex'; t.status = 'in_progress'; Object.assign(t, patch); approve(); assert.equal(perform().ok, false); assert.equal(store.approvals.get('approval_test')?.consumedAt, null)
  }
})
test('job/run/tool/scope mismatch and invalid digest fail without mutations', () => {
  for (const patch of [{ scope: 'production' }, { target: 'other' }, { action: 'deploy' }, { binding: { ...binding, runId: '8406a2ec-abba-43ce-88e0-4b18ee8f2b28' } }, { binding: { ...binding, argumentsSha256: 'bad' } }]) {
    const before = store.ledger.length; const result = perform({ ...payload(), ...patch }); assert.equal(result.ok, false); assert.equal(store.ledger.length, before)
  }
})
test('missing binding on managed task and missing governing policy fail closed', () => {
  const p: Record<string, unknown> = payload(); delete p.binding; assert.equal(processAct({ type: 'perform', from: 'agent.alex', payload: p }).ok, false)
  store.policies.clear(); assert.equal(perform().ok, false)
})
test('verified evidence is checked before direct authority and approval', () => {
  store.tasks.get('task_test')!.gates = [{ action: '*', scope: '*', requireVerified: ['test'] }]
  store.agents.get('agent.alex')!.authority = [{ action: '*', scope: '*', requiresApproval: false, approver: '' }]
  assert.equal(perform().ok, false)
  store.tasks.get('task_test')!.gates = []; assert.equal(perform().allowed, true)
})
test('multi-use or agent-decided approval cannot authorize managed action', () => {
  approve({ usesLeft: 2 }); assert.equal(perform().ok, false)
  store.approvals.clear(); approve({ decidedBy: 'agent.bob' }); assert.equal(perform().ok, false)
})
test('legacy ungoverned perform retains existing behavior outside managed tasks', () => {
  store.policies.clear(); const result = processAct({ type: 'perform', from: 'agent.alex', payload: { action: 'read', scope: 'test' } }); assert.equal(result.allowed, true); assert.equal(result.via, 'ungoverned')
})
test('frozen workspace and revoked worker cannot consume a managed permission', () => {
  approve(); store.freeze = { by: 'human.owner', at: new Date().toISOString(), reason: 'incident' }
  assert.equal(perform().ok, false); assert.equal(store.approvals.get('approval_test')?.consumedAt, null)
  store.freeze = null; store.agents.get('agent.alex')!.revokedAt = new Date().toISOString()
  assert.equal(perform().ok, false); assert.equal(store.approvals.get('approval_test')?.consumedAt, null)
})
