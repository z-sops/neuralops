// NeuralOps Coordination Core — In-Memory Store
//
// V0.1 uses an in-memory store. The API surface is stable so a Prisma-backed
// persistent store can replace it later without touching engines or the MCP layer.

import type {
  Agent,
  Approval,
  Decision,
  Evidence,
  LedgerEvent,
  Proposal,
  Question,
  Task,
  Workspace,
} from './types.js'
import { makeId } from '../protocol/envelope.js'

class Store {
  workspaces = new Map<string, Workspace>()
  agents = new Map<string, Agent>()
  tasks = new Map<string, Task>()
  decisions = new Map<string, Decision>()
  evidence = new Map<string, Evidence>()
  approvals = new Map<string, Approval>()
  questions = new Map<string, Question>()
  proposals = new Map<string, Proposal>()
  ledger: LedgerEvent[] = []
  acts: Map<string, import('../protocol/envelope.js').Act> = new Map()

  private seq = 0
  private subscribers: Array<(event: LedgerEvent) => void> = []

  nextSeq(): number {
    return ++this.seq
  }

  newId(prefix: string): string {
    return makeId(prefix)
  }

  // --- subscribers (for event broadcasting) ---
  subscribe(fn: (event: LedgerEvent) => void): () => void {
    this.subscribers.push(fn)
    return () => {
      this.subscribers = this.subscribers.filter((f) => f !== fn)
    }
  }

  emit(event: LedgerEvent): void {
    for (const fn of this.subscribers) fn(event)
  }

  appendLedger(event: LedgerEvent): void {
    this.ledger.push(event)
    this.emit(event)
  }

  // --- helpers ---
  tasksByWorkspace(wsId: string): Task[] {
    return Array.from(this.tasks.values()).filter((t) => t.workspaceId === wsId)
  }

  agentsByWorkspace(wsId: string): Agent[] {
    return Array.from(this.agents.values()).filter((a) => a.workspaceId === wsId)
  }

  decisionsForTask(taskId: string): Decision[] {
    return Array.from(this.decisions.values())
      .filter((d) => d.taskId === taskId)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  }

  evidenceForTask(taskId: string): Evidence[] {
    return Array.from(this.evidence.values())
      .filter((e) => e.taskId === taskId)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  }

  ledgerForTask(taskId: string): LedgerEvent[] {
    return this.ledger.filter((e) => e.taskId === taskId)
  }

  pendingApprovalsForApprover(agentId: string): Approval[] {
    return Array.from(this.approvals.values()).filter(
      (a) => a.approver === agentId && a.status === 'pending'
    )
  }

  reset(): void {
    this.workspaces.clear()
    this.agents.clear()
    this.tasks.clear()
    this.decisions.clear()
    this.evidence.clear()
    this.approvals.clear()
    this.questions.clear()
    this.proposals.clear()
    this.ledger = []
    this.acts.clear()
    this.seq = 0
  }
}

export const store = new Store()
