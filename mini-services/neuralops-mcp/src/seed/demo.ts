// Demo seed — a realistic multi-agent workspace.
//
// Deterministic given `seededAt`, so replaying the journal (genesis + acts)
// rebuilds exactly the same state.

import { sha256, store } from '../state/store.js'
import type {
  Agent,
  AuthorityScope,
  Decision,
  Evidence,
  Policy,
  Task,
  Workspace,
} from '../state/types.js'
import type { ActType } from '../protocol/act-types.js'
import { demoToken } from '../engines/agents.js'

const direct = (action: string, scope: string, self: string): AuthorityScope => ({
  action,
  scope,
  requiresApproval: false,
  approver: self,
})

function baseTask(partial: Partial<Task> & Pick<Task, 'id' | 'title' | 'objective' | 'createdAt'>): Task {
  return {
    workspaceId: 'ws_engineering',
    status: 'unclaimed',
    assignee: null,
    claims: [],
    handoffs: [],
    decisionIds: [],
    evidenceIds: [],
    constraints: [],
    openItems: [],
    nextSteps: [],
    gates: [],
    clearances: [],
    resultRef: null,
    progress: 0,
    eta: null,
    blockedReason: null,
    pendingHandoffTo: null,
    escalatedTo: null,
    createdBy: 'agent.architect',
    updatedAt: partial.createdAt,
    ...partial,
  }
}

/** Populates an EMPTY store with the Engineering demo. Caller resets first. */
export function applyDemoSeed(seededAt: string): void {
  const NOW = new Date(seededAt).getTime()
  const iso = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString()

  const ws: Workspace = {
    id: 'ws_engineering',
    name: 'Engineering',
    description:
      'A shared workspace where Claude (Architect), Codex (Backend), Gemini (QA), and Qwen (Security) coordinate through NeuralOps.',
    createdAt: iso(600),
  }
  store.workspaces.set(ws.id, ws)

  // --- policies (gatekeeping) ---
  const policies: Omit<Policy, 'id'>[] = [
    { action: 'complete', scope: 'production', approver: 'agent.architect' },
    { action: 'deploy', scope: 'production', approver: 'agent.architect' },
  ]
  for (const p of policies) {
    const id = store.nextId('policy')
    store.policies.set(id, { id, ...p })
  }

  // --- agents ---
  const agents: Agent[] = [
    {
      id: 'agent.ceo', workspaceId: ws.id, name: 'CEO', model: 'Claude', role: 'ceo', reportsTo: null,
      authority: [direct('*', '*', 'agent.ceo')],
      status: 'online', subscriptions: ['workspace'], createdAt: iso(590),
    },
    {
      id: 'agent.architect', workspaceId: ws.id, name: 'Architect', model: 'Claude', role: 'architect', reportsTo: 'agent.ceo',
      authority: [
        direct('deploy', 'production', 'agent.architect'),
        direct('complete', 'production', 'agent.architect'),
        direct('govern', '*', 'agent.architect'),
      ],
      status: 'online', subscriptions: ['workspace'], createdAt: iso(590),
    },
    {
      id: 'agent.backend', workspaceId: ws.id, name: 'Backend Dev', model: 'Codex', role: 'backend', reportsTo: 'agent.architect',
      authority: [], status: 'busy', subscriptions: ['task_42'], createdAt: iso(580),
    },
    {
      id: 'agent.qa', workspaceId: ws.id, name: 'QA Engineer', model: 'Gemini', role: 'qa', reportsTo: 'agent.architect',
      authority: [], status: 'online', subscriptions: ['workspace'], createdAt: iso(580),
    },
    {
      id: 'agent.security', workspaceId: ws.id, name: 'Security', model: 'Qwen', role: 'security', reportsTo: 'agent.ceo',
      // Veto power: may deny any production approval.
      authority: [direct('deny', 'production', 'agent.security')],
      status: 'online', subscriptions: ['workspace'], createdAt: iso(580),
    },
    {
      // CI pipeline identity: its evidence counts as VERIFIED (attest authority).
      id: 'agent.ci', workspaceId: ws.id, name: 'CI Pipeline', model: 'Custom', role: 'ci', reportsTo: 'agent.architect',
      authority: [direct('attest', '*', 'agent.ci')],
      status: 'online', subscriptions: ['workspace'], createdAt: iso(570),
    },
  ]
  for (const a of agents) {
    a.revokedAt = null
    store.agents.set(a.id, a)
    store.tokenHashes.set(sha256(demoToken(a.id)), { agentId: a.id, expiresAt: null })
  }

  // --- task 42: build auth module (gated for production) ---
  const task42 = baseTask({
    id: 'task_42',
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
      { from: 'agent.architect', to: 'agent.backend', intent: 'implement', timestamp: iso(310), accepted: true, acceptedAt: iso(300), statusBefore: 'in_progress' },
    ],
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
    gates: [{ action: 'complete', scope: 'production' }],
    progress: 65,
    createdAt: iso(420),
    updatedAt: iso(40),
  })
  store.tasks.set(task42.id, task42)

  const decisions: Omit<Decision, 'id'>[] = [
    {
      taskId: 'task_42',
      text: 'Session-based authentication selected over JWT for this service.',
      rationale: 'Existing infra uses Redis session store; JWT rotation adds complexity without clear benefit at current scale.',
      decidedBy: 'agent.architect', references: [], timestamp: iso(410),
    },
    {
      taskId: 'task_42',
      text: 'Passwords hashed with argon2id (memory-hard).',
      rationale: 'OWASP recommendation; resistant to GPU brute-force.',
      decidedBy: 'agent.architect', references: [], timestamp: iso(405),
    },
  ]
  const decisionIds = decisions.map((d) => {
    const id = store.nextId('decision')
    store.decisions.set(id, { id, ...d })
    task42.decisionIds.push(id)
    return id
  })

  const evidence: Omit<Evidence, 'id'>[] = [
    {
      taskId: 'task_42', type: 'result',
      summary: 'Backend implementation complete: login, logout, session validation, role checks.',
      ref: 'repo://api-gateway/src/auth/session.ts', producedBy: 'agent.backend',
      references: decisionIds, timestamp: iso(120), verified: false, verifiedBy: null,
    },
    {
      taskId: 'task_42', type: 'test',
      summary: '42 unit tests passed (auth flows, session expiry, role enforcement).',
      ref: 'ci://pipeline/8421', producedBy: 'agent.backend', references: [], timestamp: iso(90),
      verified: false, verifiedBy: null,
    },
  ]
  const evidenceIds = evidence.map((e) => {
    const id = store.nextId('evidence')
    store.evidence.set(id, { id, ...e })
    task42.evidenceIds.push(id)
    return id
  })

  history('status', 'agent.architect', 'task_42', 'scoped with backend', iso(415))
  history('handoff', 'agent.architect', 'task_42', 'handed off to backend (implement)', iso(310))
  history('status', 'agent.backend', 'task_42', 'implementation 40% — login + logout done', iso(200))
  history('evidence', 'agent.backend', 'task_42', `backend impl complete [${evidenceIds[0]}]`, iso(120))
  history('status', 'agent.backend', 'task_42', `tests passing [${evidenceIds[1]}], ready for security review`, iso(40))

  // --- task 43: security review ---
  store.tasks.set(
    'task_43',
    baseTask({
      id: 'task_43',
      title: 'Security review of auth module',
      objective:
        'Review the authentication implementation in task_42 for vulnerabilities (session fixation, CSRF, insecure cookie flags, timing attacks). Block deploy if critical issues found.',
      constraints: ['Must run before any production deploy of task_42.'],
      openItems: ['Awaiting claim from Security agent.'],
      nextSteps: ['Security agent should claim and review.'],
      createdAt: iso(35),
    })
  )

  // --- task 44: CI pipeline (blocked) ---
  store.tasks.set(
    'task_44',
    baseTask({
      id: 'task_44',
      title: 'Set up CI pipeline for auth module',
      objective:
        'Create GitHub Actions workflow running the auth test suite on every PR. Blocked on DevOps providing the runner image.',
      status: 'blocked',
      assignee: 'agent.qa',
      claims: [{ agentId: 'agent.qa', timestamp: iso(70), note: 'started but blocked' }],
      constraints: ['Runner image must include Node 20 + Redis 7.'],
      openItems: ['DevOps has not provided the runner image.'],
      nextSteps: ['Escalate to Architect or CEO if DevOps does not respond.'],
      progress: 20,
      blockedReason: 'Waiting on DevOps runner image (external dependency).',
      createdAt: iso(80),
      updatedAt: iso(30),
    })
  )
  history('block', 'agent.qa', 'task_44', 'Waiting on DevOps runner image (external dependency).', iso(30))
}

function history(type: ActType, actor: string, taskId: string, summary: string, timestamp: string): void {
  store.appendLedger({
    workspaceId: 'ws_engineering',
    actId: `act_hist_${store.ledger.length + 1}`,
    actType: type,
    actor,
    via: 'system',
    taskId,
    intent: null,
    before: {},
    after: {},
    references: [],
    deltaSummary: summary,
    timestamp,
    history: true,
  })
}

export const DEMO_AGENT_IDS = ['agent.ceo', 'agent.architect', 'agent.backend', 'agent.qa', 'agent.security', 'agent.ci']
