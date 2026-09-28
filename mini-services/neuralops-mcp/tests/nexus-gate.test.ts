// Live test of the NeuralOps Nexus integration: Nexus' own ToolApprovalGate
// with NeuralOpsToolGate on top, against a secure-mode core. Needs a patched
// NeuralOps Nexus checkout in NEXUS_DIR (and its Python deps); skipped otherwise.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createApp, type App } from '../src/app.js'
import { loadConfig } from '../src/config.js'

const ADMIN = 'admin-secret-0123456789'
const NEXUS_DIR = process.env.NEXUS_DIR ?? ''
const PY = Bun.which('python3')
const ready = !!PY && !!NEXUS_DIR && existsSync(join(NEXUS_DIR, 'modules/nexus-ai/apps/managers/neuralops_gate.py'))

let app: App
let base: string
const tokens: Record<string, string> = {}

async function post(path: string, body: unknown, token = ADMIN) {
  const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
  return res.json()
}

beforeAll(async () => {
  if (!ready) return
  app = createApp(loadConfig({ NEURALOPS_MODE: 'secure', NEURALOPS_ADMIN_TOKEN: ADMIN, NEURALOPS_DATA_DIR: 'off', NEURALOPS_RATE_LIMIT: 'off' }))
  base = `http://127.0.0.1:${await app.listen(0)}`
  tokens.broker = (await post('/api/agents', { id: 'agent.nexus-worker', name: 'Nexus worker', model: 'Custom', role: 'service', access: 'broker' })).token
  tokens.noaman = (await post('/api/agents', { id: 'human.noaman', name: 'Noaman', model: 'Custom', role: 'lead' })).token
  await post('/api/policies', { action: 'odoo.write', scope: 'production', approver: 'human.noaman' })
})
afterAll(() => (ready ? app.close() : undefined))

test.skipIf(!ready)('Nexus gate + NeuralOps: named approver, denial, standing approval, levels kept, freeze', async () => {
  const proc = Bun.spawn([PY!, join(import.meta.dir, '..', 'integrations', 'nexus', 'test_nexus_gate_live.py')], {
    env: { ...process.env, NEURALOPS_URL: base, BROKER_TOKEN: tokens.broker, NOAMAN_TOKEN: tokens.noaman, ADMIN_TOKEN: ADMIN, NEXUS_DIR },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  if (code !== 0 || process.env.SHOW_PY) console.error(out, err)
  expect(err).toMatch(/OK/)
  expect(code).toBe(0)
}, 120_000)
