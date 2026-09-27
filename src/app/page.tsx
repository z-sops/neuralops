'use client'

import { useEffect, useState } from 'react'
import { TerminalIcon } from 'lucide-react'
import { useNeuralOps } from '@/hooks/use-neuralops'
import { ArchitectureStrip, Footer, Header } from '@/components/inspector/header'
import { WorkforceSection } from '@/components/inspector/workforce-section'
import {
  CoordinationConsole,
  ScenarioLegend,
} from '@/components/inspector/coordination-console'
import { SharedWorkState } from '@/components/inspector/shared-work-state'
import { WorkLedger } from '@/components/inspector/work-ledger'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function Page() {
  const {
    state,
    connection,
    lastResult,
    lastResultAt,
    lastLedgerEvent,
    families,
    submitAct,
    resetDemo,
    clearLastResult,
  } = useNeuralOps()

  // Selected task defaults to task_42 (the rich-history task) once the state
  // arrives, but lets the user override it.
  const [pickedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const selectedTaskId =
    (pickedTaskId && state.tasks.some((t) => t.id === pickedTaskId) ? pickedTaskId : null) ??
    state.tasks.find((t) => t.id === 'task_42')?.id ??
    state.tasks[0]?.id ??
    null

  // The compaction comparison re-fetches whenever the ledger moves (new event
  // or reseed) or the user forces a refresh.
  const [manualRefresh, setRefreshSignal] = useState(0)
  const refreshSignal = `${state.ledgerHead ?? state.ledgerTotal}:${lastLedgerEvent?.id ?? ''}:${manualRefresh}`

  const [resetting, setResetting] = useState(false)
  const onReset = async () => {
    setResetting(true)
    try {
      await resetDemo()
      setSelectedTaskId('task_42')
      setRefreshSignal((n) => n + 1)
    } finally {
      setResetting(false)
    }
  }

  const latestEventId = lastLedgerEvent?.id ?? null

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header connection={connection} onReset={onReset} resetting={resetting} />
      <ArchitectureStrip />

      {connection === 'disconnected' && <DisconnectedBanner />}

      <main className="mx-auto w-full max-w-7xl flex-1 space-y-8 px-4 py-6 sm:px-6 sm:py-8">
        {/* Hero strip */}
        <section className="rounded-xl border border-border/80 bg-gradient-to-br from-muted/40 via-background to-background p-5 sm:p-6">
          <div className="flex flex-col gap-2">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
              The typed-acts coordination protocol, made visible.
            </h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Five AI agents (Claude, Codex, Gemini, Qwen) collaborate on a shared engineering
              workspace. Every state change is a typed{' '}
              <span className="font-mono text-foreground">act</span>; every act produces an immutable{' '}
              <span className="font-mono text-foreground">ledger event</span>; every authority gate is
              auditable. The Coordination Core owns the truth — agents read compacted snapshots, not
              each other&apos;s conversation logs.
            </p>
          </div>
        </section>

        <WorkforceSection
          agents={state.agents}
          tasks={state.tasks}
          selectedTaskId={selectedTaskId}
          onSelectTask={setSelectedTaskId}
        />

        <section className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <TerminalIcon className="size-4 text-muted-foreground" aria-hidden />
              <h2 className="text-sm font-semibold tracking-tight">Coordination Console</h2>
            </div>
            <ScenarioLegend />
          </div>
          <Card className="p-0 py-0">
            <CardHeader className="gap-1.5 border-b border-border/60 px-4 py-3">
              <CardTitle className="text-sm">
                Trigger typed acts as any agent.
              </CardTitle>
              <p className="text-[11px] text-muted-foreground">
                Acts mutate state; the ledger records every delta. Pre-built scenarios exercise the
                golden-path demo: claim → handoff → complete-with-deploy (approval gate) → authorize
                → complete. Buttons are <span className="font-semibold">smart</span> — they enable
                based on live state and the &ldquo;authorize latest approval&rdquo; button finds the
                latest pending approval for you.
              </p>
            </CardHeader>
            <CardContent className="px-4 py-4">
              <CoordinationConsole
                agents={state.agents}
                tasks={state.tasks}
                approvals={state.approvals}
                lastResult={lastResult}
                lastResultAt={lastResultAt}
                submitAct={submitAct}
                resetLastResult={clearLastResult}
              />
            </CardContent>
          </Card>
        </section>

        <SharedWorkState
          tasks={state.tasks}
          selectedTaskId={selectedTaskId}
          onSelectTask={setSelectedTaskId}
          refreshSignal={refreshSignal}
        />

        <WorkLedger
          ledger={state.ledger}
          ledgerTotal={state.ledgerTotal}
          agents={state.agents}
          families={families}
          latestEventId={latestEventId}
        />
      </main>

      <Footer connection={connection} />
    </div>
  )
}

function DisconnectedBanner() {
  return (
    <div className="border-b border-rose-500/30 bg-rose-500/10 px-4 py-2 text-[12px] text-rose-800 dark:text-rose-200">
      <div className="mx-auto flex max-w-7xl items-center gap-2 sm:px-6">
        <span className="font-mono uppercase">ws offline</span>
        <span aria-hidden>·</span>
        <span>
          Falling back to polling <span className="font-mono">/api/state</span> every 3s. Some
          real-time updates may be delayed.
        </span>
      </div>
    </div>
  )
}
