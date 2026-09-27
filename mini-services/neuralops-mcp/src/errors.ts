// Typed errors. `code` maps 1:1 to an HTTP status in the REST door.

export type ErrorCode =
  | 'invalid' // 400 — malformed envelope or payload
  | 'unauthenticated' // 401 — no / bad token
  | 'forbidden' // 403 — identity known, not allowed
  | 'not_found' // 404
  | 'conflict' // 409 — state does not allow this act right now
  | 'too_large' // 413
  | 'rate_limited' // 429

export const HTTP_STATUS: Record<ErrorCode, number> = {
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

export const invalid = (m: string) => new NeuralOpsError('invalid', m)
export const forbidden = (m: string) => new NeuralOpsError('forbidden', m)
export const notFound = (m: string) => new NeuralOpsError('not_found', m)
export const conflict = (m: string) => new NeuralOpsError('conflict', m)
export const unauthenticated = (m: string) => new NeuralOpsError('unauthenticated', m)
