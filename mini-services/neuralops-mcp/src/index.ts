// NeuralOps MCP — Coordination Core entry point.
//
// Restores state from the journal (or seeds a fresh workspace), then serves
// HTTP + WebSocket on NEURALOPS_PORT (default 3031). Agents connect over MCP
// through src/mcp/stdio.ts, which proxies to this process.

import { loadConfig } from './config.js'
import { createApp } from './app.js'
import { store } from './state/store.js'
import { DEMO_AGENT_IDS } from './seed/demo.js'
import { demoToken } from './engines/agents.js'

const config = loadConfig()
const app = createApp(config)
const port = await app.listen()

console.log(`NeuralOps MCP — Coordination Core v0.1.2`)
console.log(`  mode      : ${config.mode}`)
console.log(`  http+ws   : ${config.host}:${port}${config.host.startsWith('127.') || config.host === 'localhost' || config.host === '::1' ? ' (this machine only)' : ' (NETWORK-VISIBLE)'}`)
console.log(`  journal   : ${app.journal ? app.journal.path : 'off (in-memory)'}${app.restored ? ' (restored' + (app.migrated ? ', migrated to signed format' : '') + ')' : ''}${app.journal ? ', HMAC-signed' : ''}`)
console.log(`  rate limit: ${config.rateLimit ? config.rateLimit.perSecond + '/s per caller' : 'off'}`)
console.log(`  ledger    : ${store.ledger.length} events, head ${store.ledgerHead.slice(0, 12)}…`)
if (config.mode === 'demo') {
  console.log(`  demo mode : Inspector may act as any agent. Demo agent tokens:`)
  for (const id of DEMO_AGENT_IDS) if (store.agents.has(id)) console.log(`              ${id.padEnd(16)} ${demoToken(id)}`)
}

const shutdown = async () => {
  await app.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
