# NeuralOps MCP — Infrastructure & Persistence

## 11.1 Process topology

```
PID 1: tini -- /start.sh (sandbox init)
  └── PID 2: caddy (gateway, port 81)
        ├── routes /?XTransformPort=N → localhost:N
        └── routes / → localhost:3000 (Next.js)
        
PID 2617: bun run dev (Next.js dev server, port 3000)
  └── PID 2633: next-server

PID 2932: bun --hot src/index.ts (NeuralOps mini-service, port 3031)
```

## 11.2 The persistence discovery (critical)

Sandbox mein processes jo tool-call ke andar start hote the, tool-call khatam hote hi kill ho jate the (ZAI service descendants kill karti hai).

**Fix:** `setsid --fork` (true double-fork) → process PID 1 (tini) ko reparent hota hai → persists across tool calls.

### Why `setsid` alone failed

```bash
setsid bun src/index.ts &
# → process is child of bash → bash exits → ZAI kills descendants → process dies
```

### Why `setsid --fork` works

```bash
setsid --fork bash -c 'exec bun src/index.ts'
# → true double-fork → process reparents to PID 1 (tini)
# → ZAI doesn't track it as descendant → survives
```

## 11.3 Restart commands

```bash
# dev server (port 3000)
cd /home/z/my-project && setsid --fork bash -c 'exec bun run dev' </dev/null >>dev.log 2>&1

# mini-service (port 3031, with --hot for live edits)
cd /home/z/my-project/mini-services/neuralops-mcp && setsid --fork bash -c 'exec bun --hot src/index.ts' </dev/null >>neuralops.log 2>&1
```

## 11.4 Gateway routing rule (CRITICAL)

Sab API requests relative path pe hote hain, with `?XTransformPort=3031` query param:

```javascript
// CORRECT
fetch('/api/state?XTransformPort=3031')
io('/?XTransformPort=3031')

// WRONG (forbidden)
fetch('http://localhost:3031/api/state')
io('http://localhost:3031')
```

### Caddyfile (the gateway)

```caddy
:81 {
    @transform_port_query {
        query XTransformPort=*
    }

    handle @transform_port_query {
        reverse_proxy localhost:{query.XTransformPort} {
            header_up Host {host}
            header_up X-Forwarded-For {remote_host}
            header_up X-Forwarded-Proto {scheme}
            header_up X-Real-IP {remote_host}
        }
    }

    handle {
        reverse_proxy localhost:3000 {
            header_up Host {host}
            header_up X-Forwarded-For {remote_host}
            header_up X-Forwarded-Proto {scheme}
            header_up X-Real-IP {remote_host}
        }
    }
}
```

- Port 81 = Caddy (gateway)
- Default route → port 3000 (Next.js)
- `?XTransformPort=N` → port N (mini-services)

## 11.5 How the Preview Panel works

The Preview Panel (right side of Z.ai Code interface) routes through Caddy on port 81:

```
Preview Panel
    ↓
Caddy (:81)
    ├── / → Next.js (:3000)
    └── /api/...?XTransformPort=3031 → mini-service (:3031)
    └── /?XTransformPort=3031 (WS) → mini-service (:3031)
```

User never needs to know about ports. Just sees the dashboard.

## 11.6 Sandbox startup (`/start.sh`)

PID 1 is `tini -- /start.sh`. At container boot:

1. Initializes project (restores from `repo.tar` if exists)
2. Extracts official skills to `/home/z/my-project/skills/`
3. Sets up git repo
4. Starts ZAI control service (root, port 12600)
5. Starts `bun run dev` (if `package.json` exists)
6. Auto-discovers `mini-services/*/package.json` and runs `bun run dev` in each
7. Starts Caddy (foreground, port 81)

**Important:** Step 5 & 6 only run at boot. If dev server dies later, must restart manually with `setsid --fork`.

## 11.7 Logging

| Service | Log file |
|---------|----------|
| Next.js dev | `/home/z/my-project/dev.log` |
| NeuralOps mini-service | `/home/z/my-project/mini-services/neuralops.log` |
| Boot timeline | `/tmp/boot-timeline.log` |
| Mini-service (boot-started) | `/tmp/mini-service-<name>.log` |

## 11.8 Health checks

```bash
# dev server
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/
# → 200

# mini-service
curl -s -o /dev/null -w "%{http_code}" http://localhost:3031/api/state
# → 200

# via Caddy (what Preview Panel uses)
curl -s -o /dev/null -w "%{http_code}" http://localhost:81/
# → 200
```
