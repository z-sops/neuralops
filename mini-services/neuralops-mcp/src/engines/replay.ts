// Event sourcing: genesis, replay, persistence, integrity.
//
// The journal (genesis + registrations + accepted acts) is the source of
// truth. Views and the hash-chained ledger are rebuilt from it by replay.

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { store } from '../state/store.js'
import type { JournalRecord } from '../state/types.js'
import { applyDemoSeed } from '../seed/demo.js'
import { applyRegister } from './agents.js'
import { processAct } from './task-manager.js'

export type SeedKind = 'demo' | 'empty'

function applyGenesis(seed: SeedKind, seededAt: string): void {
  store.reset()
  if (seed === 'demo') {
    applyDemoSeed(seededAt)
  } else {
    store.workspaces.set('ws_default', {
      id: 'ws_default',
      name: 'Default',
      description: 'NeuralOps workspace',
      createdAt: seededAt,
    })
  }
  store.journalAppend({ k: 'genesis', seed, seededAt, version: 1 })
}

/** Start a fresh history. Broadcasts + persists (unless muted). */
export function genesis(seed: SeedKind, seededAt = new Date().toISOString()): void {
  applyGenesis(seed, seededAt)
  store.broadcastSnapshot()
}

/** Rebuild everything from journal records. Throws on divergence. */
export function replay(records: readonly JournalRecord[]): void {
  const wasMuted = store.muted
  store.muted = true
  try {
    const [first, ...rest] = records
    if (!first || first.k !== 'genesis') throw new Error('Journal must start with a genesis record')
    applyGenesis(first.seed, first.seededAt)
    for (const rec of rest) {
      if (rec.k === 'genesis') throw new Error('Unexpected second genesis record')
      if (rec.k === 'register') {
        applyRegister(structuredClone(rec.agent), rec.tokenHash, rec.at)
      } else {
        const res = processAct(structuredClone(rec.act), { replay: true })
        if (!res.ok) throw new Error(`Replay diverged at ${rec.act.id}: ${res.error}`)
      }
    }
  } finally {
    store.muted = wasMuted
  }
}

/**
 * Integrity check: verify the ledger hash chain, then rebuild state from the
 * journal and compare hashes. Live state is restored afterwards.
 */
export function verifyIntegrity() {
  const chain = store.verifyChain()
  const liveHash = store.stateHash()
  const saved = store.exportData()
  let replayHash: string | null = null
  let replayError: string | null = null
  try {
    replay(saved.journal)
    replayHash = store.stateHash()
  } catch (e) {
    replayError = (e as Error).message
  } finally {
    store.importData(saved)
  }
  return {
    chainValid: chain.valid,
    chainBrokenAt: chain.brokenAt,
    replayMatches: replayHash === liveHash,
    replayError,
    stateHash: liveHash,
    ledgerHead: store.ledgerHead,
    ledgerLength: store.ledger.length,
    journalLength: store.journal.length,
  }
}

// ---------------------------------------------------------------- persistence

export class JournalFile {
  readonly path: string
  private unsubscribe: (() => void) | null = null

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true })
    this.path = join(dataDir, 'journal.jsonl')
  }

  load(): JournalRecord[] | null {
    if (!existsSync(this.path)) return null
    const text = readFileSync(this.path, 'utf8')
    const records: JournalRecord[] = []
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue
      try {
        records.push(JSON.parse(line) as JournalRecord)
      } catch {
        // A torn final line (crash mid-write) is dropped; anything else is fatal.
        if (i >= lines.length - 2) break
        throw new Error(`Corrupt journal at line ${i + 1}`)
      }
    }
    return records.length ? records : null
  }

  /** Mirror every new journal record to disk. A genesis record truncates the file. */
  attach(): void {
    this.unsubscribe?.()
    this.unsubscribe = store.onJournal((rec) => {
      try {
        if (rec.k === 'genesis') {
          const tmp = `${this.path}.tmp`
          writeFileSync(tmp, JSON.stringify(rec) + '\n')
          renameSync(tmp, this.path)
        } else {
          appendFileSync(this.path, JSON.stringify(rec) + '\n')
        }
      } catch (e) {
        console.error('[neuralops] journal write failed:', e)
      }
    })
  }

  /** Rewrite the file from the in-memory journal (after loading/replay). */
  rewrite(records: readonly JournalRecord[]): void {
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, records.map((r) => JSON.stringify(r)).join('\n') + '\n')
    renameSync(tmp, this.path)
  }

  detach(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
  }
}
