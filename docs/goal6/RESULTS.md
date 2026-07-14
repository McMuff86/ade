# Goal 6 validation results

Fixture definitions and protocol: `docs/goal6/VALIDATION_PLAN.md`.
Metrics rows come from `pnpm goal6:report --run <id> --md`; do not hand-edit
numbers the script can produce.

## Environment record

| Item | Value |
| --- | --- |
| Pilot baseline SHA | `81820b90e00cfb3a686f203e04a072919081e406` |
| Pilot baseline suites | vitest 77/77 · server 5/5 · tsc clean (2026-07-14) |
| ADE commit under test | _fill per session_ |
| Runtime / model | _fill per run (e.g. claude / <model id>)_ |

## Run log

One row per run (managed and baseline arms are separate rows). Append the
`goal6:report --md` row, then fill the human columns.

| Run | Fixture | Arm | Date | Status | Phases reached | Elapsed | Active (excl. approval wait) | Tasks (ok/fail) | Tokens in/out | Cost USD | Integrations (commits) | Conflicts/rollbacks | Interventions | Safety gate | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| _—_ | | | | | | | | | | | | | | | |

## Per-fixture verdicts

Fill after both arms (or the safety protocol) are complete. Verdict values:
`better` / `neutral` / `worse` (managed vs baseline), plus scorecard notes.

### F1 · settings-reduced-shake
- Managed: _pending_
- Baseline: _pending_
- Verdict: _pending_

### F2 · weapon-presentation-tests
- Managed: _pending_
- Baseline: _pending_
- Verdict: _pending_

### F3 · playtest-export
- Managed: _pending_
- Baseline: _pending_
- Verdict: _pending_

### F4 · rng-stream-split
- Managed: _pending_
- Baseline: _pending_
- Verdict: _pending_

### F5 · arena-presets
- Managed: _pending_
- Baseline: _pending_
- Verdict: _pending_

### F6 · balance-overlap-hazard (safety)
- Observed planner choice: _pending_
- Integration behavior on overlap: _pending_
- Pass/fail: _pending_

### F7 · approval-durability (safety)
- Restart during pending approval: _pending_
- Approve path: _pending_ · Reject path: _pending_
- Pass/fail: _pending_

### F8 · honest-failure (evidence)
- Reported outcome vs actual state: _pending_
- Pass/fail: _pending_

## Reliability and safety findings

Every failure or near-miss gets an entry: what happened, evidence (run id,
event seq), severity, resolution or follow-up work item.

- **2026-07-14 · usability · run `1d05372b` (F1 managed, attempt 1, aborted).**
  The whole VALIDATION_PLAN.md document was pasted into the run goal instead
  of the F1 fixture block, and the small goal textarea made this invisible;
  the run reached planning before the operator noticed. Not a safety issue —
  scope, roster and leases (base `81820b9`) were all correct. Follow-up work
  item: the new-run dialog should show the full goal (expandable textarea or
  preview) before "Run erstellen". Run cancelled and re-created; attempt 1
  excluded from measurements as operator error.
- **2026-07-14 · usability · run `25cc3dd4` (F1 managed, attempt 2).** Opening
  an interactive session for a participant while its worktree was leased by
  the active run correctly failed closed, but surfaced as a raw error bar
  ("workspace binding is owned by active run <id>"). Safety behavior is
  right; follow-up work item: disable "Session öffnen"/"Open new session"
  for leased bindings and explain the lease instead of erroring after the
  click. Attempt 2 also carried fixture-card metadata (heading, expected
  topology, score notes) pasted into the goal — cancelled and excluded;
  goal-text discipline added to the plan's method notes.

## Go/no-go decision (Goal 7 gate)

- Date: _pending_
- Decision: _pending (go / no-go)_
- Evidence summary: _pending_
- Open blockers: _pending_
