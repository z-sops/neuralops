# NeuralOps MCP — Files Index

## 16.1 Backend (mini-service)

```
mini-services/neuralops-mcp/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                          # bootstrap (port 3031)
    ├── protocol/
    │   ├── act-types.ts                  # 22 act types, 6 families
    │   ├── envelope.ts                   # Act envelope + zod schema
    │   └── payloads.ts                   # per-act payload schemas
    ├── state/
    │   ├── types.ts                      # all entity types
    │   ├── store.ts                      # in-memory store + pub/sub
    │   └── token-estimate.ts             # chars/4 heuristic
    ├── engines/
    │   ├── task-manager.ts               # act dispatcher
    │   ├── authority.ts                  # approval gating
    │   └── context.ts                    # compaction engine
    ├── mcp/
    │   └── tools.ts                      # MCP tool registry + dispatcher
    ├── seed/
    │   └── demo.ts                       # Engineering workspace seed
    └── server/
        ├── http.ts                       # REST API
        └── ws.ts                         # socket.io event stream
```

## 16.2 Frontend (Next.js app)

```
src/
├── app/
│   ├── layout.tsx                        # added Sonner Toaster
│   ├── page.tsx                          # dashboard composition
│   └── globals.css                       # (existing)
├── lib/
│   ├── neuralops-types.ts               # TS types mirroring backend
│   ├── neuralops-api.ts                 # typed REST helpers
│   └── utils.ts                         # (existing)
├── hooks/
│   └── use-neuralops.ts                 # single hook (WS + state + actions)
└── components/
    ├── inspector/
    │   ├── colors.ts                     # hue → Tailwind class maps
    │   ├── act-badge.tsx                 # colored ActBadge + StatusDot
    │   ├── header.tsx                    # sticky Header + ArchitectureStrip + Footer
    │   ├── agent-card.tsx                # agent card component
    │   ├── task-card.tsx                 # task card component
    │   ├── workforce-section.tsx         # agents + tasks grids
    │   ├── coordination-console.tsx      # 8 scenario buttons + pending approvals
    │   ├── shared-work-state.tsx         # compaction comparison panels
    │   └── work-ledger.tsx               # live event stream
    └── ui/                               # (existing shadcn components)
```

## 16.3 Documentation

```
/home/z/my-project/worklog.md            # all task records (3 sections)
/home/z/my-project/download/NeuralOps-MCP/  # this documentation package
```

## 16.4 File responsibilities

### Backend files

| File | Lines | Responsibility |
|------|-------|----------------|
| `act-types.ts` | ~70 | 22 act types, 6 families, color/description maps |
| `envelope.ts` | ~40 | Act envelope zod schema, makeId helper |
| `payloads.ts` | ~150 | Per-act typed payload schemas (zod) |
| `types.ts` | ~180 | All entity interfaces (Agent, Task, Decision, Evidence, Approval, LedgerEvent, etc.) |
| `store.ts` | ~110 | In-memory maps + append-only ledger + pub/sub |
| `token-estimate.ts` | ~20 | chars/4 token heuristic + formatter |
| `task-manager.ts` | ~450 | Act dispatcher + 22 handlers + ledger recording |
| `authority.ts` | ~100 | hasAuthority, approvalRequired, hasApprovedApproval, requestApproval, authorize, deny |
| `context.ts` | ~200 | getCompactedContext, getFullContext, getContextComparison, formatters, on-demand retrieval |
| `tools.ts` | ~380 | 15 MCP tool definitions + callTool dispatcher |
| `demo.ts` | ~250 | Engineering workspace seed (5 agents, 3 tasks, history) |
| `http.ts` | ~180 | REST API handlers |
| `ws.ts` | ~30 | socket.io setup + event broadcasting |
| `index.ts` | ~30 | Bootstrap (port 3031, seed demo) |

### Frontend files

| File | Responsibility |
|------|----------------|
| `page.tsx` | Dashboard composition (5 sections + header + footer) |
| `layout.tsx` | Root layout (fonts, Sonner Toaster) |
| `neuralops-types.ts` | TS types mirroring backend |
| `neuralops-api.ts` | Typed REST helpers (with XTransformPort) |
| `use-neuralops.ts` | Single hook: WS connection, state, submitAct, resetDemo |
| `colors.ts` | Hue → Tailwind class maps (6 families) |
| `act-badge.tsx` | Colored badge + status dot |
| `header.tsx` | Sticky header + architecture strip + sticky footer |
| `agent-card.tsx` | Agent card (name, model, role, authority) |
| `task-card.tsx` | Task card (status, progress, counts) |
| `workforce-section.tsx` | Agents + tasks grids |
| `coordination-console.tsx` | 8 scenario buttons + pending approvals |
| `shared-work-state.tsx` | Compaction comparison panels |
| `work-ledger.tsx` | Live event stream |

## 16.5 Dependencies

### Backend (mini-service)

```json
{
  "dependencies": {
    "socket.io": "^4.7.5",
    "zod": "^3.23.8"
  }
}
```

### Frontend (Next.js, additions only)

```json
{
  "added": {
    "socket.io-client": "^4.8.4"
  }
}
```

All other frontend deps (Next.js 16, React 19, Tailwind 4, shadcn/ui, lucide-react, framer-motion, sonner, zustand, etc.) were already in the project.

## 16.6 Ports

| Service | Port | Purpose |
|---------|------|---------|
| Caddy | 81 | Gateway (Preview Panel entry point) |
| Next.js dev | 3000 | Dashboard |
| NeuralOps MCP | 3031 | Coordination Core |

## 16.7 Total lines of code

```
Backend (mini-service):  ~1,890 lines TypeScript
Frontend (dashboard):     ~1,200 lines TypeScript/TSX
─────────────────────────────────────
Total:                    ~3,090 lines
```

Plus this documentation package (~2,000 lines markdown).
