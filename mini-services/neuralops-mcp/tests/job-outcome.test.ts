import { beforeEach, test } from 'bun:test'
import assert from 'node:assert/strict'
import { store } from '../src/state/store.js'
import { processAct, jobOutcomeReceipt } from '../src/engines/task-manager.js'
import type { Agent } from '../src/state/types.js'
import { callTool, TOOL_DEFS } from '../src/mcp/tools.js'

const jobId = 'job-73d4bbef-2f69-4a1e-8fe7-448a1c99f8ee', runId = '701679a9-2b73-4291-bf8c-0bc5d7917b8c'
const base = { taskId: 'task_outcome', version: 'orbit-v1', jobId, runId, sequence: 1, state: 'review', verification: 'files_checked', reportSha256: 'a'.repeat(64), artifactsSha256: 'b'.repeat(64), artifactCount: 1 }
const outcome = (payload = base, id = 'outcome_1', from = 'agent.alex') => processAct({ id, type: 'job_outcome', from, payload })
beforeEach(() => {
  store.reset()
  for (const id of ['agent.alex', 'agent.bob', 'human.owner']) store.agents.set(id, { id, workspaceId: 'ws', name: id, model: 'Custom', role: 'test', reportsTo: id === 'human.owner' ? null : 'human.owner', authority: [], status: 'online', subscriptions: [], createdAt: new Date().toISOString() } as Agent)
  assert.equal(processAct({ type: 'create_task', from: 'agent.alex', payload: { id: 'task_outcome', title: 'Outcome', objective: 'Test', constraints: [`orbit.job:${jobId}`, `orbit.run:${runId}`] } }).ok, true)
  assert.equal(processAct({ type: 'claim', from: 'agent.alex', payload: { taskId: 'task_outcome' } }).ok, true)
})
test('review and local acceptance are unverified client claims, never approvals or completion', () => {
  assert.equal(outcome().task?.status, 'blocked')
  const accepted = outcome({ ...base, sequence: 2, state: 'accepted_locally' }, 'outcome_2')
  assert.equal(accepted.ok, true); assert.equal(accepted.task?.status, 'blocked'); assert.equal(accepted.task?.clientOutcome?.verified, false)
  assert.equal(accepted.ledgerEvent?.after.remoteCompletion, false); assert.equal(store.approvals.size, 0); assert.equal(store.evidence.size, 0)
})
test('wrong owner, job/run and malformed metadata leave state and ledger unchanged', () => {
  const before = JSON.stringify(store.exportData())
  for (const [p, from] of [[base, 'agent.bob'], [{ ...base, jobId: 'job-8406a2ec-abba-43ce-88e0-4b18ee8f2b28' }, 'agent.alex'], [{ ...base, runId: '8406a2ec-abba-43ce-88e0-4b18ee8f2b28' }, 'agent.alex'], [{ ...base, reportSha256: 'bad' }, 'agent.alex'], [{ ...base, humanApproved: true }, 'agent.alex']] as const) {
    assert.equal(outcome(p as typeof base, 'bad', from).ok, false); assert.equal(JSON.stringify(store.exportData()), before)
  }
})
test('out-of-order, failed-check acceptance and changes after remote reconciliation are refused', () => {
  assert.equal(outcome({ ...base, sequence: 2, state: 'accepted_locally' }).ok, false)
  outcome(); assert.equal(outcome({ ...base, sequence: 2, state: 'accepted_locally', verification: 'failed' }, 'bad_accept').ok, false)
  assert.equal(outcome({ ...base, sequence: 2, state: 'accepted_locally', reportSha256: 'c'.repeat(64) }, 'changed_report').ok, false)
  store.tasks.get(base.taskId)!.status = 'in_progress'
  assert.equal(outcome({ ...base, sequence: 2, state: 'accepted_locally' }, 'changed').ok, false)
})
test('fixed act id creates one receipt and duplicate submission never repeats its effects', () => {
  assert.equal(jobOutcomeReceipt('agent.alex', base.taskId, 'outcome_1'), null)
  outcome(); const count = store.ledger.length
  assert.equal(outcome().ok, false); assert.equal(store.ledger.length, count)
  const receipt = jobOutcomeReceipt('agent.alex', base.taskId, 'outcome_1')!
  assert.equal(receipt.from, 'agent.alex'); assert.equal(JSON.stringify(receipt.payload), JSON.stringify(base)); assert.match(receipt.ledgerHash, /^[a-f0-9]{64}$/)
  assert.throws(() => jobOutcomeReceipt('agent.bob', base.taskId, 'outcome_1'), /another task or identity/)
  const saved = store.exportData(); store.reset(); store.importData(saved)
  assert.equal(jobOutcomeReceipt('agent.alex', base.taskId, 'outcome_1')?.ledgerHash, receipt.ledgerHash)
})
test('failed and cancelled execution pause remotely and cannot become local acceptance', () => {
  assert.equal(outcome({ ...base, state: 'failed', verification: 'unverified', artifactCount: 0 }).task?.status, 'blocked')
  assert.equal(outcome({ ...base, sequence: 2, state: 'accepted_locally' }, 'bad').ok, false)
})
test('startup interruption is recorded as an uncertain execution outcome, never completion', () => {
  const result = outcome({ ...base, state: 'interrupted', verification: 'unverified', artifactCount: 0 })
  assert.equal(result.ok, true); assert.equal(result.task?.status, 'blocked'); assert.equal(result.task?.clientOutcome?.state, 'interrupted')
})
test('freeze/revocation cannot record an outcome or change the journal', () => {
  const before = store.ledger.length
  store.freeze = { by: 'human.owner', at: new Date().toISOString(), reason: 'incident' }; assert.equal(outcome().ok, false)
  store.freeze = null; store.agents.get('agent.alex')!.revokedAt = new Date().toISOString(); assert.equal(outcome().ok, false)
  assert.equal(store.ledger.length, before); assert.throws(() => jobOutcomeReceipt('agent.alex', base.taskId, 'outcome_1'))
})
test('real MCP registry advertises outcome capability and derives its schema from the dispatcher', () => {
  const caller = { agentId: 'agent.alex', scoped: true, via: 'delegated' as const }
  const me = callTool('neuralops_whoami', {}, caller)
  assert.equal((me.result as { capabilities: { jobOutcomes: string } }).capabilities.jobOutcomes, 'orbit-v1')
  assert.ok(TOOL_DEFS.some(t => t.name === 'neuralops_job_outcome'))
  assert.equal(callTool('neuralops_job_receipt', { taskId: base.taskId, actId: 'wire_1' }, caller).ok, true)
  assert.equal(callTool('neuralops_job_outcome', { ...base, actId: 'wire_1' }, caller).ok, true)
  const result = callTool('neuralops_job_receipt', { taskId: base.taskId, actId: 'wire_1' }, caller)
  assert.equal((result.result as { receipt: { from: string } }).receipt.from, caller.agentId)
  assert.equal(callTool('neuralops_job_receipt', { taskId: base.taskId, actId: 'wire_1' }, { ...caller, agentId: 'agent.bob' }).ok, false)
})
