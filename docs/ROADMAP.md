# ADE delivery roadmap

Status date: 2026-07-10. Goals are completed in order and published as separate
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

Status: next.

- Keep categories and named agents permanent.
- Add persisted `Run`, `Task`, `Participant`, `Event`, and `Artifact` entities.
- Make lead/worker roles run-scoped instead of permanent agent fields.
- Make Graph render normalized run events rather than timer/view state.
- Migrate existing Graph-created categories without deleting user data.

Exit criteria: a run survives reload, status is reconstructible from its event
journal, and spawning a run does not create permanent categories or identities.

## Goal 3 - terminal beta

Status: planned.

- CI and Electron workflow tests, CLI/auth diagnostics, keyboard navigation,
  notifications, CSP/IPC validation, and Windows packaging.
- Finish session recovery semantics and failure UI.

## Goal 4 - orchestration beta

Status: planned.

- Runtime adapter interface, worker-specific tasks, structured results,
  worktree ownership, verification and integration.
- Prefer native runtime coordination where it is reliable; keep a file-based
  mailbox as a generic fallback.
- Add concurrency, token/cost and approval budgets per run.

## Goal 5 - product validation

Status: planned.

- Compare representative tasks against a single-agent baseline.
- Measure completion, elapsed time, cost, conflicts and human interventions.
- Validate the workflow with external users before broadening the feature set.
