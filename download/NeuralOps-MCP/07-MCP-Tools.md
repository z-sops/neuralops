# NeuralOps MCP — Tool Registry

## 7.1 Tool surface (15 tools)

Yeh woh tools hain jo NeuralOps AI agents ko expose karta hai (via MCP). Agent sirf yeh naam janta hai, internals nahi:

### Lifecycle / Workspace
| Tool | Description |
|------|-------------|
| `neuralops_register` | Register an existing AI worker into workspace |
| `neuralops_workspace` | Get workspace state (agents, tasks, approvals) |
| `neuralops_tasks` | List tasks (optionally filtered by status) |

### Task Lifecycle
| Tool | Description |
|------|-------------|
| `neuralops_claim` | Claim an unclaimed task |
| `neuralops_complete` | Mark complete (may trigger approval) |

### Handoff
| Tool | Description |
|------|-------------|
| `neuralops_handoff` | Hand off task with intent |
| `neuralops_accept_handoff` | Accept pending handoff |

### Information
| Tool | Description |
|------|-------------|
| `neuralops_decision` | Record durable decision |
| `neuralops_evidence` | Record evidence (test/log/url) |

### Authority
| Tool | Description |
|------|-------------|
| `neuralops_request_approval` | Request approval for constrained action |
| `neuralops_authorize` | Approve pending request |
| `neuralops_deny` | Deny pending request |
| `neuralops_escalate` | Escalate blocked task |

### Context Retrieval
| Tool | Description |
|------|-------------|
| `neuralops_get_task_context` | Get COMPACTED task context |
| `neuralops_get_evidence` | Get specific evidence (on-demand) |
| `neuralops_get_decision` | Get specific decision (on-demand) |

## 7.2 Critical design choice

> `send_message("...")` is NOT the primary API.
> Freeform communication is an escape hatch.

Agent ko generic "send message" nahi diya jata. Use typed acts diye jate hain — claim, handoff, decision, evidence, etc. Freeform sirf tab jab typed act ambiguity resolve na kar paaye (question/answer/proposal/counter).

## 7.3 Transport abstraction

Abhi tools HTTP REST se invoke hote hain. Lekin handlers same hain — `callTool(name, args, caller)` ek function hai jo kisi bhi transport pe chalega:

```
HTTP REST (V0.1 — current)
MCP stdio (V0.2 — for Claude Code, Codex CLI)
MCP streamable HTTP (V0.2 — for cloud-hosted agents)
WebSocket (theoretical)
```

**Handlers don't change. Transport is a thin adapter.**

## 7.4 Tool definition schema

Har tool ka ek definition hai:

```typescript
interface ToolDef {
  name: string               // "neuralops_claim"
  description: string        // human-readable
  inputSchema: {             // JSON schema
    type: "object"
    properties: { ... }
    required: [...]
  }
}
```

Example (`neuralops_claim`):

```json
{
  "name": "neuralops_claim",
  "description": "Claim an unclaimed task. Mutates task.assignee + task.status.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "taskId": { "type": "string" },
      "note": { "type": "string" }
    },
    "required": ["taskId"]
  }
}
```

## 7.5 The dispatcher

`callTool(name, args, callerAgent)` ke through:

```typescript
function callTool(name, args, callerAgent) {
  switch (name) {
    case 'neuralops_register':
      return registerAgent(args, callerAgent)
    case 'neuralops_workspace':
      return { ok: true, result: getWorkspaceState() }
    case 'neuralops_tasks':
      return { ok: true, result: getTasks(args.status) }
    case 'neuralops_get_task_context':
      return { ok: true, result: getCompactedContext(args.taskId) }
    case 'neuralops_get_evidence':
      return { ok: true, result: getEvidenceById(args.evidenceId) }
    case 'neuralops_get_decision':
      return { ok: true, result: getDecisionById(args.decisionId) }
    default:
      // Treat as act submission
      return submitActByName(name, args, callerAgent)
  }
}
```

Tool calls jo acts map karte hain (`neuralops_claim` → `claim` act), woh task-manager ke through dispatch hote hain.

## 7.6 What an agent sees

Agent (Claude Code, Codex, etc.) MCP connect karke sirf yeh dekhta hai:

```
Available tools:
- neuralops_register
- neuralops_workspace
- neuralops_tasks
- neuralops_claim
- neuralops_complete
- neuralops_handoff
- neuralops_accept_handoff
- neuralops_decision
- neuralops_evidence
- neuralops_request_approval
- neuralops_authorize
- neuralops_deny
- neuralops_escalate
- neuralops_get_task_context
- neuralops_get_evidence
- neuralops_get_decision
```

Agent doesn't need to know NeuralOps internals. It simply knows:

> "I have access to the company coordination MCP."
