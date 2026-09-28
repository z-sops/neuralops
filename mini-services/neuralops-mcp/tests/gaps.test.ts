// V0.1.6 — closing the known gaps: multi-use / time-boxed / standing
// approvals, one-click approval links, webhook delivery log, hook blocks in
// the ledger, custom presets, JWT identities (Supabase) and read scopes.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { createServer, type Server } from 'node:http'
import { createHmac, generateKeyPairSync, sign as cryptoSign } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { io as ioClient } from 'socket.io-client'
import { act, freshDemo, ok, store } from './helpers.js'
import { loadConfig } from '../src/config.js'
import { bootstrapState, createApp, type App } from '../src/app.js'
import { setPolicy } from '../src/engines/admin.js'
import { allPresets, applyPreset, definePreset, deletePreset } from '../src/engines/presets.js'
import { verifyIntegrity } from '../src/engines/replay.js'
import { setupWebhook, webhookDeliveries } from '../src/server/webhook.js'

async function call(base: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  return { status: res.status, data: data as any, text }
}

const ODOO = { action: 'odoo.write', scope: 'production' }

// ------------------------------------------------------------------ approvals that fit real work
describe('multi-use, time-boxed and standing approvals', () => {
  beforeEach(() => {
    freshDemo()
    setPolicy({ ...ODOO, approver: 'agent.architect' }, 'admin')
  })

  test('authorize with uses: N unlocks N performs, then a new approval is needed', () => {
    const r = ok(act('agent.qa', 'perform', ODOO))
    ok(act('agent.architect', 'authorize', { approvalId: r.approval!.id, uses: 3, reason: 'three invoices today' }))
    for (let i = 0; i < 3; i++) {
      const p = ok(act('agent.qa', 'perform', ODOO))
      expect(p.allowed).toBe(true)
      expect(p.via).toBe('approval')
    }
    const a = store.approvals.get(r.approval!.id)!
    expect(a.usedBy).toHaveLength(3)
    expect(a.consumedAt).not.toBeNull()
    expect(ok(act('agent.qa', 'perform', ODOO)).allowed).toBe(false)
  })

  test('a time-boxed approval stops working when it expires', () => {
    const r = ok(act('agent.qa', 'perform', ODOO))
    ok(act('agent.architect', 'authorize', { approvalId: r.approval!.id, uses: 10, validForSeconds: 3600 }))
    expect(ok(act('agent.qa', 'perform', ODOO)).allowed).toBe(true)
    store.approvals.get(r.approval!.id)!.validUntil = new Date(Date.now() - 1000).toISOString()
    expect(ok(act('agent.qa', 'perform', ODOO)).allowed).toBe(false)
  })

  test('grant_approval: an approver pre-approves an unattended persona; nobody else can, nobody for themselves', () => {
    const g = ok(act('agent.architect', 'grant_approval', { to: 'agent.qa', ...ODOO, uses: 2, validForSeconds: 3600, reason: 'nightly reconciliation run' }))
    expect(g.approval!.status).toBe('approved')
    expect(ok(act('agent.qa', 'perform', ODOO)).allowed).toBe(true)
    expect(ok(act('agent.qa', 'perform', ODOO)).allowed).toBe(true)
    expect(ok(act('agent.qa', 'perform', ODOO)).allowed).toBe(false)
    expect(act('agent.backend', 'grant_approval', { to: 'agent.qa', ...ODOO, reason: 'x' }).errorCode).toBe('forbidden')
    expect(act('agent.architect', 'grant_approval', { to: 'agent.architect', ...ODOO, reason: 'x' }).errorCode).toBe('forbidden')
  })

  test('perform says why it was allowed', () => {
    expect(ok(act('agent.qa', 'perform', { action: 'search.web' })).via).toBe('ungoverned')
    expect(ok(act('agent.architect', 'perform', { action: 'deploy' })).via).toBe('authority')
  })
})

// ------------------------------------------------------------------ custom presets
describe('custom presets', () => {
  beforeEach(() => freshDemo())

  test('define, apply, update, delete; built-ins are protected; replay matches', () => {
    const dir = mkdtempSync(join(tmpdir(), 'neuralops-cpreset-'))
    try {
      const cfg = loadConfig({ NEURALOPS_DATA_DIR: dir })
      store.reset()
      const a = bootstrapState(cfg)
      definePreset({ name: 'finance-team', policies: [{ action: 'payment.send', scope: 'production' }, { action: 'odoo.write', scope: '*' }] }, 'admin')
      expect(allPresets().find((p) => p.name === 'finance-team')?.custom).toBe(true)
      expect(applyPreset('finance-team', { approver: 'agent.architect' }, 'admin').policies).toHaveLength(2)
      definePreset({ name: 'finance-team', policies: [{ action: 'payment.send', scope: 'production' }] }, 'admin')
      expect(allPresets().find((p) => p.name === 'finance-team')!.policies).toHaveLength(1)
      expect(() => definePreset({ name: 'lockdown', policies: [{ action: 'x', scope: 'y' }] }, 'admin')).toThrow(/built-in/)
      expect(() => deletePreset('lockdown', 'admin')).toThrow(/built-in/)
      definePreset({ name: 'temp', policies: [{ action: 'x', scope: 'y' }] }, 'admin')
      deletePreset('temp', 'admin')
      a.journal!.detach()
      store.reset()
      const b = bootstrapState(cfg)
      expect(verifyIntegrity(b.journal).replayMatches).toBe(true)
      expect(store.presets.has('finance-team')).toBe(true)
      expect(store.presets.has('temp')).toBe(false)
      b.journal!.detach()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ------------------------------------------------------------------ webhook delivery
describe('webhook delivery', () => {
  test('several receivers; a failing one is retried then logged as failed; the other is delivered', async () => {
    freshDemo()
    setPolicy({ ...ODOO, approver: 'agent.architect' }, 'admin')
    const got: string[] = []
    const good = createServer((req, res) => {
      let b = ''
      req.on('data', (c) => (b += c))
      req.on('end', () => {
        got.push(req.headers['x-neuralops-event'] as string)
        res.writeHead(204).end()
      })
    })
    await new Promise<void>((r) => good.listen(0, '127.0.0.1', () => r()))
    const goodUrl = `http://127.0.0.1:${(good.address() as { port: number }).port}/`
    const badUrl = 'http://127.0.0.1:9/'
    const hook = setupWebhook({ urls: [goodUrl, badUrl], secret: null, retryDelaysMs: [20, 20], timeoutMs: 500 })
    ok(act('agent.qa', 'perform', ODOO))
    for (let i = 0; i < 100; i++) {
      const bad = webhookDeliveries().find((d) => d.url === badUrl && d.event === 'approval.requested')
      if (bad && bad.status === 'failed' && got.length) break
      await Bun.sleep(20)
    }
    const ds = webhookDeliveries().filter((d) => d.event === 'approval.requested')
    expect(ds.find((d) => d.url === goodUrl)!.status).toBe('delivered')
    const bad = ds.find((d) => d.url === badUrl)!
    expect(bad.status).toBe('failed')
    expect(bad.attempts).toBe(3)
    expect(got).toContain('approval.requested')
    hook.dispose()
    await new Promise<void>((r) => good.close(() => r()))
  })
})

// ------------------------------------------------------------------ hook blocks land in the ledger
describe('enforcer blocks are recorded', () => {
  let app: App
  let base: string
  beforeAll(async () => {
    app = createApp(loadConfig({ NEURALOPS_DATA_DIR: 'off', NEURALOPS_RATE_LIMIT: 'off' }))
    base = `http://127.0.0.1:${await app.listen(0)}`
  })
  afterAll(() => app.close())

  test('a blocked Claude Code edit becomes a report_block ledger event', async () => {
    const hook = join(import.meta.dir, '..', 'src/hooks/claude-pretooluse.ts')
    const proc = Bun.spawn([process.execPath, hook], {
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', NEURALOPS_URL: base, NEURALOPS_TOKEN: 'nops_demo_security' },
      stdin: new TextEncoder().encode(JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'src/a.ts' } })),
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: '/',
    })
    expect(await proc.exited).toBe(2)
    const ev = store.ledger.filter((e) => e.actType === 'report_block').at(-1)!
    expect(ev.actor).toBe('agent.security')
    expect(ev.after).toMatchObject({ blocked: true, enforcer: 'claude-code', tool: 'Edit', target: 'src/a.ts' })
    expect(ev.deltaSummary).toMatch(/claude-code BLOCKED agent.security/)
  })
})

// ------------------------------------------------------------------ HTTP: links, JWT identities, read scopes
describe('secure mode: approval links, JWT identities, read scopes', () => {
  const ADMIN = 'admin-secret-0123456789'
  const JWT_SECRET = 'supabase-legacy-secret-0123456789'
  const admin = { Authorization: `Bearer ${ADMIN}` }
  let app: App
  let base: string
  let jwks: Server
  const tokens: Record<string, string> = {}
  const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' })

  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const hs256 = (claims: Record<string, unknown>, secret = JWT_SECRET) => {
    const head = b64({ alg: 'HS256', typ: 'JWT' })
    const body = b64(claims)
    return `${head}.${body}.${createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')}`
  }
  const es256 = (claims: Record<string, unknown>) => {
    const head = b64({ alg: 'ES256', typ: 'JWT', kid: 'k1' })
    const body = b64(claims)
    const sig = cryptoSign('sha256', Buffer.from(`${head}.${body}`), { key: ec.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')
    return `${head}.${body}.${sig}`
  }
  const exp = () => Math.floor(Date.now() / 1000) + 600
  const AUD = { aud: 'authenticated' }

  beforeAll(async () => {
    jwks = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ keys: [{ ...ec.publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'ES256', use: 'sig' }] }))
    })
    await new Promise<void>((r) => jwks.listen(0, '127.0.0.1', () => r()))
    app = createApp(
      loadConfig({
        NEURALOPS_MODE: 'secure',
        NEURALOPS_ADMIN_TOKEN: ADMIN,
        NEURALOPS_DATA_DIR: 'off',
        NEURALOPS_RATE_LIMIT: 'off',
        NEURALOPS_PUBLIC_URL: 'https://ops.example.com',
        NEURALOPS_LINK_SECRET: 'link-secret-0123456789',
        NEURALOPS_JWT_SECRET: JWT_SECRET,
        NEURALOPS_JWT_JWKS_URL: `http://127.0.0.1:${(jwks.address() as { port: number }).port}/jwks.json`,
        NEURALOPS_JWT_AUDIENCE: 'authenticated',
        NEURALOPS_JWT_AUTO_PROVISION: '1',
      })
    )
    base = `http://127.0.0.1:${await app.listen(0)}`
    await call(base, 'POST', '/api/agents', { id: 'human.noaman', name: 'Noaman', model: 'Custom', role: 'lead', externalId: 'uuid-noaman' }, admin)
    tokens.layla = (await call(base, 'POST', '/api/agents', { id: 'agent.layla', name: 'Layla', model: 'Claude', role: 'analyst', reportsTo: 'human.noaman' }, admin)).data.token
    tokens.omar = (await call(base, 'POST', '/api/agents', { id: 'agent.omar', name: 'Omar', model: 'Codex', role: 'dev', reportsTo: 'human.noaman' }, admin)).data.token
    await call(base, 'POST', '/api/policies', { ...ODOO, approver: 'human.noaman' }, admin)
    await Bun.sleep(100) // first JWKS load
  })
  afterAll(async () => {
    await app.close()
    await new Promise<void>((r) => jwks.close(() => r()))
  })

  test('JWT identities: HS256 and ES256 (JWKS) map to the linked person; bad, expired and wrong-audience tokens are refused', async () => {
    const who = async (t: string) => call(base, 'GET', '/api/whoami', undefined, { Authorization: `Bearer ${t}` })
    expect((await who(hs256({ sub: 'uuid-noaman', exp: exp(), ...AUD }))).data.agent.id).toBe('human.noaman')
    expect((await who(es256({ sub: 'uuid-noaman', exp: exp(), ...AUD }))).data.agent.id).toBe('human.noaman')
    expect((await who(hs256({ sub: 'uuid-noaman', exp: exp(), ...AUD }, 'wrong-secret-xxxxxxxxxxxxxxxx'))).status).toBe(401)
    expect((await who(hs256({ sub: 'uuid-noaman', exp: Math.floor(Date.now() / 1000) - 5, ...AUD }))).status).toBe(401)
    expect((await who(hs256({ sub: 'uuid-noaman', exp: exp(), aud: 'anon' }))).status).toBe(401)
    // auto-provision: a new signed-in person gets an identity with no authority
    const fresh = await who(hs256({ sub: 'uuid-sara', email: 'sara@example.com', exp: exp(), ...AUD }))
    expect(fresh.data.agent.id).toBe('human.sara')
    expect(fresh.data.agent.authority).toEqual([])
  })

  test('approval links: the webhook-free path — a person approves from a link, recorded as themselves via "link"', async () => {
    const p = await call(base, 'POST', '/api/tools/neuralops_perform', { ...ODOO, target: 'create_invoice', detail: '<script>alert(1)</script> ACME 5000' }, { Authorization: `Bearer ${tokens.layla}` })
    const approvalId = p.data.result.approval.id
    const links = await call(base, 'GET', `/api/approvals/${approvalId}/links`, undefined, admin)
    expect(links.data.page).toMatch(/^https:\/\/ops\.example\.com\/approve\/approval_\d+\?exp=\d+&sig=/)
    const local = links.data.page.replace('https://ops.example.com', base)
    const qs = new URL(local).searchParams

    const pageRes = await fetch(local)
    const html = await pageRes.text()
    expect(pageRes.status).toBe(200)
    expect(html).toContain('odoo.write')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
    expect(store.approvals.get(approvalId)!.status).toBe('pending') // GET never decides

    const post = (fields: Record<string, string>) =>
      fetch(`${base}/approve/${approvalId}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() })
    expect((await post({ exp: qs.get('exp')!, sig: 'forged', decision: 'authorize' })).status).toBe(403)
    expect((await post({ exp: qs.get('exp')!, sig: qs.get('sig')!, decision: 'deny' })).status).toBe(400) // deny needs a reason
    const okRes = await post({ exp: qs.get('exp')!, sig: qs.get('sig')!, decision: 'authorize', reason: 'invoice checked' })
    expect(okRes.status).toBe(200)
    const a = store.approvals.get(approvalId)!
    expect(a.status).toBe('approved')
    expect(a.decidedBy).toBe('human.noaman')
    expect(a.reason).toBe('invoice checked')
    const ev = store.ledger.filter((e) => e.actType === 'authorize').at(-1)!
    expect(ev.via).toBe('link')
    expect((await post({ exp: qs.get('exp')!, sig: qs.get('sig')!, decision: 'authorize' })).status).toBe(409) // single decision
    // expired link
    const old = await fetch(`${base}/approve/${approvalId}?exp=1&sig=${qs.get('sig')}`)
    expect([403, 410]).toContain(old.status)
  })

  test('read scope "involved": agents see only what they are part of; the admin and governors see everything', async () => {
    const layla = { Authorization: `Bearer ${tokens.layla}` }
    const omar = { Authorization: `Bearer ${tokens.omar}` }
    await call(base, 'POST', '/api/acts', { type: 'create_task', payload: { id: 'task_omar1', title: 'Omar private', objective: 'x' } }, omar)
    await call(base, 'POST', '/api/acts', { type: 'create_task', payload: { id: 'task_layla1', title: 'Layla work', objective: 'y' } }, layla)

    const tasks = await call(base, 'GET', '/api/tasks', undefined, layla)
    expect(tasks.data.map((t: { id: string }) => t.id)).toEqual(['task_layla1'])
    expect((await call(base, 'GET', '/api/tasks/task_omar1', undefined, layla)).status).toBe(403)
    expect((await call(base, 'GET', '/api/tasks/task_omar1/context', undefined, layla)).status).toBe(403)
    expect((await call(base, 'POST', '/api/tools/neuralops_get_task_context', { taskId: 'task_omar1' }, layla)).status).toBe(403)
    expect((await call(base, 'GET', '/api/tasks/task_layla1', undefined, layla)).status).toBe(200)
    const state = await call(base, 'GET', '/api/state', undefined, layla)
    expect(state.data.tasks.map((t: { id: string }) => t.id)).toEqual(['task_layla1'])
    expect(state.data.ledger.every((e: { actor: string; taskId: string | null }) => e.actor !== 'agent.omar')).toBe(true)
    const ledger = await call(base, 'GET', '/api/ledger', undefined, layla)
    expect(ledger.data.some((e: { taskId: string }) => e.taskId === 'task_omar1')).toBe(false)
    // the manager sees work below them; the admin sees all
    const noaman = { Authorization: `Bearer ${hs256({ sub: 'uuid-noaman', exp: exp(), ...AUD })}` }
    await call(base, 'POST', '/api/acts', { type: 'claim', payload: { taskId: 'task_omar1' } }, omar)
    expect((await call(base, 'GET', '/api/tasks/task_omar1', undefined, noaman)).status).toBe(200)
    expect((await call(base, 'GET', '/api/tasks', undefined, admin)).data.length).toBeGreaterThanOrEqual(2)
    // the live stream needs the admin in this mode
    const sock = ioClient(base, { auth: { token: tokens.layla }, transports: ['websocket'], reconnection: false })
    const err = await new Promise<string>((r) => sock.on('connect_error', (e) => r(e.message)))
    sock.close()
    expect(err).toMatch(/involved/)
  })
})
