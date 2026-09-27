# NeuralOps MCP — Protocol Inspector (Dashboard)

> V0.1.1: 10 scenario buttons (accept-handoff aur self-approval-rejected add hue); "approval required" sirf asli gate pe; approvals panel "USED" dikhata hai. Dekhein §17.11.

## 10.1 What it is

> A visualization layer — NOT the product.
> Like RedisInsight or pgAdmin. Lets you SEE the protocol execute.

Built at Next.js `/` route. Single page, 5 sections.

## 10.2 Sections (in scroll order)

### Section A: Header (sticky top)

- Left: "NeuralOps MCP" wordmark + "AI Workforce Coordination Protocol" tagline + V0.1 badge
- Right: Connection status pill (green "Connected" / red "Disconnected") + "Reset demo" button
- Below: Architecture strip — Claude/Codex/Gemini/Qwen model badges → arrow → "NeuralOps MCP" box → arrow → "Shared Work State"

### Section B: The Workforce

- **Agents grid:** Each card shows name, model badge (color-coded), role, "reports to: X", status dot (pulses when busy), owned-task chips, expandable authority scopes list
- **Tasks grid:** Each card shows id, status badge (color by status), progress bar, objective excerpt, owner/blocked/pending-handoff chips, decision/evidence/handoff count badges. Click to select for compaction.

### Section C: Coordination Console (interactive)

- Helper text: "Trigger typed acts as any agent. Acts mutate state; the ledger records every delta."
- **8 scenario buttons** (auto-enable/disable based on live state):
  1. Security → claim task_43
  2. Backend → handoff task_42 to Security (review)
  3. Backend → complete task_42 (deploy) [triggers approval]
  4. Architect → authorize latest approval (disabled if no pending approval)
  5. Backend → complete task_42 (deploy, now approved) (disabled until authorized)
  6. QA → escalate task_44 to Architect
  7. Architect → decide on task_42
  8. Security → record evidence on task_42
- Buttons colored by family: emerald (task), amber (handoff), rose (authority), sky (information)
- Each button shows inline result (ok/failed, approval created?, error message)
- **Pending Approvals sub-panel:** Lists all `status=pending` approvals with "Authorize" / "Deny" buttons (acting as the approver agent)

### Section D: Shared Work State — Context Compaction (the killer feature)

- Title: "Shared Work State — Context Compaction"
- Task selector (chips for all tasks; defaults to task_42)
- **Side-by-side panels:**
  - LEFT: "Full raw context" — `<pre>` showing `fullFormatted` string + token count badge (estimate)
  - RIGHT: "Compacted context" — `<pre>` showing `compactedFormatted` string + token count badge (estimate) + big "−N% tokens" reduction banner (≈70% fresh seed, ≈81% after golden path)
- Below: explanation — "Agent B requests get_task_context(task_id) and receives the compacted snapshot — shared knowledge without shared token waste. Deeper detail available on-demand via get_evidence / get_decision."
- Auto-refetches when new ledger events arrive
- Skeleton loaders during fetch
- Graceful empty state for tasks with no history

### Section E: Work Ledger (real-time event stream)

- Title: "Work Ledger — immutable event stream"
- Live reverse-chronological list (max 50 items, scrollable)
- Each row: colored ActBadge (by family), actor, deltaSummary, taskId, monospace timestamp
- Expandable before→after JSON delta on click
- New events animate in via framer-motion (subtle fade/slide)
- Header shows total ledger event count

### Footer (sticky bottom, mt-auto)

- "NeuralOps MCP — AI Workforce Coordination Protocol (V0.1 demo)"
- Connection status
- Note: "Coordination Core runs on port 3031"

## 10.3 Tech stack (frontend)

- Next.js 16 App Router, TypeScript, `'use client'`
- shadcn/ui (New York) — existing components (card, button, badge, tabs, scroll-area, separator, progress, avatar, tooltip, dialog)
- lucide-react icons
- socket.io-client (for WS)
- Tailwind CSS 4 with theme tokens
- framer-motion (event animation)
- sonner (toast notifications on every act result + ledger event)

## 10.4 Single hook: `useNeuralOps()`

- Connects WS: `io('/?XTransformPort=3031')`
- Holds: latest `state:snapshot`, connection status, `lastLedgerEvent`, `lastResult`, families, `submitAct()`, `resetDemo()`
- SSR-guarded (no hydration mismatch)
- Polling fallback every 3s when WS drops
- Sonner toasts on every ledger event + act result

```typescript
const {
  state,              // latest state:snapshot
  connectionStatus,   // 'connected' | 'disconnected' | 'connecting'
  lastLedgerEvent,    // for animations
  lastResult,         // last act result for toast
  families,           // act type → family map
  submitAct,           // (type, from, payload) => Promise<ActResult>
  resetDemo,           // () => Promise<void>
} = useNeuralOps()
```

## 10.5 Color system (no indigo/blue)

| Family | Hue | Use |
|--------|-----|-----|
| task | emerald | lifecycle (claim, complete) |
| handoff | amber | ownership transfer |
| information | sky | facts (decision, evidence) |
| conversation | violet | short exchanges |
| authority | rose | approval/escalation |
| lifecycle | slate | subscription signals |

Task status colors:

| Status | Color |
|--------|-------|
| unclaimed | slate |
| in_progress | emerald |
| blocked | rose |
| handoff_pending | amber |
| completed | emerald (dark) |
| failed | red |

Model badge colors:

| Model | Hue |
|-------|-----|
| Claude | orange |
| Codex | teal |
| Gemini | violet |
| Qwen | cyan |
| GPT | green |
| Custom | slate |

## 10.6 Accessibility

- Semantic HTML (`main`, `header`, `section`)
- ARIA labels for interactive elements
- Keyboard navigation (all buttons reachable via Tab)
- Screen reader friendly (sr-only text where needed)
- Touch targets ≥ 44px

## 10.7 Responsive design

- Mobile-first: single column stack on small screens
- Desktop: multi-column grids (agents, tasks)
- Sticky header + footer work on all sizes
- Coordination console buttons wrap on mobile
