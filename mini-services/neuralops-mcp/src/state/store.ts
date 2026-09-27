// NeuralOps Coordination Core — Store
//
// Holds materialized views (agents, tasks, decisions, …), the hash-chained
// ledger, and the act journal. The journal is the source of truth: replaying it
// on an empty store reproduces every view byte-for-byte (see engines/replay.ts).
//
// Ids are deterministic (per-prefix counters) so replay reproduces them exactly.

import { createHash } from 'node:crypto'
import type {
  Agent,
  Approval,
  Decision,
  Evidence,
  JournalRecord,
  LedgerEvent,
  Policy,
  Proposal,
  Question,
  Task,
  Workspace,
} from './types.js'
import type { Act } from '../protocol/envelope.js'

export const GENESIS_HASH = '0'.repeat(64)

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

// Deterministic JSON (sorted keys) for hashing.
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(',')}}`
}

export function hashLedgerBody(e: Omit<LedgerEvent, 'hash'>): string {
  const { ...body } = e
  return sha256(e.prevHash + stableStringify(body))
}

type LedgerListener = (event: LedgerEvent) => void
type SnapshotListener = () => void
type JournalListener = (rec: JournalRecord) => void

interface StoreData {
  workspaces: Map<string, Workspace>
  agents: Map<string, Agent>
  tasks: Map<string, Task>
  decisions: Map<string, Decision>
  evidence: Map<string, Evidence>
  approvals: Map<string, Approval>
  questions: Map<string, Question>
  proposals: Map<string, Proposal>
  policies: Map<string, Policy>
  tokenHashes: Map<string, string> // sha256(token) → agent id
  ledger: LedgerEvent[]
  acts: Map<string, Act>
  counters: Record<string, number>
  actSeq: number
  journal: JournalRecord[]
}

function emptyData(): StoreData {
  return {
    workspaces: new Map(),
    agents: new Map(),
    tasks: new Map(),
    decisions: new Map(),
    evidence: new Map(),
    approvals: new Map(),
    questions: new Map(),
    proposals: new Map(),
    policies: new Map(),
    tokenHashes: new Map(),
    ledger: [],
    acts: new Map(),
    counters: {},
    actSeq: 0,
    journal: [],
  }
}

export class Store {
  private d: StoreData = emptyData()
  private ledgerListeners: LedgerListener[] = []
  private snapshotListeners: SnapshotListener[] = []
  private journalListeners: JournalListener[] = []
  /** While muted (replay, integrity check) nothing is broadcast or persisted. */
  muted = false

  get workspaces() { return this.d.workspaces }
  get agents() { return this.d.agents }
  get tasks() { return this.d.tasks }
  get decisions() { return this.d.decisions }
  get evidence() { return this.d.evidence }
  get approvals() { return this.d.approvals }
  get questions() { return this.d.questions }
  get proposals() { return this.d.proposals }
  get policies() { return this.d.policies }
  get tokenHashes() { return this.d.tokenHashes }
  get ledger(): readonly LedgerEvent[] { return this.d.ledger }
  get acts() { return this.d.acts }
  get journal(): readonly JournalRecord[] { return this.d.journal }

  // ---- ids & sequences ----
  nextId(prefix: string, exists?: (id: string) => boolean): string {
    for (;;) {
      const n = (this.d.counters[prefix] = (this.d.counters[prefix] ?? 0) + 1)
      const candidate = `${prefix}_${String(n).padStart(4, '0')}`
      if (!exists || !exists(candidate)) return candidate
    }
  }

  nextActSeq(): number {
    return ++this.d.actSeq
  }

  /** Replay: acts carry their original seq. */
  setActSeq(seq: number): void {
    this.d.actSeq = Math.max(this.d.actSeq, seq)
  }

  exportCounters(): { counters: Record<string, number>; actSeq: number } {
    return { counters: { ...this.d.counters }, actSeq: this.d.actSeq }
  }

  restoreCounters(c: { counters: Record<string, number>; actSeq: number }): void {
    this.d.counters = { ...c.counters }
    this.d.actSeq = c.actSeq
  }

  // ---- ledger (hash chained) ----
  get ledgerHead(): string {
    const last = this.d.ledger[this.d.ledger.length - 1]
    return last ? last.hash : GENESIS_HASH
  }

  appendLedger(e: Omit<LedgerEvent, 'id' | 'seq' | 'prevHash' | 'hash'>): LedgerEvent {
    const seq = this.d.ledger.length + 1
    const body: Omit<LedgerEvent, 'hash'> = {
      ...e,
      id: `evt_${String(seq).padStart(4, '0')}`,
      seq,
      prevHash: this.ledgerHead,
    }
    const event: LedgerEvent = { ...body, hash: hashLedgerBody(body) }
    this.d.ledger.push(event)
    if (!this.muted) for (const fn of this.ledgerListeners) fn(event)
    return event
  }

  verifyChain(): { valid: boolean; brokenAt: number | null } {
    let prev = GENESIS_HASH
    for (const e of this.d.ledger) {
      const { hash, ...body } = e
      if (e.prevHash !== prev || hashLedgerBody(body) !== hash) {
        return { valid: false, brokenAt: e.seq }
      }
      prev = hash
    }
    return { valid: true, brokenAt: null }
  }

  // ---- journal ----
  journalAppend(rec: JournalRecord): void {
    this.d.journal.push(rec)
    if (!this.muted) for (const fn of this.journalListeners) fn(rec)
  }

  // ---- listeners ----
  onLedger(fn: LedgerListener): () => void {
    this.ledgerListeners.push(fn)
    return () => (this.ledgerListeners = this.ledgerListeners.filter((f) => f !== fn))
  }
  onSnapshot(fn: SnapshotListener): () => void {
    this.snapshotListeners.push(fn)
    return () => (this.snapshotListeners = this.snapshotListeners.filter((f) => f !== fn))
  }
  onJournal(fn: JournalListener): () => void {
    this.journalListeners.push(fn)
    return () => (this.journalListeners = this.journalListeners.filter((f) => f !== fn))
  }
  /** Tell observers the whole state changed (reset, reseed, replay). */
  broadcastSnapshot(): void {
    if (!this.muted) for (const fn of this.snapshotListeners) fn()
  }

  // ---- queries ----
  decisionsForTask(taskId: string): Decision[] {
    return [...this.d.decisions.values()]
      .filter((x) => x.taskId === taskId)
      .sort((a, b) => a.id.localeCompare(b.id))
  }
  evidenceForTask(taskId: string): Evidence[] {
    return [...this.d.evidence.values()]
      .filter((x) => x.taskId === taskId)
      .sort((a, b) => a.id.localeCompare(b.id))
  }
  ledgerForTask(taskId: string): LedgerEvent[] {
    return this.d.ledger.filter((e) => e.taskId === taskId)
  }
  approvalsForTask(taskId: string): Approval[] {
    return [...this.d.approvals.values()].filter((a) => a.taskId === taskId)
  }

  // ---- lifecycle ----
  reset(): void {
    this.d = emptyData()
  }

  /** Deep copy of all data (used by the integrity check to restore state). */
  exportData(): StoreData {
    return structuredClone(this.d)
  }
  importData(data: StoreData): void {
    this.d = structuredClone(data)
  }

  /** Hash of every materialized view. Equal hashes ⇒ identical state. */
  stateHash(): string {
    const views = {
      workspaces: [...this.d.workspaces.values()],
      agents: [...this.d.agents.values()],
      tasks: [...this.d.tasks.values()],
      decisions: [...this.d.decisions.values()],
      evidence: [...this.d.evidence.values()],
      approvals: [...this.d.approvals.values()],
      questions: [...this.d.questions.values()],
      proposals: [...this.d.proposals.values()],
      policies: [...this.d.policies.values()],
      tokenHashes: [...this.d.tokenHashes.entries()],
      ledgerHead: this.ledgerHead,
      counters: this.d.counters,
      actSeq: this.d.actSeq,
    }
    return sha256(stableStringify(views))
  }
}

export const store = new Store()
