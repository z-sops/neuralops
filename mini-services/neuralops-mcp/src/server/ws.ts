// WebSocket gateway — broadcasts ledger events + state snapshots so acts are
// observable the instant they mutate state. Snapshots are coalesced per tick.

import type { Server as HTTPServer } from 'node:http'
import { Server as IOServer, type Socket } from 'socket.io'
import type { Config } from '../config.js'
import { store } from '../state/store.js'
import { snapshotState } from './http.js'
import { resolveCaller } from './identity.js'
import type { LedgerEvent } from '../state/types.js'

export function setupWebSocket(httpServer: HTTPServer, config: Config): { io: IOServer; dispose: () => void } {
  const io = new IOServer(httpServer, {
    cors: config.corsOrigin ? { origin: config.corsOrigin, methods: ['GET', 'POST'] } : undefined,
    pingTimeout: 60000,
    pingInterval: 25000,
  })

  if (config.mode === 'secure') {
    io.use((socket, next) => {
      try {
        const token = (socket.handshake.auth as { token?: string })?.token ?? null
        resolveCaller(config, token, null)
        next()
      } catch (e) {
        next(e as Error)
      }
    })
  }

  let pending = false
  const scheduleSnapshot = () => {
    if (pending) return
    pending = true
    queueMicrotask(() => {
      pending = false
      io.emit('state:snapshot', snapshotState(config))
    })
  }

  const offLedger = store.onLedger((event: LedgerEvent) => {
    io.emit('ledger:event', event)
    scheduleSnapshot()
  })
  const offSnapshot = store.onSnapshot(scheduleSnapshot)

  io.on('connection', (socket: Socket) => {
    socket.emit('state:snapshot', snapshotState(config))
  })

  return {
    io,
    dispose: () => {
      offLedger()
      offSnapshot()
    },
  }
}
