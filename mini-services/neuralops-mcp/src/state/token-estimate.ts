// Token estimation utility.
// V0.1 uses a chars/4 heuristic on the formatted text an agent would read.
// It is an order-of-magnitude estimate, labelled as such in every response.
// Swap in a per-model tokenizer here without touching the engines.

export const TOKEN_METHOD = 'estimate: chars/4 of the formatted text'

export function estimateTokens(value: unknown): number {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  return Math.max(1, Math.ceil(text.length / 4))
}

export function formatTokens(n: number): string {
  if (n >= 1000) {
    const k = n / 1000
    return k % 1 === 0 ? `${k}k` : `${k.toFixed(1)}k`
  }
  return `${n}`
}
