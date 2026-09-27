# NeuralOps MCP — Demo Seed (Engineering Workspace)

## 9.1 The narrative

> "Customer already has Claude Code + Codex + Gemini + Qwen running. They install NeuralOps MCP, connect workspace, register these 4 agents + a CEO agent. Now their existing AI workforce is coordinated."

## 9.2 Pre-seeded agents

| ID | Name | Model | Role | Reports To | Authority |
|----|------|-------|------|------------|-----------|
| `agent.ceo` | CEO | Claude | ceo | (none) | wildcard: action=*, scope=* |
| `agent.architect` | Architect | Claude | architect | CEO | direct: deploy/production, complete/production, govern/*; named approver in policies |
| `agent.backend` | Backend Dev | Codex | backend | Architect | none (must request approval) |
| `agent.qa` | QA Engineer | Gemini | qa | Architect | none |
| `agent.security` | Security | Qwen | security | CEO | veto: deny/production |

## 9.3 Org hierarchy

```
CEO (Claude)
  ├── wildcard authority: action="*", scope="*", no approval needed
  │
  └── Architect (Claude)
        ├── direct: deploy/production, complete/production, govern/*
        ├── named approver in workspace policies:
        │     complete/production → agent.architect
        │     deploy/production   → agent.architect
        │
        ├── Backend (Codex) — no direct authority
        │   must request_approval for production deploy
        │
        └── QA (Gemini) — no direct authority

Security (Qwen) — reports directly to CEO (not Architect)
  ├── veto: deny/production (can deny any production approval, cannot authorize)

task_42 gates: complete/production  (gate task pe hai — agent ke lafzon pe nahi)
```

## 9.4 Pre-seeded tasks

### task_42 — "Build authentication module" (rich history)

- **Status:** in_progress
- **Owner:** Backend (claimed after Architect's handoff)
- **Progress:** 65%
- **Objective:** "Implement session-based authentication for the API gateway. Must support login, logout, session validation, role checks. No production modification until security review complete."
- **Decisions (2):**
  - Session-based auth selected over JWT (rationale: existing Redis infra)
  - Passwords hashed with argon2id (OWASP recommendation)
- **Evidence (2):**
  - Backend implementation complete → repo://api-gateway/src/auth/session.ts
  - 42 unit tests passed → ci://pipeline/8421
- **Constraints:** No production deploy until security review; use Redis session store; argon2 for passwords
- **Open:** Security review pending; rate limiting undecided
- **Next:** Security must review; QA must write integration tests for session expiry
- **Handoff history:** Architect → Backend (intent: implement, accepted)
- **Seeded ledger events (6):** scoped, handoff, status updates, evidence recording

### task_43 — "Security review of auth module" (unclaimed)

- **Status:** unclaimed
- **Objective:** Review task_42 implementation for vulnerabilities (session fixation, CSRF, insecure cookie flags, timing attacks). Block deploy if critical issues found.
- **Constraint:** Must run before any production deploy of task_42

### task_44 — "Set up CI pipeline for auth module" (blocked)

- **Status:** blocked
- **Owner:** QA
- **Blocked reason:** "Waiting on DevOps runner image (external dependency)"
- **Open:** DevOps hasn't provided runner image
- **Next:** Escalate to Architect or CEO if DevOps doesn't respond

## 9.5 The golden path demo scenario

V0.1.1 mein 10 scenario buttons. Golden path:

```
1. Security → claim task_43                         → task_43 in_progress
2. Backend  → handoff task_42 to Security (review)  → task_42 handoff_pending
3. Security → accept_handoff task_42                → Security owns task_42
4. Security → evidence (review passed)              → evidence_0003
5. Security → complete task_42 (deploy)             → GATE: task_42 gated complete/production,
                                                      Security has no direct authority
                                                      → approval_0001 pending (approver: Architect)
6. Security → authorize approval_0001 (its own)     → 403 forbidden (separation of duties)
7. Architect → authorize approval_0001              → approved
8. Security → complete task_42 (deploy)             → completed; approval_0001 consumed (single-use)
9. QA → escalate task_44 to Architect               → blocked, escalatedTo = Architect
10. Architect → decision on task_42                 → decision_0003
```

V0.1 mein step 2 ke baad Backend ne pending handoff ke dauran hi task complete kar diya tha. Yeh ab `409 conflict` hai, is liye Security pehle accept karta hai.

## 9.6 Final state after golden path

```
- task_42: completed, 100%
- task_43: in_progress (Security)
- task_44: blocked, escalatedTo = agent.architect (Architect claim karke le sakta hai)
- approval_0001: approved, consumedBy = the completing act
- Ledger: 6 seeded + golden-path events, hash chain valid (/api/integrity)
- Compaction on task_42: ≈81% (chars/4 estimate)
```

## 9.7 What each step demonstrates

| Step | Demonstrates |
|------|-------------|
| 1 | Task lifecycle (claim) |
| 2–3 | Handoff protocol: offer → accept, ownership moves only on accept |
| 4 | Evidence as a deliberate act |
| 5 | **Authority gate** from task gates + policy |
| 6 | **Separation of duties**: requester cannot approve itself |
| 7 | Approver authorizes |
| 8 | **Single-use approval** consumed on completion |
| 9 | Escalation with takeover path |
| 10 | Durable decision |
| Compaction view | **Context engine**: compacted vs full (estimate) |
| Ledger | **Hash-chained audit trail** with before → after delta and `via` |
