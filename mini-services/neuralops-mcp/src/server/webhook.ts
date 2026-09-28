// Outgoing webhook — tells other systems (NeuralOps Nexus, Slack, a pager)
// when a human is needed or when something important happened.
//
//   NEURALOPS_WEBHOOK_URL     where to POST; comma-separated for several receivers (unset = off)
//   NEURALOPS_WEBHOOK_SECRET  optional; signs each body:
//                             X-NeuralOps-Signature: sha256=<hex HMAC-SHA256(secret, body)>
//
// Events
//   approval.requested   a new approval is waiting (approval, approver, detail,
//                        and a one-click `links.page` when approval links are on)
//   approval.decided     an approval was authorized or denied (with reason)
//   workspace.frozen / workspace.unfrozen   the kill switch
//
// Delivery: fire-and-forget (a slow or failing receiver never blocks or fails
// an act), three attempts per receiver (now, +2s, +10s), and the last 200
// deliveries are kept for GET /api/webhooks/deliveries. Every event carries
// a unique `id` so receivers can drop duplicates. Nothing is sent while the
// journal is replayed, so a restart never re-sends old events.

import { createHmac, randomUUID } from 'node:crypto'
import { store } from '../state/store.js'
import type { Approval, LedgerEvent } from '../state/types.js'
import { untrusted } from '../engines/guard.js'
import { approvalLinks, type ApprovalLinks, type LinkConfig } from './links.js'

export interface WebhookConfig {
  urls: string[]
  secret: string | null
  links?: LinkConfig | null
  timeoutMs?: number
  retryDelaysMs?: number[]
}

export type WebhookEvent = 'approval.requested' | 'approval.decided' | 'workspace.frozen' | 'workspace.unfrozen'

export interface WebhookBody {
  id: string
  event: WebhookEvent
  at: string
  approval?: Approval
  links?: ApprovalLinks
  freeze?: { reason: string; by: string; at: string } | null
  ledger: { seq: number; actId: string; actType: string; actor: string; summary: string; hash: string }
}

export interface Delivery {
  id: string
  event: WebhookEvent
  url: string
  status: 'pending' | 'delivered' | 'failed'
  attempts: number
  lastError: string | null
  firstAt: string
  lastAt: string
}

const MAX_LOG = 200
const log: Delivery[] = []

/** Most recent deliveries first. */
export function webhookDeliveries(): Delivery[] {
  return [...log].reverse()
}

function approvalView(a: Approval): Approval {
  // `detail` is agent-written (tool arguments): receivers may show it to a model, so send it flagged.
  return a.detail ? { ...a, detail: untrusted(a.detail, 1000) } : { ...a }
}

/** Which webhook event (if any) a ledger event stands for. */
export function classify(e: LedgerEvent): { event: WebhookEvent; approval?: Approval } | null {
  const after = e.after as Record<string, unknown>
  if (e.actType === 'admin' && 'frozen' in after) {
    return { event: after.frozen ? 'workspace.frozen' : 'workspace.unfrozen' }
  }
  if (e.actType === 'authorize' || e.actType === 'deny') {
    const id = e.references.find((r) => r.startsWith('approval_'))
    const a = id ? store.approvals.get(id) : undefined
    return a ? { event: 'approval.decided', approval: a } : null
  }
  const pendingId = (after.pendingApproval as string | undefined) ?? (after.status === 'pending' ? (after.approvalId as string | undefined) : undefined)
  if (pendingId) {
    const a = store.approvals.get(pendingId)
    if (a && a.status === 'pending') return { event: 'approval.requested', approval: a }
  }
  return null
}

export function sign(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
}

export function setupWebhook(cfg: WebhookConfig): { dispose: () => void } {
  const timeoutMs = cfg.timeoutMs ?? 5000
  const delays = cfg.retryDelaysMs ?? [2000, 10000]
  const timers = new Set<ReturnType<typeof setTimeout>>()
  let disposed = false

  async function attempt(d: Delivery, body: string): Promise<void> {
    if (disposed) return
    d.attempts += 1
    d.lastAt = new Date().toISOString()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'neuralops-webhook',
      'X-NeuralOps-Event': d.event,
      'X-NeuralOps-Delivery': d.id,
    }
    if (cfg.secret) headers['X-NeuralOps-Signature'] = sign(cfg.secret, body)
    try {
      const res = await fetch(d.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(timeoutMs) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      d.status = 'delivered'
      d.lastError = null
    } catch (e) {
      d.lastError = (e as Error).message
      const wait = delays[d.attempts - 1]
      if (wait === undefined || disposed) {
        d.status = 'failed'
        console.warn(`[neuralops] webhook ${d.event} to ${d.url} failed after ${d.attempts} attempts: ${d.lastError}`)
        return
      }
      const t = setTimeout(() => {
        timers.delete(t)
        void attempt(d, body)
      }, wait)
      timers.add(t)
    }
  }

  const off = store.onLedger((e) => {
    const c = classify(e)
    if (!c) return
    const body: WebhookBody = {
      id: randomUUID(),
      event: c.event,
      at: e.timestamp,
      ...(c.approval ? { approval: approvalView(c.approval) } : {}),
      ...(c.event === 'approval.requested' && c.approval && cfg.links ? { links: approvalLinks(cfg.links, c.approval) } : {}),
      ...(c.event.startsWith('workspace.') ? { freeze: store.freeze } : {}),
      ledger: { seq: e.seq, actId: e.actId, actType: e.actType, actor: e.actor, summary: e.deltaSummary, hash: e.hash },
    }
    const text = JSON.stringify(body)
    for (const url of cfg.urls) {
      const now = new Date().toISOString()
      const d: Delivery = { id: body.id, event: c.event, url, status: 'pending', attempts: 0, lastError: null, firstAt: now, lastAt: now }
      log.push(d)
      if (log.length > MAX_LOG) log.splice(0, log.length - MAX_LOG)
      void attempt(d, text)
    }
  })

  return {
    dispose: () => {
      disposed = true
      off()
      for (const t of timers) clearTimeout(t)
      timers.clear()
    },
  }
}
