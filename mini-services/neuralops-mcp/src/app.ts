// App factory: restore state from the journal (or start a fresh genesis),
// then open the HTTP + WebSocket doors.

import { createServer, type Server } from 'node:http'
import type { Server as IOServer } from 'socket.io'
import type { Config } from './config.js'
import { store } from './state/store.js'
import { JournalFile, genesis, replay } from './engines/replay.js'
import { createHttpHandler } from './server/http.js'
import { setupWebSocket } from './server/ws.js'

export interface App {
  config: Config
  http: Server
  io: IOServer
  journal: JournalFile | null
  restored: boolean
  listen(port?: number): Promise<number>
  close(): Promise<void>
}

export function bootstrapState(config: Config): { journal: JournalFile | null; restored: boolean } {
  const journal = config.dataDir ? new JournalFile(config.dataDir) : null
  const records = journal?.load() ?? null
  if (records) {
    replay(records) // throws loudly on divergence — never silently wipes history
    journal!.attach()
    return { journal, restored: true }
  }
  journal?.attach()
  genesis(config.seedOnEmpty ? 'demo' : 'empty')
  return { journal, restored: false }
}

export function createApp(config: Config): App {
  const { journal, restored } = bootstrapState(config)
  const handler = createHttpHandler(config)
  const http = createServer((req, res) => {
    handler(req, res).catch((e) => {
      console.error('[neuralops] handler crash', e)
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'Internal error' }))
    })
  })
  const ws = setupWebSocket(http, config)

  return {
    config,
    http,
    io: ws.io,
    journal,
    restored,
    listen(port = config.port) {
      return new Promise((resolve) => {
        http.listen(port, () => {
          const addr = http.address()
          resolve(typeof addr === 'object' && addr ? addr.port : port)
        })
      })
    },
    close() {
      ws.dispose()
      journal?.detach()
      return new Promise((resolve) => {
        ws.io.close(() => resolve())
        // Keep-alive sockets would otherwise hold the server open.
        http.closeAllConnections?.()
      })
    },
  }
}

export { store }
