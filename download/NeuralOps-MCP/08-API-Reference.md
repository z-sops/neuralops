# NeuralOps MCP — API Reference

> V0.1.1: naye endpoints (`/api/health`, `/api/whoami`, `/api/inbox`, `/api/policies`, `/api/integrity`, `/api/demo/tokens`, `POST /api/agents`), Bearer auth, aur proper status codes. Dekhein `17-V0.1.1-Hardening.md` §17.6 + §17.10.

## 8.1 GET endpoints

| Endpoint | Returns |
|----------|---------|
| `GET /api/state` | Full snapshot: workspace, agents[], tasks[], approvals[], ledger[] (recent), ledgerTotal |
| `GET /api/agents` | All agents |
| `GET /api/tasks` | All tasks (optionally `?status=...`) |
| `GET /api/tasks/:id` | Task + decisions + evidence + ledger (for that task) |
| `GET /api/tasks/:id/context` | Compacted context (OBJECTIVE/COMPLETED/...) |
| `GET /api/tasks/:id/context/full` | Full raw context |
| `GET /api/tasks/:id/context/comparison` | Full vs compacted + reduction % + formatted text |
| `GET /api/ledger?limit=N&taskId=X` | Ledger events (most recent first) |
| `GET /api/approvals` | All approvals |
| `GET /api/tools` | MCP tool definitions |
| `GET /api/families` | Act type → family + color + description maps |
| `GET /api/evidence?id=X` | Specific evidence |
| `GET /api/decisions?id=X` | Specific decision |

## 8.2 POST endpoints

### `POST /api/acts` — submit any typed act

Body = Act envelope (without id/timestamp/seq, server assigns):

```json
{
  "type": "claim",
  "from": "agent.security",
  "payload": { "taskId": "task_43", "note": "reviewing" }
}
```

Response:

```json
{
  "ok": true,
  "act": {
    "id": "act_xxx",
    "timestamp": "...",
    "seq": 8,
    "type": "claim",
    "from": "agent.security",
    "payload": { "taskId": "task_43", "note": "reviewing" },
    "references": []
  },
  "ledgerEvent": {
    "id": "evt_xxx",
    "seq": 8,
    "workspaceId": "ws_engineering",
    "actId": "act_xxx",
    "actType": "claim",
    "actor": "agent.security",
    "taskId": "task_43",
    "intent": null,
    "before": { "status": "unclaimed", "assignee": null },
    "after": { "status": "in_progress", "assignee": "agent.security" },
    "references": [],
    "deltaSummary": "agent.security claimed task task_43",
    "timestamp": "..."
  },
  "approval": null,
  "stateChanged": true,
  "task": {
    "id": "task_43",
    "status": "in_progress",
    "assignee": "agent.security",
    ...
  }
}
```

### `POST /api/tools/:toolName` — invoke MCP tool by name

Body = tool args. Caller identified via `X-Agent-Id` header or `_agent` field.

Example:

```bash
POST /api/tools/neuralops_claim
X-Agent-Id: agent.security
Content-Type: application/json

{ "taskId": "task_43", "note": "reviewing" }
```

Returns same shape as `POST /api/acts` (since claim is an act).

### `POST /api/demo/seed` — re-seed demo workspace (resets state)

Returns `{ ok, state }` with fresh seeded state.

### `POST /api/demo/reset` — clear everything

Returns `{ ok }`.

## 8.3 WebSocket events

Connect:

```javascript
const socket = io('/?XTransformPort=3031', {
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  timeout: 10000
})
```

| Event | Direction | Payload |
|-------|-----------|---------|
| `state:snapshot` | server → client (on connect + every mutation) | full state object |
| `ledger:event` | server → client (every mutation) | single LedgerEvent |

### Client subscription example

```javascript
socket.on('connect', () => {
  console.log('Connected to NeuralOps MCP')
})

socket.on('state:snapshot', (snapshot) => {
  // snapshot = { workspace, agents, tasks, approvals, ledger, ledgerTotal }
  updateUI(snapshot)
})

socket.on('ledger:event', (event) => {
  // event = single LedgerEvent
  showToast(`${event.actType} by ${event.actor}`)
  prependToLedger(event)
})
```

Inspector client simply stores latest `state:snapshot` and re-renders. No polling needed.

## 8.4 Gateway routing rule (CRITICAL)

Sab API requests relative path pe hote hain, with `?XTransformPort=3031` query param:

```javascript
// CORRECT
fetch('/api/state?XTransformPort=3031')
io('/?XTransformPort=3031')

// WRONG (forbidden)
fetch('http://localhost:3031/api/state')
io('http://localhost:3031')
```

Caddy detects `XTransformPort` query and routes to that port. Port 3031 = mini-service.

## 8.5 CORS

All responses include:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET,POST,OPTIONS
Access-Control-Allow-Headers: Content-Type,X-Agent-Id
```

## 8.6 Error responses

Errors return appropriate HTTP status + JSON body:

```json
{
  "ok": false,
  "act": { ... },
  "ledgerEvent": null,
  "approval": null,
  "error": "Task already claimed by agent.architect. Use handoff instead.",
  "stateChanged": false
}
```

Common error cases:
- Task not found (404)
- Agent not found (400)
- Already claimed by another (400)
- Pending handoff to different agent (400)
- Approval already decided (400)
- Only current owner can complete/handoff (400)
