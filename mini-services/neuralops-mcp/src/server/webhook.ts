// Outgoing webhook — tells another system (NeuralOps Nexus, Slack, a pager)
// when a human is needed or when something important happened.
//
//   NEURALOPS_WEBHOOK_URL     where to POST (unset = off)
//   NEURALOPS_WEBHOOK_SECRET  optional; signs each body:
//                             X-NeuralOps-Signature: sha256=<hex HMAC-SHA256(secret, body)>
//
// Events
//   approval.requested   a new approval is waiting (approval, approver, detail)
//   approval.decided     an approval was authorized or denied (with reason)
//   workspace.frozen / workspace.unfrozen   the kill switch
//
// Fire-and-forget: a slow or failing receiver never blocks or fails an act.
// One retry after 2s. Nothing is sent while the journal is being replayed, so
// a restart never re-sends old events.

import { createHmac } from 'node:crypto'
import { store } from '../state/store.js'
import type { Approval, LedgerEvent } from '../state/types.js'
import { untrusted } from '../engines/guard.js'

export interface WebhookConfig {
  url: string
  secret: string | null
  timeoutMs?: number
  retryDelayMs?: number
}

export type WebhookEvent = 'approval.requested' | 'approval.decided' | 'workspace.frozen' | 'workspace.unfrozen'

export interface WebhookBody {
  event: WebhookEvent
  at: string
  approval?: Approval
  freeze?: { reason: string; by: string; at: string } | null
  ledger: { seq: number; actId: string; actType: string; actor: string; summary: string; hash: string }
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
  const retryDelayMs = cfg.retryDelayMs ?? 2000
  const timers = new Set<ReturnType<typeof setTimeout>>()

  async function post(body: string, attempt: number): Promise<void> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'User-Agent': 'neuralops-webhook' }
    if (cfg.secret) headers['X-NeuralOps-Signature'] = sign(cfg.secret, body)
    try {
      const res = await fetch(cfg.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(timeoutMs) })
      if (res.ok) return
      throw new Error(`HTTP ${res.status}`)
    } catch (e) {
      if (attempt === 0) {
        const t = setTimeout(() => {
          timers.delete(t)
          void post(body, 1)
        }, retryDelayMs)
        timers.add(t)
      } else {
        console.warn(`[neuralops] webhook to ${cfg.url} failed: ${(e as Error).message}`)
      }
    }
  }

  const off = store.onLedger((e) => {
    const c = classify(e)
    if (!c) return
    const body: WebhookBody = {
      event: c.event,
      at: e.timestamp,
      ...(c.approval ? { approval: approvalView(c.approval) } : {}),
      ...(c.event.startsWith('workspace.') ? { freeze: store.freeze } : {}),
      ledger: { seq: e.seq, actId: e.actId, actType: e.actType, actor: e.actor, summary: e.deltaSummary, hash: e.hash },
    }
    void post(JSON.stringify(body), 0)
  })

  return {
    dispose: () => {
      off()
      for (const t of timers) clearTimeout(t)
      timers.clear()
    },
  }
}
