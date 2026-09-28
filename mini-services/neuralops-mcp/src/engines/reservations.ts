// File reservations — who is allowed to change which files right now.
//
// A reservation is a TTL'd claim on path patterns. Exclusive reservations
// conflict with any other agent's overlapping reservation; shared ones only
// conflict with exclusive ones. Enforced by the reserve act itself, the Claude
// Code hook (edits) and the git pre-commit hook (commits, for every agent).

import { store } from '../state/store.js'
import type { Reservation } from '../state/types.js'
import { matchesPath, normalizePath, patternsOverlap } from './paths.js'

export function isActiveReservation(r: Reservation, now: string): boolean {
  return !r.releasedAt && now < r.expiresAt
}

export function activeReservations(now = new Date().toISOString()): Reservation[] {
  return [...store.reservations.values()].filter((r) => isActiveReservation(r, now)).sort((a, b) => a.id.localeCompare(b.id))
}

/** Other agents' active reservations that collide with these patterns. */
export function conflictsFor(agentId: string, patterns: string[], exclusive: boolean, now: string): Reservation[] {
  return activeReservations(now).filter(
    (r) =>
      r.agentId !== agentId &&
      (r.exclusive || exclusive) &&
      r.patterns.some((rp) => patterns.some((p) => patternsOverlap(rp, p)))
  )
}

export interface PathCheck {
  path: string
  blocked: boolean // an exclusive reservation by another agent covers it
  mine: boolean // the caller holds a reservation covering it
  heldBy: { reservationId: string; agentId: string; exclusive: boolean; expiresAt: string; taskId: string | null; reason: string | null }[]
}

/** Who holds which of these concrete files? */
export function checkPaths(agentId: string | null, rawPaths: string[], now = new Date().toISOString()): PathCheck[] {
  const active = activeReservations(now)
  return rawPaths.map((raw) => {
    const path = normalizePath(raw)
    const holders = active.filter((r) => r.patterns.some((p) => matchesPath(p, path)))
    return {
      path,
      blocked: holders.some((r) => r.exclusive && r.agentId !== agentId),
      mine: holders.some((r) => r.agentId === agentId),
      heldBy: holders.map((r) => ({
        reservationId: r.id,
        agentId: r.agentId,
        exclusive: r.exclusive,
        expiresAt: r.expiresAt,
        taskId: r.taskId,
        reason: r.reason,
      })),
    }
  })
}

export function describeReservation(r: Reservation): string {
  return `${r.patterns.join(', ')} → ${r.agentId} (${r.exclusive ? 'exclusive' : 'shared'}, until ${r.expiresAt}${r.taskId ? `, ${r.taskId}` : ''}) [${r.id}]`
}
