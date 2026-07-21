# F3/F4 live retest protocol — dependency-aware worker bases

Written 2026-07-21 with the dependency-base change set. The F3/F4 failure mode
(dependent workers re-authoring upstream files from the run base, producing
add/add or union commits that kill the linear cherry-pick integration) is
closed at the code level and proven by executable tests; this protocol defines
the still-pending **live managed** re-proof against the Goal 6 pilot repo.

## What changed since the failed runs

- Runs `4ced0119` (F3) and `982d8a8e` (F4) failed because every worker
  worktree started from the run base and `dependsOn` forwarded information
  only. Now ADE prepares a dependent repo-backed worker's worktree with its
  dependencies' validated commits before launch (first parent verbatim,
  further parents replayed as owned deltas in assignment order), persists the
  prepared base on the task (`preparedBaseSha`, `workspace.prepared` event),
  and validates/integrates only owned deltas.
- Planner and dependent-worker prompts state the new semantics (prompt
  versions plan=2, work=2). Conflicting parent deltas fail the run closed
  before the dependent launches.

## Executable evidence already green (2026-07-21)

`pnpm run test:orchestration-beta` (117 checks) includes:

- WorkspaceService level: multi-parent preparation, owned-delta integration
  to the exact union, divergent re-author fail-closed with rollback,
  conflicting-parents fail-closed with run-base restore, diamond skip,
  dirty/wrong-base refusals.
- Full RunCoordinator on real Git: the exact F3/F4 topology (2 parallel
  producers → 1 dependent consumer) completes planning → work → prepared
  base → approval → 3-commit integration → verification, and the
  conflicting-producers negative control fails closed before the consumer
  launches with worktree restore and lease release.

## Live fixture protocol

Preconditions (unchanged from `VALIDATION_PLAN.md`):

1. Codex-only pilot roster (`gpt-5.6-sol`, bypass, orchestrator `xhigh`,
   workers `high`); the operator driver fails closed otherwise.
2. Pilot repo worktrees clean and on one common base; record the base SHA.
3. Paste only the fenced fixture goal text (no score notes).

F3-class rerun (dependent vertical slice):

1. Create a managed run with the F3 `playtest-export` fenced goal
   (`VALIDATION_PLAN.md`), 3 workers + orchestrator, approvals ≥ 1.
2. If the planner chooses a dependent topology (expected: 2∥1), do not
   intervene. Approve at the gate after the usual scope review.
3. Success criteria (all machine-checkable):
   - run reaches `completed` including integration review and read-only
     verification;
   - zero integration conflicts/rollbacks
     (no `ade: integration cherry-pick failed` in the journal);
   - each dependent work task carries `preparedBaseSha` plus a
     `workspace.prepared` event, and its worktree range
     `preparedBaseSha..commitSha` contains only its owned files;
   - the integrated range equals the union of the owned deltas
     (`git rev-list --count <base>..HEAD` equals the validated commit count
     in the approval reason);
   - `pnpm goal6:report --run <id> --md` row appended to `RESULTS.md`.
4. Failure handling: a prep-conflict fail-closed is a valid safety result but
   NOT a pass for this retest — record it and inspect whether the plan put
   divergent edits on parallel producers.

F4-class rerun (atomic coupled change):

1. Create a managed run with the F4 `rng-stream-split` fenced goal.
2. Guaranteed behavior to verify (either counts as pass):
   - the planner keeps the coupled change single-worker and the run completes;
   - or the planner decomposes with `dependsOn` and the dependent worker
     completes on its prepared base without integration conflict.
   A fail-closed prep conflict is a documented safe outcome, not a pass.
3. Record the same run id / SHA / range evidence as F3.

Both arms: keep evidence branches per worker worktree
(`goal6/<fixture>-worker-*`) and the integrated branch before cleanup, as in
the existing RESULTS entries. Update `RESULTS.md` (run log + per-fixture
verdict) and drop the "live fixture still pending" clause from `STATUS.md`
once both arms are green.
