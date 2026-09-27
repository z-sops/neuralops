# NeuralOps MCP — Design Principles

## 15.1 The 10 core principles

### 1. Acts mutate state. Messages do not become the state.

Agent sirf "complete task 42" bolta hai. NeuralOps internally:
- BEFORE: status = in_progress
- ACT: complete(task_42)
- AFTER: status = completed, completed_by = Agent_A, result_ref = ...

State aur message alag hain. Yeh discipline enforce hoti hai.

### 2. MCP is the door, not the engine.

Coordination Core MCP se independent hai. MCP ek transport hai (HTTP abhi, stdio/SSE future mein). Core ko kisi bhi transport pe baitha sakte hain.

```
┌──────────────────────────────┐
│     Agent Interface (MCP)    │  ← door
├──────────────────────────────┤
│     Typed Coordination       │
├──────────────────────────────┤
│     Coordination Core        │  ← engine
└──────────────────────────────┘
```

### 3. Payload deliberately small. Rich state lives in the core.

Act envelope ka payload chhota hota hai — sirf typed fields. Full state Coordination Core mein rehta hai. Agent ko poora context bhejne ki zaroorat nahi.

### 4. Files don't travel. References + summaries travel.

Agent B ko file nahi milti. Usko reference milta hai:
```
evidence: { type: "test", summary: "42 tests passed", ref: "ci://pipeline/8421" }
```

Dump files (debug.log, scratch.notes) NeuralOps ko dikhte hi nahi. Sirf deliberate evidence record hoti hai.

### 5. Evidence is a deliberate act, not automatic dump.

Agent A ko khud sochna padta hai:
```
debug.log          → ❌ nahi record karna
failed-attempt.ts  → ❌ nahi record karna
test-output.txt    → ✅ record karna as evidence type="test"
auth.ts            → ✅ record karna as evidence type="result"
```

Evidence act explicit hai (`neuralops.evidence({type, summary, ref})`). Jo cheez record nahi hoti, woh exist hi nahi karti.

### 6. Shared knowledge without shared token waste.

```
Agent A (20,000 tokens)
    ↓ Context Engine
Agent B (1,800 tokens) — same knowledge, 91% less tokens
```

On-demand deep retrieval (`get_evidence`, `get_decision`) jab zaroorat ho.

### 7. Model-neutral.

Developer agent chahe Claude ho ya Qwen — authority rules same. NeuralOps ko farq nahi padta. Customer apni hierarchy define karta hai, NeuralOps enforce karta hai.

### 8. Customer's agents stay where they are.

No migration. Just connect. Customer ke paas Claude Code + Codex + Gemini chal rahe hain — woh wahin chalte rahenge. Bas NeuralOps MCP connect karenge aur shared workplace mein aa jayenge.

### 9. Every coordination session produces durable state change OR explicitly terminates as non-actionable.

Agar kisi conversation ne koi decision, evidence ya task nahi banaya — woh wasted thi. Lekin agar info already ledger mein hai, artificial artifact banane ki zaroorat nahi. Conversation expire ho sakti hai.

### 10. Work Ledger is a VIEW. Event Stream is SOURCE OF TRUTH.

Task state, decisions, evidence — yeh sab materialized views hain ek immutable event stream ke upar. Replay se pura state reconstruct ho sakta hai. Audit, time-travel, debugging — sab possible.

## 15.2 Anti-principles (what NOT to do)

### ❌ Freeform messaging as primary API

`send_message("...")` nahi. Typed acts primary hain. Freeform sirf escape hatch (question/answer/proposal/counter).

### ❌ Files travel with handoffs

Raw files (code, logs) handoff ke saath nahi travel karte. Sirf references.

### ❌ Agents inherit another agent's full context

Agent B ko Agent A ka poora 20k context nahi chahiye. Usko compacted 2k context chahiye.

### ❌ Hard rule: every conversation produces artifact

Softened to: "durable state change OR explicit non-actionable termination." Production-realistic.

### ❌ NeuralOps replaces agents

Never. Agents remain where they are. NeuralOps coordinates them.

### ❌ NeuralOps is model-specific

Never. Model-neutral. Works with Claude, GPT, Qwen, Gemini, custom — all same.

## 15.3 The philosophy

NeuralOps is to AI workers what an operating system's process scheduler + IPC + filesystem is to programs:

- **Process scheduler** → Task Manager (who works on what)
- **IPC** → Typed acts (how they communicate)
- **Filesystem** → Work Ledger + Evidence (durable shared state)
- **Permissions** → Authority engine (who can do what)
- **Audit log** → Event stream (what happened when)

But for AI agents, not OS processes.
