// Normalizes tool calls from Claude Code, Codex CLI and Gemini CLI (pure; no I/O).

export const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'apply_patch', 'write_file', 'replace'])
export const SHELL_TOOLS = new Set(['Bash', 'run_shell_command'])

export const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** Every string inside the tool input (Codex puts the patch under different keys by version). */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) for (const x of v) strings(x, out)
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out)
  return out
}

/** Files an edit call touches: a direct path, or every file named in an apply_patch patch. */
export function editedFiles(tool: string, input: Record<string, unknown>): string[] {
  const direct = [input.file_path, input.notebook_path, input.absolute_path, input.path].map(str).filter(Boolean)
  if (tool !== 'apply_patch') return direct.slice(0, 1)
  const files = new Set<string>()
  for (const text of strings(input)) {
    for (const m of text.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/gm)) {
      files.add((m[1] ?? m[2]).trim())
    }
  }
  return [...files]
}
