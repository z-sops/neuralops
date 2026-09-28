// Runs the Python guard for NeuralOps Nexus (integrations/nexus) against a
// live secure-mode core. Skipped when python3 is not installed.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { join } from 'node:path'
import { createApp, type App } from '../src/app.js'
import { loadConfig } from '../src/config.js'

const ADMIN = 'admin-secret-0123456789'
const PY = Bun.which('python3')
let app: App
let base: string
const tokens: Record<string, string> = {}

async function post(path: string, body: unknown, token = ADMIN) {
  const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
  return res.json()
}

beforeAll(async () => {
  app = createApp(loadConfig({ NEURALOPS_MODE: 'secure', NEURALOPS_ADMIN_TOKEN: ADMIN, NEURALOPS_DATA_DIR: 'off', NEURALOPS_RATE_LIMIT: 'off' }))
  base = `http://127.0.0.1:${await app.listen(0)}`
  tokens.lead = (await post('/api/agents', { id: 'agent.noaman', name: 'Noaman', model: 'Custom', role: 'lead' })).token
  tokens.layla = (await post('/api/agents', { id: 'agent.layla', name: 'Layla', model: 'Claude', role: 'analyst', reportsTo: 'agent.noaman' })).token
  await post('/api/policies', { action: 'odoo.write', scope: 'production', approver: 'agent.noaman' })
})
afterAll(() => app.close())

test.skipIf(!PY)('python guard: gates tool calls, approvals, freeze, fail-closed, pydantic-ai', async () => {
  const proc = Bun.spawn([PY!, join(import.meta.dir, '..', 'integrations', 'nexus', 'test_guard.py')], {
    env: { ...process.env, NEURALOPS_URL: base, LAYLA_TOKEN: tokens.layla, LEAD_TOKEN: tokens.lead, ADMIN_TOKEN: ADMIN },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  if (code !== 0 || process.env.SHOW_PY) console.error(out, err)
  expect(err).toMatch(/OK/)
  expect(code).toBe(0)
}, 60_000)
