# NeuralOps MCP — Product Documentation Package

> **AI Workforce Coordination Protocol**
> V0.1.2 — Security build (see `17-V0.1.1-Hardening.md` and `18-V0.1.2-Security.md`)

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
├── 04-Coordination-Protocol.md            ← act envelope, 23 acts, 6 families
├── 05-State-Layer.md                      ← entities, ledger, design principle
├── 06-Engines.md                          ← task-manager, authority, context
├── 07-MCP-Tools.md                        ← 34 tools, real MCP stdio transport
├── 08-API-Reference.md                    ← REST + WebSocket full reference
├── 09-Demo-Seed.md                        ← Engineering workspace scenario
├── 10-Protocol-Inspector.md               ← dashboard sections + tech stack
├── 11-Infrastructure.md                   ← persistence, gateway routing
├── 12-Real-vs-Demo.md                     ← kya real hai, kya nahi
├── 13-Roadmap.md                          ← V0.2 → V1.0
├── 14-Verification.md                     ← browser-verified status
├── 15-Design-Principles.md               ← 10 core principles
├── 16-Files-Index.md                      ← sab files ka index
├── 17-V0.1.1-Hardening.md                 ← V0.1.1: fixes, MCP setup, tests
└── 18-V0.1.2-Security.md                  ← V0.1.2: gateway, signed journal, tokens, CI/hook enforcement
```

## Kaise read karein

- **Quick overview:** `README.md` + `01-Product-Identity.md`
- **Concept samajhna:** `02-Problem-Solution.md` + `04-Coordination-Protocol.md`
- **Technical deep dive:** `05-State-Layer.md` + `06-Engines.md` + `08-API-Reference.md`
- **Demo chalana:** `09-Demo-Seed.md`
- **Build karne wale ke liye:** `03-Architecture.md` + `16-Files-Index.md` + `17-V0.1.1-Hardening.md`
- **Sab kuch ek file mein:** `NeuralOps-MCP-Full-Summary.md`

## TL;DR (30 seconds)

NeuralOps MCP ek **coordination layer** hai jo customer ke existing AI agents (Claude, Codex, Gemini, Qwen) ke beech baith ke unhe organize karta hai. Yeh agents ko replace nahi karta — unhe ek shared workplace deta hai jahan:

1. **Typed acts** se communicate karte hain (claim, handoff, complete, decision, evidence, approval — 23 types total)
2. **Immutable ledger** mein har kaam record hota hai with before→after deltas
3. **Authority engine** enforce karta hai kaun kya kar sakta hai (production deploy ke liye approval chahiye)
4. **Context compaction**: agent ko poori history ki bajaye chhota structured snapshot milta hai — demo pe **~70–81% kam tokens** (chars/4 estimate)

Protocol real hai. Demo agents UI se chalte hain, aur asli agents (Claude Code, Codex) ab MCP stdio se connect ho kar wahi acts bhejte hain (setup: §17.7).

## Status

- ✅ Coordination Core (port 3031): persistent journal, hash-chained ledger, secure mode
- ✅ Real MCP stdio server (34 tools)
- ✅ Enforcement outside the model: Claude Code hook + GitHub required check + verified CI evidence
- ✅ Signed journal, token expiry/revoke/rotate, admin API, rate limiting, loopback-only by default
- ✅ Protocol Inspector: 10-step golden path browser-tested (Playwright)
- ✅ 101 automated tests; tsc + lint clean (frontend + backend)
- 📋 Next: multi-workspace, DB-backed journal, hooks for Codex/Gemini CLI

---

**Generated:** V0.1 demo build · **Hardened:** V0.1.1
**Live demo:** Preview Panel → `/` route
