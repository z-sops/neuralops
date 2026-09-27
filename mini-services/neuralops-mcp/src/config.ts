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
}

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost'])

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK.has(host) || host.startsWith('127.')
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
  }
}
