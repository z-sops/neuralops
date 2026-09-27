// Runtime configuration.
//
// NEURALOPS_MODE
//   demo   (default) — the Protocol Inspector may act on behalf of any agent by
//                      passing `from` (every such act is marked
//                      `via: "impersonated"` in the ledger). Demo endpoints are on.
//   secure           — every request needs `Authorization: Bearer <token>`.
//                      Agent identity comes ONLY from the token. Demo endpoints
//                      require the admin token.
//
// NEURALOPS_PORT          default 3031
// NEURALOPS_DATA_DIR      default ./data — journal file lives here. Set to "off"
//                         to run fully in-memory.
// NEURALOPS_ADMIN_TOKEN   required in secure mode (registering agents, seeding).
// NEURALOPS_CORS_ORIGIN   default "*" in demo mode, unset (same-origin) in secure.

export type Mode = 'demo' | 'secure'

export interface Config {
  mode: Mode
  port: number
  dataDir: string | null
  adminToken: string | null
  corsOrigin: string | null
  seedOnEmpty: boolean
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const mode: Mode = env.NEURALOPS_MODE === 'secure' ? 'secure' : 'demo'
  const dataDirRaw = env.NEURALOPS_DATA_DIR ?? './data'
  const adminToken = env.NEURALOPS_ADMIN_TOKEN || null
  if (mode === 'secure' && (!adminToken || adminToken.length < 16)) {
    throw new Error(
      'NEURALOPS_MODE=secure requires NEURALOPS_ADMIN_TOKEN (at least 16 characters).'
    )
  }
  return {
    mode,
    port: Number(env.NEURALOPS_PORT || 3031),
    dataDir: dataDirRaw === 'off' ? null : dataDirRaw,
    adminToken,
    corsOrigin: env.NEURALOPS_CORS_ORIGIN ?? (mode === 'demo' ? '*' : null),
    seedOnEmpty: mode === 'demo',
  }
}
