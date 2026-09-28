# NeuralOps MCP — Tool Registry

> V0.1.2: 34 tools (naya: `neuralops_gate_status`), asli MCP stdio transport. Tafseel: `17-V0.1.1-Hardening.md`, `18-V0.1.2-Security.md`.

## 7.1 Tool surface (38 tools)

### Query tools (13)

| Tool | Kaam |
|------|------|
| `neuralops_inbox` | Aap pe kya waiting hai: open tasks, handoffs, escalations, approvals to decide, open questions/proposals. **Pehle yahi call karein.** |
| `neuralops_get_task_context` | Compacted context (OBJECTIVE / COMPLETED / DECISIONS / CONSTRAINTS / EVIDENCE / OPEN / NEXT / GATES). Default text format. |
| `neuralops_get_full_context` | Task ka poora raw record (bara, kam use karein) |
| `neuralops_get_evidence` | Ek evidence by id |
| `neuralops_get_decision` | Ek decision by id |
| `neuralops_get_original_context` | Original act envelope by act id |
| `neuralops_whoami` | Aap ka agent record, authority, reporting line |
| `neuralops_workspace` | Agents, tasks, pending approvals, policies |
| `neuralops_tasks` | Tasks list (optional status filter) |
| `neuralops_register` | Naya agent register (admin only), token ek dafa milta hai |
| `neuralops_files_check` | Edit se pehle: yeh files kiske paas hain? `blocked=true` = kisi aur ki exclusive reservation |
| `neuralops_reservations` | Active file reservations (agent/task filter) |
| `neuralops_gate_status` | Kya is task ke liye merge (`complete`) ya `deploy` cleared hai? CI aur hooks yahi jawab enforce karte hain |

### Act tools (25): one per act type

`neuralops_<act>`:

| Family | Tools |
|--------|-------|
| task | `create_task`, `claim`, `release`, `complete`, `block`, `status`, `reserve_files`, `release_files` |
| handoff | `handoff`, `accept_handoff`, `reject_handoff` |
| information | `evidence`, `decision`, `update` |
| conversation | `question`, `answer`, `proposal`, `counter` |
| authority | `request_approval`, `authorize`, `deny`, `escalate` |
| lifecycle | `subscribe`, `unsubscribe`, `ack` |

Har act tool ke extra optional args:
- `references: string[]` — jin ids pe yeh act based hai (`decision_0001`, `evidence_0002`)
- `actId: string` — idempotency key; wahi `actId` dobara bheja to `409 conflict`, do dafa apply nahi hota

## 7.2 Critical design choice

> `send_message("...")` is NOT the primary API. Freeform communication is an escape hatch.

Conversation acts (`question`, `proposal`) TTL ke saath expire hote hain (default 1 ghanta) jab tak koi durable nateeja na nikle.

## 7.3 Schemas cannot drift

Act tools ke `inputSchema` **usi zod schema se generate** hote hain (`z.toJSONSchema`) jis se dispatcher validate karta hai (`PAYLOAD_SCHEMAS` registry). V0.1 mein tool definitions haath se likhi thin aur protocol se alag ho sakti thin.

## 7.4 Transport

```
Agent (Claude Code / Codex / Gemini CLI)
   │  MCP stdio
   ▼
src/mcp/stdio.ts          ← stateless MCP server (@modelcontextprotocol/sdk)
   │  HTTP + Bearer token
   ▼
Coordination Core :3031   ← one shared workspace
```

- `stdio.ts` koi state nahi rakhta, is liye alag processes ke agents ek hi workspace share karte hain.
- Wahi `callTool(name, args, caller)` HTTP `/api/tools/:name` aur MCP dono ko serve karta hai.
- Errors MCP `isError: true` ke saath `"<errorCode>: <message>"` aate hain (e.g. `forbidden: agent.backend cannot authorize its own request`).

Setup (Claude Code, Codex, `.mcp.json`): dekhein `17-V0.1.1-Hardening.md` §17.7.

## 7.5 Identity

Caller identity **token se** aati hai, tool args se nahi. `from` tool argument nahi hai. Demo mode mein (sirf demo) `NEURALOPS_AGENT` / `X-Agent-Id` se impersonation hoti hai, aur ledger mein `via: "impersonated"` likha jata hai.

## 7.6 What an agent sees

```
TASK task_42 — Build authentication module

OBJECTIVE
Implement a session-based authentication module …

COMPLETED
- Backend implementation complete: login, logout, session validation, role checks.
- Handoff agent.architect → agent.backend (implement) accepted

DECISIONS
- [decision_0001] Session-based authentication selected over JWT for this service. (by agent.architect)
- [decision_0002] Passwords hashed with argon2id (memory-hard). (by agent.architect)

CONSTRAINTS
- No production modification until security review is complete.
…

OPEN
- Security review pending — Security agent must review before deploy.
- Approval approval_0001 pending: complete/production for agent.backend (approver agent.architect)

NEXT
- Security agent must review the implementation.

GATES
- complete/production

OWNER: agent.backend   STATUS: in_progress
```
