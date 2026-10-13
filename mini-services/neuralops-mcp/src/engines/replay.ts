// Event sourcing: genesis, replay, persistence, integrity.
//
// The journal (genesis + registrations + admin changes + accepted acts) is the
// source of truth. Views and the hash-chained ledger are rebuilt from it.
//
// On disk every journal line carries an HMAC chained to the previous line, and
// journal.head.json holds an HMAC over (record count, last MAC). Without the
// key nobody can edit, insert, delete, reorder or truncate records undetected.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { stableStringify, store } from '../state/store.js'
import type { JournalRecord } from '../state/types.js'
import { applyDemoSeed } from '../seed/demo.js'
import { applyRegister } from './agents.js'
import { applyAdmin } from './admin.js'
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
function genesisInternal(seed: SeedKind, seededAt = new Date().toISOString()): void {
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
      switch (rec.k) {
        case 'genesis':
          throw new Error('Unexpected second genesis record')
        case 'register':
          applyRegister(structuredClone(rec.agent), rec.tokenHash, rec.at, rec.expiresAt ?? null)
          break
        case 'act': {
          const res = processAct(structuredClone(rec.act), { replay: true })
          if (!res.ok) throw new Error(`Replay diverged at ${rec.act.id}: ${res.error}`)
          break
        }
        default:
          applyAdmin(structuredClone(rec))
      }
    }
  } finally {
    store.muted = wasMuted
  }
}

/**
 * Integrity check: verify the ledger hash chain, the signed journal file (if
 * any), then rebuild state from the journal and compare hashes. Live state is
 * restored afterwards.
 */
export function verifyIntegrity(journal?: JournalFile | null) {
  const chain = store.verifyChain()
  let journalFile: { signed: boolean; valid: boolean; error: string | null } | null = null
  if (journal) {
    try {
      journal.load()
      journalFile = { signed: true, valid: true, error: null }
    } catch (e) {
      journalFile = { signed: true, valid: false, error: (e as Error).message }
    }
  }
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
    journalFile,
    stateHash: liveHash,
    ledgerHead: store.ledgerHead,
    ledgerLength: store.ledger.length,
    journalLength: store.journal.length,
  }
}

// ---------------------------------------------------------------- persistence

export class JournalTamperError extends Error {
  constructor(message: string, dataDir: string) {
    super(
      `Journal integrity check failed: ${message}. The server will not start on a journal it cannot trust. ` +
        `Backups: ${join(dataDir, 'backups')}. To start fresh, move ${join(dataDir, 'journal.jsonl')} away.`
    )
    this.name = 'JournalTamperError'
  }
}

const ZERO = '0'.repeat(64)

interface Head {
  count: number
  lastMac: string
  headMac: string
}

type SignedLine = JournalRecord & { mac?: string }

export class JournalFile {
  readonly path: string
  readonly headPath: string
  readonly backupDir: string
  private key: Buffer
  private lastMac = ZERO
  private count = 0
  private unsubscribe: (() => void) | null = null

  constructor(
    readonly dataDir: string,
    opts: { key?: string | null; backups?: number } = {}
  ) {
    mkdirSync(dataDir, { recursive: true })
    this.path = join(dataDir, 'journal.jsonl')
    this.headPath = join(dataDir, 'journal.head.json')
    this.backupDir = join(dataDir, 'backups')
    this.keep = opts.backups ?? 10
    this.key = opts.key ? Buffer.from(opts.key, 'utf8') : JournalFile.localKey(dataDir)
  }

  private keep: number

  /** Demo mode: a random key stored next to the journal (protects against casual edits, not against someone who can read the folder). */
  static localKey(dataDir: string): Buffer {
    const p = join(dataDir, 'journal.key')
    if (!existsSync(p)) writeFileSync(p, randomBytes(32).toString('hex'), { mode: 0o600 })
    return Buffer.from(readFileSync(p, 'utf8').trim(), 'utf8')
  }

  private hmac(data: string): string {
    return createHmac('sha256', this.key).update(data).digest('hex')
  }
  private mac(prev: string, rec: JournalRecord): string {
    return this.hmac(prev + stableStringify(rec))
  }
  private headFor(count: number, lastMac: string): Head {
    return { count, lastMac, headMac: this.hmac(`head:${count}:${lastMac}`) }
  }
  private writeHead(count = this.count, lastMac = this.lastMac): void {
    const tmp = `${this.headPath}.tmp`
    writeFileSync(tmp, JSON.stringify(this.headFor(count, lastMac)))
    renameSync(tmp, this.headPath)
  }
  private line(rec: JournalRecord): string {
    const mac = this.mac(this.lastMac, rec)
    this.lastMac = mac
    this.count++
    return JSON.stringify({ ...rec, mac }) + '\n'
  }

  /**
   * Load and verify. Returns the records (without MACs), or null if there is
   * no journal. `legacy` = an unsigned V0.1.1 journal that was accepted and
   * will be re-signed. Throws JournalTamperError on any inconsistency.
   */
  load(): { records: JournalRecord[]; legacy: boolean } | null {
    if (!existsSync(this.path)) {
      if (existsSync(this.headPath)) throw new JournalTamperError('journal.jsonl is missing but journal.head.json exists', this.dataDir)
      return null
    }
    const lines = readFileSync(this.path, 'utf8').split('\n')
    const parsed: SignedLine[] = []
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim()
      if (!l) continue
      try {
        parsed.push(JSON.parse(l) as SignedLine)
      } catch {
        // A torn final line (crash mid-write) is dropped; anything else is fatal.
        if (lines.slice(i + 1).every((x) => !x.trim())) break
        throw new JournalTamperError(`unparseable line ${i + 1}`, this.dataDir)
      }
    }
    if (parsed.length === 0) return null

    const signed = parsed.filter((r) => typeof r.mac === 'string').length
    if (signed === 0) {
      if (existsSync(this.headPath)) throw new JournalTamperError('signatures were stripped from the journal', this.dataDir)
      return { records: parsed as JournalRecord[], legacy: true }
    }
    if (signed !== parsed.length) throw new JournalTamperError('some journal lines are unsigned', this.dataDir)

    let prev = ZERO
    const records: JournalRecord[] = []
    for (let i = 0; i < parsed.length; i++) {
      const { mac, ...body } = parsed[i]
      const expected = this.mac(prev, body as JournalRecord)
      if (!safeEq(mac!, expected)) throw new JournalTamperError(`record ${i + 1} was modified, inserted, removed or reordered`, this.dataDir)
      prev = mac!
      records.push(body as JournalRecord)
    }

    if (!existsSync(this.headPath)) throw new JournalTamperError('journal.head.json is missing (possible truncation)', this.dataDir)
    let head: Head
    try {
      head = JSON.parse(readFileSync(this.headPath, 'utf8')) as Head
    } catch {
      throw new JournalTamperError('journal.head.json is unreadable', this.dataDir)
    }
    const expectHead = this.headFor(head.count, head.lastMac)
    if (!safeEq(head.headMac ?? '', expectHead.headMac)) throw new JournalTamperError('journal.head.json signature is invalid', this.dataDir)
    if (head.count > records.length) throw new JournalTamperError(`journal was truncated (${records.length} of ${head.count} records)`, this.dataDir)
    // head.count < records.length is the crash window between append and head write: the extra lines are still MAC-valid.
    if (head.count > 0 && parsed[head.count - 1].mac !== head.lastMac) throw new JournalTamperError('journal head does not match its records', this.dataDir)

    this.lastMac = prev
    this.count = records.length
    return { records, legacy: false }
  }

  /** Mirror every new journal record to disk. A genesis record backs up the old journal, then truncates. */
  attach(): void {
    this.unsubscribe?.()
    this.unsubscribe = store.onJournal((rec) => {
      store.assertWritable()
      try {
        const previous = rec.k === 'genesis' ? ZERO : this.lastMac
        const count = rec.k === 'genesis' ? 1 : this.count + 1
        const mac = this.mac(previous, rec)
        const line = JSON.stringify({ ...rec, mac }) + '\n'
        if (rec.k === 'genesis') {
          this.backup('reseed')
          const tmp = `${this.path}.tmp`
          writeFileSync(tmp, line)
          renameSync(tmp, this.path)
        } else {
          appendFileSync(this.path, line)
        }
        this.writeHead(count, mac)
        this.count = count
        this.lastMac = mac
      } catch {
        store.failPersistence()
      }
    })
  }

  /** Rewrite (and sign) the whole file from records — used to migrate legacy journals. */
  rewrite(records: readonly JournalRecord[]): void {
    store.assertWritable()
    try {
      this.lastMac = ZERO
      this.count = 0
      const tmp = `${this.path}.tmp`
      writeFileSync(tmp, records.map((r) => this.line(r)).join(''))
      renameSync(tmp, this.path)
      this.writeHead()
    } catch { store.failPersistence() }
  }

  /** Copy the current journal (+head) into backups/, keeping the newest N. */
  backup(reason: string): string | null {
    store.assertWritable()
    if (this.keep <= 0 || !existsSync(this.path)) return null
    mkdirSync(this.backupDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const base = join(this.backupDir, `journal-${stamp}-${reason}`)
    copyFileSync(this.path, `${base}.jsonl`)
    if (existsSync(this.headPath)) copyFileSync(this.headPath, `${base}.head.json`)
    const all = readdirSync(this.backupDir).filter((f) => f.endsWith('.jsonl')).sort()
    for (const old of all.slice(0, Math.max(0, all.length - this.keep))) {
      rmSync(join(this.backupDir, old), { force: true })
      rmSync(join(this.backupDir, old.replace(/\.jsonl$/, '.head.json')), { force: true })
    }
    return `${base}.jsonl`
  }

  detach(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
  }
}

function safeEq(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

export function genesis(...args: Parameters<typeof genesisInternal>): ReturnType<typeof genesisInternal> {
  return store.transaction(() => genesisInternal(...args))
}
