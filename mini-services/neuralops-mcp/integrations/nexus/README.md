# NeuralOps for NeuralOps Nexus

Nexus already lets every persona tool run at a level — **Auto**, **Ask** or
**Off** — and holds an Ask tool until someone in the topic decides. NeuralOps
plugs into exactly that mechanism and adds what a team running personas
against real systems needs next:

| Nexus today (v0.8) | With NeuralOps on top |
|---|---|
| Anyone in the topic with the right can allow an Ask tool | **Policies name the approver** per action (`odoo.write/production → Noaman`), with approver chain, veto and no self-approval; a governed action waits for that person even if the tool is set to Auto |
| Schedules and swarms refuse every Ask tool (nobody can approve) | **Standing approvals**: an approver grants "Layla may `odoo.write` 20 times today"; unattended runs use it, and otherwise leave a request for later |
| The decision is a row in the Nexus database | **Signed ledger**: every acting call, approval (with reason), refusal and block is hash-chained and replayable; auditors get a read-only token |
| Stopping means editing each persona | **Kill switch**: one call freezes every persona's tools |
| Approvals happen in the Nexus topic | Also from a **one-click link** (webhook → chat, Slack, email), recorded as the approver themselves |

Everything NeuralOps does not govern keeps Nexus' own levels and topic
decisions exactly as before.

```
 @Layla "bill ACME 5000"  →  nexus-ai (pydantic-ai)  →  tool call create_invoice
                                   │
                    NeuralOpsToolGate (extends Nexus' ToolApprovalGate)
                     ├─ frozen?                      → skip, tell the model
                     ├─ governed by a policy?        → perform → allowed (authority / standing approval)
                     │                                  or wait for the named approver (link, webhook, API)
                     └─ not governed                 → Nexus Auto/Ask/Off as today; acting calls recorded
```

## What is in this folder

| File | What it is |
|---|---|
| `nexus-ai.patch` | The change to Nexus (tested against `mapax-io/neuralops-nexus` @ `939af00`, server 0.8.0): adds `apps/managers/neuralops_gate.py` + `neuralops_guard.py`, four `NEURALOPS_*` settings, the gate in the pydantic-ai runner, and `apps/tests/test_neuralops_gate.py` (9 tests). Off unless `NEURALOPS_URL` is set. |
| `nexus_gate.py` | `NeuralOpsToolGate` — the source of `apps/managers/neuralops_gate.py` |
| `neuralops_guard.py` | Standard-library client for the NeuralOps core (also usable on its own: `process_tool_call`, a decorator) |
| `test_nexus_gate_live.py` | Nexus' real gate + NeuralOps against a live core (run by `tests/nexus-gate.test.ts` when `NEXUS_DIR` points at a patched checkout) |
| `test_guard.py` | The guard against a live core, including a real pydantic-ai agent |

## Setup (about 20 minutes)

### 1. Run the core where `nexus-ai` can reach it

Tool calls come from inside the `nexus-ai` container, so use the host's IP,
not `localhost`. Network access requires secure mode:

```bash
cd mini-services/neuralops-mcp
NEURALOPS_MODE=secure NEURALOPS_HOST=0.0.0.0 \
NEURALOPS_ADMIN_TOKEN=$(openssl rand -hex 24) NEURALOPS_JOURNAL_KEY=$(openssl rand -hex 32) \
NEURALOPS_PUBLIC_URL=https://ops.example.com NEURALOPS_LINK_SECRET=$(openssl rand -hex 24) \
bun src/index.ts
```

`NEURALOPS_PUBLIC_URL` + `NEURALOPS_LINK_SECRET` turn on one-click approval
links (optional). Put the core behind HTTPS before exposing it beyond a LAN.

### 2. Create the worker's broker identity, the approvers and the rulebook

```bash
A="Authorization: Bearer $ADMIN"; J="Content-Type: application/json"; CORE=http://<host-ip>:3031

# the nexus-ai worker: acts only on behalf of personas (token shown once → NEURALOPS_TOKEN in nexus-ai)
curl -s -X POST $CORE/api/agents -H "$A" -H "$J" \
  -d '{"id":"agent.nexus-worker","name":"Nexus worker","model":"Custom","role":"service","access":"broker"}'

# the people who approve (externalId = their Supabase user id, see step 5)
curl -s -X POST $CORE/api/agents -H "$A" -H "$J" \
  -d '{"id":"human.noaman","name":"Noaman","model":"Custom","role":"lead","externalId":"<supabase user id>"}'

# the rulebook in one call (or POST /api/policies one at a time)
curl -s -X POST $CORE/api/presets/nexus-default/apply -H "$A" -H "$J" -d '{"approver":"human.noaman"}'
```

`nexus-default` governs `odoo.write`, `odoo.delete`, `db.write`,
`email.send`, `payment.send`, `file.delete` and `deploy` in `production`.
Define your own with `POST /api/presets` (admin). Personas are created
automatically on first use as `agent.persona-<persona id>`, delegated to the
worker; the worker can act for them and for nothing else.

### 3. Apply the patch to Nexus

```bash
cd neuralops-nexus
git apply /path/to/neuralops/mini-services/neuralops-mcp/integrations/nexus/nexus-ai.patch
```

and set in `nexus-ai`'s environment:

```
NEURALOPS_URL=http://<host-ip>:3031
NEURALOPS_TOKEN=<agent.nexus-worker token>
NEURALOPS_ACTIONS={"create_invoice":"odoo.write","delete_partner":"odoo.delete","send_email":"email.send"}
```

Tool names map to governed actions through `NEURALOPS_ACTIONS`; unmapped
tools are `tool.<name>` and stay ungoverned unless a policy (or `lockdown`)
says otherwise.

### 4. Tell people when they are needed

```bash
NEURALOPS_WEBHOOK_URL=https://<nexus-host>/hooks/neuralops,https://hooks.slack.com/... \
NEURALOPS_WEBHOOK_SECRET=$(openssl rand -hex 16)
```

`approval.requested` carries the approval (tool, arguments flagged as
untrusted, approver) and, with links on, `links.page`: a page where the
approver sees the request and presses Approve or Deny. The page never decides
on a GET (link previews are safe), the link is bound to that approval and
approver, expires (`NEURALOPS_LINK_TTL`, default 24h) and works once.
Deliveries are signed (`X-NeuralOps-Signature: sha256=<HMAC>`), retried
twice, and listed at `GET /api/webhooks/deliveries` (admin).

### 5. Let people use their Nexus sign-in (optional)

Nexus signs people in with Supabase. Give NeuralOps the project's JWT
settings and a Supabase access token works as a NeuralOps bearer token for
the linked identity:

```
NEURALOPS_JWT_JWKS_URL=https://<ref>.supabase.co/auth/v1/.well-known/jwks.json   # or NEURALOPS_JWT_SECRET (legacy HS256)
NEURALOPS_JWT_AUDIENCE=authenticated
NEURALOPS_JWT_AUTO_PROVISION=1     # optional: first sign-in creates human.<name> with no authority
```

So a Nexus approvals screen can call `POST /api/acts` `authorize` with the
person's own session token.

## Everyday use

| Need | How |
|---|---|
| Approve with a reason, for more than one call | `authorize {approvalId, reason?, uses?: N, validForSeconds?: S}` |
| Pre-approve a scheduled persona | `grant_approval {to: "agent.persona-<id>", action, scope, uses, validForSeconds, reason}` (by someone who could approve it) |
| See what is waiting on me | `GET /api/inbox` → `approvalsToDecide` |
| Stop everything | `POST /api/admin/freeze {"reason": "…"}` · resume with `/api/admin/unfreeze` |
| Give a client's auditor access | register with `"access": "audit"`: reads the ledger, integrity proof, approvals and policies; can never act |
| Audit | `GET /api/ledger`, `GET /api/integrity` |

With read scope `involved` (the default in secure mode) personas and people
read only the tasks, approvals and ledger entries they are part of; governors
and the admin see everything.

## Tested

- **In Nexus' own test suite** (patched clone): `test_neuralops_gate.py` (9 tests) and Nexus' `test_tool_approvals.py` (22) pass; the rest of the suite gives the same result with and without the patch.
- **Live** (`tests/nexus-gate.test.ts` with `NEXUS_DIR`): Nexus' real `ToolApprovalGate` + `NeuralOpsToolGate` against a secure core — persona identity created and delegated to the worker; a governed call waits for the named approver and runs once approved; a denial reaches the model with the reason; a standing approval lets an unattended run act, then the next call leaves a request; ungoverned tools keep Nexus' Ask and are recorded; a frozen workspace stops the persona. This test found and fixed a real bug (a tool with no arguments was rejected).

## Limits

- Not yet run inside a full Nexus deployment (web app, nucleus, relay); the patch is tested at the worker level.
- While a governed call waits for its approver, the Nexus topic shows the run as working, not a NeuralOps-specific "waiting for Noaman" card; the webhook and link carry that message.
- The LiteLLM runner (`AGENT_BACKEND=litellm`) is not covered — Nexus' own open item says its MCP path is not wired to tool approvals either.
- Each tool call makes one policy check to the core (on the LAN, a few milliseconds).
