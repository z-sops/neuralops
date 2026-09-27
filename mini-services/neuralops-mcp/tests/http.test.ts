// HTTP + WebSocket doors, demo and secure modes.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { io as ioClient } from 'socket.io-client'
import { createApp, type App } from '../src/app.js'
import { loadConfig } from '../src/config.js'

async function call(base: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, data: text ? JSON.parse(text) : null }
}

describe('demo mode', () => {
  let app: App
  let base: string
  beforeAll(async () => {
    app = createApp(loadConfig({ NEURALOPS_DATA_DIR: 'off' }))
    base = `http://localhost:${await app.listen(0)}`
  })
  afterAll(() => app.close())

  test('inspector can act as an agent via `from` (marked impersonated)', async () => {
    const r = await call(base, 'POST', '/api/acts', { type: 'claim', from: 'agent.security', payload: { taskId: 'task_43' } })
    expect(r.status).toBe(200)
    expect(r.data.ledgerEvent.via).toBe('impersonated')
  })

  test('bearer token identity; token cannot claim to be someone else', async () => {
    const auth = { Authorization: 'Bearer nops_demo_architect' }
    const who = await call(base, 'GET', '/api/whoami', undefined, auth)
    expect(who.data.agent.id).toBe('agent.architect')
    const spoof = await call(base, 'POST', '/api/acts', { type: 'decision', from: 'agent.ceo', payload: { taskId: 'task_42', text: 'x' } }, auth)
    expect(spoof.status).toBe(403)
    const good = await call(base, 'POST', '/api/acts', { type: 'decision', payload: { taskId: 'task_42', text: 'redis' } }, auth)
    expect(good.status).toBe(200)
    expect(good.data.ledgerEvent.via).toBe('token')
    expect((await call(base, 'GET', '/api/whoami', undefined, { Authorization: 'Bearer nope' })).status).toBe(401)
  })

  test('status codes follow error codes', async () => {
    expect((await call(base, 'POST', '/api/acts', { type: 'claim', from: 'agent.qa', payload: { taskId: 'task_42' } })).status).toBe(409)
    expect((await call(base, 'POST', '/api/acts', { type: 'claim', from: 'agent.qa', payload: { taskId: 'task_404' } })).status).toBe(404)
    expect((await call(base, 'POST', '/api/acts', { type: 'claim', from: 'agent.qa', payload: {} })).status).toBe(400)
    expect((await call(base, 'POST', '/api/acts', { type: 'claim', from: 'agent.x', payload: { taskId: 'task_42' } })).status).toBe(403)
    expect((await call(base, 'POST', '/api/acts', '{not json')).status).toBe(400)
    expect((await call(base, 'POST', '/api/acts', { junk: 'x'.repeat(300_000) })).status).toBe(413)
    expect((await call(base, 'GET', '/api/nope')).status).toBe(404)
  })

  test('tools: 33 listed, act tools need an identity, errors carry codes', async () => {
    const tools = await call(base, 'GET', '/api/tools')
    expect(tools.data).toHaveLength(33)
    const anon = await call(base, 'POST', '/api/tools/neuralops_claim', { taskId: 'task_44' })
    expect(anon.status).toBe(403)
    const inbox = await call(base, 'POST', '/api/tools/neuralops_inbox', {}, { 'X-Agent-Id': 'agent.qa' })
    expect(inbox.data.result.myTasks.map((t: { id: string }) => t.id)).toContain('task_44')
    const ctx = await call(base, 'POST', '/api/tools/neuralops_get_task_context', { taskId: 'task_42' }, { 'X-Agent-Id': 'agent.qa' })
    expect(ctx.data.result.text).toContain('OBJECTIVE')
  })

  test('integrity endpoint', async () => {
    const r = await call(base, 'GET', '/api/integrity')
    expect(r.data.chainValid).toBe(true)
    expect(r.data.replayMatches).toBe(true)
  })

  test('websocket: snapshot on connect, ledger events live, snapshot after reseed', async () => {
    const socket = ioClient(base, { transports: ['websocket'] })
    const first = await new Promise<{ agents: unknown[] }>((res) => socket.once('state:snapshot', res))
    expect(first.agents.length).toBe(5)
    const evt = new Promise<{ actType: string }>((res) => socket.once('ledger:event', res))
    await call(base, 'POST', '/api/acts', { type: 'decision', from: 'agent.architect', payload: { taskId: 'task_42', text: 'ws' } })
    expect((await evt).actType).toBe('decision')
    // Wait for the snapshot that reflects the reseed (earlier coalesced snapshots may still arrive first).
    const reseeded = new Promise<{ ledgerTotal: number }>((res) => {
      const onSnap = (s: { ledgerTotal: number; tasks: Array<{ id: string }> }) => {
        if (s.ledgerTotal === 6) {
          socket.off('state:snapshot', onSnap)
          res(s)
        }
      }
      socket.on('state:snapshot', onSnap)
    })
    await call(base, 'POST', '/api/demo/seed')
    expect((await reseeded).ledgerTotal).toBe(6)
    socket.disconnect()
  })
})

describe('secure mode', () => {
  const ADMIN = 'admin-secret-0123456789'
  let app: App
  let base: string
  beforeAll(async () => {
    app = createApp(loadConfig({ NEURALOPS_MODE: 'secure', NEURALOPS_ADMIN_TOKEN: ADMIN, NEURALOPS_DATA_DIR: 'off' }))
    base = `http://localhost:${await app.listen(0)}`
  })
  afterAll(() => app.close())

  test('requires an admin token of reasonable length', () => {
    expect(() => loadConfig({ NEURALOPS_MODE: 'secure', NEURALOPS_ADMIN_TOKEN: 'short' })).toThrow()
  })

  test('everything but /api/health needs a token', async () => {
    expect((await call(base, 'GET', '/api/health')).status).toBe(200)
    expect((await call(base, 'GET', '/api/state')).status).toBe(401)
    expect((await call(base, 'POST', '/api/acts', { type: 'claim', from: 'agent.x', payload: { taskId: 't' } })).status).toBe(401)
  })

  test('demo endpoints are off; only admins register agents', async () => {
    const admin = { Authorization: `Bearer ${ADMIN}` }
    expect((await call(base, 'POST', '/api/demo/seed', {}, admin)).status).toBe(404)
    expect((await call(base, 'GET', '/api/demo/tokens', undefined, admin)).status).toBe(404)

    const lead = await call(base, 'POST', '/api/agents', {
      id: 'agent.lead', name: 'Lead', model: 'Claude', role: 'lead',
      authority: [{ action: '*', scope: '*' }],
    }, admin)
    expect(lead.status).toBe(201)
    const dev = await call(base, 'POST', '/api/agents', { id: 'agent.dev', name: 'Dev', model: 'Codex', role: 'dev', reportsTo: 'agent.lead' }, admin)
    const devAuth = { Authorization: `Bearer ${dev.data.token}` }
    const leadAuth = { Authorization: `Bearer ${lead.data.token}` }

    // an agent token cannot register agents
    expect((await call(base, 'POST', '/api/agents', { id: 'agent.evil', name: 'e', model: 'Custom', role: 'x' }, devAuth)).status).toBe(403)

    // real flow with real tokens
    const created = await call(base, 'POST', '/api/tools/neuralops_create_task', {
      title: 'Ship billing', objective: 'o', gates: [{ action: 'complete', scope: 'production' }],
    }, leadAuth)
    const taskId = created.data.result.task.id
    await call(base, 'POST', '/api/tools/neuralops_claim', { taskId }, devAuth)
    const gate = await call(base, 'POST', '/api/tools/neuralops_complete', { taskId, summary: 'done' }, devAuth)
    const approvalId = gate.data.result.approval.id
    expect(gate.data.result.approval.approver).toBe('agent.lead') // manager fallback — no policy in this workspace
    expect((await call(base, 'POST', '/api/tools/neuralops_authorize', { approvalId }, devAuth)).status).toBe(403)
    expect((await call(base, 'POST', '/api/tools/neuralops_authorize', { approvalId }, leadAuth)).status).toBe(200)
    const done = await call(base, 'POST', '/api/tools/neuralops_complete', { taskId, summary: 'done' }, devAuth)
    expect(done.data.result.task.status).toBe('completed')
  })

  test('websocket rejects unauthenticated clients', async () => {
    const socket = ioClient(base, { transports: ['websocket'], reconnection: false })
    const err = await new Promise<Error>((res) => socket.once('connect_error', res))
    expect(err.message).toMatch(/Bearer|required/)
    socket.disconnect()
  })
})
