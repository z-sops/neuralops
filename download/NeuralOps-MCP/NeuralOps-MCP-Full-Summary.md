# NeuralOps MCP — Mukammal Product Summary

> **AI Workforce Coordination Protocol**
> V0.1.3 — File reservations. Kya badla: `17-V0.1.1-Hardening.md`, `18-V0.1.2-Security.md`, `19-V0.1.3-File-Reservations.md`

---

# BHAAG 1: PRODUCT IDENTITY

## 1.1 Naam

**NeuralOps MCP — AI Workforce Coordination Protocol**

## 1.2 Positioning (3 line mein)

> NeuralOps ek aur LLM nahi hai. Ek aur agent framework nahi hai. Ek aur chatbot ya IDE nahi hai.

> NeuralOps = **coordination infrastructure for existing AI workers.**

> Customer ke paas already Claude, Codex, Gemini, Qwen, custom agents hain — woh sab NeuralOps se connect hote hain aur ek shared workplace mein aa jate hain.

## 1.3 Core bet

```
Model providers       models bechte hain, coordination nahi
Agent frameworks      ek hi stack ke andar agents, cross-framework coordination nahi
IDE vendors           dev experience, multi-agent org coordination nahi
─────────────────────────────────────────────────────────
OPEN LANE             coordination layer jo sab ke upar baithta hai
                      → NeuralOps yeh hai
```

Kisi se compete nahi karta. Sab ke upar baithta hai.

## 1.4 Killer feature

**Shared Work State with Context Compaction**

```
Agent A (20,000 tokens ka context)
    ↓
NeuralOps Context Engine
    ↓
1,800 tokens structured snapshot
    ↓
Agent B
```

Demo pe **~70–81% kam tokens** (chars/4 estimate; NeuralOps ke apne record vs compacted snapshot). Asli agent transcript pe benchmark abhi baaki hai.

---

# BHAAG 2: ASLI PROBLEM

## 2.1 Bina NeuralOps ke kya hota hai

Company ke paas 4 AI agents:

```
Claude       code likhta hai
Codex        code review karta hai
Gemini       testing karta hai
Qwen         security check karta hai
```

Har agent apne dimagh mein apna context rakhta hai. Aapas mein connect nahi.

### Result:

1. **Duplicate work** — Claude ne code likha. Codex ko nahi pata → review shuru se.
2. **Context loss** — Backend ne 1 hour pehle decide kiya "session-based auth". QA ko 2 ghante baad nahi pata → JWT testing likhta hai.
3. **Conflicting decisions** — Architect ne kaha "Redis". Backend ne "in-memory" use kiya.
4. **Agents stepping on each other** — same file edit, conflicts.
5. **Excessive token consumption** — har agent doosre ka poora context read karta hai → 20k × N.
6. **Dump file pollution** — debug.log, scratch.notes, failed-attempt.ts handoff pe travel karte hain.
7. **No human-in-loop control** — production deploy? Koi nahi puchta.
8. **No audit trail** — 3 din baad "yeh decision kaise hua?" → kisi ko nahi pata.

## 2.2 NeuralOps kya karta hai

| Problem | NeuralOps Solution |
|---------|-------------------|
| Duplicate work | Shared task state — koi dobara kaam nahi karta |
| Context loss | Durable ledger + decisions recorded |
| Conflicting decisions | Decision registry, references enforce consistency |
| Stepping on each other | Task ownership (assignee), handoff protocol |
| Token waste | Context compaction engine |
| Dump file pollution | Evidence = deliberate curated act, not raw dump |
| No human-in-loop | Authority + approval engine |
| No audit trail | Immutable append-only ledger |

---

# BHAAG 3: ARCHITECTURE

## 3.1 High-level topology

```
                 CUSTOMER'S EXISTING AI WORKFORCE

        Claude       Codex       Gemini       Qwen
          │            │            │           │
          └────────────┼────────────┼───────────┘
                       │
                       ▼
              ┌──────────────────┐
              │  NEURALOPS MCP   │
              │  (Agent Door)    │  ← MCP/HTTP/WS interface
              └────────┬─────────┘
                       │
                       ▼
              ┌──────────────────┐
              │ Coordination     │
              │ Core             │
              │                  │
              │ • Task Manager   │
              │ • Authority      │
              │ • Context Engine │
              │ • Ledger         │
              │ • State Store    │
              └────────┬─────────┘
                       │
                       ▼
              Shared Work State
              (immutable events)
```

## 3.2 Critical architectural separation

> **MCP is NOT the coordination engine.**
> **MCP is the standardized door through which existing agents access the coordination engine.**

- Coordination Core MCP se independent hai
- MCP ek transport hai: stdio server (`src/mcp/stdio.ts`) ab real hai; HTTP bhi
- Core ko kisi bhi transport pe baitha sakte hain
- Customer ke agents ko MCP support karna chahiye bas

---

# BHAAG 4: THE COORDINATION PROTOCOL

## 4.1 Core principle

> **Acts mutate state. Messages do not become the state.**

Agent sirf "complete task 42" bolta hai. NeuralOps internally:
- BEFORE: status = in_progress
- ACT: complete(task_42)
- AFTER: status = completed, completed_by = Agent_A, result_ref = ...

## 4.2 The Act envelope

```json
{
  "id": "act_123",
  "type": "handoff",
  "from": "agent.architect",
  "to": "agent.backend",
  "taskId": "task_42",
  "intent": "implement",
  "references": ["decision:D7", "evidence:E12"],
  "payload": { "taskId": "task_42", "to": "agent.backend" },
  "authorityRef": "authority:A9",
  "ttl": 600,
  "timestamp": "...",
  "seq": 42
}
```

**Important:** `payload` deliberately small hai. Rich state Coordination Core mein rehta hai.

## 4.3 6 Act Families — 25 Act Types

### Family 1: TASK (emerald) — Lifecycle mutations

| Act | Purpose | Payload |
|-----|---------|---------|
| `create_task` | Open a task (V0.1.1) | `{id?, title, objective, constraints?, openItems?, nextSteps?, gates?}` |
| `reserve_files` | Reserve files/globs (V0.1.3) | `{patterns[], taskId?, ttlSeconds?, exclusive?, reason?}` |
| `release_files` | Release reservations (V0.1.3) | `{reservationId? \| taskId? \| all?}` |
| `claim` | Agent takes ownership | `{taskId, note?}` |
| `release` | Agent gives up task | `{taskId, reason}` |
| `complete` | Mark complete (may trigger approval) | `{taskId, summary, resultRef?, evidence?[]}` |
| `block` | Task is blocked | `{taskId, reason}` |
| `status` | Progress update | `{taskId, progress (0-100), eta?, note?}` |

### Family 2: HANDOFF (amber) — Transfer ownership

| Act | Purpose | Payload |
|-----|---------|---------|
| `handoff` | Transfer task with intent | `{taskId, to, intent}` |
| `accept_handoff` | Accept pending handoff | `{taskId}` |
| `reject_handoff` | Reject pending handoff | `{taskId, reason}` |

### Family 3: INFORMATION (sky) — Durable facts

| Act | Purpose | Payload |
|-----|---------|---------|
| `evidence` | Record evidence | `{taskId, type, summary, ref}` |
| `decision` | Record durable decision | `{taskId, text, rationale?}` |
| `update` | Update task field | `{taskId, field, value}` |

### Family 4: CONVERSATION (violet) — Short, tagged exchanges

| Act | Purpose | Payload |
|-----|---------|---------|
| `question` | Ask another agent | `{to, about, contextRef?, taskId?}` |
| `answer` | Answer a question | `{questionId, payload}` |
| `proposal` | Propose something | `{to, what, why, taskId?}` |
| `counter` | Counter a proposal | `{proposalId, alternative}` |

### Family 5: AUTHORITY (rose) — Audit-able workflow

| Act | Purpose | Payload |
|-----|---------|---------|
| `request_approval` | Request approval | `{taskId?, action, scope}` |
| `authorize` | Approve pending request | `{approvalId}` |
| `deny` | Deny pending request | `{approvalId, reason}` |
| `escalate` | Escalate blocked task | `{taskId, reason, to}` |

### Family 6: LIFECYCLE (slate) — Subscription signals

| Act | Purpose | Payload |
|-----|---------|---------|
| `subscribe` | Subscribe to events | `{taskId?, scope?}` |
| `unsubscribe` | Unsubscribe | `{taskId?, scope?}` |
| `ack` | Acknowledge act | `{actId}` |

## 4.4 Conversation rule (softened, production-realistic)

> **Every coordination session must either produce a durable state change OR explicitly terminate as non-actionable.**

```
Conversation
     │
     ├── creates decision ──────► Ledger (durable)
     ├── creates evidence ──────► Ledger (durable)
     ├── creates task ───────────► Ledger (durable)
     ├── changes state ──────────► Ledger (durable)
     └── no durable consequence ► discard/expire (no overhead)
```

## 4.5 The killer design implication

```
   MESSAGING LAYER  →  THIN (typed acts, references only)
   STATE LAYER      →  RICH (full task state, decisions, evidence)
```

**Agar agents ko zyada baat karni pad rahi hai, matlab state layer fail ho gaya.**

---

# BHAAG 5: STATE LAYER

## 5.1 Entities (key ones)

### Agent
```typescript
{
  id: string                  // "agent.architect"
  workspaceId: string
  name: string
  model: 'Claude'|'Codex'|'Gemini'|'Qwen'|'GPT'|'Custom'
  role: string
  reportsTo: string | null    // org hierarchy
  authority: AuthorityScope[]
  status: 'online'|'busy'|'offline'
  subscriptions: string[]
}
```

### AuthorityScope
```typescript
{
  action: string              // "deploy" | "complete" | "*"
  scope: string              // "production" | "staging" | "*"
  requiresApproval: boolean  // false = direct, true = gatekeeping
  approver: string          // agent id
}
```

### Task
```typescript
{
  id: string                 // "task_42"
  title: string
  objective: string
  status: 'unclaimed'|'in_progress'|'blocked'|'handoff_pending'|'completed'|'failed'
  assignee: string | null
  claims: ClaimRecord[]
  handoffs: HandoffRecord[]
  decisionIds: string[]
  evidenceIds: string[]
  constraints: string[]
  openItems: string[]
  nextSteps: string[]
  resultRef: string | null
  progress: number           // 0-100
  blockedReason: string | null
  pendingHandoffTo: string | null
}
```

### LedgerEvent — **SOURCE OF TRUTH**
```typescript
{
  id: string
  seq: number                // monotonic
  workspaceId: string
  actId: string
  actType: ActType           // one of 23
  via: 'token'|'impersonated'|'system'
  prevHash: string           // hash chain
  hash: string
  actor: string
  taskId: string | null
  before: Record             // snapshot BEFORE
  after: Record              // snapshot AFTER
  references: string[]
  deltaSummary: string
  timestamp: timestamp
}
```

## 5.2 Important design principle

> **Work Ledger is a VIEW. Event Stream is the SOURCE OF TRUTH.**

V0.1.1: act **journal** (`data/journal.jsonl`) source of truth hai. Boot pe replay se har view bilkul wahi banta hai (same state hash); ledger hash-chained hai; `/api/integrity` dono check karta hai. (V0.1 mein yeh claim sach nahi tha: store in-memory tha aur replay ka koi code nahi tha.)

---

# BHAAG 6: ENGINES

## 6.1 Task Manager — the dispatcher

```
processAct(input) flow:
1. Finalize envelope (assign id, timestamp, seq)
2. Normalize (promote payload.taskId → act.taskId)
3. Validate typed payload against zod schema
4. Look up current state (BEFORE snapshot)
5. Check authority (may create Approval and short-circuit)
6. Mutate state (produces AFTER)
7. Append immutable LedgerEvent capturing before → after delta
8. Return ActResult
```

## 6.2 Authority Engine

V0.1.1 model:

- **Direct grants** on agents (`*` wildcards honoured, jaise CEO `*/*`)
- **Policies** in workspace: `{action, scope, approver}`; policy na ho to requester ka manager approver
- **Task gates**: `task.gates` (e.g. `complete/production`), gate agent ke lafzon se nahi, task se aata hai
- **authorize:** named approver / upar ki reporting chain / wildcard holder, **requester kabhi nahi**
- **deny:** upar wale + `deny` veto authority (Security)
- **Single-use, task-bound approvals** (`consumedAt`, `consumedBy`)

## 6.3 Context Engine — **THE KILLER FEATURE**

### `getCompactedContext(taskId)` — what agents receive

```
OBJECTIVE
Build authentication module...

COMPLETED
- Backend implementation complete.
- 42 tests passed.

DECISIONS
- [decision_0001] Session-based auth selected (by agent.architect)
- [decision_0002] Passwords hashed with argon2id

CONSTRAINTS
- No production deploy until security review.
- Use Redis session store.

EVIDENCE
- [evidence_0001] (result) Backend impl → repo://...
- [evidence_0002] (test) 42 tests passed → ci://...

OPEN
- Security review pending.

NEXT
- Security must review.

OWNER: agent.backend   STATUS: in_progress
```

**~340 tokens** on fresh seed (estimate).

### `getFullContext(taskId)` — without compaction

Full task object + all decisions + all evidence + all act log events.

**~1,100 tokens** on fresh seed (estimate); grows with the act log.

### Reduction: **~70% (fresh seed) → ~81% (after golden path)**, chars/4 estimate

### On-demand deep retrieval

```typescript
get_evidence("evidence_0001")    // sirf yeh evidence
get_decision("decision_0002")     // sirf yeh decision
get_original_context("act_42")   // kis act ka original envelope
```

## 6.4 Compaction savings — compounding effect

```
Bina NeuralOps — 4 agents reading each other's contexts:
  Agent 1: 0
  Agent 2: 20k
  Agent 3: 40k
  Agent 4: 60k
  Total: 120k tokens waste

NeuralOps ke saath — compacted context:
  Agent 1: 0
  Agent 2: 1.8k
  Agent 3: 3.6k
  Agent 4: 5.4k
  Total: 10.8k tokens
```

**~11x kam tokens.** 20 agents ho to aur zyada.

---

# BHAAG 7: MCP TOOL REGISTRY

## 7.1 38 tools

- **13 query tools:** `neuralops_inbox` (pehle yahi), `gate_status`, `files_check`, `reservations`, `get_task_context`, `get_full_context`, `get_evidence`, `get_decision`, `get_original_context`, `whoami`, `workspace`, `tasks`, `register`
- **25 act tools:** `neuralops_<act>` har act type ke liye; optional `references[]` aur `actId` (idempotency)
- Act tool schemas usi zod schema se generate hote hain jis se dispatcher validate karta hai, is liye drift nahi hota

## 7.2 Critical design choice

> `send_message("...")` is NOT the primary API.
> Freeform communication is an escape hatch.

## 7.3 Transport

```
Agent (Claude Code / Codex / Gemini CLI) ──MCP stdio──► src/mcp/stdio.ts ──HTTP+Bearer──► Core :3031
```

`stdio.ts` stateless hai, is liye alag processes ke agents ek workspace share karte hain. Setup: `17-V0.1.1-Hardening.md` §17.7.

---

# BHAAG 8: HTTP REST API

## 8.1 GET endpoints

| Endpoint | Returns |
|----------|---------|
| `GET /api/state` | Full snapshot |
| `GET /api/agents` | All agents |
| `GET /api/tasks` | All tasks |
| `GET /api/tasks/:id` | Task + decisions + evidence + ledger |
| `GET /api/tasks/:id/context` | Compacted context |
| `GET /api/tasks/:id/context/full` | Full raw context |
| `GET /api/tasks/:id/context/comparison` | Full vs compacted + reduction % |
| `GET /api/ledger?limit=N&taskId=X` | Ledger events |
| `GET /api/approvals` | All approvals |
| `GET /api/tools` | MCP tool definitions |
| `GET /api/families` | Act type → family + color |
| `GET /api/evidence?id=X` | Specific evidence |
| `GET /api/decisions?id=X` | Specific decision |

V0.1.1 additions: `GET /api/health`, `/api/whoami`, `/api/inbox`, `/api/policies`, `/api/integrity`, `/api/demo/tokens`; `POST /api/agents`. Bearer auth; status codes 400/401/403/404/409/413.

## 8.2 POST endpoints

- `POST /api/acts` — submit any typed act
- `POST /api/tools/:toolName` — invoke MCP tool by name
- `POST /api/demo/seed` — re-seed demo
- `POST /api/demo/reset` — clear everything

## 8.3 WebSocket

Connect: `io('/?XTransformPort=3031')`

| Event | Direction | Payload |
|-------|-----------|---------|
| `state:snapshot` | server → client | full state |
| `ledger:event` | server → client | single LedgerEvent |

## 8.4 Gateway routing

```
fetch('/api/state?XTransformPort=3031')  ✅ CORRECT
fetch('http://localhost:3031/api/state')  ❌ FORBIDDEN
```

---

# BHAAG 9: DEMO SEED

## 9.1 Pre-seeded agents

| ID | Name | Model | Role | Reports To | Authority |
|----|------|-------|------|------------|-----------|
| `agent.ceo` | CEO | Claude | ceo | (none) | wildcard |
| `agent.architect` | Architect | Claude | architect | CEO | deploy/complete production + govern; policy approver |
| `agent.backend` | Backend Dev | Codex | backend | Architect | none |
| `agent.qa` | QA Engineer | Gemini | qa | Architect | none |
| `agent.security` | Security | Qwen | security | CEO | veto: deny/production |

## 9.2 Pre-seeded tasks

- **task_42** — "Build authentication module" (in_progress, 65%, 2 decisions, 2 evidence, prior handoff history, **gated complete/production**)
- **task_43** — "Security review of auth module" (unclaimed)
- **task_44** — "Set up CI pipeline" (blocked, waiting on DevOps)

## 9.3 Golden path (10 steps, V0.1.1)

```
1. Security → claim task_43                     → task_43 in_progress
2. Backend → handoff task_42 to Security        → handoff_pending
3. Security → accept_handoff task_42            → Security owns task_42
4. Security → evidence (review passed)
5. Security → complete task_42 (deploy)         → APPROVAL GATE (task gate + policy)
6. Security → authorize its own approval        → 403 (separation of duties)
7. Architect → authorize                        → approved
8. Security → complete task_42                  → completed, approval consumed
9. QA → escalate task_44 to Architect
10. Architect → decision on task_42
```

Browser-tested (Playwright): all 10 outcomes as expected; only console error = the intended 403.

---

# BHAAG 10: PROTOCOL INSPECTOR

## 10.1 What it is

> A visualization layer — NOT the product.
> Like RedisInsight or pgAdmin. Lets you SEE the protocol execute.

## 10.2 Sections

1. **Header (sticky)** — wordmark + connection pill + Reset demo + architecture strip
2. **The Workforce** — agent cards + task cards
3. **Coordination Console** — 8 scenario buttons + Pending Approvals sub-panel
4. **Shared Work State — Context Compaction** — side-by-side Full vs Compacted panels + "−N%" banner
5. **Work Ledger** — live reverse-chronological event stream with colored badges
6. **Footer (sticky bottom)** — V0.1 demo tagline + connection + port note

## 10.3 Tech stack

Next.js 16, TypeScript, shadcn/ui (New York), Tailwind 4, socket.io-client, framer-motion, sonner, lucide-react.

## 10.4 Color system (no indigo/blue)

| Family | Hue |
|--------|-----|
| task | emerald |
| handoff | amber |
| information | sky |
| conversation | violet |
| authority | rose |
| lifecycle | slate |

---

# BHAAG 11: INFRASTRUCTURE

## 11.1 Process topology

```
PID 1: tini -- /start.sh
  └── PID 2: caddy (port 81, gateway)
        ├── routes /?XTransformPort=N → localhost:N
        └── routes / → localhost:3000

PID 2617: bun run dev (port 3000)
PID 2932: bun --hot src/index.ts (port 3031)
```

## 11.2 Persistence fix

`setsid --fork` (true double-fork) → process reparents to PID 1 (tini) → survives across shell sessions.

```bash
# dev server
cd /home/z/my-project && setsid --fork bash -c 'exec bun run dev' </dev/null >>dev.log 2>&1

# mini-service
cd /home/z/my-project/mini-services/neuralops-mcp && setsid --fork bash -c 'exec bun --hot src/index.ts' </dev/null >>neuralops.log 2>&1
```

---

# BHAAG 12: REAL vs DEMO

## 12.1 What's REAL (V0.1.1, tested)

- ✅ Coordination Core: validate → check → mutate → ledger → journal; rejected acts leave no trace
- ✅ 23 typed acts (all exercised in one test)
- ✅ Authority: policies, gates, approver chain, veto, separation of duties, single-use approvals
- ✅ Bearer-token identity + secure mode
- ✅ Persistence: JSONL journal + replay on restart
- ✅ Hash-chained ledger + `/api/integrity`
- ✅ Real MCP stdio transport, 38 tools
- ✅ V0.1.3: file reservations (reserve-time conflicts, Claude Code hook on edits, git pre-commit for every agent)
- ✅ V0.1.2: gateway locked, loopback default, signed journal, token lifecycle, admin API, verified CI evidence, injection guard, rate limit
- ✅ Context compaction (estimate, labelled)
- ✅ Dashboard: browser-tested golden path

## 12.2 What's NOT YET

- ✅ External enforcement (V0.1.2): Claude Code hook + GitHub required check + verified CI evidence
- ❌ Multi-workspace / multi-tenant
- ❌ Real tokenizers (chars/4 now)
- ❌ DB-backed journal for multiple instances
- ❌ Rate limiting, cost/token tracking UI, artifact store

## 12.3 Bottom line

> **Protocol real hai, NeuralOps ke andar enforcement real hai, aur asli agents MCP se connect ho sakte hain.** Agla qadam: gate ko agent ke bahar enforce karna.

---

# BHAAG 13: ROADMAP

## V0.1.1 — Hardening (DONE)
- [x] Real MCP transport (`@modelcontextprotocol/sdk`, stdio)
- [x] Persistent journal + replay
- [x] Auth (bearer tokens, secure mode)
- [x] Conversation TTL
- [x] Replay / integrity check

## V0.2 — Real Agent Integration
- [ ] Real MCP transport (`@modelcontextprotocol/sdk`)
- [ ] Prisma-backed persistent store
- [ ] Per-model tokenizers
- [ ] Cost / token tracking dashboard
- [ ] Artifact store integration (S3)
- [ ] Conversation session scoping (TTL)
- [ ] Auth + multi-workspace

## V0.3 — Production Hardening
- [ ] Multi-tenant isolation
- [ ] RBAC
- [ ] Replay / time-travel debugging
- [ ] Webhook integrations (Slack, email)
- [ ] Metrics / observability (Prometheus)
- [ ] Audit log export

## V1.0 — Ecosystem
- [ ] Public MCP server registry (SaaS)
- [ ] Pre-built agent adapters (Claude Code, Codex, Gemini CLI, CrewAI, LangGraph)
- [ ] Custom authority templates (HIPAA, SOC2, financial)
- [ ] Marketplace for coordination patterns

---

# BHAAG 14: VERIFICATION STATUS (V0.1.1)

| Check | Result |
|-------|--------|
| Backend + frontend `tsc` | ✅ 0 errors (V0.1: 26) |
| `eslint .` | ✅ 0 errors (V0.1: 7, although docs said 0) |
| `bun test` | ✅ 122 pass / 0 fail |
| `next build` | ✅ 0 warnings |
| Browser golden path | ✅ 10/10 |
| MCP stdio, 2 agents | ✅ |
| `/api/integrity` | ✅ chainValid, replayMatches |

Details + re-verify commands: `14-Verification.md`.

---

# BHAAG 15: DESIGN PRINCIPLES

1. **Acts mutate state. Messages do not become the state.**
2. **MCP is the door, not the engine.**
3. **Payload deliberately small. Rich state lives in the core.**
4. **Files don't travel. References + summaries travel.**
5. **Evidence is a deliberate act, not automatic dump.**
6. **Shared knowledge without shared token waste.**
7. **Model-neutral.**
8. **Customer's agents stay where they are.**
9. **Every coordination session produces durable state change OR explicitly terminates.**
10. **Work Ledger is a VIEW. Event Stream is SOURCE OF TRUTH.**

---

# BHAAG 16: FILES INDEX

## Backend (mini-service)

```
mini-services/neuralops-mcp/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                          # bootstrap
    ├── protocol/
    │   ├── act-types.ts                  # 23 acts, 6 families
    │   ├── envelope.ts                   # Act envelope + zod
    │   └── payloads.ts                   # per-act payloads
    ├── state/
    │   ├── types.ts                      # entity types
    │   ├── store.ts                      # in-memory store
    │   └── token-estimate.ts             # token heuristic
    ├── engines/
    │   ├── task-manager.ts               # dispatcher
    │   ├── authority.ts                  # approval gating
    │   └── context.ts                    # compaction
    ├── mcp/
    │   └── tools.ts                      # MCP tool registry
    ├── seed/
    │   └── demo.ts                       # Engineering seed
    └── server/
        ├── http.ts                       # REST API
        └── ws.ts                         # socket.io
```

## Frontend (Next.js app)

```
src/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                          # dashboard
│   └── globals.css
├── lib/
│   ├── neuralops-types.ts
│   ├── neuralops-api.ts
│   └── utils.ts
├── hooks/
│   └── use-neuralops.ts
└── components/
    ├── inspector/
    │   ├── colors.ts
    │   ├── act-badge.tsx
    │   ├── header.tsx
    │   ├── agent-card.tsx
    │   ├── task-card.tsx
    │   ├── workforce-section.tsx
    │   ├── coordination-console.tsx
    │   ├── shared-work-state.tsx
    │   └── work-ledger.tsx
    └── ui/                               # shadcn components
```

## Documentation

```
/home/z/my-project/worklog.md            # task records
/home/z/my-project/download/NeuralOps-MCP/  # this package
```

---

# FINAL ONE-LINER

> **NeuralOps MCP V0.1.2 = a working coordination protocol for AI workers, enforced outside the model (Claude Code hook + GitHub required check): 25 typed acts (incl. file reservations), a hash-chained ledger backed by a replayable journal, an authority engine with single-use approvals that agents cannot self-grant, a real MCP stdio server with 33 tools, and context compaction (~70–81% on the demo, estimated), covered by 122 automated tests and a browser-tested golden path.**

---

**Generated:** V0.1 demo build · **Hardened:** V0.1.1
**Live demo:** Preview Panel → `/` route
**Backend:** `mini-services/neuralops-mcp/` (port 3031)
**Frontend:** `src/app/page.tsx` (port 3000, served via Caddy :81)
