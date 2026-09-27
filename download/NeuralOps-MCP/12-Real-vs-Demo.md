# NeuralOps MCP — Real vs Demo

## 12.1 What's REAL

| Component | Real? | Notes |
|-----------|-------|-------|
| Coordination Core (backend) | ✅ Real | Actually mutates state, records ledger, enforces authority |
| Typed acts protocol | ✅ Real | 22 act types, zod-validated payloads, before/after deltas |
| Authority/approval engine | ✅ Real | Production deploy actually blocks until architect approves |
| Context compaction | ✅ Real | 71% reduction on demo task, real numbers from API |
| Work Ledger | ✅ Real | Immutable append-only, every mutation captured |
| WebSocket live updates | ✅ Real | Ledger updates instantly when acts fire |
| MCP tool registry | ✅ Real | 15 tools defined with typed input schemas |
| HTTP REST API | ✅ Real | All endpoints functional |
| Demo workspace | ✅ Real (data) | Pre-seeded agents/tasks with realistic history |
| Dashboard | ✅ Real | Live updates, real compaction numbers, working buttons |

## 12.2 What's NOT YET (demo placeholders)

| Component | Status | Notes |
|-----------|--------|-------|
| Actual AI agents (Claude/Codex) | ❌ Demo | "Agents" are data structures. User plays their role via UI buttons |
| Real MCP transport (stdio/SSE) | ❌ Not yet | Currently HTTP REST. V0.2 will add `@modelcontextprotocol/sdk` adapter |
| Persistent database | ❌ Not yet | In-memory store. V0.2 will use Prisma |
| Multi-workspace / multi-tenant | ❌ Not yet | Single workspace. V0.3 |
| Real tokenizers | ❌ Approximate | chars/4 heuristic. Per-model tokenizers in V0.2 |
| Cost / token tracking UI | ❌ Not exposed | Engine tracks internally, no dashboard panel yet |
| Artifact store (S3) | ❌ Not yet | Evidence `ref` field points to external locations, but no managed artifact storage |

## 12.3 The bottom line

> **Protocol is real, demo agents are fake.**

A real agent (Claude Code) connecting via MCP would make the same `neuralops.claim_task()` calls that the UI buttons make. Backend doesn't know the difference.

## 12.4 Why this matters

When V0.2 ships real MCP transport:

1. Customer installs NeuralOps MCP server
2. Customer connects their Claude Code (via MCP config)
3. Claude Code sees `neuralops_*` tools available
4. Claude Code calls `neuralops_claim_task("task_42")` — same as UI button
5. Coordination Core processes the act — same as now
6. Ledger records the event — same as now
7. Other connected agents see the update via WS — same as now

**Zero changes to Coordination Core.** Only transport adapter changes.

## 12.5 What an agent (Claude Code) would see

After connecting via MCP, Claude Code's tool list would include:

```python
# Available MCP tools:
neuralops_register(name, model, role, reports_to?)
neuralops_workspace()  → returns { workspace, agents, tasks, approvals }
neuralops_tasks(status?)
neuralops_claim(task_id, note?)
neuralops_complete(task_id, summary, result_ref?, evidence?)
neuralops_handoff(task_id, to, intent)
neuralops_accept_handoff(task_id)
neuralops_decision(task_id, text, rationale?)
neuralops_evidence(task_id, type, summary, ref)
neuralops_request_approval(action, scope, task_id?)
neuralops_authorize(approval_id)
neuralops_deny(approval_id, reason)
neuralops_escalate(task_id, reason, to)
neuralops_get_task_context(task_id)  → returns compacted context
neuralops_get_evidence(evidence_id)
neuralops_get_decision(decision_id)
```

Claude Code (or any MCP-aware agent) would use these like any other tool — picking the right one based on context.

## 12.6 The honest demo disclaimer

> Yeh V0.1 sirf protocol dikhane ke liye banaya hai. Iska matlab:
>
> ✅ Protocol works — acts, state mutation, ledger, authority, compaction — sab chal raha hai
> ✅ Dashboard works — live updates, compaction numbers real hain (API se aate hain)
> ⚠️ Isme abhi asli AI agents nahi hain — tum manually buttons se unka role play karte ho
>
> Yaani: **protocol real hai, demo agents fake hain.**
