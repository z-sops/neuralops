// Path patterns for file reservations.
//
// Patterns are repo-relative, forward-slash paths with globs:
//   **  any number of path segments      src/auth/**
//   *   anything within one segment      src/*.ts
//   ?   one character within a segment
//   a trailing "/" reserves a whole directory: "src/auth/" == "src/auth/**"
//
// Overlap between two patterns is decided CONSERVATIVELY: when in doubt we say
// "overlaps", because a false conflict costs a negotiation while a missed one
// costs two agents editing the same file.

import { invalid } from '../errors.js'

const GLOB = /[*?]/

export function normalizePath(raw: string): string {
  let p = String(raw).trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  while (p.startsWith('./')) p = p.slice(2)
  if (!p) throw invalid('empty path pattern')
  if (p.startsWith('/') || /^[A-Za-z]:\//.test(p)) throw invalid(`"${raw}" must be relative to the repo root`)
  if (p.split('/').some((s) => s === '..')) throw invalid(`"${raw}" may not contain ".."`)
  if (p.endsWith('/')) p = `${p}**`
  if (p.length > 300) throw invalid('path pattern too long')
  return p
}

export function hasGlob(p: string): boolean {
  return GLOB.test(p)
}

const cache = new Map<string, RegExp>()

export function globToRegExp(pattern: string): RegExp {
  const hit = cache.get(pattern)
  if (hit) return hit
  let re = '^'
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        // "**/" matches zero or more directories; a bare "**" matches anything
        if (pattern[i + 2] === '/') {
          re += '(?:.*/)?'
          i += 2
        } else {
          re += '.*'
          i += 1
        }
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') {
      re += '[^/]'
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  re += '$'
  const out = new RegExp(re)
  if (cache.size > 2000) cache.clear()
  cache.set(pattern, out)
  return out
}

/** Does a concrete file path fall under a pattern? */
export function matchesPath(pattern: string, path: string): boolean {
  return globToRegExp(pattern).test(path)
}

/** Directory part before the first glob character, e.g. "src/auth/" for "src/auth/**". */
function literalDir(p: string): string {
  const i = p.search(GLOB)
  const head = i < 0 ? p : p.slice(0, i)
  const slash = head.lastIndexOf('/')
  return slash < 0 ? '' : head.slice(0, slash + 1)
}

/** Literal ending of the last segment after its last glob char, e.g. ".ts" for "src/**\/*.ts". */
function literalSuffix(p: string): string {
  const last = p.slice(p.lastIndexOf('/') + 1)
  const i = Math.max(last.lastIndexOf('*'), last.lastIndexOf('?'))
  return i < 0 ? '' : last.slice(i + 1)
}

/** Could some file match both patterns? (conservative) */
export function patternsOverlap(a: string, b: string): boolean {
  if (a === b) return true
  const ga = hasGlob(a)
  const gb = hasGlob(b)
  if (!ga && !gb) return false
  if (!ga) return matchesPath(b, a)
  if (!gb) return matchesPath(a, b)
  const da = literalDir(a)
  const db = literalDir(b)
  if (!da.startsWith(db) && !db.startsWith(da)) return false
  const sa = literalSuffix(a)
  const sb = literalSuffix(b)
  if (sa && sb && !sa.endsWith(sb) && !sb.endsWith(sa)) return false
  return true
}
