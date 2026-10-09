'use strict';
// Real mutation/persistence modules, in-memory filesystem. Validation/seed
// substitutes are explicit: this suite does NOT verify Zod or demo seeding.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve, dirname } = require('node:path');
const { stripTypeScriptTypes } = require('node:module');
const vm = require('node:vm');
const ROOT = resolve(__dirname, '../src');
const AT = '2026-10-08T12:00:00.000Z';
async function rig() {
  const files = new Map(), modules = new Map(), events = [];
  let fault = null, writes = 0;
  const context = vm.createContext({ console: { error() {} }, Buffer, structuredClone, Date });
  function maybe(kind, after = false) {
    if (fault === kind + (after ? ':after' : '')) { fault = null; throw Object.assign(new Error('injected I/O failure'), { code: 'ENOSPC' }); }
  }
  const fs = {
    mkdirSync() {}, existsSync: p => files.has(p), readFileSync: p => files.get(p),
    writeFileSync(p, value) { writes++; maybe(p.endsWith('head.json.tmp') ? 'head-write' : 'journal-write'); files.set(p, value); },
    appendFileSync(p, value) { writes++; maybe('append'); files.set(p, (files.get(p) || '') + value); maybe('append', true); },
    renameSync(p, q) { writes++; const k = q.endsWith('head.json') ? 'head-rename' : 'journal-rename'; maybe(k); files.set(q, files.get(p)); files.delete(p); maybe(k, true); },
    copyFileSync(p, q) { writes++; files.set(q, files.get(p)); }, readdirSync() { return []; }, rmSync(p) { writes++; files.delete(p); },
  };
  const schema = new Proxy(function () {}, { get: (_t, p) => p === 'safeParse' ? data => ({ success: true, data }) : p === 'parse' ? data => data : () => schema, apply: () => schema });
  const substitutes = {
    zod: { z: schema },
    [resolve(ROOT, 'protocol/envelope.ts')]: { ActSchema: schema },
    [resolve(ROOT, 'protocol/payloads.ts')]: { PAYLOAD_SCHEMAS: new Proxy({}, { get: () => schema }), formatZodError: () => 'test validation substitute' },
    [resolve(ROOT, 'seed/demo.ts')]: { applyDemoSeed() { throw Error('Demo seeding is not covered by this offline suite'); } },
  };
  function synthetic(id, values) {
    const keys = Object.keys(values);
    return new vm.SyntheticModule(keys, function () { for (const k of keys) this.setExport(k, values[k]); }, { context, identifier: id });
  }
  function get(id) {
    if (modules.has(id)) return modules.get(id);
    let mod;
    if (substitutes[id]) mod = synthetic(id, substitutes[id]);
    else if (id.startsWith('node:')) mod = synthetic(id, id === 'node:fs' ? fs : require(id));
    else mod = new vm.SourceTextModule(stripTypeScriptTypes(readFileSync(id, 'utf8'), { mode: 'transform' }), { context, identifier: id });
    modules.set(id, mod); return mod;
  }
  const entry = new vm.SourceTextModule(`import * as replay from './engines/replay.js'; import * as agents from './engines/agents.js'; import * as admin from './engines/admin.js'; import * as acts from './engines/task-manager.js'; import * as gate from './engines/gate.js'; import { store } from './state/store.js'; export { replay, agents, admin, acts, gate, store };`, { context, identifier: resolve(ROOT, 'offline-entry.ts') });
  await entry.link((s, parent) => get(s.startsWith('node:') || s === 'zod' ? s : resolve(dirname(parent.identifier), s.replace(/\.js$/, '.ts'))));
  await entry.evaluate();
  const api = entry.namespace, store = api.store;
  const journal = new api.replay.JournalFile('/memory', { key: 'offline-test-key', backups: 0 }); journal.attach(); api.replay.genesis('empty', AT);
  store.agents.set('human.owner', { id: 'human.owner', workspaceId: 'ws_default', authority: [], subscriptions: [], reportsTo: null });
  store.agents.set('agent.alex', { id: 'agent.alex', workspaceId: 'ws_default', authority: [], subscriptions: [], reportsTo: 'human.owner' });
  store.tasks.set('existing', { id: 'existing', status: 'completed', gates: [], clearances: [] });
  store.onLedger(e => events.push(e));
  const create = () => api.acts.processAct({ type: 'create_task', from: 'agent.alex', taskId: null, intent: null, references: [], payload: { id: 'task_new', title: 'test', objective: 'test' } }, { now: AT, via: 'token' });
  return { ...api, journal, files, events, create, fail: kind => { fault = kind; }, writes: () => writes };
}
function blocked(r) {
  const n = r.writes();
  assert.equal(r.create().errorCode, 'persistence_unavailable');
  assert.throws(() => r.admin.setPolicy({ action: 'deploy', scope: 'production', approver: 'human.owner' }, 'admin'), /Journal persistence failed/);
  assert.throws(() => r.agents.registerAgent({}, { asAdmin: true }), /Journal persistence failed/);
  assert.throws(() => r.replay.genesis('empty'), /Journal persistence failed/);
  assert.throws(() => r.journal.rewrite([]), /Journal persistence failed/);
  assert.equal(r.gate.gateStatus('existing', 'complete', 'production').allowed, false);
  assert.throws(() => r.gate.performCheck('agent.alex', 'deploy', 'production', 'existing'), /Journal persistence failed/);
  assert.equal(r.writes(), n);
}
for (const failure of ['append', 'append:after', 'head-write', 'head-rename', 'head-rename:after']) {
  test(`act ${failure} failure rolls back live state, suppresses success and blocks further writes/clearance`, async () => {
    const r = await rig(), before = r.store.stateHash(), count = r.store.journal.length;
    r.fail(failure); const result = r.create(); assert.equal(result.ok, false); assert.equal(result.errorCode, 'persistence_unavailable'); assert.match(result.error, /may already be on disk/);
    assert.equal(r.store.stateHash(), before); assert.equal(r.store.journal.length, count); assert.equal(r.events.length, 0); assert.equal(r.store.persistenceFailure, true); blocked(r);
  });
}
test('successful act notifies only after signed head and journal are committed', async () => {
  const r = await rig(); let observed = 0;
  r.store.onLedger(() => { observed++; assert.equal(JSON.parse(r.files.get('/memory/journal.head.json')).count, r.store.journal.length); });
  const result = r.create(); assert.equal(result.ok, true); assert.equal(observed, 1); assert.equal(r.events.length, 1); assert.equal(r.store.tasks.has('task_new'), true); assert.equal(r.journal.load().records.length, 2);
});
test('observer failure does not turn a persisted act into a failed operation', async () => {
  const r = await rig(); r.store.onLedger(() => { throw Error('observer'); }); assert.equal(r.create().ok, true); assert.equal(r.store.persistenceFailure, false);
});
test('admin mutation and counters are rolled back when persistence fails', async () => {
  const r = await rig(), hash = r.store.stateHash(); r.fail('append'); assert.throws(() => r.admin.setPolicy({ action: 'deploy', scope: 'production', approver: 'human.owner' }, 'admin', AT), /Journal persistence failed/); assert.equal(r.store.stateHash(), hash); assert.equal(r.events.length, 0); blocked(r);
});
test('registration never returns credentials or retains an identity after failed persistence', async () => {
  const r = await rig(), hash = r.store.stateHash(); r.fail('append'); assert.throws(() => r.agents.registerAgent({ id: 'agent.bob', name: 'Bob', model: 'Custom', role: 'qa', reportsTo: 'human.owner' }, { asAdmin: true, now: AT }), /Journal persistence failed/); assert.equal(r.store.stateHash(), hash); assert.equal(r.events.length, 0); blocked(r);
});
for (const failure of ['journal-write', 'journal-rename']) {
  test(`genesis ${failure} failure restores prior memory and emits no snapshot`, async () => {
    const r = await rig(), hash = r.store.stateHash(); let snapshots = 0; r.store.onSnapshot(() => snapshots++); r.fail(failure); assert.throws(() => r.replay.genesis('empty', AT), /Journal persistence failed/); assert.equal(r.store.stateHash(), hash); assert.equal(snapshots, 0); blocked(r);
  });
}
test('reset, import, journal load and detach cannot clear the failure latch', async () => {
  const r = await rig(), saved = r.store.exportData(); r.fail('head-write'); r.create(); assert.equal(r.journal.load().records.length, 2); r.journal.detach(); r.store.reset(); r.store.importData(saved); assert.equal(r.store.persistenceFailure, true); assert.throws(() => r.store.assertWritable(), /Journal persistence failed/);
});
test('successful registration, admin and genesis retain normal journal/notification behavior', async () => {
  const r = await rig(); r.agents.registerAgent({ id: 'agent.bob', name: 'Bob', model: 'Custom', role: 'qa' }, { asAdmin: true, now: AT }); r.admin.setPolicy({ action: 'deploy', scope: 'production', approver: 'human.owner' }, 'admin', AT); assert.equal(r.events.length, 2); assert.equal(r.journal.load().records.length, 3); let snapshots = 0; r.store.onSnapshot(() => snapshots++); r.replay.genesis('empty', AT); assert.equal(snapshots, 1); assert.equal(r.journal.load().records.length, 1);
});
test('outcome journal failure rolls back client state and suppresses a success receipt', async () => {
  const r = await rig(); assert.equal(r.create().ok, true);
  const task = r.store.tasks.get('task_new'); task.assignee = 'agent.alex'; task.status = 'in_progress';
  const jobId = 'job-73d4bbef-2f69-4a1e-8fe7-448a1c99f8ee', runId = '701679a9-2b73-4291-bf8c-0bc5d7917b8c';
  task.constraints = ['orbit.job:' + jobId, 'orbit.run:' + runId];
  const hash = r.store.stateHash(), count = r.events.length;
  r.fail('head-write');
  const result = r.acts.processAct({ id: 'outcome_test', type: 'job_outcome', from: 'agent.alex', taskId: null, intent: null, references: [], payload: { taskId: task.id, version: 'orbit-v1', jobId, runId, sequence: 1, state: 'review', verification: 'unverified', reportSha256: 'a'.repeat(64), artifactsSha256: 'b'.repeat(64), artifactCount: 0 } }, { now: AT, via: 'token' });
  assert.equal(result.ok, false); assert.equal(result.errorCode, 'persistence_unavailable'); assert.equal(r.store.stateHash(), hash); assert.equal(r.events.length, count);
  assert.throws(() => r.acts.jobOutcomeReceipt('agent.alex', task.id, 'outcome_test'), /Journal persistence failed/);
});
