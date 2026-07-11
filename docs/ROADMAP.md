# ADE delivery roadmap

Status date: 2026-07-11. Goals are completed in order and published as separate
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

Verification: `pnpm run typecheck`, `pnpm test` (24 memory + 12 dispatch +
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

## Goal 5 - product validation

Status: planned.

- Compare representative tasks against a single-agent baseline.
- Measure completion, elapsed time, cost, conflicts and human interventions.
- Validate the workflow with external users before broadening the feature set.
