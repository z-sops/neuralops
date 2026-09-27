# NeuralOps MCP — Product Documentation Package

> **AI Workforce Coordination Protocol**
> V0.1 — Complete Product Summary

---

## Is package mein kya hai

Yeh folder NeuralOps MCP ke poore product ko documented karta hai — har feature, har design decision, har entity, har API endpoint, har act type.

## File structure

```
NeuralOps-MCP/
├── README.md                              ← yeh file (start here)
├── NeuralOps-MCP-Full-Summary.md          ← poora summary ek file mein
│
├── 01-Product-Identity.md                 ← naam, positioning, killer feature
├── 02-Problem-Solution.md                 ← kya problem, NeuralOps kya karta hai
├── 03-Architecture.md                     ← topology, components, separation
├── 04-Coordination-Protocol.md            ← act envelope, 22 acts, 6 families
├── 05-State-Layer.md                      ← entities, ledger, design principle
├── 06-Engines.md                          ← task-manager, authority, context
├── 07-MCP-Tools.md                        ← 15 tools, transport abstraction
├── 08-API-Reference.md                    ← REST + WebSocket full reference
├── 09-Demo-Seed.md                        ← Engineering workspace scenario
├── 10-Protocol-Inspector.md               ← dashboard sections + tech stack
├── 11-Infrastructure.md                   ← persistence, gateway routing
├── 12-Real-vs-Demo.md                     ← kya real hai, kya nahi
├── 13-Roadmap.md                          ← V0.2 → V1.0
├── 14-Verification.md                     ← browser-verified status
├── 15-Design-Principles.md               ← 10 core principles
└── 16-Files-Index.md                      ← sab files ka index
```

## Kaise read karein

- **Quick overview:** `README.md` + `01-Product-Identity.md`
- **Concept samajhna:** `02-Problem-Solution.md` + `04-Coordination-Protocol.md`
- **Technical deep dive:** `05-State-Layer.md` + `06-Engines.md` + `08-API-Reference.md`
- **Demo chalana:** `09-Demo-Seed.md`
- **Build karne wale ke liye:** `03-Architecture.md` + `16-Files-Index.md`
- **Sab kuch ek file mein:** `NeuralOps-MCP-Full-Summary.md`

## TL;DR (30 seconds)

NeuralOps MCP ek **coordination layer** hai jo customer ke existing AI agents (Claude, Codex, Gemini, Qwen) ke beech baith ke unhe organize karta hai. Yeh agents ko replace nahi karta — unhe ek shared workplace deta hai jahan:

1. **Typed acts** se communicate karte hain (claim, handoff, complete, decision, evidence, approval — 22 types total)
2. **Immutable ledger** mein har kaam record hota hai with before→after deltas
3. **Authority engine** enforce karta hai kaun kya kar sakta hai (production deploy ke liye approval chahiye)
4. **Context compaction** se ek agent ka 20k token context doosre agent ko 2k mein transfer hota hai — **71% token reduction** demo mein verified

Protocol real hai, demo agents fake hain. Real agent (Claude Code via MCP) same `neuralops.claim_task()` call karega jo UI button abhi karta hai.

## Status

- ✅ Coordination Core (port 3031) — running, browser-verified
- ✅ Protocol Inspector dashboard (`/`) — running, golden path verified end-to-end
- ✅ 71% token compaction — verified on demo task
- ✅ Lint clean, zero console errors
- 📋 V0.2 roadmap ready (real MCP transport, Prisma, multi-workspace)

---

**Generated:** V0.1 demo build
**Live demo:** Preview Panel → `/` route
