// Real MCP over stdio: two agents in two processes coordinate through one core.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { join } from 'node:path'
import { createApp, type App } from '../src/app.js'
import { loadConfig } from '../src/config.js'

const STDIO = join(import.meta.dir, '..', 'src', 'mcp', 'stdio.ts')

async function agentClient(base: string, token: string): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath, // bun
    args: [STDIO],
    env: { ...process.env, NEURALOPS_URL: base, NEURALOPS_TOKEN: token } as Record<string, string>,
    stderr: 'pipe',
  })
  const client = new Client({ name: 'test-agent', version: '0.0.0' })
  await client.connect(transport)
  return client
}

type TextResult = { content: Array<{ type: string; text: string }>; isError?: boolean }
const text = (r: unknown) => (r as TextResult).content[0].text
const json = (r: unknown) => JSON.parse(text(r))

describe('MCP stdio transport', () => {
  let app: App
  let base: string
  let backend: Client
  let architect: Client

  beforeAll(async () => {
    app = createApp(loadConfig({ NEURALOPS_DATA_DIR: 'off', NEURALOPS_RATE_LIMIT: 'off' }))
    base = `http://localhost:${await app.listen(0)}`
    backend = await agentClient(base, 'nops_demo_backend')
    architect = await agentClient(base, 'nops_demo_architect')
  })
  afterAll(async () => {
    await backend?.close()
    await architect?.close()
    await app.close()
  })

  test('lists all 39 tools with JSON schemas', async () => {
    const { tools } = await backend.listTools()
    expect(tools).toHaveLength(39)
    const complete = tools.find((t) => t.name === 'neuralops_complete')!
    expect(complete.inputSchema.required).toEqual(expect.arrayContaining(['taskId', 'summary']))
  })

  test('two agents run the approval flow over MCP', async () => {
    const who = json(await backend.callTool({ name: 'neuralops_whoami', arguments: {} }))
    expect(who.agent.id).toBe('agent.backend')

    const ctx = text(await backend.callTool({ name: 'neuralops_get_task_context', arguments: { taskId: 'task_42' } }))
    expect(ctx).toContain('DECISIONS')

    const gate = json(await backend.callTool({ name: 'neuralops_complete', arguments: { taskId: 'task_42', summary: 'auth shipped' } }))
    expect(gate.approval.status).toBe('pending')

    const selfApprove = (await backend.callTool({ name: 'neuralops_authorize', arguments: { approvalId: gate.approval.id } })) as TextResult
    expect(selfApprove.isError).toBe(true)
    expect(text(selfApprove)).toMatch(/^forbidden/)

    const inbox = json(await architect.callTool({ name: 'neuralops_inbox', arguments: {} }))
    expect(inbox.approvalsToDecide.map((a: { id: string }) => a.id)).toContain(gate.approval.id)
    await architect.callTool({ name: 'neuralops_authorize', arguments: { approvalId: gate.approval.id } })

    const done = json(await backend.callTool({ name: 'neuralops_complete', arguments: { taskId: 'task_42', summary: 'auth shipped' } }))
    expect(done.task.status).toBe('completed')
  })

  test('validation errors come back as MCP tool errors', async () => {
    const r = (await backend.callTool({ name: 'neuralops_status', arguments: { taskId: 'task_42', progress: 500 } })) as TextResult
    expect(r.isError).toBe(true)
    expect(text(r)).toMatch(/progress/)
  })
})
