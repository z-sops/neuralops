# NeuralOps MCP — State Layer

## 5.1 Entities

### Workspace
```typescript
{
  id: string                  // "ws_engineering"
  name: string               // "Engineering"
  description: string
  createdAt: timestamp
}
```

### Agent
```typescript
{
  id: string                  // "agent.architect"
  workspaceId: string
  name: string               // "Architect"
  model: 'Claude'|'Codex'|'Gemini'|'Qwen'|'GPT'|'Custom'
  role: string               // "architect" | "backend" | "qa" | ...
  reportsTo: string | null   // agent id (org hierarchy)
  authority: AuthorityScope[] // what they can do directly / approve
  status: 'online'|'busy'|'offline'
  subscriptions: string[]    // task ids | "role:qa" | "workspace"
  createdAt: timestamp
}
```

### AuthorityScope
```typescript
{
  action: string             // "deploy" | "complete" | "merge" | "delete" | "*"
  scope: string             // "production" | "staging" | "*"
  requiresApproval: boolean // false = direct grant, true = gatekeeping rule
  approver: string          // agent id (who must authorize)
}
```

### Task
```typescript
{
  id: string                 // "task_42"
  workspaceId: string
  title: string
  objective: string
  status: 'unclaimed'|'in_progress'|'blocked'|'handoff_pending'|'completed'|'failed'
  assignee: string | null    // current owner agent id
  claims: ClaimRecord[]      // history of claims
  handoffs: HandoffRecord[]  // history of handoffs (pending/accepted/rejected)
  decisionIds: string[]       // links to Decision entities
  evidenceIds: string[]       // links to Evidence entities
  constraints: string[]       // hard rules to follow
  openItems: string[]         // unresolved questions/issues
  nextSteps: string[]         // suggested next actions
  resultRef: string | null    // final artifact reference
  progress: number            // 0-100
  blockedReason: string | null
  pendingHandoffTo: string | null  // when status = handoff_pending
  createdAt: timestamp
  updatedAt: timestamp
}
```

### ClaimRecord
```typescript
{
  agentId: string
  timestamp: timestamp
  note?: string
}
```

### HandoffRecord
```typescript
{
  from: string
  to: string
  intent: string
  timestamp: timestamp
  accepted: boolean | null   // null = pending, true = accepted, false = rejected
  acceptedAt?: timestamp
  rejectedReason?: string
}
```

### Decision
```typescript
{
  id: string                 // "decision_0001"
  taskId: string
  text: string               // "Session-based auth selected"
  rationale: string | null
  decidedBy: string          // agent id
  references: string[]
  timestamp: timestamp
}
```

### Evidence
```typescript
{
  id: string                 // "evidence_0001"
  taskId: string
  type: string               // "test" | "log" | "url" | "screenshot" | "result" | "deploy" | ...
  summary: string            // human-readable
  ref: string                // pointer to raw artifact (file URL, CI link, repo path)
  producedBy: string         // agent id
  references: string[]
  timestamp: timestamp
}
```

### Approval
```typescript
{
  id: string                 // "authority_2181bxaibz3"
  workspaceId: string
  taskId: string | null
  action: string             // "complete" | "deploy" | ...
  scope: string              // "production" | "staging"
  requestedBy: string        // agent id
  approver: string           // agent id (who must decide)
  status: 'pending'|'approved'|'denied'
  decidedBy: string | null
  decidedAt: timestamp | null
  reason: string | null      // if denied
  references: string[]
  timestamp: timestamp
}
```

### Question (conversation artifact)
```typescript
{
  id: string
  taskId: string | null
  from: string
  to: string
  about: string
  contextRef: string | null
  answered: boolean
  answer: string | null
  timestamp: timestamp
}
```

### Proposal (conversation artifact)
```typescript
{
  id: string
  taskId: string | null
  from: string
  to: string
  what: string
  why: string
  countered: boolean
  counter: string | null
  timestamp: timestamp
}
```

### LedgerEvent — **SOURCE OF TRUTH**
```typescript
{
  id: string                 // "evt_xxx"
  seq: number                // monotonic sequence
  workspaceId: string
  actId: string              // which act caused this
  actType: ActType           // one of 22
  actor: string              // agent id
  taskId: string | null
  intent: string | null
  before: Record             // snapshot BEFORE mutation
  after: Record              // snapshot AFTER mutation
  references: string[]       // links to decisions/evidence
  deltaSummary: string        // human-readable one-liner
  timestamp: timestamp
}
```

## 5.2 Important design principle

> **Work Ledger is a VIEW. Event Stream is the SOURCE OF TRUTH.**

Yaani task state, decisions, evidence — yeh sab materialized views hain ek immutable event stream ke upar. Replay se pura state reconstruct ho sakta hai. Audit, time-travel, debugging — sab possible.

## 5.3 Why event-sourced design

```
Task State (materialized view)
    ↑ derived from
Event Stream (immutable log)
    ↑ produced by
Acts (typed mutations)
    ↑ triggered by
Agents (via MCP tools)
```

Benefits:
- **Audit:** Har change traceable hai
- **Replay:** Naya field add karna ho? Event stream se reconstruct karo
- **Multi-tenant isolation:** Workspace-scoped events
- **Time travel:** "Task ka state 2 ghante pehle kya tha?" → reconstruct
