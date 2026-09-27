# NeuralOps MCP — Coordination Protocol

## 4.1 Core principle

> **Acts mutate state. Messages do not become the state.**

Yaani — agent sirf "complete task 42" bolta hai. NeuralOps internally decide karta hai:
- BEFORE: status = in_progress
- ACT: complete(task_42)
- AFTER: status = completed, completed_by = Agent_A, result_ref = ...

**State aur message alag hain.** Yeh discipline kaam ka hai.

## 4.2 The Act envelope

Har coordination operation ek typed envelope mein wrapped hota hai:

```json
{
  "id": "act_123",                    // server-assigned if absent
  "type": "handoff",                  // one of 22 types
  "from": "agent.architect",          // caller agent id
  "to": "agent.backend",             // target (agent / role / task / workspace)
  "taskId": "task_42",               // optional task reference
  "intent": "implement",             // human-readable intent
  "references": [                    // links to durable artifacts
    "decision:D7",
    "evidence:E12"
  ],
  "payload": {                       // SMALL typed payload
    "taskId": "task_42",
    "to": "agent.backend"
  },
  "authorityRef": "authority:A9",    // optional approval link
  "ttl": 600,                        // optional expiry (seconds)
  "timestamp": "...",
  "seq": 42                          // monotonic ledger order
}
```

**Important:** `payload` deliberately small hai. Rich state Coordination Core mein rehta hai.

## 4.3 6 Act Families — 22 Act Types

### Family 1: TASK (emerald) — Lifecycle mutations

| Act | Purpose | Payload |
|-----|---------|---------|
| `claim` | Agent takes ownership of unclaimed task | `{taskId, note?}` |
| `release` | Agent gives up task (with reason) | `{taskId, reason}` |
| `complete` | Mark task complete (may trigger approval) | `{taskId, summary, resultRef?, evidence?[]}` |
| `block` | Task is blocked (with reason) | `{taskId, reason}` |
| `status` | Progress update | `{taskId, progress (0-100), eta?, note?}` |

### Family 2: HANDOFF (amber) — Transfer ownership

| Act | Purpose | Payload |
|-----|---------|---------|
| `handoff` | Current owner transfers task to another agent with intent | `{taskId, to, intent}` |
| `accept_handoff` | Receiver accepts pending handoff → ownership transfers | `{taskId}` |
| `reject_handoff` | Receiver rejects pending handoff → stays with current owner | `{taskId, reason}` |

### Family 3: INFORMATION (sky) — Durable facts

| Act | Purpose | Payload |
|-----|---------|---------|
| `evidence` | Record evidence (test result, log, URL, screenshot ref) | `{taskId, type, summary, ref}` |
| `decision` | Record a durable decision | `{taskId, text, rationale?}` |
| `update` | Update task field (objective / constraints / openItems / nextSteps) | `{taskId, field, value}` |

### Family 4: CONVERSATION (violet) — Short, tagged exchanges

| Act | Purpose | Payload |
|-----|---------|---------|
| `question` | Ask another agent, always referencing shared state | `{to, about, contextRef?, taskId?}` |
| `answer` | Answer a specific question | `{questionId, payload}` |
| `proposal` | Propose something to another agent | `{to, what, why, taskId?}` |
| `counter` | Counter a proposal | `{proposalId, alternative}` |

### Family 5: AUTHORITY (rose) — Audit-able workflow

| Act | Purpose | Payload |
|-----|---------|---------|
| `request_approval` | Request approval for constrained action | `{taskId?, action, scope}` |
| `authorize` | Approve a pending request | `{approvalId}` |
| `deny` | Deny a pending request | `{approvalId, reason}` |
| `escalate` | Escalate blocked task to higher authority | `{taskId, reason, to}` |

### Family 6: LIFECYCLE (slate) — Subscription signals

| Act | Purpose | Payload |
|-----|---------|---------|
| `subscribe` | Subscribe to task events | `{taskId?, scope?}` |
| `unsubscribe` | Unsubscribe | `{taskId?, scope?}` |
| `ack` | Acknowledge a received act | `{actId}` |

## 4.4 Conversation rule (softened, production-realistic)

Original (hard rule): "Har conversation ko ledger artifact produce karna chahiye."

**Refined (V0.1):**

> **Every coordination session must either produce a durable state change OR explicitly terminate as non-actionable.**

Yaani — agar agent ne question poocha "Is API available?" aur jawab "Yes" mila, aur yeh info already ledger mein hai, to artificial artifact banane ki zaroorat nahi. Conversation expire ho sakti hai.

```
Conversation
     │
     ├── creates decision ──────► Ledger (durable)
     ├── creates evidence ──────► Ledger (durable)
     ├── creates task ───────────► Ledger (durable)
     ├── changes state ──────────► Ledger (durable)
     └── no durable consequence ► discard/expire (no overhead)
```

## 4.5 Topology — kaun sunta hai

Broadcast nahi (har agent ko har message = token waste). Pure P2P bhi nahi (coordination lost). Sahi model:

```
msg(to: task#123)         → task 123 watch karne wale agents
msg(to: role:qa)          → saare QA role agents
msg(to: agent:claude-1)   → direct
msg(to: workspace)        → announcement, rare
```

Most messages **task-scoped** hote hain. Agent sirf un tasks ke messages sunta hai jisne `subscribe` kiya ya `claim` kiya.

## 4.6 The killer design implication

```
   MESSAGING LAYER  →  THIN (typed acts, references only)
   STATE LAYER      →  RICH (full task state, decisions, evidence)
```

**Agar agents ko zyada baat karni pad rahi hai, matlab state layer fail ho gaya.**

## 4.7 Messaging layer design rules

```
1. Typed envelopes  (saare acts enumerated ho)
2. Token caps       (per-message payload limit, default ~500 tokens)
3. Reference-first  (jo ledger mein hai, woh dobara mat bhejo)
```

Agar kisi agent ne lambe message bhej diya, NeuralOps usse reject ya auto-compact kar sakta hai reference ke saath. Yeh enforceable rule hai, gentleman's agreement nahi.

## 4.8 Compaction as state-delta, not message-passing

```
Agent A:  "complete task 42, summary S, evidence E12"
            ↓
Agent B:  "get_task_context(42)"
            ↓
          [OBJECTIVE / COMPLETED / DECISIONS / EVIDENCE / OPEN / NEXT]
            ↓
Agent B:  "claim next_task"
```

Poora handoff 2 typed acts mein ho gaya. Zero conversation, full coordination.

## 4.9 Edge case: freeform brainstorming

Yeh weakest case hai. Do agents milkar ideate karein — yeh demo mein accha lagta hai, production mein rare. Lekin jab zaroorat ho, toh yeh ek **scoped session** hona chahiye:

```
session(type: brainstorm, scope: task, ttl: 10 min)
   ↓
agents exchange proposals/counter
   ↓
session close → artifacts written to ledger
   ↓
(decisions, evidence, new tasks)
```

**Killer rule:**

> **Har conversation ko ledger artifact produce karna chahiye.**
> Agar kisi conversation ne koi decision, evidence ya task nahi banaya — woh conversation wasted thi.

## 4.10 State Delta as first-class concept

Agents ko sirf:

```
"complete task 42"
```

nahi bhejna chahiye.

NeuralOps internally determine kare:

```
BEFORE
task.status = in_progress

ACT
complete(task_42)

AFTER
task.status = completed
task.completed_by = agent_A
task.result_ref = result_91
task.evidence = [E12]
```

Yaani **acts mutate state; messages don't become the state.**
