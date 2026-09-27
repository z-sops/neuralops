# NeuralOps MCP — Engines

> V0.1.1: authority engine dobara likha gaya (policies, approver chain, veto, single-use approvals). Journal/replay engine: `17-V0.1.1-Hardening.md` §17.5.

## 6.1 Task Manager — the dispatcher

Yeh heart hai. `processAct(input)` ka flow:

```
1. Finalize envelope (assign id, timestamp, seq)
2. Normalize (promote payload.taskId → act.taskId, default references[])
3. Validate typed payload against zod schema
4. Look up current state (BEFORE snapshot)
5. Check authority (may create Approval and short-circuit)
6. Mutate state (produces AFTER)
7. Append immutable LedgerEvent capturing before → after delta
8. Return ActResult { ok, act, ledgerEvent, approval?, stateChanged, task? }
```

Har act type ka apna handler hai (`handleClaim`, `handleComplete`, `handleHandoff`, ...).

### ActResult return shape

```typescript
{
  ok: boolean
  act: Act
  ledgerEvent: LedgerEvent | null
  approval: Approval | null      // present if authority gate fired
  error?: string
  stateChanged: boolean          // false if approval blocked, true otherwise
  task?: Task                     // updated task (if task-related act)
}
```

### Authority check integration (in handleComplete)

V0.1.1: gate **task aur policy se** tay hota hai, agent ke bheje hue lafzon se nahi.

```typescript
// Scopes this completion touches:
//   task.gates (e.g. complete/production)  +  payload.scope  +
//   inferred "production" (deploy evidence / prod:// resultRef) — inference can only ADD
for (const scope of completionScopes(task, payload)) {
  if (hasAuthority(actor, 'complete', scope)) continue              // direct grant
  const granted = findConsumableApproval(actor, 'complete', scope, task.id)
  if (granted) { toConsume.push(granted); continue }                 // single-use, task-bound
  const pending = findPendingApproval(actor, 'complete', scope, task.id)
  if (pending) return { stateChanged: false, approval: pending }     // no approval spam
  const approval = createApproval(...)                               // approver from policy → else manager
  record ledger: "tried to complete … → approval required"
  return { stateChanged: false, approval, ledgerEvent }
}
// …complete, then consumeApproval(a, act.id) for each used approval
```

Pehle har precondition check hoti hai, phir mutation. Reject hua act koi trace nahi chhodta (counters bhi restore).

## 6.2 Authority Engine

### Direct grants — `hasAuthority(agentId, action, scope)`
`agent.authority` mein match (wildcards `*` honoured). V0.1 mein CEO ka `*/*` kaam nahi karta tha, ab karta hai.

### Gatekeeping — policies
`store.policies`: `{ action, scope, approver }`. `policyFor(action, scope)` sab se specific match deta hai. Policy na ho to approver = requester ka `reportsTo`. Woh bhi na ho to `forbidden`.

### Kaun decide kar sakta hai — `canDecide` / `canVeto`
- **authorize:** named approver, ya approver ke upar reporting chain mein koi (`isAbove`), ya `*/*` holder.
- **deny:** upar wale sab, **ya** jiske paas `deny` authority us scope pe ho (veto).
- **Requester kabhi nahi** (separation of duties).

### Single-use approvals
- `findConsumableApproval(requestedBy, action, scope, taskId)`: sirf `approved`, `consumedAt === null`, **exact** taskId match.
- `consumeApproval(a, actId, at)`: `consumedAt`, `consumedBy` set.
- V0.1 ka `hasApprovedApproval` approval kabhi consume nahi karta tha, aur `taskId === null` pe kisi bhi task se match ho jata tha.

### Approval lifecycle
- `createApproval({ requestedBy, action, scope, taskId, references, at })` → pending
- `authorize(approvalId, decidedBy, at)` → `canDecide` check ke baad approved
- `deny(approvalId, decidedBy, reason, at)` → `canDecide || canVeto` ke baad denied

## 6.3 Context Engine — **THE KILLER FEATURE**

Yeh sabse important engine hai. Do versions of context provide karta hai:

### `getCompactedContext(taskId)` — what agents actually receive

Structured snapshot:

```
OBJECTIVE
Build authentication module for the API gateway...

COMPLETED
- Backend implementation complete.
- 42 tests passed.
- Handoff to Backend (implement) — accepted

DECISIONS
- [decision_0001] Session-based auth selected (by agent.architect)
- [decision_0002] Passwords hashed with argon2id (by agent.architect)

CONSTRAINTS
- No production modification until security review is complete.
- Must use the existing session store (Redis).
- Passwords must be hashed with argon2.

EVIDENCE
- [evidence_0001] (result) Backend impl complete → repo://...
- [evidence_0002] (test) 42 tests passed → ci://pipeline/8421

OPEN
- Security review pending.
- Rate limiting on login endpoint not yet decided.

NEXT
- Security agent must review the implementation.
- QA must write integration tests for session expiry.

OWNER: agent.backend   STATUS: in_progress
```

**~400 tokens.**

### `getFullContext(taskId)` — what would be transferred WITHOUT compaction

```
=== FULL RAW CONTEXT ===
--- TASK --- (full Task object, JSON)
--- DECISIONS (N) --- (full Decision objects, JSON)
--- EVIDENCE (N) --- (full Evidence objects, JSON)
--- ACT LOG (N events) --- (full LedgerEvent stream, JSON)
```

**~1,363 tokens.**

### `getContextComparison(taskId)`

Returns dono + reduction %:

```json
{
  "fullTokens": 1363,
  "compactedTokens": 398,
  "reductionPct": 71,
  "fullFormatted": "...",
  "compactedFormatted": "..."
}
```

### On-demand deep retrieval — lazy loading

Agar agent ko sirf ek specific evidence chahiye, woh full task context nahi mangwata:

```typescript
get_evidence("evidence_0001")   // sirf yeh evidence ka full record
get_decision("decision_0002")    // sirf yeh decision ka full record
get_original_context("act_42")   // kis specific act ka original envelope
```

**Yahi NeuralOps ki asli value:**

> Shared knowledge, without shared token waste.
> Sirf wahi data travel karta hai jo zaroori hai.
> Deeper detail on-demand available hai.

## 6.4 Token estimation

Abhi chars/4 heuristic use hota hai (1 token ≈ 4 chars English/code ke liye).

```typescript
export function estimateTokens(value: unknown): number {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  return Math.max(1, Math.ceil(text.length / 4))
}
```

Future mein: per-model tokenizer (Claude, GPT-4, Gemini — sabke alag tokenizers).

## 6.5 Compaction savings — compounding effect

```
Bina NeuralOps — 4 agents, har ek doosre ke 3 contexts read karta hai:
  Agent 1: 0 extra tokens
  Agent 2: 20k (Agent 1 ka context)
  Agent 3: 40k (Agent 1 + 2 ka context)
  Agent 4: 60k (Agent 1 + 2 + 3 ka context)
  ─────────────────────────────
  Total: 120k tokens waste

NeuralOps ke saath — har agent sirf compacted context leta hai:
  Agent 1: 0
  Agent 2: 1.8k
  Agent 3: 3.6k
  Agent 4: 5.4k
  ─────────────────────────────
  Total: 10.8k tokens
```

**~11x kam tokens.** Aur yeh sirf 4 agents ka scenario hai. 20 agents ho to aur zyada.
