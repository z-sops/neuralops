// NeuralOps MCP — V0.1 entry point.
//
// Starts the Coordination Core (in-memory state + engines), the HTTP REST
// door, and the WebSocket event stream. Seeds a demo workspace so the
// Protocol Inspector has something to show immediately.
//
// The MCP tool surface is defined in src/mcp/tools.ts. The same handlers
// serve the HTTP /api/tools/* endpoints and (in a future V0.2) a real MCP
// stdio/SSE transport — the protocol layer doesn't change.

import { createServer } from 'node:http'
import { handleHttp } from './server/http.js'
import { setupWebSocket } from './server/ws.js'
import { seedDemo } from './seed/demo.js'

const PORT = 3031

const httpServer = createServer((req, res) => {
  handleHttp(req, res).catch((e) => {
    console.error('HTTP handler error:', e)
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: String(e) }))
  })
})

setupWebSocket(httpServer)

// Seed the demo workspace on boot.
seedDemo()

httpServer.listen(PORT, () => {
  console.log(`╔══════════════════════════════════════════════╗`)
  console.log(`║  NeuralOps MCP — Coordination Core v0.1     ║`)
  console.log(`║  HTTP + WebSocket on port ${PORT}             ║`)
  console.log(`║  Demo workspace "Engineering" seeded.        ║`)
  console.log(`╚══════════════════════════════════════════════╝`)
  console.log(`\nInspector connects via:`)
  console.log(`  REST  → /api/state?XTransformPort=${PORT}`)
  console.log(`  WS    → io("/?XTransformPort=${PORT}")\n`)
})
