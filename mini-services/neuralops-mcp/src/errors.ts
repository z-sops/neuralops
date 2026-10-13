// Typed errors. `code` maps 1:1 to an HTTP status in the REST door.

export type ErrorCode =
  | 'persistence_unavailable' // 503 — outcome uncertain; restart and verify journal
  | 'invalid' // 400 — malformed envelope or payload
  | 'unauthenticated' // 401 — no / bad token
  | 'forbidden' // 403 — identity known, not allowed
  | 'not_found' // 404
  | 'conflict' // 409 — state does not allow this act right now
  | 'too_large' // 413
  | 'rate_limited' // 429

export const HTTP_STATUS: Record<ErrorCode, number> = {
  persistence_unavailable: 503,
  invalid: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  too_large: 413,
  rate_limited: 429,
}

export class NeuralOpsError extends Error {
  constructor(
    public code: ErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'NeuralOpsError'
  }
}

export class PersistenceError extends NeuralOpsError {
  constructor() {
    super('persistence_unavailable', 'Journal persistence failed; the last operation may already be on disk. Further mutations and gate clearance are blocked. Restart and verify the journal before recovery; do not blindly retry.')
    this.name = 'PersistenceError'
  }
}

export const invalid = (m: string) => new NeuralOpsError('invalid', m)
export const forbidden = (m: string) => new NeuralOpsError('forbidden', m)
export const notFound = (m: string) => new NeuralOpsError('not_found', m)
export const conflict = (m: string) => new NeuralOpsError('conflict', m)
export const unauthenticated = (m: string) => new NeuralOpsError('unauthenticated', m)
