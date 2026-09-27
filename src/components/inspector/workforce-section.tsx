'use client'

import { UsersIcon, ListTodoIcon } from 'lucide-react'
import { AgentCard } from './agent-card'
import { TaskCard } from './task-card'
import type { Agent, Task } from '@/lib/neuralops-types'

interface WorkforceSectionProps {
  agents: Agent[]
  tasks: Task[]
  selectedTaskId: string | null
  onSelectTask: (id: string) => void
}

export function WorkforceSection({
  agents,
  tasks,
  selectedTaskId,
  onSelectTask,
}: WorkforceSectionProps) {
  const agentNameById = new Map(agents.map((a) => [a.id, a.name]))
  const tasksByAssignee = new Map<string, Task[]>()
  for (const t of tasks) {
    if (!t.assignee) continue
    const list = tasksByAssignee.get(t.assignee) ?? []
    list.push(t)
    tasksByAssignee.set(t.assignee, list)
  }

  return (
    <section className="space-y-5">
      <div>
        <div className="mb-3 flex items-center gap-2">
          <UsersIcon className="size-4 text-muted-foreground" aria-hidden />
          <h2 className="text-sm font-semibold tracking-tight">The Workforce</h2>
          <span className="font-mono text-[11px] text-muted-foreground">
            {agents.length} agents · {tasks.length} tasks
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {agents.map((a) => (
            <AgentCard
              key={a.id}
              agent={a}
              reportsToName={a.reportsTo ? (agentNameById.get(a.reportsTo) ?? a.reportsTo) : null}
              ownedTasks={tasksByAssignee.get(a.id) ?? []}
            />
          ))}
          {agents.length === 0 && (
            <div className="col-span-full rounded-md border border-dashed border-border/70 bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
              No agents registered. Try resetting the demo.
            </div>
          )}
        </div>
      </div>

      <div>
        <div className="mb-3 flex items-center gap-2">
          <ListTodoIcon className="size-4 text-muted-foreground" aria-hidden />
          <h2 className="text-sm font-semibold tracking-tight">Tasks</h2>
          <span className="font-mono text-[11px] text-muted-foreground">
            click a task to load its compacted context below
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {tasks.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              ownerName={t.assignee ? (agentNameById.get(t.assignee) ?? t.assignee) : null}
              selected={selectedTaskId === t.id}
              onSelect={onSelectTask}
            />
          ))}
          {tasks.length === 0 && (
            <div className="col-span-full rounded-md border border-dashed border-border/70 bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
              No tasks in the workspace.
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
