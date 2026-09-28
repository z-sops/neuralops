# NeuralOps Gate for NeuralOps Nexus

NeuralOps Nexus is where people, personas and agents work together. NeuralOps
Gate is the rulebook and the record underneath it: before a persona's tool call
touches a real system, the gate decides whether it may run now, whether a
human has to approve it first, or whether everything is frozen. Every call
lands in a signed, replayable ledger.

```
 Nexus chat ── @Layla "bill ACME 5000"
      │
  nexus-ai (pydantic-ai) ── tool call: odoo/create_invoice {...}
      │
      ├─► NeuralOps Gate  POST /api/tools/neuralops_perform   ← neuralops_guard.py
      │       allowed?  → run the tool, ledger event
      │       approval? → do NOT run; "needs approval_0007 from agent.noaman"
      │       frozen?   → do NOT run
      ▼
  Odoo / DB / email / any MCP server
```

Three pieces, all in this folder or the core:

| Piece | What it does |
|---|---|
| `POST /mcp` (streamable HTTP) | NeuralOps' own 39 tools for personas (inbox, tasks, handoffs, decisions, `neuralops_perform`, …). Register it in Nexus like any MCP server. |
| `neuralops_guard.py` | Gates **other** MCP servers' tool calls inside `nexus-ai` (pydantic-ai `process_tool_call`), or any Python tool with a decorator. Standard library only. |
| Kill switch | `POST /api/admin/freeze` stops every persona and agent at once; `POST /api/admin/unfreeze` resumes. |

## 1. Run the core where `nexus-ai` can reach it

Tool calls come from inside the `nexus-ai` container, so `localhost` will not
work — use the host's real IP (the same rule Nexus uses for its own MCP
servers). Network access requires secure mode:

```bash
cd mini-services/neuralops-mcp
NEURALOPS_MODE=secure \
NEURALOPS_HOST=0.0.0.0 \
NEURALOPS_ADMIN_TOKEN=$(openssl rand -hex 24) \
NEURALOPS_JOURNAL_KEY=$(openssl rand -hex 32) \
bun src/index.ts
```

Keep the admin token; it is the only way to register agents, set policies and
use the kill switch. Put the core behind HTTPS (e.g. Tailscale, like Nexus)
before exposing it beyond a LAN.

## 2. Register people and personas

Every Nexus person who approves things and every persona that acts gets an
identity with its own token (ids are `agent.<name>`; a person is simply an
identity with no model behind it):

```bash
A="Authorization: Bearer $ADMIN"; J="Content-Type: application/json"; CORE=http://<host-ip>:3031

curl -s -X POST $CORE/api/agents -H "$A" -H "$J" \
  -d '{"id":"agent.noaman","name":"Noaman","model":"Custom","role":"lead"}'
curl -s -X POST $CORE/api/agents -H "$A" -H "$J" \
  -d '{"id":"agent.layla","name":"Layla","model":"Claude","role":"analyst","reportsTo":"agent.noaman"}'
# → each returns a token, shown once
```

## 3. Say what needs approval

Policies name an action, a scope and the approver. An action no policy covers
runs at once (and is still logged). A `*`/`*` policy makes everything need
approval.

The quickest start is the `nexus-default` preset: writes to Odoo and databases,
sending email, payments, file deletes and deploys (all in `production`) need
the approver you name; reading and searching flow.

```bash
curl -s $CORE/api/presets/nexus-default -H "$A"                      # see what it sets
curl -s -X POST $CORE/api/presets/nexus-default/apply -H "$A" -H "$J" \
  -d '{"approver":"agent.noaman"}'
```

Or one policy at a time:

```bash
curl -s -X POST $CORE/api/policies -H "$A" -H "$J" \
  -d '{"action":"odoo.write","scope":"production","approver":"agent.noaman"}'
```

Other presets: `solo-dev`, `two-agent-team`, `production-gated`, `lockdown`
(`GET /api/presets`). Re-applying a preset updates its policies instead of
duplicating them.

Approvals are single-use and bound to the requester, the action and the
scope; nobody can approve their own request, and an identity with `deny`
authority on the scope can veto.

## 4. Gate tool calls in `nexus-ai`

Copy `neuralops_guard.py` into `nexus-ai` and pass the guard wherever
`nexus-ai` builds the MCP toolsets for an agent:

```python
from neuralops_guard import NeuralOpsGuard

guard = NeuralOpsGuard(
    url="http://<host-ip>:3031",
    token=persona.neuralops_token,             # this persona's own token
    actions={                                  # tool name → governed action
        "create_invoice": "odoo.write",
        "update_partner": "odoo.write",
        "delete_record":  "odoo.delete",
    },
    # unmapped tools become "tool.<name>" — ungoverned unless a policy says otherwise
)

toolset = MCPToolset(client, process_tool_call=guard.process_tool_call)          # pydantic-ai 2.x
# older pydantic-ai: MCPServerStreamableHTTP(url, process_tool_call=guard.process_tool_call)
```

For plain Python tools:

```python
@agent.tool_plain
@guard.guarded("email.send")
def send_email(to: str, subject: str, body: str) -> str: ...
```

When a call is not allowed, the tool does not run and the model receives a
short text such as `[NeuralOps] create_invoice was NOT run: it needs approval
approval_0007 from agent.noaman. Tell the user it is waiting for approval…`.
If the core is unreachable the guard fails closed (`fail_open=True` changes
that).

## 5. Give personas NeuralOps' own tools (optional)

Register NeuralOps as an MCP server in Nexus:

| Field | Value |
|---|---|
| URL | `http://<host-ip>:3031/mcp` |
| Transport | `streamable-http` |
| Header | `Authorization: Bearer <persona token>` |

If Nexus cannot send a header for an MCP server, start the core with
`NEURALOPS_MCP_URL_TOKENS=1` and use `http://<host-ip>:3031/mcp/<persona token>`
(the token then appears in URLs and logs, so prefer the header). Tokens are
per identity, so each persona that should act as itself needs its own entry.

## 6. Tell Nexus when a person is needed (webhook)

Start the core with a webhook and Nexus (or Slack, or a pager) is told the
moment an approval is waiting:

```bash
NEURALOPS_WEBHOOK_URL=http://<nexus-host>/hooks/neuralops \
NEURALOPS_WEBHOOK_SECRET=$(openssl rand -hex 16) \
... bun src/index.ts
```

Each event is a JSON POST:

```json
{ "event": "approval.requested", "at": "2026-09-28T07:12:03.120Z",
  "approval": { "id": "approval_0007", "action": "odoo.write", "scope": "production",
                "requestedBy": "agent.layla", "approver": "agent.noaman",
                "detail": "create_invoice: {\"partner\":\"ACME\",\"amount\":5000}", "status": "pending", "...": "..." },
  "ledger": { "seq": 41, "actId": "act_000019", "actType": "perform", "actor": "agent.layla", "summary": "...", "hash": "..." } }
```

Events: `approval.requested`, `approval.decided` (with `status` and the
approver's `reason`), `workspace.frozen`, `workspace.unfrozen`. With a secret,
verify `X-NeuralOps-Signature: sha256=<hex HMAC-SHA256(secret, raw body)>`
before trusting a call. `detail` is written by the requesting persona: show it
to people, and if a model reads it, treat it as data (it arrives flagged when
it looks like instructions). Delivery never blocks an act; a failed POST is
retried once after 2 seconds.

A natural flow: the webhook posts an `@form` into the approver's Nexus chat;
the form's buttons call `authorize` (with an optional `reason`) or `deny`
with the approver's own token.

## 7. Approvals, audit and the kill switch

| Need | Call |
|---|---|
| What is waiting on a person | `GET /api/inbox` with that person's token → `approvalsToDecide` |
| Approve / deny | `POST /api/acts` `{"type":"authorize","payload":{"approvalId":"approval_0007","reason":"agreed on the call"}}` (`reason` optional), or `deny` with a `reason` |
| Live feed | WebSocket `ledger:event` |
| Audit log | `GET /api/ledger`, `GET /api/integrity` (hash chain + replay check) |
| Give a client's auditor access | register with `"access":"audit"`: that token can read the ledger, integrity proof, approvals and policies, and can never act |
| Stop everything | `POST /api/admin/freeze {"reason":"…"}` (admin) — acts, gates, guard, hooks all refuse |
| Resume | `POST /api/admin/unfreeze` |

Nexus' `@form` output is a natural place for the approve/deny buttons: the
form posts `authorize` or `deny` with the approver's own token.

## Tested

`tests/nexus.test.ts` (perform, freeze, `/mcp` over streamable HTTP with
per-persona tokens), `tests/governance.test.ts` (presets, approval reasons,
audit identities, the signed webhook with retry) and `tests/nexus-guard.test.ts`, which runs
`test_guard.py` against a live secure-mode core: ungoverned calls, the
approval round-trip through `process_tool_call`, single use, the decorator,
fail-closed, freeze, and a real pydantic-ai agent whose tool must not run
before approval.

## Limits

- Not yet run inside a real Nexus deployment; the integration points above
  come from the Nexus README (`nexus-ai` runs pydantic-ai; MCP servers are
  registered by URL; streamable-http is the default transport).
- One token per persona: Nexus' own users (Supabase) are not mapped
  automatically yet — register them once as above.
- Approvals are single-use; a persona that repeats a governed action many
  times needs one approval each time (batch or time-boxed approvals are a
  possible next step).
