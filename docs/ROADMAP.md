# ADE delivery roadmap

Status date: 2026-07-19. Goals are completed in order and published as separate
verified commits.

## Goal 1 - runtime reliability baseline

Status: implemented; verification recorded in the Goal 1 commit.

- Distinguish interactive terminals from one-shot task sessions.
- Replace fixed-delay prompt typing with non-interactive runtime transports.
- Cap active task CLIs at four with a FIFO queue and cancellation.
- Reconcile main-owned sessions after renderer reload.
- Sequence replay and live output so attach cannot drop a chunk.
- Stop sessions when their agent/category is deleted; remove closed sessions;
  reap naturally exited sessions after a bounded retention period.
- Drive Graph completion from real process exit rather than timers.

Exit criteria: typecheck/build clean; memory, dispatch, and runtime reliability
checks pass; ConPTY smoke marker observed.

Verification: `pnpm run typecheck`, `pnpm test` (24 memory + 10 dispatch +
15 runtime assertions), and `pnpm run build` pass. The direct ConPTY smoke
reported `PTY_SMOKE_OK`; an isolated Electron dev launch created its config and
renderer data successfully, and its process tree was explicitly stopped.

## Goal 2 - run and task domain model

Status: implemented; verification recorded in the Goal 2 commit.

- Keep categories and named agents permanent.
- Add persisted `Run`, `Task`, `Participant`, `Event`, and `Artifact` entities.
- Make lead/worker roles run-scoped instead of permanent agent fields.
- Make Graph render normalized run events rather than timer/view state.
- Migrate existing Graph-created categories without deleting user data.
- Persist PTY start, completion, failure, cancellation, and restart recovery as
  normalized task events.
- Scope task cancellation to persisted task ids so one run cannot stop another.

Exit criteria: a run survives reload, status is reconstructible from its event
journal, and spawning a run does not create permanent categories or identities.

Goal 5 checkpoint verification (historical): `pnpm run typecheck`, `pnpm test` (24 memory + 12 dispatch +
16 runtime + 19 orchestration assertions), and `pnpm run build` pass. The
orchestration checks cover one-time legacy migration, reload reconstruction,
restart recovery, artifact journaling, and catalog identity preservation. An
isolated production preview at 1440x900 verified the default Graph layout,
Inspector reflow, and new-run roster dialog without overlap.

## Goal 3 - terminal beta

Status: implemented; verification recorded in the Goal 3 commit.

- Run Windows CI over typecheck, focused checks, a compiled Electron workflow,
  and an unpacked production-package smoke.
- Diagnose configured CLI availability, version, authentication and task
  transport without executing custom commands or changing credentials.
- Provide keyboard navigation for views and session tabs, including create,
  close, previous/next and direct tab shortcuts.
- Notify in the OS when background tasks finish/fail or an interactive terminal
  exits abnormally.
- Enable the renderer sandbox and a default-deny CSP; validate the main-frame
  sender and exact runtime payload for every privileged IPC call.
- Reconcile exit/removal events that race a renderer reload; preserve exit
  reason and output; show retry, restart, diagnostics and close actions.
- Produce an x64 NSIS installer and retain the verified node-pty Node-API
  prebuild inside the asar-unpacked payload.

Exit criteria: focused checks/typecheck/build clean; the production Electron
workflow proves real ConPTY I/O, reload recovery and failure/restart behavior;
the unpacked packaged executable passes the same workflow; an NSIS artifact is
created. Local artifacts may be unsigned, while release CI signs when the
Windows certificate secrets are configured.

Verification: `pnpm run typecheck`, `pnpm test` (24 memory + 12 dispatch +
16 runtime + 19 orchestration + 51 Windows security assertions), and
`pnpm run build` pass. The production Electron workflow passes 23 checks in
both the source-built app and `dist/win-unpacked/ADE.exe`. `pnpm package:win`
creates `dist/ADE-0.1.0-x64-Setup.exe`; the local artifact is deliberately
unsigned. Visual inspection at 1264x781 confirmed the failure bar and runtime
diagnostics modal do not obscure terminal or panel controls.

## Goal 4 - orchestration beta

Status: implemented; verification recorded in the Goal 4 commit.

- Runtime adapter interface, worker-specific tasks, structured results,
  worktree ownership, verification and integration.
- Prefer native runtime coordination where it is reliable; keep a file-based
  mailbox as a generic fallback.
- Add concurrency, token/cost and approval budgets per run.

Exit criteria: a managed run produces participant-specific work rather than
same-prompt fan-out; accepts only schema-valid results; owns clean worktrees for
its lifetime; stops for a durable human integration approval; transactionally
integrates every ADE-authored commit whose exact diff matches the worker report;
runs a distinct integration review and read-only verification; and fails closed
on missing required telemetry, exhausted budgets, dirty worktrees, runtime Git
history changes, report/diff mismatches, invalid commits or conflicts.

Verification: `pnpm run typecheck`, `pnpm test` (24 memory + 12 dispatch +
17 runtime + 19 domain-orchestration + 41 orchestration-beta + 56 Windows
security assertions), `pnpm run build`, and the 32-check production Electron
workflow pass. Goal 4 checks cover native Codex JSONL/schema wiring, strict
result validation, worker-specific planning, dependency/concurrency scheduling,
mailbox routing, exclusive leases, approval gating, usage budgets, exact-diff
ADE commits, full commit ranges, transactional conflict rollback, integration
and verification. The same Electron workflow is also run against the unpacked
Windows executable.

## Goal 5 - repository scopes and reusable agents

Status: implemented and locally verified; this Goal 5 commit records the result.

- Make repositories first-class catalog entries instead of category-owned
  paths. Preserve categories as organizational groups.
- Give an agent an optional default repository. An agent without one remains
  portable and may receive an explicit repository per session, task or run.
- Resolve one independent ADE worktree binding for each agent/repository pair;
  snapshot that immutable binding onto every execution.
- Add a repository-scope header above Files/Changes with repository, binding
  source, branch/worktree and lease state plus choose/default/detach actions.
- Never hot-switch a live PTY. Choosing another repo opens a new scoped session.
- Add immutable agent templates whose spawn creates an independent agent,
  memory directory and optional default repository.
- Migrate existing category `repoPath` and agent workspaces without deleting or
  moving user files, branches, worktrees, sessions or historical run state.

Exit criteria: a specialized agent can default to one repo; a portable agent
can work safely in at least two repos; Files/Changes always uses the selected
execution's actual binding; managed runs retain exclusive same-repository
worktrees and all current integration guarantees; template instances share no
mutable identity, memory or workspace; migration/restart is non-destructive.

Verification: `pnpm run typecheck`, `pnpm test` (24 memory + 12 dispatch +
17 runtime + 19 domain-orchestration + 41 orchestration-beta + 21 repository-
scope + 64 Windows security assertions), `pnpm run build`, and the 41-check
production Electron workflow pass. Goal 5 checks cover deterministic migration,
linked-worktree deduplication, two-repository reuse, concurrent binding
creation/rollback, physical-worktree uniqueness, portable/default resolution
across restart, template memory isolation/redaction and run/task/session/
artifact snapshots. The Electron workflow proves
plain-to-repository session creation, tab switching, renderer reload, exact
binding restart, full app restart and the complete managed integration
lifecycle. Detailed
decisions live in `docs/REPOSITORY_SCOPES_PLAN.md`.

## Graph P0 - orchestrator foundations

Status: implemented between Goal 5 and Goal 6; verification recorded in the
Graph P0a-P0c commits. Design sources: `docs/research/agent-orchestration/`
(GRAPH_ORCHESTRATOR_DESIGN.md P0 items) plus the mobile-readiness rules from
`REMOTE_CONTROL_PLAN.md`.

- Give events and messages one global monotonic `seq` (with one-time backfill)
  and a cursor-paged `run:events` query as the Goal 7 SSE base.
- Accept an optional `commandId` on mutating run commands and replay recorded
  successful outcomes from a bounded command log.
- Project sanitized `RunSummary` snapshots without absolute paths, prompts or
  mailbox bodies.
- Add main-owned team pause/resume that managed scheduling honors without
  cancelling running tasks; renderer idle state is manual-dispatch-only.
- Commit each logical phase transition (planning, working, approval,
  completion) as one atomic save.
- Move phase prompts into a versioned module; journal a path-free run context
  manifest and per-task context packets with bounded dependency results and
  provenance; tell the planner dependent workers inherit no upstream code;
  inject agent memory as a read-only snapshot outside the leased worktree.
- Render every non-terminal run as its own canvas cluster with journal-driven
  edge/node activity, a visible task-slot/queue panel, a provenance inspector
  and live task-session attach on double-click.

Exit criteria: no orchestration semantics change beyond pause and atomicity;
summaries, manifests and prompts contain no absolute host paths; the focused
suite and the production Electron workflow stay green.

Current regression verification: `pnpm run typecheck`, `pnpm test` (Memory 27,
Dispatch 12, Runtime 29, Orchestration 45, Orchestration-Beta 100, Prompts 31,
Repository-Scopes 43, Workspace-FS 7 and Windows Security 99), `pnpm run
build`, and the 46-check production Electron workflow pass. Renderer behavior
was additionally
verified headless against a deep-cloning `window.ade` stub: multi-run
clusters, seq-gated travel dots, pause command wiring, provenance inspector
and task-session attach.

## Goal 6 - product validation

Status: **completed 2026-07-19 with a bounded GO for Goal 7.** F1-F8 and the
single-agent comparison arms are documented. The final F8v6 run completed on
a Codex-only (`gpt-5.6-sol`, bypass, orchestrator `xhigh`) roster after closing
the expected-failure representation, Codex stdin transport and integration
path-set prompt findings. Fixture protocol and result log live in
`docs/goal6/VALIDATION_PLAN.md` and `docs/goal6/RESULTS.md`; per-run metrics
are extracted with `pnpm goal6:report` (`scripts/goal6-report.ts`). The pilot
baseline (SHA `81820b9`, vitest 77/77, server 5/5, tsc clean) was recorded on
2026-07-14.

- Validate the orchestration beta and the new repository bindings on the
  `2D_rpg_jumpnrun` repository using disposable ADE worktrees and branches. Do
  not touch its current working tree, update its main branch or push without
  separate approval.
- Define 6-10 representative tasks: isolated fixes, tests, a cross-file
  feature, refactoring and work with a credible parallel decomposition.
- Compare suitable tasks against a single-agent baseline using the same goal
  and acceptance criteria.
- Record completion, test/verification outcome, elapsed time, token usage,
  conflicts, integration attempts and human interventions. Cost remains
  unknown for adapters that do not provide trusted billed-USD telemetry.
- Resolve reliability or safety failures before adding a network control
  surface, then record an explicit go/no-go decision for the remote goals.
- Validate the resulting workflow with external users before a public remote
  beta or broader feature expansion.

Exit criteria: representative runs finish without losing user changes,
misreporting completion, crossing repository scopes, mutating worker history,
integrating an unreported diff or bypassing approval. Results identify where
managed multi-agent work is better, neutral or worse than the single-agent
baseline. Any critical safety failure blocks Goal 7.

Verification plan: task fixtures and measurements are committed separately
from changes to the pilot repository; ADE's full `pnpm verify` remains green.

## Platform track - Linux package and Windows GUI→WSL backend

Status: **implemented and locally plus hosted verified 2026-07-19; public
package-release gates remain.** This track is orthogonal to remote Goals 7-10
and is specified in `MULTIPLATFORM_PLAN.md`.

- Native Ubuntu/WSL2 builds Linux `node-pty`, passes the focused/source
  Electron gates and produces unpacked x64, AppImage and Debian artifacts.
- AppImage, unpacked and Debian-payload artifacts pass the same 47-check
  packaged workflow; Debian metadata/payload are valid. The first hosted
  release workflow also passed installed-`.deb` verification and uploaded
  SHA-256 artifacts.
- Windows ADE now imports an explicit `wsl:<distribution>` repository and
  routes its Linux paths, Git, files, worktrees, diagnostics, PTY and managed
  run through that distribution without fallback or mixed-Git access.
- Local WSL evidence is 31/31 backend integration checks and 67/67 extended
  Electron/Playwright checks, including a complete managed run, app restart,
  reopen and cleanup.

Remaining release gates: establish the public license/release policy, publish
checksummed versioned Linux assets, add clearer
first-run WSL prerequisite guidance, and keep macOS explicitly unverified.

## Verified publishing track - repository Draft PRs and CI handoff

Status: **implemented and locally verified 2026-07-19.** This is a local,
explicit desktop capability and not part of the remote Goals 7-11 command
surface. The binding contract is `VERIFIED_PUBLISHING_PLAN.md`.

- Atomically attest the exact clean repository HEAD and verification task when
  a managed run completes; legacy completed runs remain ineligible.
- Add a read-only Graph preflight for repository identity, approved integration,
  final test evidence, unchanged remote base, exact candidate range, safe
  generated branch and GitHub CLI access.
- Require a second explicit operator confirmation before any external write.
  Create only a new collision-protected `ade/run-*` branch and GitHub Draft PR;
  expose no default-branch push, force update, branch deletion or merge action.
- Persist requested/completed/failed publication state and recover interrupted
  I/O as retryable failure. Verify an exact existing branch/PR on retry and keep
  errors/evidence credential- and local-path-redacted.
- Execute Git and `gh` in the repository's native or selected WSL backend and
  show the provider check rollup without treating it as a merge decision.
- Keep publishing absent from the future mobile/remote API. A bypass coding
  agent remains a fully trusted OS process; this product gate does not claim to
  sandbox a malicious agent from ambient Git credentials.

Exit criteria: 29 focused publication contracts exercise real isolated Git
pushes plus deterministic provider behavior; security validation covers exact
new IPC payloads; Electron/Playwright proves preview, disabled-before-confirm,
exact remote branch, Draft-PR audit, unchanged `main` and restart persistence.
The full Windows source gate is 446 focused assertions plus 56 Electron checks.
Before any real target-repository PR, its existing local worktree remains
untouched and the external push receives separate operator authorization.

## Repository inspector track - selected-repository context

Status: **implemented and locally verified 2026-07-19.** The binding and noise
budget are defined in `REPOSITORY_INSPECTOR_PLAN.md`.

- Separate the selected catalog repository Overview from active-session
  Changes/Files instead of silently mixing their scope.
- Show bounded local branch, dirty/sync health and 12 recent commits without a
  fetch; load only the chosen full-SHA commit patch into the shared capped diff
  pane.
- Discover at most 20 open GitHub PRs through host-qualified, backend-local
  `gh`; render provider/offline/auth errors independently from local history.
- Revalidate repository identity, IPC payloads and external PR URLs in the
  trusted boundary; expose no repository or provider mutation.
- Use semantic roving tabs, stable panel mounting, narrow-width reflow and
  deterministic close/focus behavior so added information remains navigable.

Exit criteria: 16 focused repository-inspector checks cover real isolated Git,
dirty/history/diff caps, malformed provider data, unsafe URLs and WSL backend
propagation; security reaches 108 assertions; the 64-check Electron/Playwright
workflow proves selection, PR rendering, keyboard tabs, lazy diff, focus and
refresh. The complete Windows gate is 465 focused assertions plus build and
Electron workflow.

## Goal 7 - transport-neutral core and local host API

Status: **bounded GO; implementation not started.** Goal 6 permits the
disabled-by-default, loopback-only local foundation. Public remote exposure
remains no-go until this goal's authorization, idempotency, reconnect and audit
exit criteria pass.

The orthogonal Linux/WSL/macOS track no longer blocks this goal's local
foundation: Linux packaging and the hybrid Windows-to-WSL execution backend are
implemented and hosted-verified. Versioned package publication and macOS work
remain separate from the remote API security gates below.

- Extract a transport-neutral ADE application boundary from Electron IPC so
  desktop IPC and remote HTTP commands share authorization, validation and
  orchestration behavior.
- Add mobile-specific DTOs with repositories and agents as independent choices
  instead of exposing `AdeConfig`, raw IPC channels or the complete desktop
  orchestration snapshot.
- Add a versioned loopback-only HTTP API for health, sanitized catalog, runs,
  bounded task submission with explicit agent/repository ids, managed-run
  create/start/cancel and a resumable server-sent event stream.
- Require idempotency keys for mutations and monotonic cursors for reconnecting
  event clients. A retried mobile request must never launch duplicate work.
- Keep the listener disabled by default and reject non-loopback binds, unknown
  hosts/origins, invalid content types, oversized requests and unauthorized
  devices.

Exit criteria: local API integration tests can drive and reconnect to a full
managed run without changing the Electron workflow; duplicate, reordered,
unauthorized and malformed requests fail closed. No interactive PTY, arbitrary
IPC, filesystem/configuration mutation or absolute host path crosses the API.

## Goal 8 - personal mobile companion alpha

Status: planned after Goal 7.

- Build an installable responsive PWA for host readiness, sanitized project
  and agent selection, single-agent tasks, managed runs, budgets, live run
  state, results and cancellation.
- Select repository and agent independently; the ADE core resolves the same
  immutable execution binding used by the desktop Files/Changes panel.
- Use Tailscale Serve as the supported personal-alpha ingress. ADE remains
  bound to loopback; Tailscale Funnel, direct LAN binds and public router ports
  are unsupported.
- Pair each phone from the trusted desktop with a short-lived, one-use QR
  challenge and issue a separate revocable ADE device identity.
- Use exact Origin/Host checks, short-lived secure sessions, CSRF protection,
  rate/request limits and an app-shell-only service-worker cache.
- Persist an audit record for pairing, authentication and every remote mutation;
  provide desktop device inventory and immediate revocation from the first
  remotely writable release.
- Make desktop availability explicit: the host must be powered on, logged in,
  online and running ADE.

Exit criteria: from a phone on a mobile network, a paired device can create,
start, observe, reconnect to and cancel single- and multi-agent work. An
unpaired or revoked device receives no catalog, project or run data; a network
retry cannot duplicate a command. The mobile client exposes no terminal,
configuration, raw command or unrestricted file surface. Every mutation is
attributable, and device revocation ends commands and event streams immediately.

## Goal 9 - remote approvals, audit review and notifications

Status: planned after Goal 8.

- Add a mobile integration-approval view with the exact changed-file set,
  tests, risks, commit SHAs and an optional bounded diff.
- Require recent passkey/device reauthentication for approve/reject; a normal
  remembered session is insufficient for the privileged transition.
- Extend the audit record with approval evidence and step-up authentication
  context, and add a bounded audit viewer/export without credential contents.
- Add opt-in Web Push only for completion, failure and approval-required
  events; mobile offline state never queues an implicit future command.

Exit criteria: approval is single-use, durable, attributable and protected by
step-up authentication. Revocation takes effect immediately for commands and
event streams, audit survives restart, and notification failure cannot change
run state.

## Goal 10 - available and recoverable desktop host

Status: planned after Goal 9.

- Add tray/headless host mode in the logged-in user session and an opt-in start
  at Windows login. Do not run task CLIs as a pre-login Windows service.
- Publish host/version/readiness health and a clear last-seen/offline state.
- Reconnect the mobile event stream after host, app or network restart without
  losing or inventing run transitions.
- Optionally prevent sleep only while a run is active; ordinary idle behavior
  remains under user control.
- Exercise active run, pending approval and interrupted-task recovery through
  host and Windows restart workflows.

Exit criteria: after login the opted-in host becomes reachable without opening
the desktop window, remains low impact while idle, and recovers every persisted
run to an explicit safe state. A sleeping/offline host is reported accurately;
remote wake and unattended pre-login execution remain out of scope.

## Goal 11 - remote product hardening

Status: planned after personal-alpha validation.

- Move long run/event/audit histories from the atomic config JSON to indexed
  storage with migrations, retention, backup and corruption recovery.
- Ship signed releases and an authenticated auto-update path before asking
  non-technical users to keep an always-available host current.
- Decide from alpha evidence whether to support Cloudflare Tunnel plus Access
  or an ADE-operated outbound relay for users without a tailnet client.
- Threat-model accounts, multiple desktops/users, relay end-to-end encryption,
  abuse handling and recovery before implementing any hosted control plane.
- Consider native iOS/Android packages only if the PWA has demonstrated a
  concrete platform limitation worth two additional release pipelines.

Exit criteria: history and audit remain bounded and recoverable, updates are
authentic, the selected ingress has end-to-end authorization tests, and a
documented security review approves any public-beta exposure. Raw remote
terminal streaming, public port forwarding, remotely initiated or unattended
integration/push, Wake-on-LAN and unattended pre-login execution require
separate goals. The local, separately confirmed Draft-PR publisher above is not
exposed through these remote goals.

Detailed scope, trust boundaries and endpoint exclusions live in
`docs/REMOTE_CONTROL_PLAN.md`; repository-binding behavior and migration live
in `docs/REPOSITORY_SCOPES_PLAN.md`.
