# NeuralOps MCP — Real vs Demo

> V0.1.1 status. V0.1 ki list mein kuch "✅ Real" items asal mein broken thay (dekhein `17-V0.1.1-Hardening.md` §17.1). Yeh list tests se verified hai.

## 12.1 What's REAL (tested)

| Component | Status | Detail |
|-----------|--------|--------|
| Coordination Core | ✅ Real | Validate → check → mutate → ledger → journal. Rejected acts leave no trace. |
| Typed acts protocol | ✅ Real | 25 act types, 6 families, har ek ka zod payload; saare 25 ek test mein chalte hain |
| Authority / approvals | ✅ Real | Policies + task gates, approver chain, veto, separation of duties, single-use task-bound approvals |
| Identity | ✅ Real | Bearer tokens (sha256 stored) with expiry/revoke/rotate, secure mode, demo impersonation marked and loopback-only |
| Persistence | ✅ Real | HMAC-signed JSONL journal + signed head, replay on boot, tamper refusal, backups |
| Immutable ledger | ✅ Real | Hash-chained; journal HMAC-signed; tampering detected on boot and by `/api/integrity` |
| Context compaction | ✅ Real (estimate) | ~70% on fresh seed, ~81% after golden path; chars/4 estimate, labelled |
| MCP transport | ✅ Real | stdio server via `@modelcontextprotocol/sdk`; 2 agents in 2 processes tested |
| MCP tool registry | ✅ Real | 38 tools, schemas generated from zod |
| File reservations | ✅ Real (V0.1.3) | Conflicts at reserve time, Claude Code hook on edits, git pre-commit on commits (every agent) |
| HTTP REST + WebSocket | ✅ Real | Proper status codes, body limit, WS auth in secure mode |
| Dashboard | ✅ Real | Browser-tested golden path (10 steps) |

## 12.2 Demo parts

| Component | Status | Detail |
|-----------|--------|--------|
| Demo agents | Demo | Seed ke 6 agents (CI samet) data hain; UI buttons unki taraf se acts bhejte hain (`via: impersonated`). Asli agents ab MCP se connect ho sakte hain. |
| Demo tokens | Demo only | `nops_demo_*` guessable hain; secure mode mein demo seed hota hi nahi |

## 12.3 NOT YET

| Component | Status | Detail |
|-----------|--------|--------|
| External enforcement | ✅ V0.1.2 | Claude Code PreToolUse hook + GitHub required check (`gate-check`) + verified CI evidence. Codex/Gemini ke liye sirf CI check |
| Multi-workspace / multi-tenant | ❌ | Single workspace |
| Real tokenizers | ❌ Approximate | chars/4 |
| Multi-instance storage | ❌ | Journal single-process JSONL file |
| Rate limiting | ✅ V0.1.2 | Token bucket per caller, 429 |
| Cost / token tracking UI | ❌ | — |
| Artifact store (S3) | ❌ | Evidence `ref` sirf external location point karta hai |

## 12.4 Bottom line

> **Protocol real hai, aur enforcement NeuralOps ke bahar bhi real hai** (Claude Code hook, GitHub required check, CI-verified evidence). Agle bade qadam: multi-workspace aur DB-backed journal.
