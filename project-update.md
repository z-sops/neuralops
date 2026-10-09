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
| N04 | Journal write exceptions are logged and swallowed while live state may already change. | Propagate persistence failures and design safe state/acknowledgment handling. | Avoid reporting an operation as durably saved when disk persistence failed. | Implemented after specific approval; 13 persistence failure-injection checks pass. Real filesystem/integration verification pending. |
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

## N04 investigation and concrete proposal — 2026-10-08

- Continued after the user's “go ahead”; no N04 implementation proposal had yet been presented, so inspected and prepared the next concrete change under the working agreement. No production source changed.
- Traced current replay.ts, store.ts, task-manager.ts, app.ts, agents.ts and admin.ts. State mutation and ledger notifications can precede persistence; processAct restores counters only on error. Registrations/admin changes also mutate before journaling. Simply removing the catch is insufficient.
- Real JournalFile and Store source executed in a Node VM with an in-memory filesystem; unused replay imports substituted. Injected ENOSPC into the first append, then allowed a second. First failed save returned normally; memory had two records, disk one line, head count two and one logged error. No sockets, live journal or production actions were involved.
- Concrete proposal: explicit persistence-failure state, clear failed/uncertain outcome instead of success, block further mutations and gate clearance after disk-write uncertainty, and defer successful observer notifications until persistence succeeds. Cover acts, registration, administration and genesis. Preserve the signed journal format.
- Distinguish pre-append failure from failure after bytes were written/head update failed. Do not blindly retry, silently reseed, promise disk rollback or report ambiguous work as safely unexecuted. Resume only through restart/recovery using a verified journal.
- Verification plan: in-memory append/head-write/rename failures; ensure no later writes or success notifications and test normal behavior. Power-loss fsync guarantees and automatic recovery are outside this proposed patch.
- Benefit: honest durable-success reporting, no further chain corruption after a failed append, and a clear disk-full/permission recovery boundary. Impact: persistence failure pauses governed work until recovery.
- Specific N04 source-implementation approval pending. No source fix, package installation, paid call, production state mutation, merge or deployment performed.
- Workspace execution transport disconnected during log-save attempts. Repository logs updated directly; local/saved standalone log synchronization remains pending.

## Implementation record — N04 (2026-10-08)

- User explicitly approved the concrete N04 proposal with “ok kardo”. Workspace access recovered; local project-update.md was synchronized with the repository investigation record before changes.
- Store adds synchronous whole-state transactions, buffered ledger/snapshot notifications, rollback of live memory/counters on thrown failure, and a process-local persistence-failure latch outside replayable data. Muted trusted replay remains supported.
- Acts, registration, all administration entry points and genesis use the boundary. Journal failures propagate as persistence_unavailable (HTTP status mapping 503); failed acts return an uncertain-disk-outcome message rather than durable success. Credentials are not returned from failed registration.
- Live JournalFile writes calculate candidate MAC/count without advancing live writer state until append/head succeed. Append/head/temp rename failures latch the fault. Rewrite and later backup/writes cannot bypass the latch. Signed format is unchanged.
- gateStatus denies clearance after persistence failure; performCheck raises the same clear error. Reset/import/replay/detach/load cannot clear the fault. Ledger/snapshot observers run after confirmed writes; observer errors are isolated from committed outcomes.
- Added scripts/test-persistence-offline.cjs and package test:persistence:offline. Existing gate offline runner now provides structuredClone for transactions. README documents recovery, overhead and verification limits.
- Verification: 13 persistence checks passed, 0 failures/skips. The actual Store, JournalFile, acts/admin/registration/genesis entry points and gates execute against an in-memory filesystem; Zod validation and unused demo seeding are explicitly substituted. Tests cover failure before/after append, head write/rename (including post-rename error), genesis write/rename, rollback/counters, missing success notifications, no later mutations/writes/clearance, latch preservation, successful signed journal loads and normal observer delivery. Existing 12 N03 approval tests also passed.
- Limits: whole-state cloning overhead is unbenchmarked; fsync/power-loss durability, multi-process transactions and automatic recovery are not added. Bytes may exist on disk after a failed operation; verify the recovered journal before retrying.
- Full Bun suite, Zod validation, semantic TypeScript checking, actual HTTP/MCP error transport and Windows/real-filesystem recovery remain unverified. No packages installed, paid calls, sockets, child workers, production data changes, merge or deployment.
- Publication will update the existing NeuralOps review branch/PR with N03 and N04 together; main and Windows installations remain unchanged.

- N04 syntax verification: seven changed TypeScript modules parsed/transformed successfully, and both offline CJS runners passed node --check. This is parsing, not a semantic typecheck.

### N04 publication confirmation

- Implementation commit: 4e1b0996f425d14ac13d095e9a72f5b44bb8b87d (12 changed/new files), published on codex/strengthen-approval-usability.
- NeuralOps draft PR https://github.com/z-sops/neuralops/pull/1 now covers N03 approval usability and N04 persistence failure handling.
- Follow-up log-only commits synchronize this record across NeuralOps and Jarvis review branches. Main and Windows installations remain unchanged; no merge/deployment.
- Local standalone log synchronization resumed after workspace access recovered.


## Managed action contracts and file access — 2026-10-09 (Asia/Karachi)

- Continued under the user's autonomous strengthening authorization. Existing Electron/Node/plain-renderer architecture is retained. No ZCode files were copied into Jarvis. No paid/live-provider calls, production database changes, main merge, deployment or Windows checkout changes.
- Independently confirmed a built-in tool gap: the former `read_file`/`read_image`/`list_dir` policy allowed the whole Orbit home to workers and used lexical paths. Workers now read only their active job workspace (or their normal worker workspace outside an isolated job), cannot inherit commander session grants, and cannot follow links outside that boundary. New writes resolve existing ancestors. Secret names and Orbit connector/browser/Hermes credential directories are blocked; directory listings hide secret names. Arguments are copied before permission waits; canonical paths and permissions are rechecked immediately before execution and after managed authorization. This is a main-process API boundary, not an OS sandbox or a guarantee against concurrent hostile host filesystem changes.
- New original `lib/job-guidance.js` implements optional managed jobs. The main process requires exactly one visible enabled NeuralOps connector, explicit distinct worker mapping and the advertised `managedJobs: orbit-v1` server capability. It creates and claims a unique task for the job/run, then persists that binding before the built-in model loop. Required operations still honor blocked/ask/free connector levels. A blocked/unavailable/old server fails closed; bootstrap and mutations are not automatically retried.
- Every built-in tool invocation for a managed job checks the trusted active run and stored binding, then sends an exact job/run/tool/SHA-256 argument fingerprint to NeuralOps perform before execution. Pending/denied authorization blocks the action; no fallback to unmanaged mode. Stop during a remote authorization response prevents a later local write. Identity/URL/permission changes are rechecked. Retry and pause/continue retain managed mode but create fresh task/run bindings, never inherited approvals.
- Office adds an explicit managed-job checkbox, preserves it across refresh and shows the linked task ID. Laila assign_task can request the same managed option. Ordinary jobs retain their existing mode. Managed Hermes/OpenCode and managed shell are deliberately refused until direct engine hooks and host containment have been verified; this prevents a protection label on an uncovered execution path.
- NeuralOps changes preserve the earlier expiry/consumption and transactional persistence fixes. Optional typed perform binding validates recorded task ownership/in_progress status, job/run constraints, tool/action/scope and verified evidence before authority/approval. Ungoverned managed actions fail closed unless the actor holds an explicit direct authority grant. Approvals match the entire binding detail, must be single-use and decided by a registered human identity. A changed argument digest cannot reuse an approved or pending request. Frozen workspace/revoked identity checks remain enforced. Legacy unmanaged calls retain their existing behavior.
- Managed NeuralOps ledger receipts now record authorization, not a false claim that the external tool already ran. Existing direct authority grants remain explicit administrator-controlled authority; managed mode does not itself grant authority or create policies.
- Jarvis full suite: 355 total, 352 pass, zero fail, three real-Hermes skips. Subsequent final file-policy/assign-task changes passed 32 relevant security/core/run/guidance tests. Fourteen new Jarvis cases cover six file boundaries and eight guidance/bootstrap/worker lifecycle cases. NeuralOps real processAct/schema/store managed regressions: 10/10; existing gate regressions 12/12 and persistence regressions 13/13. NeuralOps managed tests use already installed Zod via NODE_PATH and Node's experimental TypeScript/VM support; no mocked authorization dispatcher.
- UI: 16/16 Chromium Playwright checks with real renderer/preload/IPC job backend and fixture providers/Electron APIs, including managed draft preservation and fail-closed dispatch without guidance. Seven actual Linux Electron main/window/preload/IPC checks pass. Reviewed screenshots, including the managed form. Ten touched/new Jarvis JavaScript syntax checks passed; changed NeuralOps TypeScript modules are parsed/executed through the offline dispatcher runner.
- Remaining, NOT fixed by this slice: universal managed enforcement across external engines/native/provider/direct browser routes; verified host containment; remote task finalization/outcome synchronization after human review; independent semantic artifact verification; full feasibility/planning/dependency orchestration; complete provider-switch continuity; comprehensive transport observability/router budgets; Windows and real Hermes/OpenCode/live NeuralOps/provider verification. Managed tasks currently stay in progress remotely until explicitly reconciled; local job review/acceptance is authoritative only inside Orbit. Approval fingerprints are not proof of successful execution or semantic correctness.
- Publication targets remain the existing draft PRs, with optimistic branch-head leases and exact blob verification. Publication confirmation follows after writes succeed.

- Publication confirmed: Jarvis source/tests/docs committed as `41b1a5f3567c706f85b15c3e4d9ba2baa2394028`; NeuralOps source/tests/docs committed as `34e67e12348f7e7419f787ddc41f2a06737e7c7a`. Existing draft branches updated with expected-head leases; all 15 Jarvis and eight NeuralOps published blobs exactly match reviewed local files. No main merge or deployment. Subsequent log-only confirmation commits retain this evidence.


## Managed outcome reconciliation and Herdr reference review — 2026-10-09 (Asia/Karachi)

- Continued under existing autonomous strengthening/testing/draft-publication permission. No paid/live-provider calls, new dependency installs, production changes, main merge, deployment or Windows checkout modification. No Herdr/ZCode source files were copied into Orbit.
- Found local review/acceptance had no corresponding remote outcome; managed NeuralOps tasks remained in progress. New original lib/job-outcomes.js records a bounded delivery intent atomically with worker review, failure, cancellation, startup interruption and human acceptance/rejection. Each event retains a fixed act ID and sequence. Queue survives a fresh Home/restart; startup never sends it or replays the job.
- Office now distinguishes pending/unconfirmed/recorded remote delivery from local status and provides explicit Sync NeuralOps outcome. Trusted main-window IPC calls the private identity broker after connector permissions; identity/URL/run/visibility/access are rechecked around waits. Old servers without jobOutcomes orbit-v1 or required operations fail closed. Concurrent Sync shares one operation; acknowledgement rereads the record so a human decision arriving mid-sync is retained. No automatic delivery/retry occurs.
- Sync checks the exact remote receipt before submission and after response. A lost post-commit response stays unknown; fresh guidance resolves the same act ID without reposting. Receipt mismatch is not acknowledged. Report/artifact content stays local; outcome wire carries IDs, states, check status, SHA-256 report/manifest hashes and count. Diagnostic UI errors are generic to avoid upstream data exposure.
- NeuralOps adds typed strict job_outcome and scoped job_receipt tools, registered through the existing protocol/dispatcher/MCP schemas. Owner/workspace/job/run, state sequence and report fingerprint are checked. Outcomes block the task for reconciliation, release the reporting owner's task reservations and remain client claims with verified:false. accepted_locally is explicitly worker-reported; it creates no remote human authorization, verified evidence or completed task. Existing remote completion policies are separate, not universally strengthened by this claim channel.
- Receipt confirmation fails closed on a journal/head persistence fault. New real handler/persistence regression confirms rollback, suppressed success notifications and no success receipt after an uncertain disk write. Old completed jobs without queues are not migrated; bootstrap uncertainty before binding persistence and external remote ownership/state changes still need manual reconciliation. Explicit sync solves outcome recording, not automatic remote finalization or independent semantic verification.
- Final Jarvis full suite: 384 total, 381 pass, zero fail, three real-Hermes skips (34.56 seconds). Focused outcome/guidance/recovery/run cases: 49/49. Nine new outcome tests cover atomic review/acceptance, restart, failed/cancelled distinction, lost-response recovery, concurrent sync/rejection, old/blocked/changed identity, mismatched receipts, stale bindings and trusted async IPC. An initial injected fixture lacked declarationsFor; corrected the fixture. The full suite caught a worker fixture without findJob; normal-job settlement was preserved while real managed jobs read authoritative current records. No lifecycle assertion was removed.
- NeuralOps outcome real schema/dispatcher/store/MCP registry cases: 8/8; existing managed10/10, gate12/12 and persistence now14/14. The persistence runner uses explicit in-memory filesystem and validator/demo substitutes; outcome/managed runners use installed real Zod. No deployed NeuralOps HTTP session/full UI build claim.
- Playwright Chromium: 18/18 including real renderer/preload/IPC/Workers with a fixture outcome provider; acceptance followed by a second explicit Sync remains distinct. Seven actual Linux Electron smoke checks pass. Eleven touched/new JavaScript syntax checks passed and the new managed-outcome screenshot was reviewed. Windows/live Hermes/OpenCode/NeuralOps remain unverified. No claim that all original gaps are closed.
- User requested an opinion on Herdr before continuing. Inspected official repository trees, READMEs and selected source at Herdr tree 2563803dca97c040beaf3dc3acdcb5a3221b4238, herdr-review tree 1154ddbed6db0933e7624c4487c3e890ef48b2fa and herdr-workspace tree b5f38d0e295168fcd87284b710049a183140f010. Read core agent_detection.rs, persist/restore.rs, OpenCode event integration; review status.py/exclusive.py/orchestrator prompt; workspace apply.rs. Not a complete folder audit or runtime/build verification. Demo test counts are not adopted as evidence.
- Herdr useful references: native permission/question/session events rather than silence guesses; separate coding/reviewer/fixer responsibilities; structured generation-fenced run status; heavy-command resource locking; reusable team/worktree layouts. Found Unix fcntl in the review plugin and prompt-dependent use of its command wrapper—do not treat these as portable Windows enforcement. Detach persistence differs from restarting original processes. Recommended Orbit Supervisor + Router + Pipeline + Generate–Review + Blackboard hybrid; voting/debate/swarm only when needed. Independent review tied to exact code revision and tests remains a next gap, not implemented by this reference read.
- Remaining: automatic final remote reconciliation with independently authenticated decisions; semantic/exact-revision review/testing gates; complete planning/team orchestration and provider continuity/budgets; universal external-engine hooks/host containment; actual Windows/live-provider verification. Publication confirmation follows once both draft writes and byte checks succeed.

- Publication confirmed: Jarvis source/tests/docs/log committed as `be1a8245b06ca9a58539d5d4cfcfe5f9df85f8cc`; NeuralOps source/tests/log committed as `1f4ba0586fe57f0e48600e94d5150bb0e5d5f6b8`. Both existing draft branch refs updated with expected-head leases; all 15 Jarvis and nine NeuralOps published blobs match the reviewed local bytes. No main merge/deployment. Log-only confirmation commits follow.
