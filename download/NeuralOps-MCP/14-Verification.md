# NeuralOps MCP — Verification Status

## 14.1 Browser-verified end-to-end

Used `agent-browser` to navigate to `/` via Caddy route (`:81`, same as Preview Panel):

| Check | Result |
|-------|--------|
| Page renders | ✅ Title "NeuralOps MCP — Protocol Inspector" |
| Console errors | ✅ Zero |
| All 5 sections render | ✅ Workforce, Coordination Console, Shared Work State, Work Ledger, Footer |
| Golden path step 1 (claim) | ✅ task_43 → in_progress, owner=security |
| Golden path step 2 (handoff) | ✅ task_42 → handoff_pending, → agent.security chip |
| Golden path step 3 (complete with deploy) | ✅ Approval gate fired, button auto-enabled |
| Golden path step 4 (authorize) | ✅ Approval → approved |
| Golden path step 5 (complete now approved) | ✅ task_42 → completed, progress 100, resultRef set |
| Compaction numbers | ✅ 1363 → 398 tokens → 71% reduction (real API data) |
| Live ledger updates | ✅ Events appear instantly after each act |
| Reset demo | ✅ Returns to clean seeded state |
| Lint | ✅ Clean (0 errors) |
| Responsive (mobile + desktop) | ✅ Verified |

## 14.2 Bonus verifications

Beyond the golden path, also verified:

| Action | Result |
|--------|--------|
| QA → escalate task_44 | ✅ ESCALATE seq#18, task → blocked, escalatedTo: architect |
| Architect → decide on task_42 | ✅ DECISION seq#20, decision recorded |
| Security → record evidence on task_42 | ✅ EVIDENCE seq#22, evidence attached to task |
| Pending Approvals sub-panel | ✅ Shows pending approvals with Authorize/Deny |
| Task selector (compaction) | ✅ Switching tasks refetches comparison |
| WS reconnect after disconnect | ✅ Auto-reconnects, re-syncs state |

## 14.3 Service health (current)

```bash
# dev server (Next.js, port 3000)
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/
# → 200

# mini-service (NeuralOps Coordination Core, port 3031)
curl -s -o /dev/null -w "%{http_code}" http://localhost:3031/api/state
# → 200

# via Caddy (port 81, what Preview Panel uses)
curl -s -o /dev/null -w "%{http_code}" http://localhost:81/
# → 200
```

## 14.4 Code quality

```bash
$ bun run lint
# → 0 errors, 0 warnings
```

## 14.5 Process persistence

Both services survive across shell sessions via `setsid --fork`:

```bash
$ ps aux | grep -E "next-server|bun --hot src/index"
# z  2617  bun run dev
# z  2633  next-server (v16.1.3)
# z  2932  bun --hot src/index.ts
```

## 14.6 Verification methodology

### What was verified

1. **Page renders** (not just responds) — confirmed via agent-browser snapshot
2. **Core interactivity** — clicked all 8 scenario buttons, confirmed each produces expected state change
3. **Data-driven features** — compaction numbers come from real API, not hardcoded
4. **Real-time features** — WebSocket ledger updates confirmed live
5. **Responsiveness** — verified mobile + desktop layouts
6. **Sticky footer** — confirmed bottom-anchored on short pages, pushed down on long pages
7. **No errors** — zero console errors after full flow

### What was NOT verified

- Real AI agent integration (none connected — only demo)
- Multi-workspace (only one workspace seeded)
- Persistence across service restarts (in-memory store resets on restart)
- Production-scale load (single user, single session)

## 14.7 How to re-verify

```bash
# 1. Check services alive
curl -s -o /dev/null -w "dev: %{http_code}\n" http://localhost:3000/
curl -s -o /dev/null -w "mcp: %{http_code}\n" http://localhost:3031/api/state

# 2. If down, restart
cd /home/z/my-project && setsid --fork bash -c 'exec bun run dev' </dev/null >>dev.log 2>&1
cd /home/z/my-project/mini-services/neuralops-mcp && setsid --fork bash -c 'exec bun --hot src/index.ts' </dev/null >>neuralops.log 2>&1

# 3. Re-seed demo state
curl -X POST "http://localhost:81/api/demo/seed?XTransformPort=3031"

# 4. Run golden path via API
B=http://localhost:3031
curl -s "$B/api/acts" -X POST -H "Content-Type: application/json" -d '{"type":"claim","from":"agent.security","payload":{"taskId":"task_43"}}'
curl -s "$B/api/acts" -X POST -H "Content-Type: application/json" -d '{"type":"handoff","from":"agent.backend","payload":{"taskId":"task_42","to":"agent.security","intent":"review"}}'
# ... continue through step 5

# 5. Verify compaction
curl -s "$B/api/tasks/task_42/context/comparison" | python3 -m json.tool
```
