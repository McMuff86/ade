# Repository Inspector plan

Status: implemented and locally verified 2026-07-19; binding contract for the
right-sidebar repository overview.

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

## Verification gates

- parser/service tests cover native Git history, dirty status, full-SHA commit
  validation, diff caps, GitHub/non-GitHub remotes, malformed provider JSON,
  unsafe URLs, missing `gh`, redacted failures and backend propagation;
- IPC security tests cover missing/extra fields, unknown repository IDs and
  abbreviated or shell-shaped object IDs;
- Electron/Playwright covers repository selection, overview loading, open PR
  rendering, commit-diff open/close/focus, refresh, empty/error states and tab
  keyboard behavior;
- repository-wide completion passes `pnpm verify`: 465 focused assertions,
  production build and 64 Electron/Playwright checks on Windows.
