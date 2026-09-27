// MCP Tool Registry
//
// This is the tool surface NeuralOps exposes to AI workers via MCP.
// Each entry mirrors a NeuralOps MCP tool an agent (Claude Code, Codex, etc.)
// would call. The handlers route into the Coordination Core (task-manager +
// authority + context).
//
// In V0.1 these are invoked via HTTP REST. Wrapping them with a real MCP
// transport (stdio / streamable-HTTP via @modelcontextprotocol/sdk) is a
// thin adapter — the handlers don't change.

import { processAct } from '../engines/task-manager.js'
import {
  getCompactedContext,
  getFullContext,
  getContextComparison,
  getEvidenceById,
  getDecisionById,
  getOriginalContext,
} from '../engines/context.js'
import { store } from '../state/store.js'
import type { ActInput } from '../protocol/envelope.js'
import { ACT_TYPES, ACT_FAMILY, FAMILY_DESCRIPTION } from '../protocol/act-types.js'

export interface ToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export const TOOL_DEFS: ToolDef[] = [
  {
    name: 'neuralops_register',
    description:
      'Register an existing AI worker into the workspace. The worker keeps its own runtime; NeuralOps only tracks it for coordination.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        model: { type: 'string', enum: ['Claude', 'Codex', 'Gemini', 'Qwen', 'GPT', 'Custom'] },
        role: { type: 'string' },
        reportsTo: { type: 'string' },
      },
      required: ['name', 'model', 'role'],
    },
  },
  {
    name: 'neuralops_workspace',
    description: 'Get the current workspace, its agents, and open tasks.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'neuralops_tasks',
    description: 'List tasks (optionally filtered by status).',
    inputSchema: {
      type: 'object',
      properties: { status: { type: 'string' } },
    },
  },
  {
    name: 'neuralops_claim',
    description: 'Claim an unclaimed task. Mutates task.assignee + task.status.',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' }, note: { type: 'string' } },
      required: ['taskId'],
    },
  },
  {
    name: 'neuralops_complete',
    description:
      'Mark a task complete. If the completion involves a production deploy, authority approval is required first.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        summary: { type: 'string' },
        resultRef: { type: 'string' },
        evidence: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              summary: { type: 'string' },
              ref: { type: 'string' },
            },
          },
        },
      },
      required: ['taskId', 'summary'],
    },
  },
  {
    name: 'neuralops_handoff',
    description: 'Hand a task to another agent with an intent (implement/review/test).',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' }, to: { type: 'string' }, intent: { type: 'string' } },
      required: ['taskId', 'to', 'intent'],
    },
  },
  {
    name: 'neuralops_accept_handoff',
    description: 'Accept a pending handoff. Transfers ownership.',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' } },
      required: ['taskId'],
    },
  },
  {
    name: 'neuralops_decision',
    description: 'Record a durable decision on a task.',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' }, text: { type: 'string' }, rationale: { type: 'string' } },
      required: ['taskId', 'text'],
    },
  },
  {
    name: 'neuralops_evidence',
    description: 'Record evidence (test result, log, url) on a task.',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' }, type: { type: 'string' }, summary: { type: 'string' }, ref: { type: 'string' } },
      required: ['taskId', 'type', 'summary', 'ref'],
    },
  },
  {
    name: 'neuralops_request_approval',
    description: 'Request approval for a constrained action (e.g. deploy to production).',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' }, action: { type: 'string' }, scope: { type: 'string' } },
      required: ['action', 'scope'],
    },
  },
  {
    name: 'neuralops_authorize',
    description: 'Approve a pending approval request.',
    inputSchema: {
      type: 'object',
      properties: { approvalId: { type: 'string' } },
      required: ['approvalId'],
    },
  },
  {
    name: 'neuralops_deny',
    description: 'Deny a pending approval request.',
    inputSchema: {
      type: 'object',
      properties: { approvalId: { type: 'string' }, reason: { type: 'string' } },
      required: ['approvalId', 'reason'],
    },
  },
  {
    name: 'neuralops_escalate',
    description: 'Escalate a blocked task to another agent.',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' }, reason: { type: 'string' }, to: { type: 'string' } },
      required: ['taskId', 'reason', 'to'],
    },
  },
  {
    name: 'neuralops_get_task_context',
    description:
      'Retrieve the COMPACTED task context — a small structured snapshot (OBJECTIVE/COMPLETED/DECISIONS/CONSTRAINTS/EVIDENCE/OPEN/NEXT). This is the value of NeuralOps: shared knowledge without shared token waste.',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' } },
      required: ['taskId'],
    },
  },
  {
    name: 'neuralops_get_evidence',
    description: 'On-demand deep retrieval of a specific evidence record.',
    inputSchema: {
      type: 'object',
      properties: { evidenceId: { type: 'string' } },
      required: ['evidenceId'],
    },
  },
  {
    name: 'neuralops_get_decision',
    description: 'On-demand deep retrieval of a specific decision.',
    inputSchema: {
      type: 'object',
      properties: { decisionId: { type: 'string' } },
      required: ['decisionId'],
    },
  },
]

// Dispatcher: name + args → result. Used by both the HTTP API and (future) MCP transport.
export function callTool(
  name: string,
  args: Record<string, unknown> = {},
  callerAgent: string
): { ok: boolean; result: unknown; error?: string } {
  try {
    switch (name) {
      case 'neuralops_register':
        return registerAgent(args, callerAgent)
      case 'neuralops_workspace':
        return { ok: true, result: getWorkspaceState() }
      case 'neuralops_tasks':
        return { ok: true, result: getTasks(args.status as string | undefined) }
      case 'neuralops_get_task_context':
        return { ok: true, result: getCompactedContext(args.taskId as string) }
      case 'neuralops_get_evidence':
        return { ok: true, result: getEvidenceById(args.evidenceId as string) }
      case 'neuralops_get_decision':
        return { ok: true, result: getDecisionById(args.decisionId as string) }
      default:
        // Treat as an act submission.
        return submitActByName(name, args, callerAgent)
    }
  } catch (e) {
    return { ok: false, result: null, error: (e as Error).message }
  }
}

function registerAgent(args: Record<string, unknown>, callerAgent: string) {
  const agent = {
    id: callerAgent,
    workspaceId: 'ws_engineering',
    name: String(args.name),
    model: String(args.model || 'Custom'),
    role: String(args.role),
    reportsTo: (args.reportsTo as string) || null,
    authority: [],
    status: 'online' as const,
    subscriptions: ['workspace'],
    createdAt: new Date().toISOString(),
  }
  store.agents.set(agent.id, agent)
  return { ok: true, result: agent }
}

function getWorkspaceState() {
  return {
    workspaces: Array.from(store.workspaces.values()),
    agents: Array.from(store.agents.values()),
    tasks: Array.from(store.tasks.values()),
    pendingApprovals: Array.from(store.approvals.values()).filter((a) => a.status === 'pending'),
  }
}

function getTasks(status?: string) {
  const all = Array.from(store.tasks.values())
  return status ? all.filter((t) => t.status === status) : all
}

// Map a tool name to an Act envelope + dispatch through the task-manager.
function submitActByName(
  name: string,
  args: Record<string, unknown>,
  callerAgent: string
): { ok: boolean; result: unknown; error?: string } {
  const map: Record<string, { type: ActInput['type']; build: () => ActInput }> = {
    neuralops_claim: {
      type: 'claim',
      build: () => ({
        type: 'claim',
        from: callerAgent,
        payload: { taskId: args.taskId, note: args.note },
      }),
    },
    neuralops_complete: {
      type: 'complete',
      build: () => ({
        type: 'complete',
        from: callerAgent,
        payload: {
          taskId: args.taskId,
          summary: args.summary,
          resultRef: args.resultRef,
          evidence: args.evidence,
        },
      }),
    },
    neuralops_handoff: {
      type: 'handoff',
      build: () => ({
        type: 'handoff',
        from: callerAgent,
        payload: { taskId: args.taskId, to: args.to, intent: args.intent },
      }),
    },
    neuralops_accept_handoff: {
      type: 'accept_handoff',
      build: () => ({
        type: 'accept_handoff',
        from: callerAgent,
        payload: { taskId: args.taskId },
      }),
    },
    neuralops_decision: {
      type: 'decision',
      build: () => ({
        type: 'decision',
        from: callerAgent,
        payload: { taskId: args.taskId, text: args.text, rationale: args.rationale },
      }),
    },
    neuralops_evidence: {
      type: 'evidence',
      build: () => ({
        type: 'evidence',
        from: callerAgent,
        payload: {
          taskId: args.taskId,
          type: args.type,
          summary: args.summary,
          ref: args.ref,
        },
      }),
    },
    neuralops_request_approval: {
      type: 'request_approval',
      build: () => ({
        type: 'request_approval',
        from: callerAgent,
        payload: { taskId: args.taskId, action: args.action, scope: args.scope },
      }),
    },
    neuralops_authorize: {
      type: 'authorize',
      build: () => ({
        type: 'authorize',
        from: callerAgent,
        payload: { approvalId: args.approvalId },
      }),
    },
    neuralops_deny: {
      type: 'deny',
      build: () => ({
        type: 'deny',
        from: callerAgent,
        payload: { approvalId: args.approvalId, reason: args.reason },
      }),
    },
    neuralops_escalate: {
      type: 'escalate',
      build: () => ({
        type: 'escalate',
        from: callerAgent,
        payload: { taskId: args.taskId, reason: args.reason, to: args.to },
      }),
    },
  }
  const entry = map[name]
  if (!entry) return { ok: false, result: null, error: `Unknown tool: ${name}` }
  const res = processAct(entry.build())
  return {
    ok: res.ok,
    result: {
      actId: res.act.id,
      stateChanged: res.stateChanged,
      approval: res.approval,
      task: res.task,
      error: res.error,
    },
    error: res.error,
  }
}

export function actFamilies() {
  return {
    types: ACT_TYPES,
    family: ACT_FAMILY,
    descriptions: FAMILY_DESCRIPTION,
  }
}

export { getCompactedContext, getFullContext, getContextComparison, getOriginalContext, getEvidenceById, getDecisionById }
