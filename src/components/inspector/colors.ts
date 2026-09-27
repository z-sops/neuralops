// Family hue → Tailwind class helper.
//
// Six hues (per /api/families): emerald (task), amber (handoff), sky
// (information), violet (conversation), rose (authority), slate (lifecycle).
// We expose prefixed class strings so Tailwind's content scanner keeps them.

import type { ActFamily, ActType } from '@/lib/neuralops-types'
import { ACT_FAMILY_STATIC, FAMILY_HUE } from '@/lib/neuralops-types'

export type Hue = 'emerald' | 'amber' | 'sky' | 'violet' | 'rose' | 'slate'

export function familyForActType(
  type: ActType,
  families?: { family: Record<ActType, ActFamily> } | null,
): ActFamily {
  if (families?.family?.[type]) return families.family[type]
  return ACT_FAMILY_STATIC[type] ?? 'lifecycle'
}

export function hueForFamily(family: ActFamily): Hue {
  return (FAMILY_HUE[family] as Hue) ?? 'slate'
}

export function hueForActType(
  type: ActType,
  families?: { family: Record<ActType, ActFamily> } | null,
): Hue {
  return hueForFamily(familyForActType(type, families))
}

// Tailwind class strings (kept verbatim so the JIT scanner picks them up).
// We intentionally avoid indigo / blue — these are the only act-family hues.
const BADGE_BG: Record<Hue, string> = {
  emerald: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  amber: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30',
  sky: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30',
  violet: 'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30',
  rose: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30',
  slate: 'bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30',
}

const DOT_BG: Record<Hue, string> = {
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
  sky: 'bg-sky-500',
  violet: 'bg-violet-500',
  rose: 'bg-rose-500',
  slate: 'bg-slate-500',
}

const BORDER: Record<Hue, string> = {
  emerald: 'border-emerald-500/40',
  amber: 'border-amber-500/40',
  sky: 'border-sky-500/40',
  violet: 'border-violet-500/40',
  rose: 'border-rose-500/40',
  slate: 'border-slate-500/40',
}

const TEXT: Record<Hue, string> = {
  emerald: 'text-emerald-700 dark:text-emerald-300',
  amber: 'text-amber-700 dark:text-amber-300',
  sky: 'text-sky-700 dark:text-sky-300',
  violet: 'text-violet-700 dark:text-violet-300',
  rose: 'text-rose-700 dark:text-rose-300',
  slate: 'text-slate-700 dark:text-slate-300',
}

const BUTTON_SOLID: Record<Hue, string> = {
  emerald: 'bg-emerald-600 hover:bg-emerald-700 text-white',
  amber: 'bg-amber-600 hover:bg-amber-700 text-white',
  sky: 'bg-sky-600 hover:bg-sky-700 text-white',
  violet: 'bg-violet-600 hover:bg-violet-700 text-white',
  rose: 'bg-rose-600 hover:bg-rose-700 text-white',
  slate: 'bg-slate-600 hover:bg-slate-700 text-white',
}

const BUTTON_OUTLINE: Record<Hue, string> = {
  emerald: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10',
  amber: 'border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10',
  sky: 'border-sky-500/40 text-sky-700 dark:text-sky-300 hover:bg-sky-500/10',
  violet: 'border-violet-500/40 text-violet-700 dark:text-violet-300 hover:bg-violet-500/10',
  rose: 'border-rose-500/40 text-rose-700 dark:text-rose-300 hover:bg-rose-500/10',
  slate: 'border-slate-500/40 text-slate-700 dark:text-slate-300 hover:bg-slate-500/10',
}

export const hue = {
  badge: BADGE_BG,
  dot: DOT_BG,
  border: BORDER,
  text: TEXT,
  buttonSolid: BUTTON_SOLID,
  buttonOutline: BUTTON_OUTLINE,
}

// Task status → hue mapping (used by task cards + badges).
export const TASK_STATUS_HUE: Record<string, Hue> = {
  unclaimed: 'slate',
  in_progress: 'emerald',
  blocked: 'rose',
  handoff_pending: 'amber',
  completed: 'emerald',
  failed: 'rose',
}

export const TASK_STATUS_LABEL: Record<string, string> = {
  unclaimed: 'Unclaimed',
  in_progress: 'In progress',
  blocked: 'Blocked',
  handoff_pending: 'Handoff pending',
  completed: 'Completed',
  failed: 'Failed',
}

// Agent model → subtle hue accent (subtle, not saturated, just an identifier).
export const MODEL_HUE: Record<string, Hue> = {
  Claude: 'violet',
  Codex: 'emerald',
  Gemini: 'sky',
  Qwen: 'amber',
  GPT: 'rose',
  Custom: 'slate',
}
