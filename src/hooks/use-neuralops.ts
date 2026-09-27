'use client'

// useNeuralOps — the single hook that owns the live connection to the
// NeuralOps Coordination Core.
//
// Responsibilities:
//   1. Open a socket.io WebSocket to the mini-service (port 3031 via Caddy).
//   2. Hold the latest `state:snapshot` in React state.
//   3. Track connection status; if the WS drops, fall back to polling /api/state
//      every 3s.
//   4. Expose `submitAct(type, from, payload)` that POSTs to /api/acts.
//   5. Expose `resetDemo()` that POSTs to /api/demo/seed.
//   6. Surface a `lastResult` for inline feedback in the Coordination Console.
//   7. Toast on every ledger:event (sonner).
//
// The hook is client-only — guards the first render so SSR doesn't blow up.

import { useCallback, useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { toast } from 'sonner'
import { neuralopsApi } from '@/lib/neuralops-api'
import type {
  ActResult,
  ActType,
  FamiliesResponse,
  LedgerEvent,
  NeuralOpsState,
} from '@/lib/neuralops-types'
import { ACT_FAMILY_STATIC } from '@/lib/neuralops-types'

export type ConnectionState = 'connecting' | 'connected' | 'disconnected'

interface UseNeuralOps {
  state: NeuralOpsState
  connection: ConnectionState
  lastLedgerEvent: LedgerEvent | null
  lastResult: ActResult | null
  lastResultAt: number | null
  families: FamiliesResponse | null
  submitAct: (type: ActType, from: string, payload: Record<string, unknown>) => Promise<ActResult>
  resetDemo: () => Promise<void>
  clearLastResult: () => void
}

const EMPTY_STATE: NeuralOpsState = {
  workspace: null,
  agents: [],
  tasks: [],
  approvals: [],
  ledger: [],
  ledgerTotal: 0,
}

export function useNeuralOps(): UseNeuralOps {
  const [state, setState] = useState<NeuralOpsState | null>(null)
  const [connection, setConnection] = useState<ConnectionState>('connecting')
  const [lastLedgerEvent, setLastLedgerEvent] = useState<LedgerEvent | null>(null)
  const [lastResult, setLastResult] = useState<ActResult | null>(null)
  const [lastResultAt, setLastResultAt] = useState<number | null>(null)
  const [families, setFamilies] = useState<FamiliesResponse | null>(null)

  const socketRef = useRef<Socket | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Toast summary for a ledger event.
  const summarize = useCallback((e: LedgerEvent): { title: string; description?: string } => {
    const actor = e.actor?.replace(/^agent\./, '') || 'system'
    const family = ACT_FAMILY_STATIC[e.actType] || 'lifecycle'
    const emoji: Record<string, string> = {
      task: '✅',
      handoff: '🤝',
      information: '📄',
      conversation: '💬',
      authority: '🛡️',
      lifecycle: '🔁',
    }
    const title = `${emoji[family] ?? '•'} ${actor} · ${e.actType}`
    return { title, description: e.deltaSummary }
  }, [])

  // Fetch families once.
  useEffect(() => {
    let cancelled = false
    neuralopsApi
      .getFamilies()
      .then((f) => {
        if (!cancelled) setFamilies(f)
      })
      .catch(() => {
        // families endpoint is optional — we have a static fallback.
      })
    return () => {
      cancelled = true
    }
  }, [])

  // WebSocket connection (primary).
  useEffect(() => {
    // Guard against running on the server (Next.js SSR/hydration).
    if (typeof window === 'undefined') return

    const socket = io('/?XTransformPort=3031', {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10_000,
    })
    socketRef.current = socket

    socket.on('connect', () => {
      setConnection('connected')
      // Stop polling fallback if any.
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    })

    socket.on('disconnect', () => {
      setConnection('disconnected')
    })

    socket.on('connect_error', () => {
      setConnection('disconnected')
    })

    socket.on('state:snapshot', (snap: NeuralOpsState) => {
      setState(snap)
    })

    socket.on('ledger:event', (evt: LedgerEvent) => {
      setLastLedgerEvent(evt)
      const { title, description } = summarize(evt)
      // Only toast for events that originate from a real act (have a non-zero
      // seq and a deltaSummary). Pre-seeded history events also flow in as
      // `state:snapshot` but we don't get `ledger:event` for those (they were
      // pushed before WS connect).
      if (evt.deltaSummary) {
        toast(title, { description })
      }
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [summarize])

  // Polling fallback when the WS is disconnected.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (connection === 'disconnected' && !pollRef.current) {
      // Prime immediately, then every 3s.
      neuralopsApi.getState().then(setState).catch(() => {})
      pollRef.current = setInterval(() => {
        neuralopsApi.getState().then(setState).catch(() => {})
      }, 3000)
    }
    return () => {
      if (connection !== 'disconnected' && pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [connection])

  const submitAct = useCallback(
    async (type: ActType, from: string, payload: Record<string, unknown>): Promise<ActResult> => {
      let result: ActResult
      try {
        result = await neuralopsApi.submitAct({ type, from, payload })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        result = { ok: false, error: msg, stateChanged: false }
        setLastResult(result)
        setLastResultAt(Date.now())
        toast.error(`Act failed: ${type}`, { description: msg })
        return result
      }

      setLastResult(result)
      setLastResultAt(Date.now())

      if (result.ok) {
        const actor = from.replace(/^agent\./, '')
        if (result.approval && result.approval.status === 'pending' && !result.stateChanged) {
          toast.warning(`🛡️ Approval required`, {
            description: `${actor} · ${type} → approval ${result.approval.id} pending (${result.approval.approver})`,
          })
        } else {
          toast.success(`${actor} · ${type} succeeded`, {
            description: result.ledgerEvent?.deltaSummary,
          })
        }
      } else {
        toast.error(`❌ ${type} rejected`, {
          description: result.error || 'State did not change.',
        })
      }
      return result
    },
    [],
  )

  const resetDemo = useCallback(async () => {
    try {
      const { state: fresh } = await neuralopsApi.seedDemo()
      setState(fresh)
      setLastResult(null)
      setLastResultAt(null)
      toast.success('Demo re-seeded', {
        description: 'Engineering workspace restored to the initial golden-path state.',
      })
    } catch (err) {
      toast.error('Reset failed', {
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }, [])

  const clearLastResult = useCallback(() => {
    setLastResult(null)
    setLastResultAt(null)
  }, [])

  return {
    state: state ?? EMPTY_STATE,
    connection,
    lastLedgerEvent,
    lastResult,
    lastResultAt,
    families,
    submitAct,
    resetDemo,
    clearLastResult,
  }
}
