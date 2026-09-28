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
import type { Policy } from '../state/types.js'
import { setPolicy } from './admin.js'

export interface Preset {
  name: string
  title: string
  description: string
  policies: { action: string; scope: string }[]
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

export function getPreset(name: string): Preset {
  const p = PRESETS.find((x) => x.name === name)
  if (!p) throw notFound(`No preset "${name}". Presets: ${PRESETS.map((x) => x.name).join(', ')}`)
  return p
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
