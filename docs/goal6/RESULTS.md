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
| `0163e3a0` Run 1F1 | F1 | managed | 2026-07-14 | failed (failed) | planning→plan→failed | 1m 49s | 1m 49s | 0/1 | 0/0 | 0.00 | 0 (0) | 1 | 0 | pass (fail-closed) | Planning prompt truncated at first `"` by PS 5.1 argument quoting; see finding below. Reliability failure, not operator error — counts as a measurement. |
| `97172c83` F1 settings-reduced-shake (managed) | F1 | managed | 2026-07-14 | failed (failed) | planning→plan→working→work→failed | 6m 30s | 6m 30s | 1/1 | 0/0 | 0.00 (+1 unreported) | 0 (0) | 1 | 0 | pass (fail-closed) | Stdin transport fix verified: planning completed with a correct one-worker plan. Worker failed: `permissionMode: default` denies every Edit/Write/Bash in non-interactive print mode (10 denials), including the RESULT.json blocked-report itself. See finding below. |
| `2a350876` Run 3 | F1 | managed | 2026-07-14 | failed (failed) | planning→plan→working→work→approval→integrating→integrate→verifying→verify→failed | 1h 6m 17s | 11m 16s | 3/1 | unknown | 0.00 (+4 unreported) | 1 (1) | 2 | 1 | pass (fail-closed, but false positive) | First full pipeline pass: correct one-worker plan, implementation independently verified (81/81 tests, tsc clean, exact 3-file scope), approval, transactional integration of 1 ADE commit, integration review — then the read-only verifier honestly echoed the inspected HEAD as `commitSha` and the proxy guard failed the whole run. Guard fixed; see finding below. |

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
- **2026-07-14 · reliability · run `6e632da0` (F1 managed, attempt 3, draft).**
  `run:start` failed closed with "Main Chef's worktree is not clean": opening
  an interactive session for a participant agent writes ADE's memory scaffold
  (`CLAUDE.md`) into the repo worktree and leaves it untracked, so the next
  managed run on the same binding cannot acquire its clean-worktree lease.
  ADE's own instruction file blocks ADE's own lease. Fail-closed is correct;
  the friction is real. Follow-up work item (pre-P1 candidate): write
  interactive-session instruction files outside the worktree like the managed
  memory snapshot, or remove them on session close, or exempt ADE-authored
  scaffold files from the lease cleanliness check. Workaround used:
  `git clean -f -- CLAUDE.md` in the affected worktree.
- **2026-07-14 · reliability (HIGH) · run `0163e3a0` (F1 managed, attempt 4).**
  The managed planning task failed with "did not produce result file". Root
  cause proven from the Claude Code session transcript: ADE launches task
  CLIs through `powershell.exe` (5.1), whose native-argument quoting does not
  escape embedded double quotes — `claude -p -- "$env:ADE_TASK_PROMPT"`
  split the prompt at the first `"` inside the goal text. Claude received
  only "…Run goal: Add a reduced", never saw the result contract, answered
  with a plausible plan as plain text (it even flagged the goal as truncated)
  and exited 0. ADE then failed the run fail-closed — correct behavior, and
  the worktrees stayed clean. Every prompt containing a double quote was
  affected; the E2E suite missed it because its prompts carry no quotes.
  **Fix shipped:** claude managed/one-shot tasks now pipe the prompt over
  stdin (`$env:ADE_TASK_PROMPT | claude … -p`, transport `stdin`) on both
  platforms; stdin transport verified to deliver quote-laden multiline
  prompts verbatim under PS 5.1. Follow-up: codex/opencode/gemini/ollama
  still use argument transport and share the exposure for quoted prompts.
- **2026-07-14 · reliability (HIGH) · run `97172c83` (F1 managed, attempt 5).**
  Transport fix confirmed end-to-end: planning succeeded with a precise
  single-worker plan. The work task then failed with "did not produce result
  file": the worker agent runs `permissionMode: default`, and Claude Code in
  non-interactive print mode auto-denies every Edit/Write/Bash request — the
  transcript shows 10 denials. The worker behaved honestly (complete
  read-only analysis, exact six shake call sites, full implementation spec
  as text) but could not apply anything — and could not even file the
  contract's `outcome=blocked` report, because writing RESULT.json under
  AppData is itself permission-denied. Two follow-up work items:
  (a) run creation should warn or refuse when a managed claude participant's
  permission mode cannot complete non-interactive work (bypass required
  today; the leased disposable worktree is the intended sandbox);
  (b) the blocked-report channel must remain writable for restricted agents
  (e.g. `--add-dir` the task directory in the claude launch profile), so
  fail-closed distinguishes "blocked" from "silent".
  Remedy for the rerun: set the worker to `bypass` like the orchestrator.
- **2026-07-14 · reliability (HIGH, fixed) · run `2a350876` (F1 managed,
  attempt 6).** The run survived plan → work → approval → integration → review
  and then failed in read-only verification with "managed runtimes must not
  create commits". The verifier had NOT committed (transcript shows only
  `git status`/`rev-parse`); it honestly reported the HEAD it verified in the
  result's `commitSha` field, and `finalizeRepoResult` treated any non-null
  reported sha as a runtime-authored commit. The schema note "null when …
  commitSha is unavailable" invites exactly this reading. **Fix shipped:** the
  reported-sha guard now applies only to work/integrate (where ADE authors
  the commit); read-only phases rely on the real invariant — the pre/post
  HEAD comparison — and a reported sha is normalized to null. Follow-up:
  phase-discriminated result schemas (P1) remove the ambiguity at the source.
- **2026-07-14 · reliability (HIGH, guarded — root cause open).** During the
  same integration/verification window, one config save transiently wrote
  `config.json` WITHOUT `repositories`, `workspaceBindings`, `agentTemplates`
  and `commandLog` (observed by an external reader at ~18:08; the next save
  restored them). Mechanism: a save passing an explicitly-undefined property
  shadows the live value and `JSON.stringify` drops the key from disk. Had
  the app restarted on the stripped file, migration would have re-synthesized
  repositories/bindings with NEW ids, dangling every run/task/lease scope
  reference. **Guard shipped:** `ConfigStore.save` now ignores
  explicitly-undefined properties, making key deletion impossible. Follow-up:
  find the save site that passed undefined during integration/verification.
- **2026-07-14 · usability (fixed) · approval banner.** The integration
  approval reason was clipped to one ellipsized line and could not be read
  before deciding. The banner is now click-to-expand (▸/▾, keyboard
  accessible) and shows the full reason with wrapping and a scroll cap.

## Go/no-go decision (Goal 7 gate)

- Date: _pending_
- Decision: _pending (go / no-go)_
- Evidence summary: _pending_
- Open blockers: _pending_
