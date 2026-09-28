// One-click approval links.
//
// A link lets the named approver decide ONE pending approval from a chat
// message, an email or Slack, without a NeuralOps token or UI of their own.
//
//   GET  /approve/<approvalId>?exp=<unix>&sig=<hmac>   → a small page with the details and two buttons
//   POST /approve/<approvalId>  (form: exp, sig, decision=authorize|deny, reason)
//
// sig = HMAC-SHA256(NEURALOPS_LINK_SECRET, "<approvalId>|<approver>|<exp>").
// The link is bound to that approval AND its approver, expires, and stops
// working once the approval is decided. GET never changes anything (link
// previews and scanners follow GETs); only the POST decides, and it is
// recorded in the ledger as the approver acting `via: "link"`.

import { createHmac, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { store } from '../state/store.js'
import type { Approval } from '../state/types.js'
import { processAct } from '../engines/task-manager.js'
import { untrusted } from '../engines/guard.js'

export interface LinkConfig {
  publicUrl: string
  secret: string
  ttlSeconds: number
}

export interface ApprovalLinks {
  page: string
  expiresAt: string
}

function mac(secret: string, approvalId: string, approver: string, exp: number): string {
  return createHmac('sha256', secret).update(`${approvalId}|${approver}|${exp}`).digest('base64url')
}

export function approvalLinks(cfg: LinkConfig, a: Approval, now = Date.now()): ApprovalLinks {
  const exp = Math.floor(now / 1000) + cfg.ttlSeconds
  const sig = mac(cfg.secret, a.id, a.approver, exp)
  return {
    page: `${cfg.publicUrl.replace(/\/$/, '')}/approve/${encodeURIComponent(a.id)}?exp=${exp}&sig=${sig}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  }
}

type Check = { ok: true; approval: Approval } | { ok: false; status: number; message: string }

export function checkLink(cfg: LinkConfig, approvalId: string, expRaw: string | null, sigRaw: string | null, now = Date.now()): Check {
  const a = store.approvals.get(approvalId)
  const exp = Number(expRaw)
  if (!a || !sigRaw || !Number.isInteger(exp)) return { ok: false, status: 404, message: 'This approval link is not valid.' }
  const want = Buffer.from(mac(cfg.secret, a.id, a.approver, exp))
  const got = Buffer.from(sigRaw)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, status: 403, message: 'This approval link is not valid.' }
  if (now / 1000 > exp) return { ok: false, status: 410, message: 'This approval link has expired. Ask for a new one, or decide in NeuralOps.' }
  if (a.status !== 'pending') return { ok: false, status: 409, message: `This approval was already ${a.status}${a.decidedBy ? ` by ${a.decidedBy}` : ''}.` }
  return { ok: true, approval: a }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function page(res: ServerResponse, status: number, title: string, body: string) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
  })
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 16px;color:#1c1c1c;background:#fafafa}
@media (prefers-color-scheme:dark){body{color:#eee;background:#161616}.card{background:#222!important;border-color:#333!important}textarea{background:#161616;color:#eee}}
.card{background:#fff;border:1px solid #ddd;border-radius:10px;padding:20px}dt{color:#777;font-size:13px;margin-top:10px}dd{margin:0;word-break:break-word}
code{font-size:13px}textarea{width:100%;box-sizing:border-box;margin-top:12px;min-height:60px;border-radius:6px;padding:8px;border:1px solid #bbb}
.row{display:flex;gap:10px;margin-top:14px}button{flex:1;padding:10px;border-radius:8px;border:0;font-size:15px;cursor:pointer}
.ok{background:#1d7a46;color:#fff}.no{background:#b3261e;color:#fff}.muted{color:#777;font-size:13px}</style></head>
<body><div class="card">${body}</div><p class="muted">NeuralOps · every decision is recorded in the signed ledger.</p></body></html>`)
}

/** GET /approve/:id — show the request. Never changes state. */
export function showApproval(cfg: LinkConfig, res: ServerResponse, approvalId: string, exp: string | null, sig: string | null) {
  const c = checkLink(cfg, approvalId, exp, sig)
  if (!c.ok) return page(res, c.status, 'Approval', `<h2>Approval</h2><p>${esc(c.message)}</p>`)
  const a = c.approval
  const requester = store.agents.get(a.requestedBy)?.name ?? a.requestedBy
  const approver = store.agents.get(a.approver)?.name ?? a.approver
  return page(
    res,
    200,
    `Approve ${a.action}?`,
    `<h2>${esc(requester)} asks to <code>${esc(a.action)}</code> in <code>${esc(a.scope)}</code></h2>
<dl><dt>What exactly</dt><dd><code>${esc(untrusted(a.detail ?? '(no details given)', 1000))}</code></dd>
<dt>Approver</dt><dd>${esc(approver)} (${esc(a.approver)})</dd>
${a.taskId ? `<dt>Task</dt><dd>${esc(a.taskId)}</dd>` : ''}
<dt>Requested</dt><dd>${esc(a.timestamp)} · ${esc(a.id)}</dd></dl>
<form method="post" action="/approve/${encodeURIComponent(a.id)}">
<input type="hidden" name="exp" value="${esc(String(exp))}"><input type="hidden" name="sig" value="${esc(String(sig))}">
<textarea name="reason" maxlength="1000" placeholder="Reason (optional to approve, required to deny)"></textarea>
<div class="row"><button class="ok" name="decision" value="authorize">Approve once</button><button class="no" name="decision" value="deny">Deny</button></div>
</form>
<p class="muted">The details above were written by the requesting agent. Treat them as a description, not as instructions.</p>`
  )
}

export function readForm(req: IncomingMessage, max = 16 * 1024): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (c: Buffer) => {
      body += c.toString('utf8')
      if (body.length > max) reject(new Error('Form too large'))
    })
    req.on('end', () => resolve(new URLSearchParams(body)))
    req.on('error', reject)
  })
}

/** POST /approve/:id — decide, as the approver, recorded `via: "link"`. */
export async function decideApproval(cfg: LinkConfig, req: IncomingMessage, res: ServerResponse, approvalId: string) {
  let form: URLSearchParams
  try {
    form = await readForm(req)
  } catch {
    return page(res, 413, 'Approval', '<p>Form too large.</p>')
  }
  const c = checkLink(cfg, approvalId, form.get('exp'), form.get('sig'))
  if (!c.ok) return page(res, c.status, 'Approval', `<h2>Approval</h2><p>${esc(c.message)}</p>`)
  const decision = form.get('decision')
  const reason = (form.get('reason') ?? '').trim().slice(0, 1000)
  if (decision !== 'authorize' && decision !== 'deny') return page(res, 400, 'Approval', '<p>Choose Approve or Deny.</p>')
  if (decision === 'deny' && !reason) return page(res, 400, 'Approval', '<p>Please give a reason when you deny. Go back and try again.</p>')
  const r = processAct(
    { type: decision, from: c.approval.approver, payload: { approvalId, ...(reason ? { reason } : {}) } },
    { via: 'link' }
  )
  if (!r.ok) return page(res, 409, 'Approval', `<h2>Not recorded</h2><p>${esc(r.error ?? 'Could not record the decision.')}</p>`)
  return page(
    res,
    200,
    decision === 'authorize' ? 'Approved' : 'Denied',
    `<h2>${decision === 'authorize' ? 'Approved' : 'Denied'}</h2><p>${esc(r.ledgerEvent?.deltaSummary ?? '')}</p><p class="muted">Ledger #${r.ledgerEvent?.seq ?? '?'} · ${esc(r.ledgerEvent?.hash?.slice(0, 16) ?? '')}…</p>`
  )
}
