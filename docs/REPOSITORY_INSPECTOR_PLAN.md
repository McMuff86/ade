# Repository Inspector plan

Status: implemented and locally verified 2026-07-19; binding contract for the
right-sidebar repository overview. Extended the same day by the progressive
disclosure slice: CI rollups, run-to-PR traceability, on-demand checks, the
`Scope & session` disclosure and visual regression baselines (see "Progressive
disclosure slice" below).

## Problem and scope

The current header combines two different concepts:

1. the catalog repository selected for a future session; and
2. the immutable workspace/worktree used by the active session.

`Changes` and `Files` correctly describe the active workspace, but a user who
changes the repository selector reasonably expects the information below it to
describe the selected repository. The UI must make that boundary explicit
before adding more data.

This slice adds a read-only `Overview` tab for the selected catalog repository.
The existing `Changes` and `Files` tabs remain scoped to the active session
workspace. Selecting a repository deliberately opens `Overview`; merely
hydrating or switching an existing session does not steal the user's current
tab.

## Information hierarchy

The default overview is deliberately bounded:

- one compact health row: branch, clean/dirty state, upstream divergence and
  execution backend;
- open GitHub Pull Requests, at most 20, with number, title, author, draft or
  review state, base/head branches and update time;
- the most recent 12 local commits with short SHA, subject, author and time;
- one commit patch only after the user opens a commit.

Local repository information renders independently from GitHub. A missing
`gh`, missing login, unsupported remote, offline host or WSL-only credential
never hides local status/history and never turns the whole view into an error.
One refresh action re-runs both bounded reads. Automatic workspace polling
refreshes local data only; it never repeats the provider/network read. No
`git fetch`, checkout, remote write, branch mutation or PR mutation belongs to
this inspector.

## Trusted contract

The renderer sends repository IDs and exact commit object IDs, never paths or
commands:

- `repository:overview({ repositoryId })` resolves the verified catalog record
  in Electron main and returns local status, remote identity and bounded
  history;
- `repository:pullRequests({ repositoryId })` performs the optional provider
  read through the repository's native/WSL execution backend;
- `repository:commitDiff({ repositoryId, commitSha })` verifies a full lowercase
  Git object ID as a commit in that repository and returns the existing capped
  commit view.

All requests use strict exact-key IPC validation. Git and `gh` run through the
argv-only backend boundary with timeouts and output caps. GitHub is accepted
only from one unambiguous `origin` URL resolving to `github.com/owner/repo`.
Provider calls use a host-qualified `--repo github.com/owner/repo`, and every PR
URL is revalidated against that same owner/repository and PR number before it
reaches the renderer. Provider errors are credential-redacted and reduced to an
actionable bounded state.

## Interaction and accessibility

- `Overview`, `Changes` and `Files` are real tabs with `aria-selected`, roving
  tab focus and Arrow/Home/End keyboard navigation.
- Commit rows are buttons with descriptive accessible names. Opening one uses
  the existing resizable inline diff pane; Escape or the close button returns
  focus to the commit row.
- Pull Request URLs open only after renderer-side `https://github.com/.../pull/N`
  validation and use safe external-link attributes.
- Loading, empty, unsupported, unauthenticated/offline and retry states have
  distinct copy; no spinner replaces already available local information.
- At narrow sidebar widths, metadata wraps or collapses before titles truncate.
  Counts and semantic labels do not rely on color alone. Reduced-motion users
  receive no decorative transition.

## Noise budget and follow-on design direction

ADE should grow through progressive disclosure rather than permanent chrome:

- keep the repository identity and health visible, move uncommon scope
  management actions behind one `Scope & session` disclosure;
- use `Overview` for orientation, `Changes` for current work and `Files` for
  exploration instead of mixing all three concerns;
- show badges only for states that require a decision (dirty, diverged, failed
  CI, review requested), not for every neutral fact;
- preserve one shared detail surface for diffs/previews rather than opening
  nested cards or additional sidebars;
- later add CI/check summaries and run-to-PR traceability to the PR rows, but
  keep logs and individual check details on demand;
- make the empty center useful with a focused start surface (recent repos,
  resumable work, one primary action) while keeping terminal space dominant as
  soon as a session exists.

## Progressive disclosure slice (2026-07-19)

This slice implements the follow-on design direction above:

- **Scope & session disclosure.** The scope header keeps identity, health and
  the two frequent controls (repository selector, `Open new session`) visible.
  `Add repo`, `Pfad…` (manual import incl. backend choice), `Set agent
  default` and `Remove worktree` moved behind one `⋯` toggle with
  `aria-expanded`/`aria-controls`. The disclosure survives the 5-second
  workspace poll and resets only on an agent/session context switch.
- **CI rollup per PR row.** `repository:pullRequests` additionally requests
  `statusCheckRollup` and reduces it in Electron main to a bounded summary
  `{ state, total, failed, pending }` (`none`/`pending`/`passed`/`failed`).
  The reduction mirrors the publication gate's conservative reading: unknown
  or malformed entries count as pending, any failure-shaped conclusion marks
  the rollup failed. The renderer never receives raw provider check payloads
  from the list read.
- **Run → Publication → PR traceability.** Open PRs are matched in main
  against the durable `runPublications` audit records — same repository and
  provider identity, by recorded PR number first, by the ADE-owned head
  branch for not-yet-numbered attempts. Matching rows carry an `ADE run` tag
  whose tooltip names the run and publication status.
- **Individual checks stay on demand.** The CI chip on a PR row is a button
  (`aria-expanded`) that opens the shared inline detail pane and triggers
  `repository:pullRequestChecks({ repositoryId, pullRequestNumber })`. Main
  re-runs `gh pr view <n> --repo github.com/owner/repo`, revalidates PR
  number and URL against the origin identity, and returns at most 100 named
  check states without any provider URLs; logs remain on GitHub behind the
  existing validated PR link. Escape returns focus to the chip.
- **Decision-relevant emphasis only.** Dirty working tree, upstream
  divergence, failing CI, review-required and changes-requested keep color;
  clean, up-to-date, draft, approved and passing CI render neutral/muted.
- **Visual regression.** `scripts/test-visual-regression.ts` captures the
  sidebar in dark and light themes at 300/380/540 px (plus the open checks
  pane) with a frozen renderer clock, fixed Git dates, forced 1.0 device
  scale and `en-US` locale, then compares against per-platform pixelmatch
  baselines in `scripts/fixtures/visual-baselines/`. Baselines are
  authoritative on the machine that captured them; hosted CI captures and
  runs the structural checks (deterministic width, no horizontal overflow)
  but skips the pixel diff. `pnpm test:visual:update` rewrites baselines.

## Verification gates

- parser/service tests cover native Git history, dirty status, full-SHA commit
  validation, diff caps, GitHub/non-GitHub remotes, malformed provider JSON,
  unsafe URLs, missing `gh`, redacted failures, backend propagation, CI rollup
  reduction, publication matching and the bounded checks read;
- IPC security tests cover missing/extra fields, unknown repository IDs,
  abbreviated or shell-shaped object IDs and non-integer/oversized PR numbers;
- Electron/Playwright covers repository selection, overview loading, open PR
  rendering, the CI rollup chip, on-demand checks with focus return, the
  Scope & session disclosure, published-run traceability, commit-diff
  open/close/focus, refresh, empty/error states and tab keyboard behavior;
- visual regression compares dark/light × narrow/medium/wide sidebar
  baselines plus the open checks pane on the capturing platform;
- repository-wide completion passes `pnpm verify`: 483 focused assertions,
  production build, 72 Electron/Playwright checks and 21 visual checks on
  Windows (totals include the same-day per-run harness-choice and
  run-dialog path-import slices).
