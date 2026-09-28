# NeuralOps MCP

**Coordination infrastructure for the AI agents you already use.**
Claude Code, Codex, Gemini CLI and custom agents connect over MCP and share one workspace: typed acts instead of chat, single-use approvals that agents cannot grant themselves, a signed and replayable ledger, compacted task context, and enforcement at the places that matter (Claude Code hooks, GitHub required checks).

```
Claude Code ─┐                                  ┌─ Protocol Inspector (dashboard)
Codex CLI   ─┼─ MCP stdio ─► Coordination Core ─┤
Gemini CLI  ─┘               :3031              └─ gate-check (CI) · PreToolUse hook
```

- **25 typed acts** in 6 families: create/claim/handoff/complete, file reservations, decisions and evidence, questions/proposals with TTL, approvals and escalation
- **File reservations**: agents reserve files/globs; other agents can't edit (Claude Code hook) or commit (git pre-commit, works for every agent) what someone else holds
- **Authority**: direct grants, workspace policies, task gates, approver chain, veto; approvals are single-use, task-bound, and never self-approved
- **Verified evidence**: only CI (or another `attest` agent) can satisfy gates like "tests must pass"
- **Event-sourced**: HMAC-signed journal, hash-chained ledger, replay on boot, `/api/integrity`
- **Secure mode**: bearer tokens with expiry/revoke/rotate, admin API, rate limiting, loopback-only by default
- **127 automated tests**

## Quick start (local demo)

Requires [Bun](https://bun.sh) and [Caddy](https://caddyserver.com/download).

```bash
# 1. core
cd mini-services/neuralops-mcp
bun install
bun test            # 127 pass
bun run dev         # 127.0.0.1:3031

# 2. dashboard (new terminal, repo root)
bun install
bun run dev:local   # 127.0.0.1:3000

# 3. gateway (new terminal, repo root)
caddy run --config Caddyfile     # Windows: .\caddy.exe run --config Caddyfile
```

Open **http://localhost:81**. Opening `:3000` directly shows DISCONNECTED; the dashboard reaches the core through the gateway.

## Connect a real agent

```bash
claude mcp add neuralops \
  -e NEURALOPS_URL=http://127.0.0.1:3031 \
  -e NEURALOPS_TOKEN=nops_demo_backend \
  -- bun /abs/path/mini-services/neuralops-mcp/src/mcp/stdio.ts
```

Enforcement outside the model:
- Pre-tool hooks (same rules for all three): Claude Code `integrations/claude-code/settings.example.json` · Codex CLI `integrations/codex/config.toml` · Gemini CLI `integrations/gemini/settings.json` (all under `mini-services/neuralops-mcp/`)
- git pre-commit (any agent): `bun run install-git-hook -- --repo <worktree> --token <agent token>` (in `mini-services/neuralops-mcp`)
- GitHub required check: `mini-services/neuralops-mcp/integrations/github/neuralops-gate.yml`

## Production-ish (secure mode)

```bash
NEURALOPS_MODE=secure \
NEURALOPS_ADMIN_TOKEN=$(openssl rand -hex 24) \
NEURALOPS_JOURNAL_KEY=$(openssl rand -hex 32) \
bun mini-services/neuralops-mcp/src/index.ts
```

Register agents with `POST /api/agents` (admin token). Tokens are shown once.

## Docs

`download/NeuralOps-MCP/`: start with `README.md`. What changed: `17-V0.1.1-Hardening.md`, `18-V0.1.2-Security.md`, `19-V0.1.3-File-Reservations.md`.

## Status

V0.1.3. Single workspace, single process (JSONL journal). See `12-Real-vs-Demo.md` for the honest list of what is and is not done.
