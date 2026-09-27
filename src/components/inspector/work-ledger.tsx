'use client'

import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronRightIcon, HistoryIcon, HashIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import type {
  ActType,
  Agent,
  FamiliesResponse,
  LedgerEvent,
} from '@/lib/neuralops-types'
import { ActBadge, StatusDot } from './act-badge'
import { familyForActType, hueForActType, hue, type Hue } from './colors'

interface WorkLedgerProps {
  ledger: LedgerEvent[]
  ledgerTotal: number
  agents: Agent[]
  families: FamiliesResponse | null
  latestEventId: string | null
}

const MAX_ROWS = 50

export function WorkLedger({
  ledger,
  ledgerTotal,
  agents,
  families,
  latestEventId,
}: WorkLedgerProps) {
  const agentNameById = useMemo(() => new Map(agents.map((a) => [a.id, a.name])), [agents])
  const visible = ledger.slice(0, MAX_ROWS)
  // Track which seqs were rendered "new" so we can pulse them once. We rely on
  // `latestEventId` (passed from the hook) to detect the latest event.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const toggle = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <HistoryIcon className="size-4 text-muted-foreground" aria-hidden />
          <h2 className="text-sm font-semibold tracking-tight">
            Work Ledger — immutable event stream
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <HashIcon className="size-3" aria-hidden />
            {ledgerTotal} event{ledgerTotal === 1 ? '' : 's'} total
          </span>
          <span aria-hidden>·</span>
          <span>showing {Math.min(visible.length, MAX_ROWS)} most recent</span>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1.5">
            <StatusDot h="emerald" pulse />
            live
          </span>
        </div>
      </div>

      <Card className="p-0 py-0">
        <CardHeader className="gap-1.5 border-b border-border/60 px-4 py-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
              reverse-chronological
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-2 py-2">
          {visible.length === 0 ? (
            <div className="rounded-md border border-dashed border-border/70 bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
              No ledger events yet. Trigger an act above to see the stream.
            </div>
          ) : (
            <ScrollArea className="h-96 w-full rounded-md">
              <ul className="divide-y divide-border/60">
                <AnimatePresence initial={false}>
                  {visible.map((evt) => {
                    const family = familyForActType(evt.actType as ActType, families)
                    const h = hueForActType(evt.actType as ActType, families) as Hue
                    const isNew = latestEventId === evt.id
                    const expanded = expandedIds.has(evt.id)
                    return (
                      <motion.li
                        key={evt.id}
                        layout
                        initial={isNew ? { opacity: 0, y: -8 } : false}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.18, ease: 'easeOut' }}
                        className="px-2"
                      >
                        <button
                          type="button"
                          onClick={() => toggle(evt.id)}
                          className={cn(
                            'flex w-full items-start gap-3 px-2 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                            isNew && cn('bg-emerald-500/[0.06]', hue.border[h]),
                            'rounded-md',
                          )}
                          aria-expanded={expanded}
                        >
                          <span className="mt-0.5 flex shrink-0 items-center gap-2">
                            <ActBadge type={evt.actType as ActType} families={families} />
                            <span
                              className={cn('hidden size-2 rounded-full sm:inline-block', hue.dot[h])}
                              aria-hidden
                            />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                              <span className="font-mono text-[12px] font-medium text-foreground">
                                {agentNameById.get(evt.actor) ?? evt.actor}
                              </span>
                              <span className="font-mono text-[10px] text-muted-foreground">
                                seq#{evt.seq}
                              </span>
                              {evt.taskId && (
                                <span className="font-mono text-[10px] text-muted-foreground">
                                  · {evt.taskId}
                                </span>
                              )}
                              {evt.intent && (
                                <Badge
                                  variant="outline"
                                  className="px-1.5 py-0 font-mono text-[10px] text-muted-foreground"
                                >
                                  intent: {evt.intent}
                                </Badge>
                              )}
                              <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                                {formatTs(evt.timestamp)}
                              </span>
                            </div>
                            <p className="mt-0.5 break-words font-mono text-[11px] text-foreground/80">
                              {evt.deltaSummary}
                            </p>
                            {expanded && (
                              <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                <DeltaBlock title="before" data={evt.before} h="rose" />
                                <DeltaBlock title="after" data={evt.after} h="emerald" />
                              </div>
                            )}
                          </div>
                          <ChevronRightIcon
                            className={cn(
                              'mt-1 size-3.5 shrink-0 text-muted-foreground transition-transform',
                              expanded && 'rotate-90',
                            )}
                            aria-hidden
                          />
                        </button>
                      </motion.li>
                    )
                  })}
                </AnimatePresence>
              </ul>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </section>
  )
}

function DeltaBlock({
  title,
  data,
  h,
}: {
  title: string
  data: Record<string, unknown>
  h: Hue
}) {
  const json = useMemo(() => {
    try {
      return JSON.stringify(data, null, 2)
    } catch {
      return String(data)
    }
  }, [data])
  const isEmpty = !data || Object.keys(data).length === 0
  return (
    <div
      className={cn(
        'overflow-hidden rounded-md border bg-background/60',
        hue.border[h],
      )}
    >
      <div
        className={cn(
          'border-b border-border/60 px-2 py-1 font-mono text-[10px] uppercase tracking-wide',
          hue.text[h],
        )}
      >
        {title}
      </div>
      <pre className="max-h-40 overflow-auto p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
        {isEmpty ? '(empty)' : json}
      </pre>
    </div>
  )
}

function formatTs(ts: string): string {
  try {
    const d = new Date(ts)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return ts
  }
}
