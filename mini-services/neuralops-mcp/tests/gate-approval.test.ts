import { beforeEach, test } from 'bun:test'
import assert from 'node:assert/strict'
import { store } from '../src/state/store.js'
import { gateStatus } from '../src/engines/gate.js'
import { isUsable, consumeApproval, findConsumableApproval } from '../src/engines/authority.js'
import type { Approval, Task } from '../src/state/types.js'

const AT = '2026-10-08T12:00:00.000Z'
function approval(overrides: Partial<Approval> = {}): Approval {
  const a = { id: 'approval_test', workspaceId: 'ws', taskId: 'task_test', action: 'deploy', scope: 'production', requestedBy: 'agent.alex', approver: 'human.owner', status: 'approved', decidedBy: 'human.owner', decidedAt: AT, reason: null, references: [], timestamp: AT, consumedAt: null, consumedBy: null, ...overrides } as Approval
  store.approvals.set(a.id, a)
  return a
}
beforeEach(() => {
  store.tasks.clear(); store.approvals.clear(); store.evidence.clear(); store.freeze = null
  store.tasks.set('task_test', { id: 'task_test', status: 'in_progress', gates: [], clearances: [] } as unknown as Task)
})
const check = () => gateStatus('task_test', 'deploy', 'production')

test('fresh approved permission allows a non-completion gate without consuming it', () => {
  const a = approval(); assert.equal(check().allowed, true); assert.equal(check().approvalId, a.id); assert.equal(a.consumedAt, null)
})
test('expired permission cannot clear a new action even though status stays approved', () => {
  approval({ validUntil: new Date(Date.now() - 60_000).toISOString() }); assert.equal(check().allowed, false)
})
test('consumed single-use permission cannot clear a new action', () => {
  const a = approval(); consumeApproval(a, 'act_1', AT); assert.equal(a.status, 'approved'); assert.equal(check().allowed, false)
})
test('multi-use permission remains usable until its final use and then closes', () => {
  const a = approval({ usesLeft: 2 }); consumeApproval(a, 'act_1', AT); assert.equal(a.usesLeft, 1); assert.equal(check().allowed, true)
  consumeApproval(a, 'act_2', AT); assert.equal(a.usesLeft, 0); assert.equal(check().allowed, false)
})
test('zero or malformed use counts fail closed even without a consumption marker', () => {
  for (const usesLeft of [0, -1, NaN, 1.5, Infinity]) assert.equal(isUsable(approval({ usesLeft }), AT), false)
})
test('expiry uses instants, rejects invalid times and expires exactly at the boundary', () => {
  assert.equal(isUsable(approval({ validUntil: AT }), AT), false)
  assert.equal(isUsable(approval({ validUntil: '2026-10-08T17:00:00+05:00' }), AT), false)
  assert.equal(isUsable(approval({ validUntil: 'not-a-date' }), AT), false)
  assert.equal(isUsable(approval({ validUntil: AT }), 'not-a-date'), false)
  assert.equal(isUsable(approval({ validUntil: '2026-10-08T12:00:01.000Z' }), AT), true)
})
test('omitting check time still enforces real-time expiration', () => {
  assert.equal(isUsable(approval({ validUntil: '2000-01-01T00:00:00.000Z' })), false)
})
test('old non-completion clearance is a receipt, not repeat permission', () => {
  const a = approval(); consumeApproval(a, 'act_1', AT)
  store.tasks.get('task_test')!.clearances.push({ action: 'deploy', scope: 'production', via: 'approval', approvalId: a.id, by: a.requestedBy, actId: 'act_1', at: AT })
  assert.equal(check().allowed, false)
  store.tasks.get('task_test')!.clearances[0].via = 'authority'; assert.equal(check().allowed, false)
})
test('completed task clearance remains a historical completion check', () => {
  const a = approval({ action: 'complete', validUntil: '2000-01-01T00:00:00.000Z' }); consumeApproval(a, 'act_1', AT)
  const t = store.tasks.get('task_test')!; t.status = 'completed'; t.gates = [{ action: 'complete', scope: 'production' }]
  t.clearances.push({ action: 'complete', scope: 'production', via: 'approval', approvalId: a.id, by: a.requestedBy, actId: 'act_1', at: AT })
  assert.equal(gateStatus(t.id, 'complete', 'production').allowed, true)
  t.status = 'in_progress'; assert.equal(gateStatus(t.id, 'complete', 'production').allowed, false)
})
test('a usable approval is selected after stale entries; pending and denied do not allow', () => {
  approval({ id: 'old', consumedAt: AT }); const fresh = approval({ id: 'new' }); assert.equal(check().approvalId, fresh.id)
  store.approvals.delete(fresh.id); approval({ id: 'pending', status: 'pending' }); assert.equal(check().allowed, false); assert.equal(check().approvalId, 'pending')
  store.approvals.clear(); approval({ status: 'denied' }); assert.equal(check().allowed, false)
})
test('task, action, scope and requester matching stay exact', () => {
  approval({ taskId: 'another' }); assert.equal(check().allowed, false)
  store.approvals.clear(); approval({ scope: 'staging' }); assert.equal(check().allowed, false)
  store.approvals.clear(); approval({ action: 'publish' }); assert.equal(check().allowed, false)
  store.approvals.clear(); approval(); assert.equal(findConsumableApproval('agent.bob', 'deploy', 'production', 'task_test', AT), null)
})
test('freeze and required verified evidence still block a usable approval', () => {
  approval(); store.freeze = { by: 'human.owner', at: AT, reason: 'incident' }; assert.equal(check().allowed, false)
  store.freeze = null; store.tasks.get('task_test')!.gates = [{ action: 'deploy', scope: 'production', requireVerified: ['test'] }]; assert.equal(check().allowed, false)
  store.evidence.set('e', { id: 'e', taskId: 'task_test', type: 'test', verified: true } as any); assert.equal(check().allowed, true)
})
