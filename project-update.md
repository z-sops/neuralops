# Orbit / Jarvis + NeuralOps — Project Update

Last updated: 2026-10-08 (Asia/Karachi)

## Working agreement

- Strengthen the existing Orbit and NeuralOps systems; preserve the product vision and reuse existing capabilities.
- Explain each gap, proposed adjustment, benefit, impact and verification before implementation. Obtain specific approval before applying that change.
- Respond in Roman Urdu / English.
- Maintain this file after each meaningful investigation, decision, approved change and verification. Never record credentials or personal data.
- No dependency installation, paid calls, destructive operations, production database changes, deployment, commits or pushes without applicable authorization.
- This log has been added to the Orbit review branch with the first identity change. The user's Windows checkout has not been changed.

## Product requirements discussed

- Visual AI office with Laila as CEO and dynamically configured workers.
- Laila evaluates scope, plans work, selects roles/skills, delegates, monitors and verifies deliverables.
- Direct worker dispatch through commands such as /alex and /bob.
- Shared procedural skill library and knowledge packs; job-specific context selection.
- Structured Alex-to-Bob development/testing handoffs with evidence and clear ownership.
- Guidance controls for approvals, state protection, cross-tag context and economy.
- State-preserving compaction and continuity across provider/model changes.
- Worker observability: meaningful progress, activity, tool status, tokens, errors and retries.

## Completed investigation

### Orbit read-only review

- Repository: https://github.com/z-sops/jarvis
- Inspected revision: 064e735351885030d4864ff23ca3881d7c72827f.
- Reviewed repository structure and execution/security/reliability paths; produced Orbit-Jarvis-Read-Only-Audit.md with 27 findings.
- Relevant source implementations were inspected; tests were not executed.
- No source modifications, installations, model calls, production writes, commits or pushes were performed.

### Screenshot review

- Viewed all nine supplied screenshots successfully despite the initial attachment path errors.
- Observed Office, workers, Workspace, Browser, Connectors, Memory, Library and Settings.
- The interface reported NeuralOps connected with 42 tools. This establishes displayed connection status, not end-to-end enforcement.
- Memory displayed five personal skills; shared Library displayed zero skills and one knowledge pack. These are different collections.
- Screenshots alone do not verify worker performance or the correctness of generated files.

### NeuralOps core and Orbit integration review

- Repository: https://github.com/z-sops/neuralops
- Inspected revision: decd1cbd19caebfbaf4a645324ee496a0d27d1bc; MCP package version 0.1.6.
- Inspected task manager, context engine, authority, gates, identity, MCP registry/transport, journal/replay, configuration, hooks and selected test source.
- Compared Orbit connectors, gateway and upstream transport against NeuralOps identity handling.
- Found actual implementations for 28 typed acts / 42 tools, task ownership, handoff accept/reject, approvals, reservations, structured compaction, ledger, signed journal/replay and workspace freeze.
- Classification: implemented but unverified in this session. No tests or live service calls were run.
- Correction to earlier scope: guidance/state/compaction capabilities exist in the separate NeuralOps repository; they must be assessed together with Orbit. Their availability does not establish mandatory Orbit enforcement.

## Findings and proposed strengthening

| ID | Gap found through code inspection | Proposed adjustment | Benefit | Status |
| --- | --- | --- | --- | --- |
| N01 | Orbit uses one saved connector token; upstream ignores the actor option and does not send delegated worker identity. | Map each worker to a NeuralOps identity and use its existing broker/delegate mechanism; reject missing/revoked mappings. | Correct ownership, actor history and separation of permissions. | Implemented on the review branch; 17 focused checks pass. Actor-authentication hardening follows in F02 below; real-service verification remains pending. |
| N02 | Inspected Orbit gateway does not automatically require NeuralOps clearance before other connector actions. | Enforce relevant checks in actual execution paths and synchronize Orbit jobs with NeuralOps tasks. | Guidance applies consistently instead of depending on model cooperation. | Proposed; scope and approval pending. |
| N03 | gateStatus for non-completion actions accepts approved status without checking expiry or consumption. | Use consistent approval usability checks and review clearance semantics. | Expired/exhausted permissions do not clear future actions. | Implemented for N03 with 12 focused offline regressions passing; full integration pending. |
| N04 | Journal write exceptions are logged and swallowed while live state may already change. | Propagate persistence failures and design safe state/acknowledgment handling. | Avoid reporting an operation as durably saved when disk persistence failed. | Static finding; design and approval pending. |
| N05 | Verified evidence is assigned from producer attest authority; it is not automatic artifact inspection. | Connect trustworthy QA/CI evidence to acceptance criteria and artifact versions. | Completion requires appropriate evidence of the requested result. | Integration proposal pending. |
| N06 | Compactor estimates tokens from characters and summarizes stored state; this is not provider usage/budget telemetry. | Keep estimates labeled; connect actual provider metrics and budget controls separately. | Honest economy reporting and enforceable limits. | Proposal pending. |

## Evidence pointers

- NeuralOps task states and handoffs: mini-services/neuralops-mcp/src/engines/task-manager.ts
- Compaction: mini-services/neuralops-mcp/src/engines/context.ts
- Approval usability: mini-services/neuralops-mcp/src/engines/authority.ts
- Gate inconsistency: mini-services/neuralops-mcp/src/engines/gate.ts
- Token/broker identity: mini-services/neuralops-mcp/src/server/identity.ts
- Persistence failure handling: mini-services/neuralops-mcp/src/engines/replay.ts
- Orbit connection/actor forwarding: lib/connectors.js, lib/gateway.js, lib/upstream.js

## Approval and execution state

- User authorized read-only NeuralOps inspection with 'check karlo'.
- User agreed to strengthening rather than replacing the system.
- After the concrete N01 proposal, the user said 'carry on working aur isko add bhi kardena', authorizing this implementation and adding the log to the repository on a review branch.
- User authorized creation and ongoing maintenance of project-update.md.
- N01 downstream identity forwarding is implemented and covered by focused offline checks. This does not establish full end-to-end identity isolation: F02 was subsequently authorized and strengthened as recorded below; filesystem isolation and live verification remain separate boundaries. No real-service, Windows or full-suite pass is claimed.

## Change history

| Date | Activity | Result / verification |
| --- | --- | --- |
| 2026-10-08 | Orbit read-only review and audit report | Source inspection; runtime behavior unverified. |
| 2026-10-08 | Nine screenshots reviewed | Visible setup understood; live execution not verified. |
| 2026-10-08 | NeuralOps core and Orbit connector reviewed | Existing guidance implementation confirmed in source; six strengthening areas documented. |
| 2026-10-08 | N01 worker identity proposal explained | Benefits and intended verification explained; approval pending. |
| 2026-10-08 | project-update.md created | Investigation, requirements, findings and pending approval recorded; repository unchanged. |

## Implementation record — N01

- Added lib/neuralops-identity.js: explicit unique AI identity mappings, malformed/header-injection rejection, no human identity assignments, and fail-closed missing mappings.
- Updated lib/connectors.js: validated mapping persistence, broker setup guidance and configuration signatures that change with mappings.
- Updated lib/upstream.js: identity-bound X-Agent-Id header alongside the private broker bearer token.
- Updated lib/gateway.js: separate connections/cache entries per mapped identity, no fallback to a shared actor, changed-access checks after approval and connector-wide cleanup of identity connections.
- Updated lib/connectors-panel.js and renderer/js/connectors-ui.js: editable mappings for Laila and each worker under Who can use it; validation errors shown; saved tokens never returned to the renderer.
- Added test/neuralops-identity.test.js and included it in the default test script. Updated README.md and AGENTS.md with setup and verification limitations.
- Existing NeuralOps authority, worker allowlists and Orbit tool-level approvals were preserved. No server registration or authority change was performed.
- Existing installations need an Orbit broker plus separately registered AI identities with that broker as delegate. Workers without mappings cannot use the NeuralOps connector until configured.
- Approval-granting calls still run as the mapped AI identity, after Orbit's existing user dialog; human approvals remain in NeuralOps' human workflow. This change does not impersonate a human or add human-decision attribution.

## Verification — 2026-10-08

- node --check: all seven changed/new JavaScript files passed.
- node --test --test-isolation=none test/neuralops-identity.test.js test/neuralops-connector.test.js: 17 passed, 0 failed, 0 skipped (Node 24.19.0).
- Checks cover parallel identity headers, missing mappings, unsafe/duplicate/human mappings, simulated delegate revocation, mapped handoff boundary, approval/allowlist preservation, mapping changes during approval, stale connection cleanup, unchanged other-service headers/native actor forwarding, IPC and DOM form behavior.
- First focused run: 14 passed / 1 failed due to a test fixture missing its connector visibility setting. Fixture corrected; subsequent 17-check runs passed. No product failure was hidden or waived.
- Tests used an in-memory MCP client substitute and a DOM harness. No test sockets, temporary test files, child worker processes or paid model calls were used.
- No dependencies were installed. Full npm test was not run: the available checkout is a scoped source snapshot, and the full suite contains filesystem/process/integration tests subject to the user's restrictions. Real MCP SDK transport, live NeuralOps/Hermes, real server handoff semantics, visual Electron screenshots and Windows execution remain unverified.

## Remaining boundaries and next proposals

- F02: actor-bound gateway authentication is now implemented with focused in-memory verification. Credential theft through unrestricted local filesystem access remains outside this change.
- N02, N04-N06 remain proposed, not implemented: mandatory NeuralOps gating, journal failure propagation, evidence integration and actual economy telemetry. N03 is recorded below.
- OpenCode and built-in workers gain no new connector access in this change.
- N03 was subsequently authorized and implemented below. The next independent change needs its own gap/change/benefit explanation and approval.


## Repository publication

- User authorized N01 implementation and repository addition with 'carry on working aur isko add bhi kardena'.
- Repository branch: codex/strengthen-neuralops-identities.
- Implementation commit: 6cc9bfd54a4f0efa56ac1f7967079df412cc726c (11 changed files).
- Draft review PR: https://github.com/z-sops/jarvis/pull/1.
- project-update.md is committed on that branch. Main has not been merged or changed by this work; the Windows checkout has not been updated.
- A follow-up log-only commit records this publication. All source verification results remain as listed above; no live deployment or worker setup was performed.

## Implementation record — F02 (2026-10-08)

- User authorized the concrete worker-bound gateway token proposal with “go ahead”. Preserved the existing architecture and main-process Laila path.
- Added lib/gateway-auth.js: a fresh 32-byte private key, exclusive creation with mode 0600, fail-closed corrupt/unreadable key handling, exact active-worker checks and per-actor HMAC tokens with constant-time comparison. The old shared browser token is never used as key material.
- Updated lib/browser-mcp.js: actor-bound bearer authentication, no default commander route, reserved/unknown actor rejection and a discovery-only bridge-check identity. Existing Host/Origin protections remain. URL, header and tool-body spoofing cannot select another authenticated actor.
- Updated lib/browser-panel.js: per-worker token in the Hermes profile environment, private key absent from generated profiles; existing signatures refresh changed profiles. Probe discovery omits connector tools and all probe tool calls are rejected.
- Added test/gateway-auth.test.js to the default test script; updated existing real HTTP browser-mcp tests, README.md and AGENTS.md. No new dependencies.
- Verification: 24 focused checks passed (gateway auth 7 + identity/connector 17), 0 failures/skips; five changed/new JavaScript files passed node --check. Gateway/profile checks used memory-only HTTP and filesystem substitutes.
- Initial combined run had one test-harness assertion failure comparing an empty array across VM realms. Corrected that assertion to compare length; final 24 checks passed. No product failure was waived.
- No paid calls, dependency installs, real sockets, child workers, production database changes or deployment. Real HTTP tests, full suite, Electron UI, live NeuralOps/Hermes transport and Windows ACLs remain unverified.
- Activation requires updating the Windows checkout, stopping existing jobs and restarting Orbit; none of those actions have been performed here. Existing NeuralOps broker/delegate mappings from N01 still need configuration and live whoami verification.
- Boundary: workers with unrestricted local filesystem access can steal another profile token or the master key. Same-ID recreation reuses its token under the same key; removal refuses future requests but does not cancel in-flight actions. This change does not claim OS sandbox isolation.
- Publication target: existing review branch codex/strengthen-neuralops-identities and draft PR https://github.com/z-sops/jarvis/pull/1; main remains unchanged. Publication confirmation follows after successful branch update.

### F02 publication confirmation

- Implementation commit: c00d8e7afa095a34e3fea245e1e1e542f8a4ee41 (nine changed/new files). Branch update succeeded.
- Draft PR #1 now describes both NeuralOps identity forwarding and worker-bound gateway authentication: https://github.com/z-sops/jarvis/pull/1.
- A follow-up log-only commit records publication. Main is unchanged; no merge, deployment or Windows checkout update occurred.

## Implementation record — N03 (2026-10-08)

- User said “go ahead” after the expired/consumed approval proposal, authorizing this specific NeuralOps fix. NeuralOps main source baseline: decd1cbd19caebfbaf4a645324ee496a0d27d1bc. No AGENTS.md was found in the current recursive repository tree.
- Independently traced gateStatus, isUsable, consumeApproval, perform, completed-task clearance and existing enforcement tests. Confirmed gateStatus accepted approved status without expiry/consumption checks and accepted old non-completion clearances as permission.
- Updated mini-services/neuralops-mcp/src/engines/authority.ts: shared usability rejects consumed permissions, exhausted/invalid counts and invalid/expired timestamps; uses actual instants, treats exact expiry as expired, and defaults omitted check time to now. Explicit replay timestamps remain supported.
- Updated src/engines/gate.ts: uses the shared predicate for non-completion approvals; historical non-completion clearances cannot bypass it. Completed-task clearance semantics, frozen workspace checks, task/action/scope matching and required verified evidence are preserved.
- Added tests/gate-approval.test.ts (12 regressions), scripts/test-gate-offline.cjs (Node 24 in-memory source loader), package script test:gate:offline and README guidance. The loader substitutes only bun:test with node:test; production store, authority, gate and error modules execute from source. No services or journal persistence listeners are initialized.
- Before fix: 4 passed, 8 failed, reproducing stale/expired/consumed approval, exact-expiry, malformed-count and clearance bypass behavior. After fix: 12 passed, 0 failed/skipped on Node 24.19.0. Source transformation/runtime parsing passed for loaded TypeScript modules; offline CJS runner syntax passed.
- Bun is unavailable. Full Bun suite, semantic TypeScript checking, actual processAct/journal replay, HTTP/CLI/hook flows and Windows execution remain unverified. No packages installed, paid calls, sockets, child workers, production state mutation, merge or deployment.
- Boundary: gateStatus remains read-only and does not reserve or consume permission. Check-only external actions can race or repeat before consumption; existing actor-bound perform consumes governed permissions. Mandatory external enforcement and artifact verification are separate proposed work.
- Publish target: a separate NeuralOps review branch/draft PR; Jarvis review source is unchanged by N03. Publication confirmation follows.

### N03 publication confirmation

- Implementation commit: e9398d62d07e78e97fd1b3bfd05d2bc5d75fc381 (seven changed/new files) on codex/strengthen-approval-usability. Branch update succeeded.
- NeuralOps draft review PR: https://github.com/z-sops/neuralops/pull/1. Main is unchanged; no merge/deployment performed.
- Follow-up log-only commits synchronize this record to the NeuralOps and Jarvis review branches. Windows installations remain unchanged.
