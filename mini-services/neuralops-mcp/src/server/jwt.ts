// Sign in with the workspace's own user tokens (e.g. Supabase, which Nexus uses).
//
// A person already signed in to Nexus should not need a second NeuralOps
// token to approve something. With JWT identities on, a bearer token that is
// a JWT is verified and mapped to the identity whose `externalId` equals the
// token's `sub` claim.
//
//   NEURALOPS_JWT_SECRET          HS256 shared secret (Supabase "legacy JWT secret")
//   NEURALOPS_JWT_JWKS_URL        RS256 / ES256 public keys (Supabase: https://<ref>.supabase.co/auth/v1/.well-known/jwks.json)
//   NEURALOPS_JWT_ISSUER          required `iss` (optional check)
//   NEURALOPS_JWT_AUDIENCE        required `aud` (Supabase: "authenticated")
//   NEURALOPS_JWT_AUTO_PROVISION  "1" = first sign-in creates a person identity (human.<name>)
//                                 with no authority; an admin grants roles and policies later.
//
// JWKS keys are fetched at start and refreshed every 10 minutes (and when an
// unknown key id shows up), so verification itself never waits on the network.

import { createHmac, createPublicKey, timingSafeEqual, verify as cryptoVerify, type KeyObject, type JsonWebKeyInput } from 'node:crypto'

type JsonWebKey = JsonWebKeyInput['key']
import { store } from '../state/store.js'
import { registerAgent } from '../engines/agents.js'
import { unauthenticated } from '../errors.js'

export interface JwtConfig {
  secret: string | null
  jwksUrl: string | null
  issuer: string | null
  audience: string | null
  autoProvision: boolean
}

interface Claims {
  sub?: string
  email?: string
  exp?: number
  nbf?: number
  iss?: string
  aud?: string | string[]
  user_metadata?: { full_name?: string; name?: string }
}

const b64 = (s: string) => Buffer.from(s, 'base64url')

export const looksLikeJwt = (token: string) => /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)

const keys = new Map<string, { key: KeyObject; alg: string }>()
let lastFetch = 0

export async function refreshJwks(url: string, force = false): Promise<void> {
  if (!force && Date.now() - lastFetch < 30_000) return
  lastFetch = Date.now()
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`JWKS HTTP ${res.status}`)
  const body = (await res.json()) as { keys?: (JsonWebKey & { kid?: string; alg?: string })[] }
  keys.clear()
  for (const jwk of body.keys ?? []) {
    if (!jwk.kid) continue
    const alg = jwk.alg ?? (jwk.kty === 'EC' ? 'ES256' : 'RS256')
    keys.set(jwk.kid, { key: createPublicKey({ key: jwk, format: 'jwk' }), alg })
  }
}

/** Start background JWKS refresh; returns a stop function. */
export function startJwks(cfg: JwtConfig): () => void {
  if (!cfg.jwksUrl) return () => {}
  const url = cfg.jwksUrl
  const load = () => refreshJwks(url, true).catch((e) => console.warn(`[neuralops] JWKS refresh failed: ${(e as Error).message}`))
  void load()
  const t = setInterval(load, 10 * 60 * 1000)
  return () => clearInterval(t)
}

function verifySignature(cfg: JwtConfig, alg: string, kid: string | undefined, signingInput: string, sig: Buffer): boolean {
  if (alg === 'HS256') {
    if (!cfg.secret) return false
    const want = createHmac('sha256', cfg.secret).update(signingInput).digest()
    return want.length === sig.length && timingSafeEqual(want, sig)
  }
  if (alg !== 'RS256' && alg !== 'ES256') return false
  const k = kid ? keys.get(kid) : undefined
  if (!k) {
    if (cfg.jwksUrl) void refreshJwks(cfg.jwksUrl).catch(() => {})
    return false
  }
  if (k.alg !== alg) return false
  return alg === 'RS256'
    ? cryptoVerify('RSA-SHA256', Buffer.from(signingInput), k.key, sig)
    : cryptoVerify('sha256', Buffer.from(signingInput), { key: k.key, dsaEncoding: 'ieee-p1363' }, sig)
}

/** Verify a JWT and return its claims, or throw 401. */
export function verifyJwt(cfg: JwtConfig, token: string, nowSec = Math.floor(Date.now() / 1000)): Claims {
  const [h, p, s] = token.split('.')
  let header: { alg?: string; kid?: string }
  let claims: Claims
  try {
    header = JSON.parse(b64(h).toString('utf8'))
    claims = JSON.parse(b64(p).toString('utf8'))
  } catch {
    throw unauthenticated('Malformed JWT')
  }
  if (!header.alg || !verifySignature(cfg, header.alg, header.kid, `${h}.${p}`, b64(s))) throw unauthenticated('JWT signature not valid')
  if (typeof claims.exp !== 'number' || nowSec >= claims.exp) throw unauthenticated('JWT has expired')
  if (typeof claims.nbf === 'number' && nowSec < claims.nbf) throw unauthenticated('JWT not valid yet')
  if (cfg.issuer && claims.iss !== cfg.issuer) throw unauthenticated('JWT issuer not accepted')
  if (cfg.audience) {
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
    if (!aud.includes(cfg.audience)) throw unauthenticated('JWT audience not accepted')
  }
  if (!claims.sub) throw unauthenticated('JWT has no sub claim')
  return claims
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'user'
}

/** The identity a verified JWT stands for (auto-provisioned if allowed). */
export function identityForJwt(cfg: JwtConfig, token: string): string {
  const claims = verifyJwt(cfg, token)
  const found = [...store.agents.values()].find((a) => a.externalId === claims.sub)
  if (found) {
    if (found.revokedAt) throw unauthenticated('This identity has been revoked')
    return found.id
  }
  if (!cfg.autoProvision) {
    throw unauthenticated(`No NeuralOps identity is linked to this user (sub ${claims.sub}). An admin registers one with "externalId": "${claims.sub}".`)
  }
  const base = `human.${slug(claims.email?.split('@')[0] ?? claims.sub!)}`
  let id = base
  for (let n = 2; store.agents.has(id); n++) id = `${base}-${n}`
  const name = claims.user_metadata?.full_name ?? claims.user_metadata?.name ?? claims.email ?? id
  registerAgent({ id, name: String(name).slice(0, 80), model: 'Custom', role: 'member', externalId: claims.sub }, { asAdmin: false })
  return id
}
