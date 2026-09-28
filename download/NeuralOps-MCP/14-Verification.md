# NeuralOps MCP — Verification Status (V0.1.5)

> V0.1 ki verification mein "Lint 0 errors" aur "all golden path steps work" likha tha, lekin `tsc` ke 26 errors, lint ke 7 errors, aur 2 act types crash karte thay. V0.1.1 mein har claim neeche wale command se dobara check ho sakta hai.

## 14.1 Automated

| Check | Command | Result |
|-------|---------|--------|
| Backend types | `cd mini-services/neuralops-mcp && bun run typecheck` | ✅ 0 errors |
| Backend tests | `bun test` | ✅ 148 pass, 0 fail |
| Frontend types | `bunx tsc --noEmit` (root) | ✅ 0 errors |
| Lint | `bun run lint` (root, whole project) | ✅ 0 errors |
| Build | `bunx next build` | ✅ compiled, 0 warnings |

## 14.2 Test suites

| File | Tests | Covers |
|------|-------|--------|
| `regressions.test.ts` | 14 | Har V0.1 review bug (#1–#12) + wildcard + ledger contiguity |
| `protocol.test.ts` | 21 | Golden path, all 26 act types, authority, ownership, conversations/TTL, validation, atomicity, idempotency, context, inbox |
| `replay.test.ts` | 8 | Replay = same state hash, tamper detection, restart persistence, torn line, divergence refusal, reseed truncation |
| `http.test.ts` | 10 | Demo impersonation, token identity/spoofing, status codes, 413, tools, integrity, WebSocket, secure mode, admin-only register, WS auth |
| `mcp.test.ts` | 3 | Real MCP stdio: 39 tools listed, two agents run the approval flow, tool errors |
| `security.test.ts` | 33 | Loopback binding, signed journal (9 tamper cases), token expiry/revoke/rotate, admin API + audit + replay, rate limit, verified evidence, prompt-injection guard, gate status |
| `reservations.test.ts` | 26 | Glob overlap, reservation rules, lifecycle (complete/release/handoff/revoke), replay, HTTP, git pre-commit in a real repo, Claude, Codex and Gemini hooks on reserved files, push and deploy |
| `enforcement.test.ts` | 13 | gate-check CLI exit codes, report-evidence (CI = verified), Claude Code hook: edit / push / deploy / unreachable core / frozen workspace |
| `nexus.test.ts` | 11 | `perform` rules, veto, wildcard policy, flagged approval detail, freeze + restart + replay, freeze API, `/mcp` with a real MCP SDK client and per-persona tokens |
| `governance.test.ts` | 8 | Approval reasons, presets (apply, update, reject, replay, admin-only API), webhook (requested/decided/frozen, signature, retry, flagged detail), audit identities (allowed reads, 403 everywhere else) |
| `nexus-guard.test.ts` | 1 (7 Python) | `integrations/nexus/test_guard.py` against a live secure core, including a real pydantic-ai agent |

## 14.3 Browser (Playwright, real dashboard)

Next.js production build + Core + gateway, Chromium clicks each scenario:

| Step | Expected | Result |
|------|----------|--------|
| Security → claim task_43 | ok | ✅ |
| Backend → handoff task_42 to Security | ok | ✅ |
| Security → accept handoff | ok | ✅ |
| Security → record review evidence | ok | ✅ |
| Security → complete (deploy) | approval required | ✅ |
| Security → authorize own approval | **rejected** | ✅ 403 |
| Architect → authorize latest | ok | ✅ |
| Security → complete (now approved) | ok, approval consumed | ✅ |
| QA → escalate task_44 | ok | ✅ |
| Architect → decide on task_42 | ok | ✅ |

Compaction banner after the run: −81%. Only console error: the intended 403 from the self-approval step.

## 14.4 Live integrity check

```bash
curl -s localhost:3031/api/integrity
# {"chainValid":true,"replayMatches":true,"replayError":null,"stateHash":"…","ledgerLength":…}
```

## 14.5 How to re-verify the golden path via API

```bash
B=http://localhost:3031
p(){ curl -s -X POST $B/api/acts -H 'Content-Type: application/json' -H "Authorization: Bearer $1" -d "$2"; echo; }
curl -s -X POST $B/api/demo/seed >/dev/null
p nops_demo_security  '{"type":"claim","payload":{"taskId":"task_43"}}'
p nops_demo_backend   '{"type":"handoff","payload":{"taskId":"task_42","to":"agent.security","intent":"review"}}'
p nops_demo_security  '{"type":"accept_handoff","payload":{"taskId":"task_42"}}'
p nops_demo_security  '{"type":"complete","payload":{"taskId":"task_42","summary":"deployed"}}'   # → approval_0001
p nops_demo_security  '{"type":"authorize","payload":{"approvalId":"approval_0001"}}'           # → 403
p nops_demo_architect '{"type":"authorize","payload":{"approvalId":"approval_0001"}}'           # → ok
p nops_demo_security  '{"type":"complete","payload":{"taskId":"task_42","summary":"deployed"}}'   # → completed
curl -s $B/api/integrity
```

## 14.6 Not verified

- Load / concurrency (single process, synchronous journal writes)
- Real Claude Code / Codex sessions end-to-end (MCP protocol tested with the official SDK client, not with those CLIs)
