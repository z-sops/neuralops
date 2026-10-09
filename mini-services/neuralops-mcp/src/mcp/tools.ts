// MCP Tool Registry
//
// One tool per act type (`neuralops_<act>`, 26 total) plus query tools.
// Act tool input schemas are generated from PAYLOAD_SCHEMAS, so the tool
// surface can never drift from what the dispatcher validates.
//
// The same callTool() serves the HTTP door (/api/tools/:name) and — through
// src/mcp/stdio.ts — a real MCP stdio transport for Claude Code, Codex, etc.

import { z } from 'zod'
import { processAct, jobOutcomeReceipt, type ActResult } from '../engines/task-manager.js'
import {
  getCompactedContext,
  getDecisionById,
  getEvidenceById,
  getFullContext,
  getInbox,
  getOriginalContext,
  formatCompactedContext,
} from '../engines/context.js'
import { registerAgent, RegisterSchema } from '../engines/agents.js'
import { gateStatus, performCheck } from '../engines/gate.js'
import { requireTaskVisible, view } from '../engines/visibility.js'
import { activeReservations, checkPaths } from '../engines/reservations.js'
import { store } from '../state/store.js'
import { ACT_DESCRIPTION, ACT_FAMILY, ACT_TYPES, FAMILY_DESCRIPTION, isActType } from '../protocol/act-types.js'
import { PAYLOAD_SCHEMAS } from '../protocol/payloads.js'
import type { ActVia } from '../protocol/envelope.js'
import { NeuralOpsError, forbidden, invalid, type ErrorCode } from '../errors.js'

export interface ToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface Caller {
  agentId: string | null
  via: ActVia
  isAdmin: boolean
  /** Read scope "involved": this caller only reads what it is part of (engines/visibility.ts). */
  scoped?: boolean
}

export interface ToolResult {
  ok: boolean
  result: unknown
  error?: string
  errorCode?: ErrorCode
}

export const ACT_TOOL_PREFIX = 'neuralops_'

function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const s = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>
  delete s.$schema
  return s
}

function withEnvelopeExtras(s: Record<string, unknown>): Record<string, unknown> {
  const props = { ...((s.properties as Record<string, unknown>) ?? {}) }
  props.references = {
    type: 'array',
    items: { type: 'string' },
    description: 'Ids this act builds on, e.g. ["decision_0001","evidence_0002"]',
  }
  props.actId = {
    type: 'string',
    description: 'Optional idempotency key. Re-sending the same actId is rejected as a duplicate instead of applied twice.',
  }
  return { ...s, type: 'object', properties: props }
}

const QUERY_SCHEMAS = {
  neuralops_whoami: z.object({}),
  neuralops_job_receipt: z.object({ taskId: z.string().min(1).max(128), actId: z.string().min(1).max(128) }).strict(),
  neuralops_register: RegisterSchema,
  neuralops_workspace: z.object({}),
  neuralops_tasks: z.object({
    status: z
      .enum(['unclaimed', 'in_progress', 'blocked', 'handoff_pending', 'completed', 'failed'])
      .optional(),
  }),
  neuralops_inbox: z.object({}),
  neuralops_get_task_context: z.object({
    taskId: z.string(),
    format: z.enum(['text', 'json']).optional().describe('text (default) is what you should read'),
  }),
  neuralops_get_full_context: z.object({ taskId: z.string() }),
  neuralops_get_evidence: z.object({ evidenceId: z.string() }),
  neuralops_get_decision: z.object({ decisionId: z.string() }),
  neuralops_get_original_context: z.object({ actId: z.string() }),
  neuralops_files_check: z.object({
    paths: z.array(z.string()).min(1).max(200).describe('Repo-relative file paths you are about to edit'),
  }),
  neuralops_reservations: z.object({
    agentId: z.string().optional(),
    taskId: z.string().optional(),
  }),
  neuralops_perform_check: z.object({
    action: z.string().min(1).max(64),
    scope: z.string().min(1).max(64).optional().describe('default "production"'),
    taskId: z.string().optional(),
  }),
  neuralops_gate_status: z.object({
    taskId: z.string(),
    action: z.string().optional().describe('default "complete"; e.g. "deploy"'),
    scope: z.string().optional().describe('default "production"'),
  }),
} as const

type QueryTool = keyof typeof QUERY_SCHEMAS

const QUERY_DESCRIPTIONS: Record<QueryTool, string> = {
  neuralops_job_receipt: 'Read a durable client-outcome receipt for your identity/task, or null if absent. Check before explicitly retrying an uncertain delivery.',
  neuralops_whoami: 'Who you are in this workspace: agent record, direct authority, and reporting line.',
  neuralops_register:
    'Register a new AI worker. Admin only in secure mode. Returns the agent and its bearer token (shown once).',
  neuralops_workspace: 'Workspace overview: agents, tasks, pending approvals, policies.',
  neuralops_tasks: 'List tasks, optionally filtered by status.',
  neuralops_inbox:
    'Everything waiting on you: your open tasks, handoffs to accept, escalations, approvals to decide, open questions/proposals addressed to you or your role. Call this first.',
  neuralops_get_task_context:
    'The COMPACTED task context — OBJECTIVE / COMPLETED / DECISIONS / CONSTRAINTS / EVIDENCE / OPEN / NEXT. Read this before working on a task instead of asking other agents.',
  neuralops_get_full_context: 'The full raw record of a task (all records + act log). Large — prefer get_task_context.',
  neuralops_get_evidence: 'Fetch one evidence record by id.',
  neuralops_get_decision: 'Fetch one decision record by id.',
  neuralops_get_original_context: 'Fetch the original act envelope by act id.',
  neuralops_files_check:
    'Before editing, check who holds these files. blocked=true means another agent holds an exclusive reservation: do not edit; ask them or pick other work. mine=true means you already hold it.',
  neuralops_reservations: 'List active file reservations (optionally for one agent or task).',
  neuralops_perform_check:
    'Dry run of neuralops_perform: is this action governed by a policy, who approves it, do you hold authority or an unused approval, is the workspace frozen. Records and consumes nothing.',
  neuralops_gate_status:
    'Ask whether an action (merge = "complete", or e.g. "deploy") is cleared for a task and scope. CI and hooks enforce exactly this answer, so check it before pushing or deploying.',
}

export const TOOL_DEFS: ToolDef[] = [
  ...(Object.keys(QUERY_SCHEMAS) as QueryTool[]).map((name) => ({
    name,
    description: QUERY_DESCRIPTIONS[name],
    inputSchema: jsonSchema(QUERY_SCHEMAS[name]),
  })),
  ...ACT_TYPES.map((type) => ({
    name: `${ACT_TOOL_PREFIX}${type}`,
    description: `[${ACT_FAMILY[type]}] ${ACT_DESCRIPTION[type]}`,
    inputSchema: withEnvelopeExtras(jsonSchema(PAYLOAD_SCHEMAS[type])),
  })),
]

function requireAgent(caller: Caller): string {
  if (!caller.agentId) throw forbidden('This tool needs an agent identity (send your agent bearer token).')
  return caller.agentId
}

function parseArgs<N extends QueryTool>(name: N, args: unknown): z.infer<(typeof QUERY_SCHEMAS)[N]> {
  const r = QUERY_SCHEMAS[name].safeParse(args ?? {})
  if (!r.success) throw invalid(r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '))
  return r.data as z.infer<(typeof QUERY_SCHEMAS)[N]>
}

export function workspaceState(caller?: Caller) {
  const c = caller ?? { agentId: null }
  return {
    workspaces: [...store.workspaces.values()],
    agents: [...store.agents.values()],
    tasks: view.tasks(c, [...store.tasks.values()]),
    pendingApprovals: view.approvals(c, [...store.approvals.values()].filter((a) => a.status === 'pending')),
    policies: [...store.policies.values()],
  }
}

/** Scoped callers may only read tasks they are part of. */
function checkTask(caller: Caller, taskId: string | null | undefined): void {
  if (caller.scoped && caller.agentId && taskId) requireTaskVisible(caller.agentId, taskId)
}

export function callTool(name: string, rawArgs: unknown, caller: Caller): ToolResult {
  try {
    const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as Record<string, unknown>
    switch (name) {
      case 'neuralops_whoami': {
        parseArgs(name, args)
        const id = requireAgent(caller)
        const agent = store.agents.get(id)!
        return { ok: true, result: { agent, via: caller.via, capabilities: { managedJobs: 'orbit-v1', jobOutcomes: 'orbit-v1' } } }
      }
      case 'neuralops_job_receipt': {
        const { taskId, actId } = parseArgs(name, args)
        checkTask(caller, taskId)
        return { ok: true, result: { receipt: jobOutcomeReceipt(requireAgent(caller), taskId, actId) } }
      }
      case 'neuralops_register': {
        if (!caller.isAdmin && caller.via !== 'impersonated') {
          throw forbidden('Registering agents needs the admin token')
        }
        const { agent, token } = registerAgent(args, { asAdmin: caller.isAdmin })
        return { ok: true, result: { agent, token, note: 'Store this token now — it is not shown again.' } }
      }
      case 'neuralops_workspace':
        parseArgs(name, args)
        return { ok: true, result: workspaceState(caller) }
      case 'neuralops_tasks': {
        const { status } = parseArgs(name, args)
        const all = view.tasks(caller, [...store.tasks.values()])
        return { ok: true, result: status ? all.filter((t) => t.status === status) : all }
      }
      case 'neuralops_inbox':
        parseArgs(name, args)
        return { ok: true, result: { ...getInbox(requireAgent(caller)), frozen: store.freeze } }
      case 'neuralops_get_task_context': {
        const { taskId, format } = parseArgs(name, args)
        checkTask(caller, taskId)
        const ctx = getCompactedContext(taskId)
        return { ok: true, result: format === 'json' ? ctx : { text: formatCompactedContext(ctx), tokens: ctx.tokens, method: ctx.method } }
      }
      case 'neuralops_get_full_context': {
        const { taskId } = parseArgs(name, args)
        checkTask(caller, taskId)
        return { ok: true, result: getFullContext(taskId) }
      }
      case 'neuralops_get_evidence': {
        const r = getEvidenceById(parseArgs(name, args).evidenceId)
        checkTask(caller, r.taskId)
        return { ok: true, result: r }
      }
      case 'neuralops_get_decision': {
        const r = getDecisionById(parseArgs(name, args).decisionId)
        checkTask(caller, r.taskId)
        return { ok: true, result: r }
      }
      case 'neuralops_get_original_context': {
        const r = getOriginalContext(parseArgs(name, args).actId)
        if (caller.scoped && caller.agentId && r.from !== caller.agentId) {
          if (!r.taskId) throw forbidden(`${caller.agentId} may only read its own acts or acts on tasks it is part of (read scope "involved").`)
          checkTask(caller, r.taskId)
        }
        return { ok: true, result: r }
      }
      case 'neuralops_files_check': {
        const a = parseArgs(name, args)
        return { ok: true, result: checkPaths(caller.agentId, a.paths) }
      }
      case 'neuralops_reservations': {
        const a = parseArgs(name, args)
        return { ok: true, result: activeReservations().filter((r) => (!a.agentId || r.agentId === a.agentId) && (!a.taskId || r.taskId === a.taskId)) }
      }
      case 'neuralops_perform_check': {
        const a = parseArgs(name, args)
        return { ok: true, result: performCheck(requireAgent(caller), a.action, a.scope ?? 'production', a.taskId ?? null) }
      }
      case 'neuralops_gate_status': {
        const a = parseArgs(name, args)
        return { ok: true, result: gateStatus(a.taskId, a.action ?? 'complete', a.scope ?? 'production') }
      }
    }

    if (name.startsWith(ACT_TOOL_PREFIX)) {
      const type = name.slice(ACT_TOOL_PREFIX.length)
      if (isActType(type)) {
        const from = requireAgent(caller)
        const { references, actId, ...payload } = args
        const res = processAct(
          {
            ...(typeof actId === 'string' ? { id: actId } : {}),
            type,
            from,
            references: Array.isArray(references) ? references : [],
            payload,
          },
          { via: caller.via }
        )
        return actToolResult(res)
      }
    }
    return { ok: false, result: null, error: `Unknown tool: ${name}`, errorCode: 'not_found' }
  } catch (e) {
    const err = e instanceof NeuralOpsError ? e : new NeuralOpsError('invalid', (e as Error).message)
    return { ok: false, result: null, error: err.message, errorCode: err.code }
  }
}

function actToolResult(res: ActResult): ToolResult {
  return {
    ok: res.ok,
    result: {
      actId: res.act?.id ?? null,
      stateChanged: res.stateChanged,
      message: res.message,
      approval: res.approval,
      task: res.task,
      reservation: res.reservation,
      ...(res.allowed === undefined ? {} : { allowed: res.allowed }),
      ...(res.via === undefined ? {} : { via: res.via }),
      ledgerEvent: res.ledgerEvent
        ? { seq: res.ledgerEvent.seq, deltaSummary: res.ledgerEvent.deltaSummary, hash: res.ledgerEvent.hash }
        : null,
    },
    ...(res.ok ? {} : { error: res.error, errorCode: res.errorCode }),
  }
}

export function actFamilies() {
  return { types: ACT_TYPES, family: ACT_FAMILY, descriptions: FAMILY_DESCRIPTION }
}
