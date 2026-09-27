// /api/download — serves the NeuralOps documentation package.
//
// Usage:
//   GET /api/download                         → downloads NeuralOps-MCP.zip
//   GET /api/download?file=<name>             → serves an individual file
//                                               (e.g. ?file=README.md)
//   GET /api/download?list=1                  → returns JSON index of files
//
// Files are read from /home/z/my-project/download/NeuralOps-MCP/

import { NextRequest, NextResponse } from 'next/server'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join, resolve, sep, normalize } from 'node:path'

const DOCS_DIR = '/home/z/my-project/download/NeuralOps-MCP'
const ZIP_PATH = '/home/z/my-project/download/NeuralOps-MCP.zip'

// Guard against path traversal — ensure the resolved path stays inside DOCS_DIR.
function safePath(name: string): string | null {
  const cleaned = normalize(name).replace(/^([/\\])/, '')
  const resolved = resolve(DOCS_DIR, cleaned)
  if (!resolved.startsWith(DOCS_DIR + sep) && resolved !== DOCS_DIR) {
    return null
  }
  return resolved
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const list = url.searchParams.get('list')
  const file = url.searchParams.get('file')

  // --- list mode: return JSON index of files ---
  if (list === '1') {
    try {
      const names = await readdir(DOCS_DIR)
      const entries: { name: string; size: number }[] = []
      for (const n of names) {
        const full = join(DOCS_DIR, n)
        const s = await stat(full)
        if (s.isFile()) {
          entries.push({ name: n, size: s.size })
        }
      }
      entries.sort((a, b) => a.name.localeCompare(b.name))
      return NextResponse.json({ files: entries, dir: 'NeuralOps-MCP' })
    } catch (e) {
      return NextResponse.json(
        { error: 'Could not read docs directory', detail: String(e) },
        { status: 500 }
      )
    }
  }

  // --- individual file mode ---
  if (file) {
    const safe = safePath(file)
    if (!safe) {
      return NextResponse.json(
        { error: 'Invalid file path' },
        { status: 400 }
      )
    }
    try {
      const data = await readFile(safe)
      const isMarkdown = safe.toLowerCase().endsWith('.md')
      return new NextResponse(data, {
        status: 200,
        headers: {
          'Content-Type': isMarkdown
            ? 'text/markdown; charset=utf-8'
            : 'application/octet-stream',
          'Content-Disposition': `inline; filename="${file.split(sep).pop()}"`,
          'Cache-Control': 'no-cache',
        },
      })
    } catch (e) {
      return NextResponse.json(
        { error: 'File not found', detail: String(e) },
        { status: 404 }
      )
    }
  }

  // --- default: serve the zip ---
  try {
    const data = await readFile(ZIP_PATH)
    return new NextResponse(data, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="NeuralOps-MCP.zip"',
        'Content-Length': String(data.length),
        'Cache-Control': 'no-cache',
      },
    })
  } catch (e) {
    return NextResponse.json(
      {
        error: 'Zip file not found. Documentation package may not have been generated.',
        detail: String(e),
        hint: 'Individual files are still available via ?file=<name>',
      },
      { status: 404 }
    )
  }
}
