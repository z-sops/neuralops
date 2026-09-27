# NeuralOps MCP — Real vs Demo

> V0.1.1 status. V0.1 ki list mein kuch "✅ Real" items asal mein broken thay (dekhein `17-V0.1.1-Hardening.md` §17.1). Yeh list tests se verified hai.

## 12.1 What's REAL (tested)

| Component | Status | Detail |
|-----------|--------|--------|
| Coordination Core | ✅ Real | Validate → check → mutate → ledger → journal. Rejected acts leave no trace. |
| Typed acts protocol | ✅ Real | 23 act types, 6 families, har ek ka zod payload; saare 23 ek test mein chalte hain |
| Authority / approvals | ✅ Real | Policies + task gates, approver chain, veto, separation of duties, single-use task-bound approvals |
| Identity | ✅ Real | Bearer tokens (sha256 stored), secure mode, demo impersonation clearly marked |
| Persistence | ✅ Real | JSONL journal, replay on boot, torn-line tolerance, divergence refusal |
| Immutable ledger | ✅ Real | Hash-chained; tampering detected by `/api/integrity` |
| Context compaction | ✅ Real (estimate) | ~70% on fresh seed, ~81% after golden path; chars/4 estimate, labelled |
| MCP transport | ✅ Real | stdio server via `@modelcontextprotocol/sdk`; 2 agents in 2 processes tested |
| MCP tool registry | ✅ Real | 33 tools, schemas generated from zod |
| HTTP REST + WebSocket | ✅ Real | Proper status codes, body limit, WS auth in secure mode |
| Dashboard | ✅ Real | Browser-tested golden path (10 steps) |

## 12.2 Demo parts

| Component | Status | Detail |
|-----------|--------|--------|
| Demo agents | Demo | Seed ke 5 agents data hain; UI buttons unki taraf se acts bhejte hain (`via: impersonated`). Asli agents ab MCP se connect ho sakte hain. |
| Demo tokens | Demo only | `nops_demo_*` guessable hain; secure mode mein demo seed hota hi nahi |

## 12.3 NOT YET

| Component | Status | Detail |
|-----------|--------|--------|
| External enforcement | ❌ | Gate abhi agent ke `complete` call pe hai. GitHub required check / Claude Code hooks roadmap pe |
| Multi-workspace / multi-tenant | ❌ | Single workspace |
| Real tokenizers | ❌ Approximate | chars/4 |
| Multi-instance storage | ❌ | Journal single-process JSONL file |
| Rate limiting | ❌ | — |
| Cost / token tracking UI | ❌ | — |
| Artifact store (S3) | ❌ | Evidence `ref` sirf external location point karta hai |

## 12.4 Bottom line

> **Protocol real hai, enforcement real hai (NeuralOps ke andar), aur agents ab asli MCP se connect ho sakte hain.** Agla bara qadam: gate ko agent ke bahar enforce karna (CI / merge / deploy path).
