// Caller identity for the HTTP / WS doors.
//
//   Authorization: Bearer <agent token>  → that agent (via "token")
//   Authorization: Bearer <admin token>  → admin; may name an agent with
//                                          X-Agent-Id / body.from (via "impersonated")
//   no token, demo mode                  → X-Agent-Id / body.from (via "impersonated")
//   no token, secure mode                → 401

import { createHash, timingSafeEqual } from 'node:crypto'
import type { Config } from '../config.js'
import { agentForToken } from '../engines/agents.js'
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

export function resolveCaller(
  config: Config,
  token: string | null,
  claimedAgent: string | null
): Caller {
  if (token) {
    if (config.adminToken && safeEqual(token, config.adminToken)) {
      return { agentId: claimedAgent, via: 'impersonated', isAdmin: true }
    }
    const agentId = agentForToken(token)
    if (!agentId) throw unauthenticated('Unknown bearer token')
    if (claimedAgent && claimedAgent !== agentId) {
      throw forbidden(`Token belongs to ${agentId}; it cannot act as ${claimedAgent}`)
    }
    return { agentId, via: 'token', isAdmin: false }
  }
  if (config.mode === 'secure') {
    throw unauthenticated('Authorization: Bearer <token> is required in secure mode')
  }
  return { agentId: claimedAgent, via: 'impersonated', isAdmin: false }
}
