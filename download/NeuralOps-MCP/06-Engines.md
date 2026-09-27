# NeuralOps MCP — Engines

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

`handleComplete` ke andar — agar evidence mein type="deploy" hai ya resultRef mein "production" hai:

```typescript
if (isDeploy && !hasAuthority(actor, 'complete', 'production')
            && !hasApprovedApproval(actor, 'complete', 'production', taskId)) {
    // CREATE PENDING APPROVAL — DO NOT COMPLETE
    approval = requestApproval(actor, 'complete', 'production', taskId)
    record ledger: "requested approval"
    return { ok: true, stateChanged: false, approval }
}
```

Yaani backend agent production deploy nahi kar sakta bina architect approval ke. **Authority engine enforce karta hai, gentleman's agreement nahi.**

## 6.2 Authority Engine

3 core functions:

### `hasAuthority(agentId, action, scope)` — direct grant check
Agent ke authority table mein action/scope match ho aur `requiresApproval: false` ho.

```typescript
export function hasAuthority(agentId, action, scope): boolean {
  const agent = store.agents.get(agentId)
  if (!agent) return false
  return agent.authority.some(
    (s) => s.action === action
       && (s.scope === scope || s.scope === '*')
       && !s.requiresApproval
  )
}
```

### `approvalRequired(agentId, action, scope)` — gatekeeping check
Agent ke paas direct authority nahi. System mein kahin gatekeeping rule hai (`requiresApproval: true`) jiska approver defined hai.

```typescript
export function approvalRequired(agentId, action, scope) {
  // Direct grant → no approval needed.
  if (hasAuthority(agentId, action, scope)) {
    return { required: false, approver: null }
  }
  // Scan every agent's authority table for a gatekeeping rule
  for (const candidate of store.agents.values()) {
    for (const rule of candidate.authority) {
      if (rule.action === action
       && (rule.scope === scope || rule.scope === '*')
       && rule.requiresApproval) {
        return { required: true, approver: rule.approver }
      }
    }
  }
  return { required: false, approver: null }
}
```

### `hasApprovedApproval(agentId, action, scope, taskId)` — flow continuation
Pehle request_approval karke approval li, fir authorize hua. Ab dobara same action kar sakta hai.

```typescript
export function hasApprovedApproval(agentId, action, scope, taskId): boolean {
  for (const a of store.approvals.values()) {
    if (a.requestedBy === agentId
     && a.action === action
     && (a.scope === scope || a.scope === '*')
     && a.status === 'approved'
     && (taskId === null || a.taskId === taskId || a.taskId === null)) {
      return true
    }
  }
  return false
}
```

### Approval lifecycle functions

- `requestApproval(requestedBy, action, scope, taskId, references)` → creates pending Approval
- `authorize(approvalId, decidedBy)` → marks approval as approved
- `deny(approvalId, decidedBy, reason)` → marks approval as denied

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
