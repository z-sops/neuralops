// App factory: restore state from the journal (or start a fresh genesis),
// then open the HTTP + WebSocket doors.

import { createServer, type Server } from 'node:http'
import type { Server as IOServer } from 'socket.io'
import type { Config } from './config.js'
import { store } from './state/store.js'
import { JournalFile, genesis, replay } from './engines/replay.js'
import { createHttpHandler } from './server/http.js'
import { setupWebSocket } from './server/ws.js'
import { setupWebhook } from './server/webhook.js'
import { startJwks } from './server/jwt.js'

export interface App {
  config: Config
  http: Server
  io: IOServer
  journal: JournalFile | null
  restored: boolean
  migrated: boolean
  listen(port?: number, host?: string): Promise<number>
  close(): Promise<void>
}

export function bootstrapState(config: Config): { journal: JournalFile | null; restored: boolean; migrated: boolean } {
  const journal = config.dataDir
    ? new JournalFile(config.dataDir, { key: config.journalKey, backups: config.backups })
    : null
  const loaded = journal?.load() ?? null // throws JournalTamperError on tampering
  if (loaded) {
    journal!.backup('boot')
    replay(loaded.records) // throws loudly on divergence — never silently wipes history
    if (loaded.legacy) {
      // Unsigned V0.1.1 journal: accepted once, then signed from here on.
      journal!.rewrite(store.journal)
      console.warn('[neuralops] migrated an unsigned journal to the signed format (backup kept)')
    }
    journal!.attach()
    return { journal, restored: true, migrated: loaded.legacy }
  }
  journal?.attach()
  genesis(config.seedOnEmpty ? 'demo' : 'empty')
  return { journal, restored: false, migrated: false }
}

export function createApp(config: Config): App {
  const { journal, restored, migrated } = bootstrapState(config)
  const handler = createHttpHandler(config, { journal })
  const http = createServer((req, res) => {
    handler(req, res).catch((e) => {
      console.error('[neuralops] handler crash', e)
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'Internal error' }))
    })
  })
  const ws = setupWebSocket(http, config)
  const hook = config.webhook ? setupWebhook({ ...config.webhook, links: config.links }) : null
  const stopJwks = config.jwt ? startJwks(config.jwt) : () => {}

  return {
    config,
    http,
    io: ws.io,
    journal,
    restored,
    migrated,
    listen(port = config.port, host = config.host) {
      return new Promise((resolve, reject) => {
        http.once('error', reject)
        http.listen(port, host, () => {
          const addr = http.address()
          resolve(typeof addr === 'object' && addr ? addr.port : port)
        })
      })
    },
    close() {
      ws.dispose()
      hook?.dispose()
      stopJwks()
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
