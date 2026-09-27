// WebSocket gateway — broadcasts ledger events + state snapshots to the
// Protocol Inspector in real time so acts are observable the instant they
// mutate state.

import type { Server as HTTPServer } from 'node:http'
import { Server as IOServer, type Socket } from 'socket.io'
import { store } from '../state/store.js'
import { snapshotState } from './http.js'
import type { LedgerEvent } from '../state/types.js'

export function setupWebSocket(httpServer: HTTPServer): IOServer {
  const io = new IOServer(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    pingTimeout: 60000,
    pingInterval: 25000,
  })

  // Whenever the store appends a ledger event, broadcast it + a fresh snapshot.
  store.subscribe((event: LedgerEvent) => {
    io.emit('ledger:event', event)
    io.emit('state:snapshot', snapshotState())
  })

  io.on('connection', (socket: Socket) => {
    // New inspector client → send the current snapshot immediately.
    socket.emit('state:snapshot', snapshotState())
  })

  return io
}
