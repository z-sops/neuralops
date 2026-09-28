// Policy presets — ready-made sets of workspace policies.
//
// A preset is a named list of action/scope pairs. Applying it sets one policy
// per pair with the approver you name (existing policies for the same
// action/scope are updated, so re-applying is safe). Every policy goes
// through setPolicy(), i.e. it is validated, audited in the ledger and
// replayed like any other admin change. Nothing here is guessed by a model.

import { z } from 'zod'
import { invalid, notFound } from '../errors.js'
import { formatZodError } from '../protocol/payloads.js'
import type { CustomPreset, Policy } from '../state/types.js'
import { store } from '../state/store.js'
import { applyAdmin, setPolicy } from './admin.js'
import { conflict } from '../errors.js'

export interface Preset {
  name: string
  title: string
  description: string
  policies: { action: string; scope: string }[]
  custom?: boolean
}

export const PRESETS: Preset[] = [
  {
    name: 'nexus-default',
    title: 'NeuralOps Nexus (default)',
    description:
      'Personas may read and search freely; writes to outside systems need a human. Map your tools to these actions in the guard (actions={"create_invoice": "odoo.write", ...}).',
    policies: [
      { action: 'odoo.write', scope: 'production' },
      { action: 'odoo.delete', scope: 'production' },
      { action: 'db.write', scope: 'production' },
      { action: 'email.send', scope: 'production' },
      { action: 'payment.send', scope: 'production' },
      { action: 'file.delete', scope: 'production' },
      { action: 'deploy', scope: 'production' },
    ],
  },
  {
    name: 'solo-dev',
    title: 'Solo developer',
    description: 'One person with a few agents: only production deploys need you.',
    policies: [{ action: 'deploy', scope: 'production' }],
  },
  {
    name: 'two-agent-team',
    title: 'Two or more agents on one repo',
    description: 'Finishing production work, deploying and publishing need a human; everything else flows.',
    policies: [
      { action: 'complete', scope: 'production' },
      { action: 'deploy', scope: 'production' },
      { action: 'publish', scope: 'production' },
    ],
  },
  {
    name: 'production-gated',
    title: 'Production gated',
    description: 'Any action in the production scope needs a human; staging and ungoverned scopes flow.',
    policies: [{ action: '*', scope: 'production' }],
  },
  {
    name: 'lockdown',
    title: 'Lockdown',
    description: 'Every action in every scope needs a human (default-deny). Useful while you learn what your agents do.',
    policies: [{ action: '*', scope: '*' }],
  },
]

/** Built-in presets, then the workspace's own. */
export function allPresets(): Preset[] {
  return [...PRESETS, ...[...store.presets.values()].map((p) => ({ ...p, custom: true }))]
}

export function getPreset(name: string): Preset {
  const p = allPresets().find((x) => x.name === name)
  if (!p) throw notFound(`No preset "${name}". Presets: ${allPresets().map((x) => x.name).join(', ')}`)
  return p
}

const PresetInput = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/, 'lowercase name with dashes, e.g. "finance-team"'),
  title: z.string().min(1).max(80).optional(),
  description: z.string().max(500).optional(),
  policies: z.array(z.object({ action: z.string().min(1).max(64), scope: z.string().min(1).max(64) })).min(1).max(50),
})

/** Define (or update) a workspace preset. Admin; journaled and replayed. */
export function definePreset(raw: unknown, by: string, at = new Date().toISOString()): Preset {
  const r = PresetInput.safeParse(raw ?? {})
  if (!r.success) throw invalid(`Invalid preset — ${formatZodError(r.error)}`)
  if (PRESETS.some((p) => p.name === r.data.name)) throw conflict(`"${r.data.name}" is a built-in preset; choose another name`)
  const preset: CustomPreset = { name: r.data.name, title: r.data.title ?? r.data.name, description: r.data.description ?? '', policies: r.data.policies }
  applyAdmin({ k: 'preset_set', preset, by, at })
  return { ...preset, custom: true }
}

export function deletePreset(name: string, by: string, at = new Date().toISOString()): void {
  if (PRESETS.some((p) => p.name === name)) throw conflict(`"${name}" is a built-in preset and cannot be deleted`)
  if (!store.presets.has(name)) throw notFound(`No custom preset "${name}"`)
  applyAdmin({ k: 'preset_delete', name, by, at })
}

const ApplyInput = z.object({
  approver: z.string().min(1).max(128).describe('Identity that approves everything this preset governs, e.g. "agent.noaman"'),
})

export function applyPreset(name: string, raw: unknown, by: string): { preset: string; policies: Policy[] } {
  const preset = getPreset(name)
  const r = ApplyInput.safeParse(raw ?? {})
  if (!r.success) throw invalid(`Invalid preset request — ${formatZodError(r.error)}`)
  const policies = preset.policies.map((p) => setPolicy({ ...p, approver: r.data.approver }, by))
  return { preset: preset.name, policies }
}
