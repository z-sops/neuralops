'use client'

import { useEffect, useState } from 'react'
import { DatabaseIcon, FileStackIcon, LayersIcon, RefreshCwIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { neuralopsApi } from '@/lib/neuralops-api'
import type { ContextComparison, Task } from '@/lib/neuralops-types'
import { hue } from './colors'

interface SharedWorkStateProps {
  tasks: Task[]
  selectedTaskId: string | null
  onSelectTask: (id: string) => void
  // Bump this number to force a re-fetch (e.g. after a state mutation).
  refreshSignal: number | string
}

function formatTokens(n: number): string {
  return n.toLocaleString()
}

export function SharedWorkState({
  tasks,
  selectedTaskId,
  onSelectTask,
  refreshSignal,
}: SharedWorkStateProps) {
  const taskId = selectedTaskId
  const requestKey = taskId ? `${taskId}|${refreshSignal}` : null
  const [result, setResult] = useState<{
    key: string
    taskId: string
    data: ContextComparison | null
    error: string | null
  } | null>(null)

  // Fetch the comparison whenever the task or the refresh signal changes.
  // State is only set from the async callbacks (no cascading renders).
  useEffect(() => {
    if (!requestKey || !taskId) return
    let cancelled = false
    neuralopsApi
      .getComparison(taskId)
      .then((c) => {
        if (!cancelled) setResult({ key: requestKey, taskId, data: c, error: null })
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setResult({ key: requestKey, taskId, data: null, error: err instanceof Error ? err.message : String(err) })
        }
      })
    return () => {
      cancelled = true
    }
  }, [requestKey, taskId])

  const loading = !!requestKey && result?.key !== requestKey
  // Keep showing the last numbers for the same task while a refresh is in flight.
  const data = taskId && result?.taskId === taskId ? result.data : null
  const error = requestKey && result?.key === requestKey ? result.error : null

  const reductionPct = data?.reductionPct ?? 0
  const fullTokens = data?.fullTokens ?? 0
  const compactedTokens = data?.compactedTokens ?? 0
  const savedTokens = Math.max(0, fullTokens - compactedTokens)

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <LayersIcon className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
          <h2 className="text-sm font-semibold tracking-tight">Shared Work State — Context Compaction</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
            task:
          </span>
          <div className="flex flex-wrap gap-1">
            {tasks.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onSelectTask(t.id)}
                className={cn(
                  'rounded-md border px-2 py-0.5 font-mono text-[11px] transition-colors',
                  t.id === taskId
                    ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                    : 'border-border/60 bg-background/60 text-muted-foreground hover:bg-muted/60',
                )}
                title={t.title}
              >
                {t.id}
              </button>
            ))}
            {tasks.length === 0 && (
              <span className="text-[11px] text-muted-foreground">no tasks available</span>
            )}
          </div>
        </div>
      </div>

      <Card className="p-0 py-0">
        <CardHeader className="gap-1.5 border-b border-border/60 px-4 py-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <DatabaseIcon className="size-4 text-muted-foreground" aria-hidden />
            get_task_context(<span className="font-mono">{taskId ?? '—'}</span>)
          </CardTitle>
          <p className="text-[11px] text-muted-foreground">
            Compare the <span className="font-semibold">full raw context</span> an agent would have
            inherited (acts + records) against the{' '}
            <span className="font-semibold">compacted snapshot</span> the Coordination Core actually
            returns. Deeper detail is available on-demand via{' '}
            <span className="font-mono">get_evidence</span> /{' '}
            <span className="font-mono">get_decision</span>.
          </p>
        </CardHeader>
        <CardContent className="px-4 py-4">
          {loading ? (
            <CompactionSkeleton />
          ) : error ? (
            <div className="rounded-md border border-rose-500/40 bg-rose-500/5 px-4 py-3 text-[12px] text-rose-700 dark:text-rose-300">
              Failed to load comparison: {error}
            </div>
          ) : !data ? (
            <div className="rounded-md border border-dashed border-border/70 bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
              Select a task above to view its context comparison.
            </div>
          ) : (
            <>
              {/* Reduction banner */}
              <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-border/60 bg-muted/30 px-3 py-2.5">
                <Badge
                  variant="outline"
                  className={cn(
                    'gap-1 px-2.5 py-1 font-mono text-[12px] font-semibold',
                    reductionPct >= 50
                      ? hue.badge.emerald
                      : reductionPct > 0
                        ? hue.badge.amber
                        : hue.badge.slate,
                  )}
                >
                  <RefreshCwIcon className="size-3" aria-hidden />
                  −{reductionPct}% tokens
                </Badge>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground">
                  <span>
                    full:{' '}
                    <span className="font-semibold text-foreground">{formatTokens(fullTokens)}</span> tk
                  </span>
                  <span aria-hidden>→</span>
                  <span>
                    compacted:{' '}
                    <span className="font-semibold text-foreground">{formatTokens(compactedTokens)}</span> tk
                  </span>
                  <span aria-hidden>·</span>
                  <span>
                    saved:{' '}
                    <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                      {formatTokens(savedTokens)}
                    </span> tk
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <ContextPanel
                  label="Full raw context"
                  hueName="slate"
                  tokens={fullTokens}
                  formatted={data.fullFormatted}
                />
                <ContextPanel
                  label="Compacted context"
                  hueName="emerald"
                  tokens={compactedTokens}
                  formatted={data.compactedFormatted}
                  highlight
                />
              </div>

              <Separator className="my-4" />
              <p className="text-[11px] text-muted-foreground">
                Agent B requests{' '}
                <span className="font-mono text-foreground">get_task_context(task_id)</span> and
                receives the compacted snapshot — shared knowledge without shared token waste.
                Deeper detail is available on-demand via{' '}
                <span className="font-mono text-foreground">get_evidence</span> /{' '}
                <span className="font-mono text-foreground">get_decision</span>.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  )
}

interface ContextPanelProps {
  label: string
  hueName: 'slate' | 'emerald'
  tokens: number
  formatted: string
  highlight?: boolean
}

function ContextPanel({ label, hueName, tokens, formatted, highlight }: ContextPanelProps) {
  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden rounded-md border',
        highlight ? hue.border[hueName] : 'border-border/60',
        highlight ? 'bg-emerald-500/[0.03]' : 'bg-background/60',
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <FileStackIcon
            className={cn('size-3.5', hueName === 'emerald' ? 'text-emerald-600' : 'text-muted-foreground')}
            aria-hidden
          />
          <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
        </div>
        <Badge
          variant="outline"
          className={cn('px-1.5 py-0 font-mono text-[10px]', hue.badge[hueName])}
        >
          {formatTokens(tokens)} tokens
        </Badge>
      </div>
      <ScrollArea className="h-72 w-full">
        <pre className="whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-relaxed text-foreground/90">
          {formatted || '(empty)'}
        </pre>
      </ScrollArea>
    </div>
  )
}

function CompactionSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-8 w-full" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-72 w-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

// Convenience: a small floating refresh button the page can render in the
// section header. (Currently the section re-fetches automatically on state
// changes; this is a manual override.)
export function RefreshCompactionButton({
  onClick,
  busy,
}: {
  onClick: () => void
  busy: boolean
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="gap-1.5 text-[11px] text-muted-foreground"
      onClick={onClick}
      disabled={busy}
    >
      <RefreshCwIcon className={cn('size-3.5', busy && 'animate-spin')} aria-hidden />
      Refresh
    </Button>
  )
}
