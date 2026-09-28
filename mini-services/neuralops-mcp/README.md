# NeuralOps — Coordination Core (v0.1.6)

The core service: typed acts, policies and single-use approvals, gated actions (`perform`), a kill switch, policy presets, an approval webhook, read-only audit identities, file reservations, a signed and replayable ledger, and MCP over stdio and streamable HTTP. Overview, concepts, API and configuration: the [root README](../../README.md). NeuralOps Nexus setup: [`integrations/nexus/README.md`](integrations/nexus/README.md).

## Run

```bash
bun install
bun run dev                 # demo mode, :3031, journal in ./data
NEURALOPS_DATA_DIR=off bun run dev   # in-memory
```

Secure mode (real tokens, no impersonation, demo endpoints off):

```bash
NEURALOPS_MODE=secure NEURALOPS_ADMIN_TOKEN=$(openssl rand -hex 24) NEURALOPS_JOURNAL_KEY=$(openssl rand -hex 32) bun run start

# register an agent (token is shown once)
curl -X POST localhost:3031/api/agents \
  -H "Authorization: Bearer $NEURALOPS_ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"id":"agent.backend","name":"Backend","model":"Codex","role":"backend"}'
```

## Connect an agent over MCP

Over the network (NeuralOps Nexus, remote MCP hosts): `POST /mcp` with `Authorization: Bearer <agent token>` (streamable HTTP, stateless).

Over stdio (Claude Code, Codex CLI, Gemini CLI):

```bash
claude mcp add neuralops \
  -e NEURALOPS_URL=http://localhost:3031 \
  -e NEURALOPS_TOKEN=<agent token> \
  -- bun /abs/path/mini-services/neuralops-mcp/src/mcp/stdio.ts
```

See `.mcp.example.json` for a project-scoped config. The stdio server is stateless: every call is forwarded to the core, so agents in different processes share one workspace.

## Layout

```
src/
  config.ts            env → Config (demo | secure)
  errors.ts            typed errors → HTTP status
  protocol/            act types (26), envelope, per-act zod payloads (single registry)
  state/               types, store (hash-chained ledger, journal, deterministic ids)
  engines/
    task-manager.ts    dispatcher: validate → check → mutate → ledger → journal
    authority.ts       grants, policies, approver chain, veto, single-use approvals
    context.ts         compaction, full context, inbox
    agents.ts          registration + token identity (sha256 only)
    replay.ts          genesis, replay, integrity check, JSONL journal file
  mcp/tools.ts         39 tools, schemas generated from the zod payloads
  mcp/stdio.ts         real MCP stdio server (proxy to the core)
  mcp/http.ts          streamable-HTTP MCP at POST /mcp (per-agent bearer token)
  server/              HTTP door, identity, WebSocket
  seed/demo.ts         Engineering demo workspace (deterministic)
  engines/admin.ts     policies, authority, token rotate/revoke (audited)
  engines/gate.ts      gate status for CI / hooks
  engines/guard.ts     prompt-injection guard for agent-authored text
  engines/paths.ts     glob matching + conservative overlap
  engines/reservations.ts  file reservations (who may change which files)
  engines/presets.ts   policy presets (nexus-default, solo-dev, two-agent-team, production-gated, lockdown)
  engines/visibility.ts  read scopes ("involved": identities read only what they are part of)
  server/webhook.ts    approval.requested / approval.decided / workspace.frozen webhook (HMAC-signed, several receivers, delivery log)
  server/links.ts      one-click signed approval links (/approve/:id)
  server/jwt.ts        sign-in JWTs (Supabase JWKS / HS256) as identities
  cli/                 gate-check, report-evidence, install-git-hook
  hooks/               pre-tool hook for Claude Code / Codex / Gemini CLI, git pre-commit hook
integrations/          GitHub workflow; Claude Code, Codex CLI and Gemini CLI hook configs; nexus/ (patch + gate for NeuralOps Nexus, Python client)
tests/                 159 tests: regressions, protocol, replay, http, mcp, security, enforcement, reservations, nexus
```

## Verify

```bash
bun test            # 159 tests (the live Nexus test needs NEXUS_DIR) (the Python guard test needs python3)
bun run typecheck
curl localhost:3031/api/integrity   # hash chain + replay check
```

Change notes: `download/NeuralOps-MCP/17-V0.1.1-Hardening.md`, `18-V0.1.2-Security.md`, `19-V0.1.3-File-Reservations.md`, `20-V0.1.4-Nexus-Gate.md`, `21-V0.1.5-Governance-Setup.md`, `22-V0.1.6-Gaps-Closed.md`.

## Enforce outside the model

- **Pre-tool hooks:** Claude Code `integrations/claude-code/settings.example.json` · Codex CLI `integrations/codex/config.toml` · Gemini CLI `integrations/gemini/settings.json`.
- **GitHub:** copy `integrations/github/neuralops-gate.yml` to `.github/workflows/`, make `neuralops-gate` a required check.
- **git pre-commit (every agent):** `bun run install-git-hook -- --repo <worktree> --token <agent token> --url http://127.0.0.1:3031`
- **CLIs:** `bun run gate-check -- --task task_42` · `bun run report-evidence -- --type test --summary … --ref …`
