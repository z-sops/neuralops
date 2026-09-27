// NeuralOps MCP — REST API helpers.
//
// Every request goes through Caddy with `?XTransformPort=3031` so the gateway
// can forward to the Coordination Core mini-service on port 3031. Never use
// `http://localhost:3031` directly.

import type {
  ActInput,
  ActResult,
  ContextComparison,
  FamiliesResponse,
  NeuralOpsState,
} from './neuralops-types'

export const NEURALOPS_PORT = '3031'

function apiUrl(path: string, extra?: Record<string, string | number | undefined>): string {
  const url = new URL(path, typeof window === 'undefined' ? 'http://localhost' : window.location.origin)
  url.searchParams.set('XTransformPort', NEURALOPS_PORT)
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
    }
  }
  // Return a relative URL (path + query) so Caddy sees it on the same origin.
  return `${url.pathname}?${url.searchParams.toString()}`
}

async function getJson<T>(path: string, extra?: Record<string, string | number | undefined>): Promise<T> {
  const res = await fetch(apiUrl(path, extra), {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`GET ${path} → ${res.status}: ${text.slice(0, 200)}`)
  }
  return (await res.json()) as T
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text().catch(() => '')
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`POST ${path} → ${res.status}: ${text.slice(0, 200)}`)
  }
}

export const neuralopsApi = {
  getState: () => getJson<NeuralOpsState>('/api/state'),
  getFamilies: () => getJson<FamiliesResponse>('/api/families'),
  getComparison: (taskId: string) =>
    getJson<ContextComparison>(`/api/tasks/${encodeURIComponent(taskId)}/context/comparison`),
  getLedger: (limit = 100, taskId?: string) =>
    getJson<{ id: string }[]>(`/api/ledger`, { limit, taskId }),
  getApprovals: () => getJson<{ id: string }[]>('/api/approvals'),
  submitAct: (act: ActInput) => postJson<ActResult>('/api/acts', act),
  seedDemo: () => postJson<{ ok: boolean; state: NeuralOpsState }>('/api/demo/seed'),
  resetAll: () => postJson<{ ok: boolean }>('/api/demo/reset'),
}
