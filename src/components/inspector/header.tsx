'use client'

import { useState } from 'react'
import { Activity, BookOpen, RefreshCw, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { ConnectionState } from '@/hooks/use-neuralops'
import { StatusDot } from './act-badge'
import { DocsDialog } from './docs-dialog'

interface HeaderProps {
  connection: ConnectionState
  onReset: () => void
  resetting?: boolean
}

export function Header({ connection, onReset, resetting }: HeaderProps) {
  const connected = connection === 'connected'
  const [docsOpen, setDocsOpen] = useState(false)
  return (
    <header
      className={cn(
        'sticky top-0 z-40 w-full border-b border-border/80',
        'bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60',
      )}
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 md:flex-row md:items-center md:justify-between md:py-3.5">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg border border-border bg-muted/60">
            <Activity className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden />
          </div>
          <div className="leading-tight">
            <div className="flex items-center gap-2">
              <span className="font-mono text-base font-semibold tracking-tight">
                NeuralOps<span className="text-muted-foreground">.mcp</span>
              </span>
              <Badge
                variant="outline"
                className="border-emerald-500/30 bg-emerald-500/10 font-mono text-[10px] uppercase text-emerald-700 dark:text-emerald-300"
              >
                V0.1.5
              </Badge>
            </div>
            <p className="text-[11px] text-muted-foreground sm:text-xs">
              AI Workforce Coordination Protocol · Protocol Inspector
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={cn(
              'gap-1.5 px-2.5 py-1 font-mono text-[11px] uppercase',
              connected
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : connection === 'connecting'
                  ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                  : 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
            )}
            aria-live="polite"
          >
            <StatusDot
              h={connected ? 'emerald' : connection === 'connecting' ? 'amber' : 'rose'}
              pulse={connected}
            />
            {connected ? 'Connected' : connection === 'connecting' ? 'Connecting…' : 'Disconnected'}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDocsOpen(true)}
            className="gap-1.5"
          >
            <BookOpen className="size-3.5" aria-hidden />
            <span className="hidden sm:inline">Docs</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onReset}
            disabled={resetting}
            className="gap-1.5"
          >
            <RefreshCw className={cn('size-3.5', resetting && 'animate-spin')} aria-hidden />
            <span className="hidden sm:inline">Reset demo</span>
            <span className="sm:hidden">Reset</span>
          </Button>
        </div>
      </div>

      <DocsDialog open={docsOpen} onOpenChange={setDocsOpen} />
    </header>
  )
}

export function ArchitectureStrip() {
  // A thin narrative strip: [model badges] → NeuralOps MCP → Shared Work State
  const models: { name: string; hue: 'violet' | 'emerald' | 'sky' | 'amber' }[] = [
    { name: 'Claude', hue: 'violet' },
    { name: 'Codex', hue: 'emerald' },
    { name: 'Gemini', hue: 'sky' },
    { name: 'Qwen', hue: 'amber' },
  ]
  const dot: Record<string, string> = {
    violet: 'bg-violet-500',
    emerald: 'bg-emerald-500',
    sky: 'bg-sky-500',
    amber: 'bg-amber-500',
  }
  return (
    <div className="border-b border-border/60 bg-muted/30">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-2 gap-y-3 px-4 py-2.5 text-[11px] sm:px-6">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono uppercase tracking-wide text-muted-foreground">
            AI agents
          </span>
          {models.map((m) => (
            <span
              key={m.name}
              className="inline-flex items-center gap-1.5 rounded-md border border-border/80 bg-background/70 px-1.5 py-0.5 font-mono"
            >
              <span className={cn('size-1.5 rounded-full', dot[m.hue])} aria-hidden />
              {m.name}
            </span>
          ))}
        </div>
        <span className="text-muted-foreground/60" aria-hidden>
          →
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono font-medium text-emerald-700 dark:text-emerald-300">
          <ShieldCheck className="size-3" aria-hidden />
          NeuralOps MCP
          <span className="text-muted-foreground">Coordination Core</span>
        </span>
        <span className="text-muted-foreground/60" aria-hidden>
          →
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-md border border-border/80 bg-background/70 px-2 py-0.5 font-mono">
          Shared Work State
          <span className="text-muted-foreground">(typed acts · immutable ledger)</span>
        </span>
      </div>
    </div>
  )
}

export function Footer({ connection }: { connection: ConnectionState }) {
  const connected = connection === 'connected'
  return (
    <footer
      className={cn(
        'mt-auto w-full border-t border-border/80 bg-background/80 backdrop-blur',
      )}
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-1.5 px-4 py-3 text-[11px] sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-2 font-mono text-muted-foreground">
          <span className="font-semibold text-foreground">NeuralOps MCP</span>
          <span aria-hidden>—</span>
          <span>AI Workforce Coordination Protocol (V0.1.5)</span>
        </div>
        <div className="flex items-center gap-3 font-mono text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <StatusDot h={connected ? 'emerald' : 'rose'} pulse={connected} />
            {connected ? 'ws live' : connection === 'connecting' ? 'ws connecting' : 'ws offline'}
          </span>
          <span className="hidden sm:inline" aria-hidden>·</span>
          <span className="hidden sm:inline">
            Coordination Core on{' '}
            <span className="font-semibold text-foreground">port 3031</span>
          </span>
        </div>
      </div>
    </footer>
  )
}
