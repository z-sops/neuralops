# NeuralOps MCP — Roadmap

## V0.1 — Current (DONE)

✅ Coordination Core (typed acts, state mutation, immutable ledger)
✅ Authority + approval engine
✅ Context compaction engine (~70–81% on demo, chars/4 estimate)
✅ MCP tool registry (33 tools in V0.1.1)
✅ HTTP REST API + WebSocket
✅ Demo seed (Engineering workspace)
✅ Protocol Inspector dashboard
✅ Browser-verified end-to-end

## V0.1.1 — Hardening (DONE)

✅ Real MCP stdio transport (`@modelcontextprotocol/sdk`)
✅ Persistent journal + replay (JSONL, single process)
✅ Bearer-token identity, secure mode, admin registration
✅ Policies, approver chain, veto, single-use task-bound approvals
✅ Hash-chained ledger + `/api/integrity`
✅ Conversation TTL
✅ 55 automated tests; tsc + lint clean

## V0.2 — Real Agent Integration (next)

### Real MCP transport
- [ ] `@modelcontextprotocol/sdk` integration
- [ ] stdio transport (for CLI agents: Claude Code, Codex CLI, Gemini CLI)
- [ ] streamable HTTP transport (for cloud-hosted agents)
- [ ] Tool handlers unchanged — only transport adapter changes

### Persistent storage
- [x] Durable storage: JSONL journal + replay (V0.1.1)
- [ ] Database-backed journal for multi-instance (Postgres / SQLite)
- [ ] External enforcement: GitHub required status check + Claude Code hooks so gates hold outside NeuralOps
- [ ] API surface unchanged (store.ts implementation swaps)

### Accurate tokenization
- [ ] Per-model tokenizers (Claude, GPT-4, Gemini, Qwen)
- [ ] Replace chars/4 heuristic with real tokenizer calls
- [ ] Cache tokenized results

### Cost / token tracking
- [ ] Dashboard panel showing per-agent token usage
- [ ] Per-task token consumption breakdown
- [ ] Cost estimation (model pricing × tokens)
- [ ] Historical trends

### Artifact store integration
- [ ] S3 / local file storage for raw artifacts (code, screenshots, logs)
- [ ] Evidence `ref` field points to artifact store URLs
- [ ] On-demand `get_artifact(ref)` returns content
- [ ] Clean separation: Coordination Layer (cheap) vs Artifact Store (expensive, on-demand)

### Conversation session scoping
- [ ] TTL-based brainstorm sessions
- [ ] Session-scoped message exchanges
- [ ] Auto-close sessions that produce no artifacts (rule from §4.4)

### Authentication + multi-workspace
- [ ] API key auth for agents
- [ ] User auth for inspector dashboard
- [ ] Multiple workspaces per deployment
- [ ] Workspace-scoped data isolation

## V0.3 — Production Hardening

### Multi-tenant isolation
- [ ] Per-tenant data separation
- [ ] Per-tenant authority rules
- [ ] Tenant-scoped event streams

### RBAC (role-based access control)
- [ ] Inspector dashboard roles (admin, viewer, operator)
- [ ] Per-agent permission scopes (what tools an agent can call)
- [ ] Per-task visibility rules

### Replay / time-travel debugging
- [ ] Event sourcing already supports this — build the UI
- [ ] "Task state at time T" reconstruction
- [ ] Diff between any two points in time

### Webhook integrations
- [ ] Slack notification on approval required
- [ ] Email on escalation
- [ ] Custom webhook per workspace
- [ ] Event filter rules

### Metrics / observability
- [ ] Prometheus metrics export
- [ ] Grafana dashboards
- [ ] Per-act latency tracking
- [ ] Per-agent throughput

### Audit log export
- [ ] CSV/JSON export of ledger
- [ ] Date range filters
- [ ] Compliance-ready formats

## V1.0 — Ecosystem

### Public MCP server registry
- [ ] NeuralOps as a hosted service (SaaS)
- [ ] Public workspace discovery
- [ ] Self-hosted option (on-prem)

### Pre-built agent adapters
- [ ] Claude Code adapter (official MCP)
- [ ] Codex CLI adapter
- [ ] Gemini CLI adapter
- [ ] CrewAI integration
- [ ] LangGraph integration
- [ ] Custom Python agent SDK

### Custom authority templates
- [ ] HIPAA compliance template
- [ ] SOC2 compliance template
- [ ] Financial compliance template
- [ ] Custom rule builder UI

### Marketplace for coordination patterns
- [ ] Pre-built org hierarchies (startup, enterprise, agency)
- [ ] Task templates (software dev, content creation, research)
- [ ] Authority rule packs

## Beyond V1.0 — speculative

### Cross-workspace coordination
- [ ] Federated workspaces
- [ ] Cross-company agent collaboration
- [ ] Marketplace for hiring external agents

### AI-native organization templates
- [ ] "AI startup" template (5 agents, CTO + 4 ICs)
- [ ] "AI agency" template (PM + designers + devs)
- [ ] "AI research lab" template (PI + researchers)

### Compaction engine v2
- [ ] ML-based relevance scoring (what to include in compacted context)
- [ ] Per-task-type compaction strategies
- [ ] Learned compression patterns

## Priority order

```
Immediate (V0.2):
1. Real MCP transport      ← enables actual agent integration
2. Prisma persistence       ← production-safe storage
3. Per-model tokenizers     ← accurate token tracking

Medium-term (V0.3):
4. Multi-tenant             ← SaaS-ready
5. RBAC                     ← enterprise-ready
6. Replay UI                ← debugging superpower

Long-term (V1.0):
7. Hosted SaaS              ← scale
8. Agent adapters           ← ecosystem
9. Templates marketplace   ← network effects
```
