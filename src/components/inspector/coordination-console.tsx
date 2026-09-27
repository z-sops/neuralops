'use client'

import { useMemo, useState } from 'react'
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  ClockIcon,
  Loader2Icon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  SparklesIcon,
  Wand2Icon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type {
  ActResult,
  ActType,
  Agent,
  Approval,
  Task,
} from '@/lib/neuralops-types'
import { hue, type Hue } from './colors'
import { StatusDot } from './act-badge'

export type ScenarioId =
  | 'security_claim_43'
  | 'backend_handoff_42_to_security'
  | 'security_accept_42'
  | 'security_evidence_42'
  | 'security_complete_42_deploy_trigger'
  | 'architect_authorize_latest'
  | 'security_self_authorize'
  | 'security_complete_42_deploy_approved'
  | 'qa_escalate_44_to_architect'
  | 'architect_decide_42'

interface ScenarioDef {
  id: ScenarioId
  family: 'task' | 'handoff' | 'authority' | 'information'
  label: string
  summary: string
  payload: string // monospace payload preview
  enabled: (state: { tasks: Task[]; approvals: Approval[] }) => boolean
  hint?: string
}

const isOpenGateFor = (a: Approval, agentId: string) =>
  a.taskId === 'task_42' &&
  a.requestedBy === agentId &&
  a.action === 'complete' &&
  a.scope === 'production'

const DEPLOY_PAYLOAD =
  'complete { taskId: "task_42", summary: "auth module deployed", resultRef: "production://auth", evidence: [{ type: "deploy", … }] }'

const SCENARIOS: ScenarioDef[] = [
  {
    id: 'security_claim_43',
    family: 'task',
    label: 'Security → claim task_43',
    summary: 'agent.security claims the unclaimed security review.',
    payload: 'claim { taskId: "task_43", note: "reviewing" }',
    enabled: ({ tasks }) => {
      const t = tasks.find((x) => x.id === 'task_43')
      return !!t && t.status === 'unclaimed'
    },
    hint: 'task_43 must be unclaimed',
  },
  {
    id: 'backend_handoff_42_to_security',
    family: 'handoff',
    label: 'Backend → handoff task_42 to Security',
    summary: 'backend offers task_42 to security for review. Ownership moves only on accept.',
    payload: 'handoff { taskId: "task_42", to: "agent.security", intent: "review" }',
    enabled: ({ tasks }) => {
      const t = tasks.find((x) => x.id === 'task_42')
      return !!t && t.assignee === 'agent.backend' && t.status === 'in_progress'
    },
    hint: 'backend must own task_42',
  },
  {
    id: 'security_accept_42',
    family: 'handoff',
    label: 'Security → accept handoff of task_42',
    summary: 'security accepts and becomes the owner of task_42.',
    payload: 'accept_handoff { taskId: "task_42" }',
    enabled: ({ tasks }) => {
      const t = tasks.find((x) => x.id === 'task_42')
      return !!t && t.status === 'handoff_pending' && t.pendingHandoffTo === 'agent.security'
    },
    hint: 'handoff to security must be pending',
  },
  {
    id: 'security_evidence_42',
    family: 'information',
    label: 'Security → record review evidence on task_42',
    summary: 'security records a review-passed evidence artifact on task_42.',
    payload:
      'evidence { taskId: "task_42", type: "review", summary: "security review passed", ref: "review://task_42/sec" }',
    enabled: ({ tasks }) => {
      const t = tasks.find((x) => x.id === 'task_42')
      return !!t && t.status !== 'completed'
    },
    hint: 'task_42 must be open',
  },
  {
    id: 'security_complete_42_deploy_trigger',
    family: 'task',
    label: 'Security → complete task_42 (deploy) [triggers approval]',
    summary: 'task_42 is gated complete/production → the authority gate fires instead of completing.',
    payload: DEPLOY_PAYLOAD,
    enabled: ({ tasks, approvals }) => {
      const t = tasks.find((x) => x.id === 'task_42')
      if (!t || t.assignee !== 'agent.security' || t.status !== 'in_progress') return false
      return !approvals.some(
        (a) => isOpenGateFor(a, 'agent.security') && (a.status === 'pending' || (a.status === 'approved' && !a.consumedAt)),
      )
    },
    hint: 'security owns task_42, no open gate approval',
  },
  {
    id: 'architect_authorize_latest',
    family: 'authority',
    label: 'Architect → authorize latest approval',
    summary: 'the named approver authorizes the most recent pending approval.',
    payload: 'authorize { approvalId: <latest pending> }',
    enabled: ({ approvals }) => approvals.some((a) => a.status === 'pending'),
    hint: 'requires a pending approval',
  },
  {
    id: 'security_self_authorize',
    family: 'authority',
    label: 'Security → authorize its OWN approval [must be rejected]',
    summary: 'separation of duties: a requester can never approve its own request.',
    payload: 'authorize { approvalId: <security’s pending approval> }  // from: agent.security',
    enabled: ({ approvals }) =>
      approvals.some((a) => a.status === 'pending' && a.requestedBy === 'agent.security'),
    hint: 'security must have a pending approval',
  },
  {
    id: 'security_complete_42_deploy_approved',
    family: 'task',
    label: 'Security → complete task_42 (deploy, now approved)',
    summary: 'the approved approval is consumed (single-use) → task_42 → completed.',
    payload: DEPLOY_PAYLOAD,
    enabled: ({ tasks, approvals }) => {
      const t = tasks.find((x) => x.id === 'task_42')
      if (!t || t.status !== 'in_progress' || t.assignee !== 'agent.security') return false
      return approvals.some((a) => isOpenGateFor(a, 'agent.security') && a.status === 'approved' && !a.consumedAt)
    },
    hint: 'requires an approved, unused approval',
  },
  {
    id: 'qa_escalate_44_to_architect',
    family: 'authority',
    label: 'QA → escalate task_44 to Architect',
    summary: 'qa (owner) escalates the blocked CI task; the architect may then take it over by claiming.',
    payload: 'escalate { taskId: "task_44", reason: "DevOps unresponsive", to: "agent.architect" }',
    enabled: ({ tasks }) => {
      const t = tasks.find((x) => x.id === 'task_44')
      return !!t && t.assignee === 'agent.qa' && t.status !== 'completed' && t.escalatedTo !== 'agent.architect'
    },
    hint: 'qa must own task_44',
  },
  {
    id: 'architect_decide_42',
    family: 'information',
    label: 'Architect → decide on task_42',
    summary: 'architect records a durable decision on task_42.',
    payload: 'decision { taskId: "task_42", text: "approved for production deploy", rationale: "review passed" }',
    enabled: ({ tasks }) => !!tasks.find((x) => x.id === 'task_42'),
    hint: 'task_42 must exist',
  },
]

const FAMILY_HUE: Record<ScenarioDef['family'], Hue> = {
  task: 'emerald',
  handoff: 'amber',
  authority: 'rose',
  information: 'sky',
}

const FAMILY_LABEL: Record<ScenarioDef['family'], string> = {
  task: 'task',
  handoff: 'handoff',
  authority: 'authority',
  information: 'information',
}

interface ScenarioResult {
  ok: boolean
  error?: string
  approval?: Approval | null
  stateChanged: boolean
  actId?: string
}

// Tracks the most recent result per scenario (so each card shows its own result).
type ResultMap = Partial<Record<ScenarioId, ScenarioResult>>

interface CoordinationConsoleInnerProps {
  agents: Agent[]
  tasks: Task[]
  approvals: Approval[]
  lastResult: ActResult | null
  lastResultAt: number | null
  submitAct: (type: ActType, from: string, payload: Record<string, unknown>) => Promise<ActResult>
  resetLastResult: () => void
}

export function CoordinationConsole(props: CoordinationConsoleInnerProps) {
  const { agents, tasks, approvals, lastResult, lastResultAt, submitAct } = props
  void props.resetLastResult // reserved for parent-driven resets; not used in-component.

  const agentNameById = useMemo(() => new Map(agents.map((a) => [a.id, a.name])), [agents])

  const [busyId, setBusyId] = useState<ScenarioId | null>(null)
  const [results, setResults] = useState<ResultMap>({})

  // The latest pending approval (for the smart authorize button).
  const latestPendingApproval = useMemo(() => {
    const pending = approvals.filter((a) => a.status === 'pending')
    pending.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
    return pending[0] ?? null
  }, [approvals])

  const runScenario = async (id: ScenarioId): Promise<void> => {
    const def = SCENARIOS.find((s) => s.id === id)
    if (!def) return
    setBusyId(id)
    try {
      let type: ActType
      let from: string
      let payload: Record<string, unknown>

      const deployPayload = {
        taskId: 'task_42',
        summary: 'Auth module deployed to production',
        resultRef: 'production://auth-module/v1',
        evidence: [
          {
            type: 'deploy',
            summary: 'deployed to production://auth-module/v1',
            ref: 'production://auth-module/v1',
          },
        ],
      }

      switch (id) {
        case 'security_claim_43':
          type = 'claim'
          from = 'agent.security'
          payload = { taskId: 'task_43', note: 'reviewing' }
          break
        case 'backend_handoff_42_to_security':
          type = 'handoff'
          from = 'agent.backend'
          payload = { taskId: 'task_42', to: 'agent.security', intent: 'review' }
          break
        case 'security_accept_42':
          type = 'accept_handoff'
          from = 'agent.security'
          payload = { taskId: 'task_42' }
          break
        case 'security_evidence_42':
          type = 'evidence'
          from = 'agent.security'
          payload = {
            taskId: 'task_42',
            type: 'review',
            summary: 'Security review passed — no critical issues found.',
            ref: 'review://task_42/security',
          }
          break
        case 'security_complete_42_deploy_trigger':
        case 'security_complete_42_deploy_approved':
          type = 'complete'
          from = 'agent.security'
          payload = deployPayload
          break
        case 'architect_authorize_latest':
          if (!latestPendingApproval) {
            setResults((prev) => ({
              ...prev,
              [id]: { ok: false, error: 'No pending approval to authorize.', stateChanged: false },
            }))
            setBusyId(null)
            return
          }
          type = 'authorize'
          from = latestPendingApproval.approver
          payload = { approvalId: latestPendingApproval.id }
          break
        case 'security_self_authorize': {
          const own = approvals.find((a) => a.status === 'pending' && a.requestedBy === 'agent.security')
          if (!own) {
            setBusyId(null)
            return
          }
          type = 'authorize'
          from = 'agent.security'
          payload = { approvalId: own.id }
          break
        }
        case 'qa_escalate_44_to_architect':
          type = 'escalate'
          from = 'agent.qa'
          payload = {
            taskId: 'task_44',
            reason: 'DevOps unresponsive — runner image still missing',
            to: 'agent.architect',
          }
          break
        case 'architect_decide_42':
          type = 'decision'
          from = 'agent.architect'
          payload = {
            taskId: 'task_42',
            text: 'Approved for production deploy.',
            rationale: 'Security review passed; CI is green; constraints met.',
          }
          break
        default:
          setBusyId(null)
          return
      }

      const result = await submitAct(type, from, payload)
      setResults((prev) => ({
        ...prev,
        [id]: {
          ok: result.ok,
          error: result.error,
          approval: result.approval,
          stateChanged: result.stateChanged,
          actId: result.act?.id,
        },
      }))
      setBusyId(null)
    } catch (err) {
      setResults((prev) => ({
        ...prev,
        [id]: {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          stateChanged: false,
        },
      }))
      setBusyId(null)
    }
  }

  // Pending approvals sub-panel actions.
  const [approvalBusy, setApprovalBusy] = useState<string | null>(null)
  const runApprovalAction = async (approvalId: string, kind: 'authorize' | 'deny') => {
    const approval = approvals.find((a) => a.id === approvalId)
    if (!approval) return
    setApprovalBusy(approvalId)
    try {
      if (kind === 'authorize') {
        await submitAct('authorize', approval.approver, { approvalId })
      } else {
        await submitAct('deny', approval.approver, {
          approvalId,
          reason: 'Denied via Coordination Console (demo).',
        })
      }
    } finally {
      setApprovalBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* Scenario buttons */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {SCENARIOS.map((s) => {
          const enabled = s.enabled({ tasks, approvals })
          const h = FAMILY_HUE[s.family]
          const isBusy = busyId === s.id
          const result = results[s.id]
          return (
            <Card
              key={s.id}
              className={cn(
                'p-0 py-0 transition-colors',
                !enabled && 'opacity-60',
              )}
            >
              <CardHeader className="gap-1.5 border-b border-border/60 px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <Badge
                    variant="outline"
                    className={cn('px-1.5 py-0 font-mono text-[10px] uppercase', hue.badge[h])}
                  >
                    {FAMILY_LABEL[s.family]}
                  </Badge>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {s.hint ?? ' '}
                  </span>
                </div>
                <CardTitle className="text-[13px] leading-snug">{s.label}</CardTitle>
                <p className="text-[11px] text-muted-foreground">{s.summary}</p>
              </CardHeader>
              <CardContent className="px-4 py-3">
                <pre className="mb-3 max-h-24 overflow-hidden rounded-md border border-border/60 bg-muted/40 px-2.5 py-1.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
                  {s.payload}
                </pre>

                <Button
                  type="button"
                  size="sm"
                  className={cn('w-full gap-1.5', hue.buttonSolid[h])}
                  disabled={!enabled || isBusy}
                  onClick={() => runScenario(s.id)}
                >
                  {isBusy ? (
                    <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Wand2Icon className="size-3.5" aria-hidden />
                  )}
                  {isBusy ? 'Running…' : enabled ? 'Run act' : 'Not available'}
                </Button>

                {result && (
                  <ResultRow result={result} agentNameById={agentNameById} />
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Pending approvals sub-panel */}
      <Card className="p-0 py-0">
        <CardHeader className="gap-1.5 border-b border-border/60 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ShieldAlertIcon className="size-4 text-rose-500" aria-hidden />
              Pending Approvals
            </CardTitle>
            <Badge
              variant="outline"
              className={cn(
                'px-1.5 py-0 font-mono text-[10px] uppercase',
                approvals.some((a) => a.status === 'pending')
                  ? hue.badge.rose
                  : 'border-border/60 text-muted-foreground',
              )}
            >
              {approvals.filter((a) => a.status === 'pending').length} pending
            </Badge>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Authority gatekeeper. Each pending approval blocks the requesting agent&apos;s gated
            action until the named approver authorizes or denies it.
          </p>
        </CardHeader>
        <CardContent className="px-4 py-3">
          {approvals.length === 0 ? (
            <div className="rounded-md border border-dashed border-border/70 bg-muted/30 px-4 py-4 text-center text-[12px] text-muted-foreground">
              No approvals have been requested. Run the &ldquo;complete (deploy)&rdquo; scenario to
              trigger the authority gate.
            </div>
          ) : (
            <ul className="space-y-2">
              {approvals
                .slice()
                .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
                .map((a) => (
                  <li
                    key={a.id}
                    className={cn(
                      'flex flex-col gap-2 rounded-md border bg-background/60 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between',
                      a.status === 'pending'
                        ? hue.border.rose
                        : 'border-border/60',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[11px] text-muted-foreground">{a.id}</span>
                        <Badge
                          variant="outline"
                          className={cn(
                            'px-1.5 py-0 font-mono text-[10px] uppercase',
                            a.status === 'pending'
                              ? hue.badge.rose
                              : a.status === 'approved'
                                ? hue.badge.emerald
                                : hue.badge.slate,
                          )}
                        >
                          {a.status}
                        </Badge>
                        <span className="font-mono text-[11px] text-foreground">
                          {a.action}/{a.scope}
                        </span>
                        {a.taskId && (
                          <span className="font-mono text-[11px] text-muted-foreground">
                            on {a.taskId}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                        <span>
                          requestedBy:{' '}
                          <span className="font-mono text-foreground">
                            {agentNameById.get(a.requestedBy) ?? a.requestedBy}
                          </span>
                        </span>
                        <span>
                          approver:{' '}
                          <span className="font-mono text-foreground">
                            {agentNameById.get(a.approver) ?? a.approver}
                          </span>
                        </span>
                        {a.consumedBy && (
                          <span>
                            used by: <span className="font-mono text-foreground">{a.consumedBy}</span>
                          </span>
                        )}
                        {a.decidedBy && (
                          <span>
                            decidedBy:{' '}
                            <span className="font-mono text-foreground">
                              {agentNameById.get(a.decidedBy) ?? a.decidedBy}
                            </span>
                          </span>
                        )}
                        <span className="font-mono text-[10px]">
                          {new Date(a.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      {a.reason && (
                        <p className="mt-1 text-[11px] italic text-muted-foreground">
                          “{a.reason}”
                        </p>
                      )}
                    </div>
                    {a.status === 'pending' ? (
                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          size="sm"
                          className={cn('gap-1.5', hue.buttonSolid.emerald)}
                          disabled={approvalBusy === a.id}
                          onClick={() => runApprovalAction(a.id, 'authorize')}
                        >
                          {approvalBusy === a.id ? (
                            <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
                          ) : (
                            <ShieldCheckIcon className="size-3.5" aria-hidden />
                          )}
                          Authorize
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className={cn('gap-1.5', hue.buttonOutline.rose)}
                          disabled={approvalBusy === a.id}
                          onClick={() => runApprovalAction(a.id, 'deny')}
                        >
                          Deny
                        </Button>
                      </div>
                    ) : (
                      <div className="flex shrink-0 items-center gap-1.5">
                        {a.status === 'approved' ? (
                          <CheckCircle2Icon className="size-4 text-emerald-500" aria-hidden />
                        ) : (
                          <AlertCircleIcon className="size-4 text-slate-500" aria-hidden />
                        )}
                        <span className="font-mono text-[10px] uppercase text-muted-foreground">
                          {a.status === 'approved' ? (a.consumedAt ? 'used' : 'ready to use') : 'resolved'}
                        </span>
                      </div>
                    )}
                  </li>
                ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Last-action-at-a-glance footer */}
      {lastResult && lastResultAt && (
        <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
          <span className="font-mono">last act:</span>{' '}
          <span className="font-mono text-foreground">{lastResult.act?.id ?? '—'}</span>
          <span className="mx-2">·</span>
          <span>
            ok=<span className={lastResult.ok ? 'text-emerald-600' : 'text-rose-600'}>
              {String(lastResult.ok)}
            </span>
          </span>
          <span className="mx-2">·</span>
          <span>
            stateChanged=<span className="text-foreground">{String(lastResult.stateChanged)}</span>
          </span>
          {lastResult.approval && (
            <>
              <span className="mx-2">·</span>
              <span>
                approval=<span className="font-mono text-rose-600">{lastResult.approval.id}</span>
              </span>
            </>
          )}
          <span className="mx-2">·</span>
          <span className="font-mono">{new Date(lastResultAt).toLocaleTimeString()}</span>
        </div>
      )}
    </div>
  )
}

// A result is an authority gate only when it returns a still-pending approval
// without changing task state (authorize/complete also return approvals).
function isGate(result: { approval?: Approval | null; stateChanged: boolean }): boolean {
  return !!result.approval && result.approval.status === 'pending' && !result.stateChanged
}

function ResultRow({
  result,
  agentNameById,
}: {
  result: ScenarioResult
  agentNameById: Map<string, string>
}) {
  return (
    <div
      className={cn(
        'mt-2 flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-[11px]',
        result.ok
          ? isGate(result)
            ? 'border-amber-500/40 bg-amber-500/5 text-amber-800 dark:text-amber-200'
            : 'border-emerald-500/40 bg-emerald-500/5 text-emerald-800 dark:text-emerald-200'
          : 'border-rose-500/40 bg-rose-500/5 text-rose-800 dark:text-rose-200',
      )}
    >
      {result.ok ? (
        isGate(result) ? (
          <ClockIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        ) : (
          <CheckCircle2Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        )
      ) : (
        <AlertCircleIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-mono uppercase">
            {result.ok
              ? isGate(result)
                ? 'approval required'
                : 'ok'
              : 'failed'}
          </span>
          {result.stateChanged && (
            <span className="font-mono text-[10px] opacity-70">state changed</span>
          )}
        </div>
        {result.approval && (
          <p className="mt-0.5 font-mono text-[10px] opacity-80">
            {result.approval.id} · {result.approval.status}
            {result.approval.consumedBy ? ' · used' : ''} · approver: {agentNameById.get(result.approval.approver) ?? result.approval.approver}
          </p>
        )}
        {result.error && (
          <p className="mt-0.5 break-words font-mono text-[10px] opacity-90">{result.error}</p>
        )}
      </div>
    </div>
  )
}

// Re-export a small scenario index for the page so it can list them.
export function ScenarioLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
      <span className="font-mono uppercase tracking-wide">color legend</span>
      {(['task', 'handoff', 'authority', 'information'] as const).map((f) => (
        <span key={f} className="inline-flex items-center gap-1.5">
          <StatusDot h={FAMILY_HUE[f]} />
          <span className="font-mono">{f}</span>
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <SparklesIcon className="size-3 text-muted-foreground" aria-hidden />
        <span>smart buttons enable based on live state</span>
      </span>
      <ChevronRightIcon className="size-3 text-muted-foreground/50" aria-hidden />
    </div>
  )
}
