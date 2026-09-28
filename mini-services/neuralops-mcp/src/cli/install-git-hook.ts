#!/usr/bin/env bun
// Install the NeuralOps git pre-commit hook into a repo (or worktree).
//
//   bun src/cli/install-git-hook.ts --repo /path/to/app-repo --token nops_... [--url http://127.0.0.1:3031]
//
// Writes <git-dir>/hooks/pre-commit (keeps any existing hook as pre-commit.local
// and chains it), and stores this worktree's agent token/url in
// <git-dir>/neuralops-token / neuralops-url — inside .git, never committed.
// Give each agent its own worktree (git worktree add) so each has its own token.

import { execSync } from 'node:child_process'
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { arg } from './client.js'

const MARKER = '# neuralops-pre-commit'

function main(): number {
  const repo = resolve(arg('repo') ?? process.cwd())
  let gitDir: string
  let hooksDir: string
  try {
    gitDir = execSync('git rev-parse --absolute-git-dir', { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
    hooksDir = execSync('git rev-parse --git-path hooks', { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
    hooksDir = resolve(repo, hooksDir)
  } catch {
    console.error(`${repo} is not a git repository`)
    return 2
  }
  const script = resolve(import.meta.dir, '..', 'hooks', 'git-pre-commit.ts').replace(/\\/g, '/')
  const bun = (process.execPath || 'bun').replace(/\\/g, '/')
  const hook = join(hooksDir, 'pre-commit')

  if (existsSync(hook) && !readFileSync(hook, 'utf8').includes(MARKER)) {
    renameSync(hook, `${hook}.local`)
    console.log(`kept your existing hook as ${hook}.local (it still runs first)`)
  }
  writeFileSync(
    hook,
    [
      '#!/bin/sh',
      MARKER,
      `if [ -x "$(dirname "$0")/pre-commit.local" ]; then "$(dirname "$0")/pre-commit.local" "$@" || exit $?; fi`,
      `exec "${bun}" "${script}"`,
      '',
    ].join('\n')
  )
  chmodSync(hook, 0o755)

  const token = arg('token')
  const url = arg('url')
  if (token) writeFileSync(join(gitDir, 'neuralops-token'), token + '\n', { mode: 0o600 })
  if (url) writeFileSync(join(gitDir, 'neuralops-url'), url + '\n')
  console.log(`NeuralOps pre-commit hook installed → ${hook}`)
  console.log(token ? `agent token stored in ${join(gitDir, 'neuralops-token')}` : 'no --token given: the hook will use NEURALOPS_TOKEN from the environment')
  return 0
}

process.exit(main())
