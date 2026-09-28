// Runtime configuration.
//
// NEURALOPS_MODE
//   demo   (default) — the Protocol Inspector may act on behalf of any agent by
//                      passing `from` (every such act is marked
//                      `via: "impersonated"` in the ledger). Demo endpoints are on.
//                      Demo mode only listens on loopback unless explicitly allowed.
//   secure           — every request needs `Authorization: Bearer <token>`.
//                      Agent identity comes ONLY from the token. Demo endpoints off.
//
// NEURALOPS_HOST                    default 127.0.0.1 (loopback only)
// NEURALOPS_PORT                    default 3031
// NEURALOPS_DATA_DIR                default ./data — journal lives here; "off" = in-memory
// NEURALOPS_ADMIN_TOKEN             required in secure mode (16+ chars)
// NEURALOPS_ADMIN_CAN_ACT           "1" lets the admin token act as an agent (secure mode). Default off.
// NEURALOPS_JOURNAL_KEY             HMAC key for the journal (required in secure mode, 16+ chars).
//                                   Demo mode generates one in <dataDir>/journal.key.
// NEURALOPS_RATE_LIMIT              requests/second per caller (default 20, "off" to disable)
// NEURALOPS_BACKUPS                 journal backups to keep (default 10)
// NEURALOPS_CORS_ORIGIN             default "*" in demo mode, unset (same-origin) in secure
// NEURALOPS_ALLOW_DEMO_ON_NETWORK   "1" to let demo mode bind a non-loopback host (not recommended)
// NEURALOPS_MCP_URL_TOKENS          "1" also accepts the agent token in the MCP URL (POST /mcp/<token>)
//                                   for MCP hosts that cannot send an Authorization header. The token
//                                   then appears in URLs/logs — prefer the header.
// NEURALOPS_WEBHOOK_URL             POST approval.requested / approval.decided / workspace.frozen|unfrozen here
//                                   (comma-separated for several receivers)
// NEURALOPS_WEBHOOK_SECRET          optional HMAC-SHA256 key → X-NeuralOps-Signature: sha256=<hex>
// NEURALOPS_PUBLIC_URL              how people reach this core (e.g. https://ops.example.com); enables one-click approval links
// NEURALOPS_LINK_SECRET             HMAC key for approval links (16+ chars; required with NEURALOPS_PUBLIC_URL)
// NEURALOPS_LINK_TTL                approval link lifetime in seconds (default 86400)
// NEURALOPS_JWT_SECRET / NEURALOPS_JWT_JWKS_URL / NEURALOPS_JWT_ISSUER / NEURALOPS_JWT_AUDIENCE /
// NEURALOPS_JWT_AUTO_PROVISION      accept your sign-in system's JWTs (e.g. Supabase) as identities; see server/jwt.ts
// NEURALOPS_AGENT_READ              "involved" (default in secure mode): an agent reads only tasks, approvals and
//                                   ledger entries it is part of; "workspace" (default in demo): everything

export type Mode = 'demo' | 'secure'

export interface Config {
  mode: Mode
  host: string
  port: number
  dataDir: string | null
  adminToken: string | null
  adminCanAct: boolean
  journalKey: string | null
  rateLimit: { perSecond: number; burst: number } | null
  backups: number
  corsOrigin: string | null
  seedOnEmpty: boolean
  mcpUrlTokens: boolean
  webhook: { urls: string[]; secret: string | null } | null
  links: { publicUrl: string; secret: string; ttlSeconds: number } | null
  jwt: { secret: string | null; jwksUrl: string | null; issuer: string | null; audience: string | null; autoProvision: boolean } | null
  agentRead: 'workspace' | 'involved'
}

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost'])

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK.has(host) || host.startsWith('127.')
}

function linkConfig(env: Record<string, string | undefined>): Config['links'] {
  const publicUrl = env.NEURALOPS_PUBLIC_URL
  if (!publicUrl) return null
  const secret = env.NEURALOPS_LINK_SECRET || ''
  if (secret.length < 16) throw new Error('NEURALOPS_PUBLIC_URL enables approval links: set NEURALOPS_LINK_SECRET (at least 16 characters).')
  if (!/^https?:\/\//.test(publicUrl)) throw new Error('NEURALOPS_PUBLIC_URL must start with http:// or https://')
  return { publicUrl, secret, ttlSeconds: Math.max(60, Number(env.NEURALOPS_LINK_TTL || 86400)) }
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const mode: Mode = env.NEURALOPS_MODE === 'secure' ? 'secure' : 'demo'
  const host = env.NEURALOPS_HOST || '127.0.0.1'
  const dataDirRaw = env.NEURALOPS_DATA_DIR ?? './data'
  const adminToken = env.NEURALOPS_ADMIN_TOKEN || null
  const journalKey = env.NEURALOPS_JOURNAL_KEY || null

  if (mode === 'secure') {
    if (!adminToken || adminToken.length < 16) {
      throw new Error('NEURALOPS_MODE=secure requires NEURALOPS_ADMIN_TOKEN (at least 16 characters).')
    }
    if (dataDirRaw !== 'off' && (!journalKey || journalKey.length < 16)) {
      throw new Error('NEURALOPS_MODE=secure requires NEURALOPS_JOURNAL_KEY (at least 16 characters) to sign the journal.')
    }
  }
  if (mode === 'demo' && !isLoopbackHost(host) && env.NEURALOPS_ALLOW_DEMO_ON_NETWORK !== '1') {
    throw new Error(
      `Refusing to start demo mode on ${host}: demo mode lets anyone act as any agent. ` +
        'Use NEURALOPS_MODE=secure for network access (or set NEURALOPS_ALLOW_DEMO_ON_NETWORK=1 if you really mean it).'
    )
  }

  const rl = env.NEURALOPS_RATE_LIMIT
  const perSecond = rl === 'off' ? 0 : Number(rl || 20)

  return {
    mode,
    host,
    port: Number(env.NEURALOPS_PORT || 3031),
    dataDir: dataDirRaw === 'off' ? null : dataDirRaw,
    adminToken,
    adminCanAct: env.NEURALOPS_ADMIN_CAN_ACT === '1',
    journalKey,
    rateLimit: perSecond > 0 ? { perSecond, burst: perSecond * 3 } : null,
    backups: Math.max(0, Number(env.NEURALOPS_BACKUPS ?? 10)),
    corsOrigin: env.NEURALOPS_CORS_ORIGIN ?? (mode === 'demo' ? '*' : null),
    seedOnEmpty: mode === 'demo',
    mcpUrlTokens: env.NEURALOPS_MCP_URL_TOKENS === '1',
    webhook: env.NEURALOPS_WEBHOOK_URL
      ? { urls: env.NEURALOPS_WEBHOOK_URL.split(',').map((u) => u.trim()).filter(Boolean), secret: env.NEURALOPS_WEBHOOK_SECRET || null }
      : null,
    links: linkConfig(env),
    jwt:
      env.NEURALOPS_JWT_SECRET || env.NEURALOPS_JWT_JWKS_URL
        ? {
            secret: env.NEURALOPS_JWT_SECRET || null,
            jwksUrl: env.NEURALOPS_JWT_JWKS_URL || null,
            issuer: env.NEURALOPS_JWT_ISSUER || null,
            audience: env.NEURALOPS_JWT_AUDIENCE || null,
            autoProvision: env.NEURALOPS_JWT_AUTO_PROVISION === '1',
          }
        : null,
    agentRead: env.NEURALOPS_AGENT_READ === 'workspace' || env.NEURALOPS_AGENT_READ === 'involved' ? env.NEURALOPS_AGENT_READ : mode === 'secure' ? 'involved' : 'workspace',
  }
}
