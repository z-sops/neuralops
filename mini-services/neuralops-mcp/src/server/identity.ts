// Caller identity for the HTTP / WS doors.
//
//   Authorization: Bearer <agent token>  → that agent (via "token"), if not expired/revoked
//   Authorization: Bearer <admin token>  → admin. In secure mode the admin may act AS an
//                                          agent only when NEURALOPS_ADMIN_CAN_ACT=1.
//   no token, demo mode                  → X-Agent-Id / body.from (via "impersonated");
//                                          demo mode is loopback-only by default.
//   no token, secure mode                → 401

import { createHash, timingSafeEqual } from 'node:crypto'
import type { Config } from '../config.js'
import { checkToken } from '../engines/agents.js'
import { identityForJwt, looksLikeJwt } from './jwt.js'
import { seesEverything } from '../engines/visibility.js'
import { store } from '../state/store.js'
import { forbidden, unauthenticated } from '../errors.js'
import type { Caller } from '../mcp/tools.js'

function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

export function bearer(header: string | string[] | undefined): string | null {
  const h = Array.isArray(header) ? header[0] : header
  const m = h?.match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : null
}

export function isAdminToken(config: Config, token: string | null): boolean {
  return !!(token && config.adminToken && safeEqual(token, config.adminToken))
}

export function resolveCaller(config: Config, token: string | null, claimedAgent: string | null): Caller {
  const c = resolveIdentity(config, token, claimedAgent)
  if (!c.isAdmin && c.agentId && config.agentRead === 'involved' && !seesEverything(c.agentId)) c.scoped = true
  return c
}

function resolveIdentity(config: Config, token: string | null, claimedAgent: string | null): Caller {
  if (token) {
    if (isAdminToken(config, token)) {
      if (claimedAgent && config.mode === 'secure' && !config.adminCanAct) {
        throw forbidden(
          'The admin token cannot act as an agent in secure mode (set NEURALOPS_ADMIN_CAN_ACT=1 to allow). Use the agent’s own token.'
        )
      }
      return { agentId: claimedAgent, via: 'impersonated', isAdmin: true }
    }
    if (config.jwt && looksLikeJwt(token)) {
      const agentId = identityForJwt(config.jwt, token)
      if (claimedAgent && claimedAgent !== agentId) throw forbidden(`Token belongs to ${agentId}; it cannot act as ${claimedAgent}`)
      return { agentId, via: 'token', isAdmin: false }
    }
    const c = checkToken(token)
    if (!c.ok) {
      const why = { unknown: 'Unknown bearer token', expired: 'Bearer token has expired — rotate it', revoked: 'This agent has been revoked' }
      throw unauthenticated(why[c.reason])
    }
    if (store.agents.get(c.agentId)?.access === 'broker' && claimedAgent && claimedAgent !== c.agentId) {
      const target = store.agents.get(claimedAgent)
      if (!target || target.delegate !== c.agentId) {
        throw forbidden(`${c.agentId} is not the delegate of ${claimedAgent}${target ? '' : ' (no such identity; register it first)'}`)
      }
      if (target.revokedAt) throw unauthenticated(`${claimedAgent} has been revoked`)
      return { agentId: claimedAgent, via: 'delegated', isAdmin: false }
    }
    if (claimedAgent && claimedAgent !== c.agentId) {
      throw forbidden(`Token belongs to ${c.agentId}; it cannot act as ${claimedAgent}`)
    }
    return { agentId: c.agentId, via: 'token', isAdmin: false }
  }
  if (config.mode === 'secure') {
    throw unauthenticated('Authorization: Bearer <token> is required in secure mode')
  }
  return { agentId: claimedAgent, via: 'impersonated', isAdmin: false }
}

/** Admin endpoints: admin token, or anyone in demo mode (demo is loopback-only). */
export function canAdminister(config: Config, caller: Caller): boolean {
  return caller.isAdmin || config.mode === 'demo'
}
