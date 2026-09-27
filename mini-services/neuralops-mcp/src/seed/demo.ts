// Demo seed — a realistic multi-agent workspace.
//
// This is what a customer's "already running" AI workforce looks like once
// connected to NeuralOps. Agents are pre-registered, tasks carry history
// (decisions, evidence, handoffs) so the compaction value is immediately
// visible, and a pending approval flow is ready to exercise.

import { store } from '../state/store.js'
import type {
  Agent,
  AuthorityScope,
  Decision,
  Evidence,
  Task,
  Workspace,
} from '../state/types.js'

const NOW = Date.now()
const iso = (minutesAgo: number) =>
  new Date(NOW - minutesAgo * 60_000).toISOString()

export function seedDemo(): void {
  store.reset()

  // --- workspace ---
  const ws: Workspace = {
    id: 'ws_engineering',
    name: 'Engineering',
    description:
      'A shared workspace where Claude (Architect), Codex (Backend), Gemini (QA), and Qwen (Security) coordinate through NeuralOps.',
    createdAt: iso(600),
  }
  store.workspaces.set(ws.id, ws)

  // --- authority rules ---
  // Architect holds direct authority to deploy/complete in production.
  // Architect is also the named approver for production completions by others
  // (gatekeeping rule). Security can deny deployments.
  const architectAuthority: AuthorityScope[] = [
    { action: 'deploy', scope: 'production', requiresApproval: false, approver: 'agent.architect' },
    { action: 'complete', scope: 'production', requiresApproval: false, approver: 'agent.architect' },
    { action: 'complete', scope: 'production', requiresApproval: true, approver: 'agent.architect' },
  ]
  const securityAuthority: AuthorityScope[] = [
    { action: 'deny', scope: 'deploy', requiresApproval: false, approver: 'agent.security' },
  ]
  const ceoAuthority: AuthorityScope[] = [
    { action: '*', scope: '*', requiresApproval: false, approver: 'agent.ceo' },
  ]

  // --- agents ---
  const agents: Agent[] = [
    {
      id: 'agent.ceo',
      workspaceId: ws.id,
      name: 'CEO',
      model: 'Claude',
      role: 'ceo',
      reportsTo: null,
      authority: ceoAuthority,
      status: 'online',
      subscriptions: ['workspace'],
      createdAt: iso(590),
    },
    {
      id: 'agent.architect',
      workspaceId: ws.id,
      name: 'Architect',
      model: 'Claude',
      role: 'architect',
      reportsTo: 'agent.ceo',
      authority: architectAuthority,
      status: 'online',
      subscriptions: ['workspace'],
      createdAt: iso(590),
    },
    {
      id: 'agent.backend',
      workspaceId: ws.id,
      name: 'Backend Dev',
      model: 'Codex',
      role: 'backend',
      reportsTo: 'agent.architect',
      authority: [],
      status: 'busy',
      subscriptions: ['task_42'],
      createdAt: iso(580),
    },
    {
      id: 'agent.qa',
      workspaceId: ws.id,
      name: 'QA Engineer',
      model: 'Gemini',
      role: 'qa',
      reportsTo: 'agent.architect',
      authority: [],
      status: 'online',
      subscriptions: ['workspace'],
      createdAt: iso(580),
    },
    {
      id: 'agent.security',
      workspaceId: ws.id,
      name: 'Security',
      model: 'Qwen',
      role: 'security',
      reportsTo: 'agent.ceo',
      authority: securityAuthority,
      status: 'online',
      subscriptions: ['workspace'],
      createdAt: iso(580),
    },
  ]
  for (const a of agents) store.agents.set(a.id, a)

  // --- task 42: build auth module (in progress, owner backend, rich history) ---
  const task42: Task = {
    id: 'task_42',
    workspaceId: ws.id,
    title: 'Build authentication module',
    objective:
      'Implement a session-based authentication module for the API gateway. Must support login, logout, session validation, and role checks. No production modification until security review is complete.',
    status: 'in_progress',
    assignee: 'agent.backend',
    claims: [
      { agentId: 'agent.architect', timestamp: iso(420), note: 'initial scoping' },
      { agentId: 'agent.backend', timestamp: iso(300), note: 'taking implementation' },
    ],
    handoffs: [
      {
        from: 'agent.architect',
        to: 'agent.backend',
        intent: 'implement',
        timestamp: iso(310),
        accepted: true,
        acceptedAt: iso(300),
      },
    ],
    decisionIds: [],
    evidenceIds: [],
    constraints: [
      'No production modification until security review is complete.',
      'Must use the existing session store (Redis).',
      'Passwords must be hashed with argon2.',
    ],
    openItems: [
      'Security review pending — Security agent must review before deploy.',
      'Rate limiting on login endpoint not yet decided.',
    ],
    nextSteps: [
      'Security agent must review the implementation.',
      'QA must write integration tests for session expiry.',
    ],
    resultRef: null,
    progress: 65,
    blockedReason: null,
    pendingHandoffTo: null,
    createdAt: iso(420),
    updatedAt: iso(40),
  }
  store.tasks.set(task42.id, task42)

  // Decisions on task 42
  const d1: Decision = {
    id: 'decision_0001',
    taskId: 'task_42',
    text: 'Session-based authentication selected over JWT for this service.',
    rationale:
      'Existing infra uses Redis session store; JWT rotation adds complexity without clear benefit at current scale.',
    decidedBy: 'agent.architect',
    references: [],
    timestamp: iso(410),
  }
  const d2: Decision = {
    id: 'decision_0002',
    taskId: 'task_42',
    text: 'Passwords hashed with argon2id (memory-hard).',
    rationale: 'OWASP recommendation; resistant to GPU brute-force.',
    decidedBy: 'agent.architect',
    references: [],
    timestamp: iso(405),
  }
  store.decisions.set(d1.id, d1)
  store.decisions.set(d2.id, d2)
  task42.decisionIds.push(d1.id, d2.id)

  // Evidence on task 42
  const e1: Evidence = {
    id: 'evidence_0001',
    taskId: 'task_42',
    type: 'result',
    summary: 'Backend implementation complete: login, logout, session validation, role checks.',
    ref: 'repo://api-gateway/src/auth/session.ts',
    producedBy: 'agent.backend',
    references: [d1.id, d2.id],
    timestamp: iso(120),
  }
  const e2: Evidence = {
    id: 'evidence_0002',
    taskId: 'task_42',
    type: 'test',
    summary: '42 unit tests passed (auth flows, session expiry, role enforcement).',
    ref: 'ci://pipeline/8421',
    producedBy: 'agent.backend',
    references: [],
    timestamp: iso(90),
  }
  store.evidence.set(e1.id, e1)
  store.evidence.set(e2.id, e2)
  task42.evidenceIds.push(e1.id, e2.id)

  // A few status updates recorded in the ledger (history)
  pushHistory('status', 'agent.architect', 'task_42', 10, 'scoped with backend', iso(415))
  pushHistory('handoff', 'agent.architect', 'task_42', 20, 'handed off to backend (implement)', iso(310))
  pushHistory('status', 'agent.backend', 'task_42', 30, 'implementation 40% — login + logout done', iso(200))
  pushHistory('evidence', 'agent.backend', 'task_42', 40, 'backend impl complete [evidence_0001]', iso(120))
  pushHistory('status', 'agent.backend', 'task_42', 65, 'tests passing [evidence_0002], ready for security review', iso(40))

  // --- task 43: security review (unclaimed, depends on 42) ---
  const task43: Task = {
    id: 'task_43',
    workspaceId: ws.id,
    title: 'Security review of auth module',
    objective:
      'Review the authentication implementation in task_42 for vulnerabilities (session fixation, CSRF, insecure cookie flags, timing attacks). Block deploy if critical issues found.',
    status: 'unclaimed',
    assignee: null,
    claims: [],
    handoffs: [],
    decisionIds: [],
    evidenceIds: [],
    constraints: ['Must run before any production deploy of task_42.'],
    openItems: ['Awaiting claim from Security agent.'],
    nextSteps: ['Security agent should claim and review.'],
    resultRef: null,
    progress: 0,
    blockedReason: null,
    pendingHandoffTo: null,
    createdAt: iso(35),
    updatedAt: iso(35),
  }
  store.tasks.set(task43.id, task43)

  // --- task 44: CI pipeline (blocked, escalate-ready) ---
  const task44: Task = {
    id: 'task_44',
    workspaceId: ws.id,
    title: 'Set up CI pipeline for auth module',
    objective:
      'Create GitHub Actions workflow running the auth test suite on every PR. Blocked on DevOps providing the runner image.',
    status: 'blocked',
    assignee: 'agent.qa',
    claims: [{ agentId: 'agent.qa', timestamp: iso(70), note: 'started but blocked' }],
    handoffs: [],
    decisionIds: [],
    evidenceIds: [],
    constraints: ['Runner image must include Node 20 + Redis 7.'],
    openItems: ['DevOps has not provided the runner image.'],
    nextSteps: ['Escalate to Architect or CEO if DevOps does not respond.'],
    resultRef: null,
    progress: 20,
    blockedReason: 'Waiting on DevOps runner image (external dependency).',
    pendingHandoffTo: null,
    createdAt: iso(80),
    updatedAt: iso(30),
  }
  store.tasks.set(task44.id, task44)
  pushHistory('block', 'agent.qa', 'task_44', 25, 'Waiting on DevOps runner image (external dependency).', iso(30))
}

// Helper to push a synthetic ledger event for pre-seeded history.
function pushHistory(
  type: string,
  actor: string,
  taskId: string,
  seq: number,
  summary: string,
  timestamp: string
): void {
  // We don't re-run the full act pipeline for history; we just record a ledger
  // entry so the inspector's act stream looks realistic.
  const event = {
    id: `evt_hist_${seq}`,
    seq: store.nextSeq(),
    workspaceId: 'ws_engineering',
    actId: `act_hist_${seq}`,
    actType: type as never,
    actor,
    taskId,
    intent: null,
    before: {},
    after: {},
    references: [],
    deltaSummary: summary,
    timestamp,
  }
  store.ledger.push(event)
}
