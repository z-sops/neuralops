# NeuralOps MCP — Architecture

## 3.1 High-level topology

```
                 CUSTOMER'S EXISTING AI WORKFORCE

        Claude       Codex       Gemini       Qwen
          │            │            │           │
          └────────────┼────────────┼───────────┘
                       │
                       ▼
              ┌──────────────────┐
              │  NEURALOPS MCP   │
              │  (Agent Door)    │  ← MCP/HTTP/WS interface
              └────────┬─────────┘
                       │
                       ▼
              ┌──────────────────┐
              │ Coordination     │
              │ Core             │
              │                  │
              │ • Task Manager   │
              │ • Authority      │
              │ • Context Engine │
              │ • Ledger         │
              │ • State Store    │
              └────────┬─────────┘
                       │
                       ▼
              Shared Work State
              (immutable events)
```

## 3.2 Critical architectural separation

> **MCP is NOT the coordination engine.**
> **MCP is the standardized door through which existing agents access the coordination engine.**

Iska implication:
- Coordination Core MCP se independent hai
- MCP ek transport hai (HTTP abhi, stdio/SSE future mein)
- Core ko kisi bhi transport pe baitha sakte hain
- Customer ke agents ko MCP support karna chahiye bas

## 3.3 The model-neutral coordination layer

NeuralOps doesn't care whether Developer agent is:
- Claude
- GPT
- Qwen
- Gemini
- custom Python agent

Customer apni hierarchy define karta hai:

```
Developer
reports_to: Engineering Manager

QA
reports_to: Engineering Manager

Security
reports_to: CTO
```

Phir:

```
Developer → production deployment
                  ↓
        NeuralOps Authority Check
                  ↓
         "Manager approval required."
```

## 3.4 Component map

```
mini-services/neuralops-mcp/
├── src/
│   ├── protocol/
│   │   ├── act-types.ts       # 23 act types, 6 families
│   │   ├── envelope.ts        # Act envelope + zod schema
│   │   └── payloads.ts        # per-act payload schemas
│   │
│   ├── state/
│   │   ├── types.ts           # all entity types
│   │   ├── store.ts           # store: views + hash-chained ledger + journal
│   │   └── token-estimate.ts  # chars/4 heuristic
│   │
│   ├── engines/
│   │   ├── task-manager.ts    # act dispatcher + state mutation
│   │   ├── authority.ts       # approval gating
│   │   └── context.ts         # compaction + comparison
│   │
│   ├── mcp/
│   │   └── tools.ts           # MCP tool registry + dispatcher
│   │
│   ├── seed/
│   │   └── demo.ts            # Engineering workspace seed
│   │
│   ├── server/
│   │   ├── http.ts            # REST API
│   │   └── ws.ts              # socket.io event stream
│   │
│   └── index.ts               # bootstrap (port 3031)
```

## 3.5 Internal modules

```
NeuralOps MCP
│
├── Agent Registry
├── Workspace State
├── Task Coordination
├── Agent Messaging
├── Handoffs
├── Context Engine
├── Compaction Engine
├── Authority Engine
├── Approval Engine
├── Evidence
├── Work Ledger
├── Event Stream
└── Cost / Token Tracking (internal, not yet exposed)
```

## 3.6 Transport layering

```
┌──────────────────────────────┐
│     Agent Interface (MCP)    │  ← tools: claim, complete, handoff...
├──────────────────────────────┤
│     Typed Coordination       │  ← acts validated, dispatched
├──────────────────────────────┤
│     Coordination Core        │  ← state, authority, context
├─────────────┬────────────────┤
│   Agent A   │  Agent B  │ Agent C  │  ← existing AI workers
└─────────────┴──────────┴───────────┘
```

## 3.7 Why this architecture is clean

Yeh design isliye strong hai kyunki:

1. **Model-neutral** — koi bhi AI agent connect ho sakta hai
2. **Transport-agnostic** — MCP, HTTP, WS, koi bhi transport
3. **State is centralized, agents are distributed** — single source of truth
4. **Acts are typed, not freeform** — discipline enforced
5. **MCP = door, not engine** — coordination logic transport se alag hai
