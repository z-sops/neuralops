// Token estimation utility.
// V0.1 uses a rough chars/4 heuristic. A real implementation would use the
// specific tokenizer of the consuming model. The point is to expose the
// order-of-magnitude reduction that compaction produces.

export function estimateTokens(value: unknown): number {
  const text =
    typeof value === 'string' ? value : JSON.stringify(value ?? '')
  // Count conservatively: 1 token ≈ 4 chars for English/code text.
  return Math.max(1, Math.ceil(text.length / 4))
}

export function formatTokens(n: number): string {
  if (n >= 1000) {
    const k = n / 1000
    return k % 1 === 0 ? `${k}k` : `${k.toFixed(1)}k`
  }
  return `${n}`
}
