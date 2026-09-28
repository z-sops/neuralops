# NeuralOps MCP

**The rulebook and the record underneath a human + AI workspace.**
Built for [NeuralOps Nexus](https://github.com/mapax-io/neuralops-nexus): before a persona's tool call reaches a real system, NeuralOps decides whether it runs now, waits for a human's approval, or is stopped by the kill switch — and every step lands in a signed, replayable ledger. Coding agents (Claude Code, Codex, Gemini CLI) use the same core for tasks, handoffs, file reservations and merge gates.

```
Nexus personas ─ nexus-ai guard / MCP HTTP ─┐                        ┌─ approvals (humans) · kill switch
Claude Code ─┐                              ├─► Coordination Core ───┤
Codex CLI   ─┼─ MCP stdio ──────────────────┘      :3031             ├─ Protocol Inspector (dashboard)
Gemini CLI  ─┘                                                       └─ gate-check (CI) · pre-tool hooks · pre-commit
```

- **Gated tool calls** (`perform`): allowed at once, or held for a single-use human approval — with a Python guard for Nexus' `nexus-ai` (pydantic-ai `process_tool_call`)
- **Kill switch**: one admin call freezes every agent, persona, gate and hook
- **MCP over stdio and streamable HTTP** (`POST /mcp`, one bearer token per persona)
- **26 typed acts** in 6 families: create/claim/handoff/complete, file reservations, decisions and evidence, questions/proposals with TTL, approvals, escalation, perform
- **File reservations**: agents reserve files/globs; other agents can't edit (Claude Code hook) or commit (git pre-commit, works for every agent) what someone else holds
- **Authority**: direct grants, workspace policies, task gates, approver chain, veto; approvals are single-use, task-bound, and never self-approved
- **Verified evidence**: only CI (or another `attest` agent) can satisfy gates like "tests must pass"
- **Event-sourced**: HMAC-signed journal, hash-chained ledger, replay on boot, `/api/integrity`
- **Secure mode**: bearer tokens with expiry/revoke/rotate, admin API, rate limiting, loopback-only by default
- **140 automated tests**

**Evaluating NeuralOps for Nexus?** Read the [proposal & test guide](docs/PITCH.md): what it adds to Nexus, how it plugs in, and a 45-minute test.

## Quick start (local demo)

Requires [Bun](https://bun.sh) and [Caddy](https://caddyserver.com/download).

```bash
# 1. core
cd mini-services/neuralops-mcp
bun install
bun test            # 140 pass
bun run dev         # 127.0.0.1:3031

# 2. dashboard (new terminal, repo root)
bun install
bun run dev:local   # 127.0.0.1:3000

# 3. gateway (new terminal, repo root)
caddy run --config Caddyfile     # Windows: .\caddy.exe run --config Caddyfile
```

Open **http://localhost:81**. Opening `:3000` directly shows DISCONNECTED; the dashboard reaches the core through the gateway.

## NeuralOps Nexus

Setup (core on the host IP in secure mode, personas and approvers, policies, the guard in `nexus-ai`, `/mcp`): [`mini-services/neuralops-mcp/integrations/nexus/README.md`](mini-services/neuralops-mcp/integrations/nexus/README.md).

## Connect a coding agent

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

`download/NeuralOps-MCP/`: start with `README.md`. What changed: `17-V0.1.1-Hardening.md`, `18-V0.1.2-Security.md`, `19-V0.1.3-File-Reservations.md`, `20-V0.1.4-Nexus-Gate.md`.

## Status

V0.1.4. Single workspace, single process (JSONL journal). See `12-Real-vs-Demo.md` for the honest list of what is and is not done.

## License

[Apache-2.0](LICENSE).
