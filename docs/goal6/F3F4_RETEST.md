# F3/F4 live retest protocol — dependency-aware worker bases

Written 2026-07-21 with the dependency-base change set and closed live on
2026-07-22. The F3/F4 failure mode (dependent workers re-authoring upstream
files from the run base, producing add/add or union commits that kill the
linear cherry-pick integration) is now proven closed both by executable tests
and by completed **live managed** runs against the Goal 6 pilot repo.

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

## Live attempt 2026-07-21 (`51bdbaf7`) — partial confirmation, superseded

The first live F3 attempt on build `76de944` confirmed the mechanism in the
real app with real Codex workers: the planner chose a 3-task chain D1→D2→D3,
`workspace.prepared` fired for both dependent tasks with verbatim upstream
adoption (D2 base = D1 tip, D3 base = D2 tip), and dependent D2 completed
with its owned-delta commit validated from the prepared base. The run is
nevertheless **excluded** for the completion verdict: the operator driver's
45-minute lifetime closed the app while D3 was mid-task, so integration and
verification never ran (details in `RESULTS.md`). At that point the remaining
work was the completion half: integration + verification of a live dependent
topology. Runs `3a2773cc` and `9bcd8932` below now close it.

Driver lessons folded into the protocol below: launch the driver detached
from any tool/session lifetime, size `--timeout-min` to 90+ for Codex worker
phases, and treat a driver timeout as "reattach later", never as app-close
(driver work item).

## Live completion evidence — 2026-07-22

### F3v4 (`3a2773cc`) — pass

- Codex Sol chose a D1→D2→D3 chain. D1 produced `3b312546`; D2's
  `preparedBaseSha` and `workspace.prepared` event were exactly that SHA, and
  D2 produced owned tip `b34fc69c`. D3 was then prepared exactly at
  `b34fc69c` and produced owned tip `655be12b`.
- Every owned range contained one linear commit, no merge, and exactly its
  reported path set. The full worker chain contained three commits and five
  unique paths. The approved integration contained the same three-commit
  union and its final tree (`06962ae9`) was byte-identical to the worker tip.
- Integration review and read-only verification completed with 83/83 tests,
  TypeScript and the production build green. There were zero integration
  rollbacks; all four leases were released.
- Evidence refs: `goal6/f3v4-a1-worker-d1/-d2/-d3` and
  `goal6/f3v4-a1-integrated`.

### F4 (`c3c232c6`, `9bcd8932`) — one excluded attempt, then pass

- F4v2 (`c3c232c6`) is excluded, not scored as a product failure. D1 completed
  at `6cea96cd` and D2 was prepared at exactly that SHA, after which the Codex
  stream repeatedly failed DNS resolution for `chatgpt.com` (`os error
  11001`). D2 left no result or partial diff; no approval or integration ran,
  and every lease was released. D1 is retained as
  `goal6/f4v2-a1-worker-d1`.
- After DNS and TCP/443 recovered, F4v3 (`9bcd8932`) again chose a dependent
  chain. D1 (`5c0d4a01`) owned `random.ts` plus `random.test.ts`; D2 was
  prepared exactly there and produced `e4679587`, owning only
  `ArtilleryScene.ts`; D3 was prepared exactly at `e4679587` and performed a
  read-only RNG-classification audit with no commit.
- The approved integration applied exactly two commits and the three-path
  union. Integrated HEAD `b8a1229d` had the same tree as worker tip
  `e4679587`. Integration review and independent verification completed with
  78/78 tests, TypeScript and the production build green, zero rollbacks and
  all leases released.
- Evidence refs: `goal6/f4v3-a1-worker-d1/-d2/-d3` (D3 intentionally points
  to D2's tip because it was read-only) and `goal6/f4v3-a1-integrated`.

Both arms therefore satisfy the live completion criteria. After evidence refs
were created, all four disposable pilot worktrees were restored cleanly to
baseline `81820b90e`; the pilot original repo remained untouched.

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
the existing RESULTS entries. The completed runs above followed this cleanup
sequence; `RESULTS.md`, `STATUS.md`, `HANDOFF.md` and `ROADMAP.md` record the
closure.
