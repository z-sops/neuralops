'use client'

import {
  CheckCircle2Icon,
  ClockIcon,
  FileTextIcon,
  GitBranchIcon,
  LockIcon,
  HandIcon,
  CircleDashedIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import type { Task } from '@/lib/neuralops-types'
import { TASK_STATUS_HUE, TASK_STATUS_LABEL, hue, type Hue } from './colors'

interface TaskCardProps {
  task: Task
  ownerName: string | null
  selected: boolean
  onSelect: (id: string) => void
}

function StatusIcon({ status }: { status: Task['status'] }) {
  const cls = 'size-3.5'
  switch (status) {
    case 'in_progress':
      return <ClockIcon className={cls} aria-hidden />
    case 'completed':
      return <CheckCircle2Icon className={cls} aria-hidden />
    case 'blocked':
      return <LockIcon className={cls} aria-hidden />
    case 'handoff_pending':
      return <HandIcon className={cls} aria-hidden />
    case 'failed':
      return <LockIcon className={cls} aria-hidden />
    default:
      return <CircleDashedIcon className={cls} aria-hidden />
  }
}

export function TaskCard({ task, ownerName, selected, onSelect }: TaskCardProps) {
  const h = TASK_STATUS_HUE[task.status] ?? 'slate'
  const objectiveExcerpt =
    task.objective.length > 110 ? `${task.objective.slice(0, 110)}…` : task.objective

  return (
    <Card
      className={cn(
        'cursor-pointer p-0 py-0 transition-all hover:shadow-md',
        selected && cn('ring-2 ring-offset-2 ring-offset-background', hue.border[h]),
      )}
      onClick={() => onSelect(task.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(task.id)
        }
      }}
    >
      <CardHeader className="gap-1.5 border-b border-border/60 px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-muted-foreground">{task.id}</span>
              {selected && (
                <Badge
                  variant="outline"
                  className="border-foreground/20 px-1.5 py-0 font-mono text-[10px] uppercase"
                >
                  selected
                </Badge>
              )}
            </div>
            <CardTitle className="mt-0.5 truncate text-sm">{task.title}</CardTitle>
          </div>
          <Badge
            variant="outline"
            className={cn(
              'gap-1 px-2 py-0.5 font-mono text-[10px] uppercase',
              hue.badge[h as Hue],
            )}
          >
            <StatusIcon status={task.status} />
            {TASK_STATUS_LABEL[task.status] ?? task.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="px-4 py-3">
        <p className="line-clamp-2 text-[12px] text-muted-foreground">{objectiveExcerpt}</p>

        <div className="mt-3 flex items-center gap-2">
          <Progress
            value={task.progress}
            className={cn(
              'h-1.5',
              task.status === 'blocked' && 'bg-rose-500/15',
              task.status === 'completed' && 'bg-emerald-500/15',
            )}
          />
          <span className="w-9 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
            {task.progress}%
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/30 px-1.5 py-0.5 font-mono text-[10px]',
              )}
              title={`assignee: ${task.assignee ?? 'unclaimed'}`}
            >
              <GitBranchIcon className="size-3 text-muted-foreground" aria-hidden />
              {ownerName ? ownerName : 'unclaimed'}
            </span>
            {task.blockedReason && (
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px]',
                  hue.badge.rose,
                )}
                title={task.blockedReason}
              >
                <LockIcon className="size-3" aria-hidden />
                blocked
              </span>
            )}
            {task.pendingHandoffTo && (
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px]',
                  hue.badge.amber,
                )}
              >
                <HandIcon className="size-3" aria-hidden />
                → {task.pendingHandoffTo}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
            <Count icon={<FileTextIcon className="size-3" />} n={task.decisionIds.length} title="decisions" />
            <Count icon={<CheckCircle2Icon className="size-3" />} n={task.evidenceIds.length} title="evidence" />
            <Count icon={<HandIcon className="size-3" />} n={task.handoffs.length} title="handoffs" />
          </div>
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="mt-2 h-7 w-full justify-center text-[11px] text-muted-foreground hover:bg-muted/60"
          onClick={(e) => {
            e.stopPropagation()
            onSelect(task.id)
          }}
        >
          {selected ? 'Selected for context compaction ↓' : 'Select for compaction'}
        </Button>
      </CardContent>
    </Card>
  )
}

function Count({
  icon,
  n,
  title,
}: {
  icon: React.ReactNode
  n: number
  title: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/60 px-1.5 py-0.5',
        n === 0 && 'opacity-50',
      )}
      title={title}
    >
      {icon}
      <span className="tabular-nums">{n}</span>
    </span>
  )
}
