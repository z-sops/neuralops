'use client'

import { useState } from 'react'
import { ChevronDownIcon, ShieldCheckIcon, UserIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import type { Agent, Task } from '@/lib/neuralops-types'
import { MODEL_HUE, hue, type Hue } from './colors'
import { StatusDot } from './act-badge'

interface AgentCardProps {
  agent: Agent
  reportsToName: string | null
  ownedTasks: Task[]
}

const STATUS_HUE: Record<string, Hue> = {
  online: 'emerald',
  busy: 'amber',
  offline: 'slate',
}

export function AgentCard({ agent, reportsToName, ownedTasks }: AgentCardProps) {
  const [open, setOpen] = useState(false)
  const mh = MODEL_HUE[agent.model] ?? 'slate'
  const sh = STATUS_HUE[agent.status] ?? 'slate'
  const isApprover = (agent.approverFor?.length ?? 0) > 0

  return (
    <Card className="overflow-hidden p-0 py-0">
      <CardHeader className="gap-1.5 border-b border-border/60 px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div
              className={cn(
                'flex size-9 items-center justify-center rounded-md border',
                hue.border[mh],
                'bg-muted/40',
              )}
              aria-hidden
            >
              <UserIcon className={cn('size-4', hue.text[mh])} />
            </div>
            <div className="leading-tight">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{agent.name}</span>
                <Badge
                  variant="outline"
                  className={cn('px-1.5 py-0 font-mono text-[10px]', hue.badge[mh])}
                >
                  {agent.model}
                </Badge>
              </div>
              <div className="font-mono text-[11px] text-muted-foreground">{agent.id}</div>
            </div>
          </div>
          <span
            className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] uppercase"
            title={`status: ${agent.status}`}
          >
            <StatusDot h={sh} pulse={agent.status === 'busy'} />
            {agent.status}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>
            role:{' '}
            <span className="font-mono text-foreground">{agent.role}</span>
          </span>
          <span>
            reports to:{' '}
            <span className="font-mono text-foreground">{reportsToName ?? '—'}</span>
          </span>
          {isApprover && (
            <span className={cn('inline-flex items-center gap-1 font-mono', hue.text.rose)}>
              <ShieldCheckIcon className="size-3" aria-hidden />
              approver
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent className="px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
            owns {ownedTasks.length === 0 ? 'no tasks' : `${ownedTasks.length} task${ownedTasks.length === 1 ? '' : 's'}`}
          </span>
          {ownedTasks.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {ownedTasks.slice(0, 3).map((t) => (
                <Badge
                  key={t.id}
                  variant="outline"
                  className="border-emerald-500/30 bg-emerald-500/10 font-mono text-[10px] text-emerald-700 dark:text-emerald-300"
                  title={t.title}
                >
                  {t.id}
                </Badge>
              ))}
              {ownedTasks.length > 3 && (
                <span className="font-mono text-[10px] text-muted-foreground">
                  +{ownedTasks.length - 3}
                </span>
              )}
            </div>
          )}
        </div>

        {agent.authority.length === 0 ? (
          <p className="rounded-md border border-dashed border-border/70 bg-muted/30 px-2.5 py-2 text-[11px] text-muted-foreground">
            No direct authority — must request approval for gated actions.
          </p>
        ) : (
          <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5 text-[11px] hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                aria-expanded={open}
              >
                <span className="font-mono uppercase tracking-wide text-muted-foreground">
                  authority · {agent.authority.length} scope{agent.authority.length === 1 ? '' : 's'}
                </span>
                <ChevronDownIcon
                  className={cn('size-3.5 transition-transform', open && 'rotate-180')}
                  aria-hidden
                />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="mt-2 space-y-1.5">
                {agent.authority.map((a, i) => (
                  <li
                    key={`${a.action}-${a.scope}-${i}`}
                    className="flex flex-wrap items-center gap-1.5 rounded-md border border-border/60 bg-background/60 px-2.5 py-1.5 font-mono text-[11px]"
                  >
                    <span className="rounded bg-foreground/5 px-1.5 py-0.5 text-foreground">
                      {a.action}
                    </span>
                    <span className="text-muted-foreground">@</span>
                    <span className="rounded bg-foreground/5 px-1.5 py-0.5 text-foreground">
                      {a.scope}
                    </span>
                    {a.requiresApproval ? (
                      <Badge
                        variant="outline"
                        className="border-rose-500/30 bg-rose-500/10 px-1.5 py-0 font-mono text-[10px] text-rose-700 dark:text-rose-300"
                      >
                        requires approval
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0 font-mono text-[10px] text-emerald-700 dark:text-emerald-300"
                      >
                        direct
                      </Badge>
                    )}
                    <span className="text-muted-foreground">
                      approver: <span className="text-foreground">{a.approver}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  )
}
