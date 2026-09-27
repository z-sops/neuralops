# NeuralOps MCP — Demo Seed (Engineering Workspace)

## 9.1 The narrative

> "Customer already has Claude Code + Codex + Gemini + Qwen running. They install NeuralOps MCP, connect workspace, register these 4 agents + a CEO agent. Now their existing AI workforce is coordinated."

## 9.2 Pre-seeded agents

| ID | Name | Model | Role | Reports To | Authority |
|----|------|-------|------|------------|-----------|
| `agent.ceo` | CEO | Claude | ceo | (none) | wildcard: action=*, scope=* |
| `agent.architect` | Architect | Claude | architect | CEO | direct: deploy/production, complete/production; gatekeeper for others' production completes |
| `agent.backend` | Backend Dev | Codex | backend | Architect | none (must request approval) |
| `agent.qa` | QA Engineer | Gemini | qa | Architect | none |
| `agent.security` | Security | Qwen | security | CEO | direct: deny/deploy |

## 9.3 Org hierarchy

```
CEO (Claude)
  ├── wildcard authority: action="*", scope="*", no approval needed
  │
  └── Architect (Claude)
        ├── direct: deploy/production (no approval)
        ├── direct: complete/production (no approval)
        ├── gatekeeping: complete/production requires Architect's approval
        │   (yaani Backend ko Architect se approval lena padega)
        │
        ├── Backend (Codex) — no direct authority
        │   must request_approval for production deploy
        │
        └── QA (Gemini) — no direct authority

Security (Qwen) — reports directly to CEO (not Architect)
  ├── direct: deny/deploy (can block deployments)
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

User clicks 5 buttons in order. This exercises the entire protocol:

```
Step 1: Security → claim task_43
  - Act: claim { from: agent.security, payload: { taskId: task_43 } }
  - State: task_43.status = in_progress, assignee = agent.security
  - Ledger: "agent.security claimed task task_43"

Step 2: Backend → handoff task_42 to Security (review)
  - Act: handoff { from: agent.backend, payload: { taskId: task_42, to: agent.security, intent: review } }
  - State: task_42.status = handoff_pending, pendingHandoffTo = agent.security
  - Ledger: "agent.backend → handoff task_42 to agent.security (review)"

Step 3: Backend → complete task_42 (with deploy evidence)
  - Act: complete { from: agent.backend, payload: { taskId: task_42, summary: ..., resultRef: "deploy://production/v1.2.3", evidence: [{ type: deploy, ... }] } }
  - AUTHORITY GATE FIRES: resultRef contains "production" + evidence type "deploy"
  - Backend has no direct production authority
  - Approval created: approver = agent.architect, status = pending
  - State NOT changed (task still in_progress)
  - Ledger: "agent.backend requested approval to complete (deploy) task_42"

Step 4: Architect → authorize latest approval
  - Act: authorize { from: agent.architect, payload: { approvalId: ... } }
  - Approval.status = approved, decidedBy = agent.architect
  - Ledger: "agent.architect AUTHORIZED ..."

Step 5: Backend → complete task_42 (now approved)
  - Act: complete { ... same as step 3 ... }
  - hasApprovedApproval check passes
  - State: task_42.status = completed, resultRef = deploy://production/v1.2.3, progress = 100
  - Ledger: "agent.backend completed task task_42: deployed to prod"
```

## 9.6 Final state after golden path

```
- task_42: completed, 100%, resultRef=deploy://production/v1.2.3
- task_43: in_progress (owned by Security)
- task_44: still blocked
- 11 ledger events total (6 seeded + 5 from golden path)
- 1 approval (approved)
- Compaction: 1363 → 398 tokens → 71% reduction
```

## 9.7 What each step demonstrates

| Step | Demonstrates |
|------|-------------|
| 1 | Task lifecycle (claim) — basic act mutating state |
| 2 | Handoff protocol — ownership transfer with intent |
| 3 | **Authority engine** — gatekeeping fires, approval required |
| 4 | **Approval workflow** — approver authorizes |
| 5 | Flow continuation — `hasApprovedApproval` check passes, state changes |
| Compaction view | **Context engine** — 71% token reduction visible |
| Ledger | **Immutable audit trail** — every act recorded with before→after delta |
