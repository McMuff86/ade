# Repository Git comparison and explicit updates

Implemented 2026-09-06. Native Windows fixture evidence is recorded in
`HANDOFF.md`; the new workflow has not been executed on Linux, WSL or macOS.

## Operator workflow

Open **Git-Abgleich** in Graph or the repository inspector. The same panel is
available under **Git-Basis vor dem Run prüfen und aktualisieren** in New Run.

1. **Anzeige aktualisieren** reads local branches, cached origin branches and
   the main/agent worktree tips. This action does not contact the remote.
2. **Remote prüfen · Fetch** explicitly fetches origin. Its success time is
   scoped to the current app session. On restart the remote is unverified;
   a previous successful fetch time remains visible after a subsequent error.
3. Select the desired local or origin branch. Each worktree shows its own
   branch, tip, changed-file count and ahead/behind distance from that basis.
4. **Update prüfen** previews one eligible target, its branch, from/to SHA and
   commit count. A separate checkbox enables **Fast-forward ausführen**.

Uncommitted changes at the main checkout do not prevent a clean agent from
adopting its committed tip. To incorporate work published from another machine,
fetch, choose `origin/main` (or the appropriate branch), and update each eligible
target. Dirty or divergent targets need an explicit resolution outside this flow.
There is no automatic commit, stash, reset, rebase, merge commit, push or pruning.

New agent worktrees still start at the main repository's HEAD. Managed runs
still use the orchestrator's HEAD. The selected comparison basis is not a
persisted Run field. Update the main checkout before creating new worktrees,
or align existing orchestrator and participants to the chosen basis individually.
The separate archived reset option for repeat managed runs retains its existing
contract; selecting a comparison basis never enables that reset.

## Main-process boundary

`RepositorySyncService` owns four strictly validated, desktop-only invokes:

| Channel | Input | Effect |
|---|---|---|
| `repository:syncOverview` | repositoryId, optional full sourceRef | Local read |
| `repository:fetch` | repositoryId | Explicit origin remote-tracking fetch |
| `repository:syncPreview` | repositoryId, targetId, optional full sourceRef | Read and bounded in-memory preview |
| `repository:syncApply` | opaque previewId | Revalidated fast-forward of one target |

No caller chooses a path, URL, Git command or arbitrary revision expression.
Sources must be enumerated `refs/heads/*` or `refs/remotes/origin/*`. The main
process resolves catalog identities and rejects redirected workspace/metadata
paths, changed common-Git identity and mismatched binding backends. An unreadable
agent is shown with unknown values and a blocker while readable targets remain.

Fetch supplies its own remote-tracking-only refspec with `--refmap=`; configured
refspecs cannot move local branches. Tags, pruning, recursive submodules, hooks,
fsmonitor, interactive authentication, ext transport and automatic maintenance
are disabled. Commands are argv-only, capped at 512 KiB and 15 seconds, or
60 seconds for fetch. At most 100 eligible refs and 32 agent bindings are shown.

Preview tokens expire after five minutes, are single-use and have a 20-entry
bound. Apply re-resolves repository/binding identity, source SHA, target SHA,
branch, dirty state, pending Git operations, active PTYs and run leases. Only a
clean attached target without unique commits can proceed. Git receives the fixed
SHA with `merge --ff-only --no-autostash --no-overwrite-ignore`; ignored local
files cannot be overwritten. The exact resulting HEAD, branch and clean state
are checked afterward. Errors are bounded/redacted by the normal IPC wrapper;
main logs carry redacted failures and successful repository/target ids and SHAs.

`WorkspaceOperationGate` fences mutations against ADE's asynchronous scope
resolution/removal and PTY/login/run-start preparation. Refusal is immediate,
and a refused task launch reports failure through its lifecycle sink. Existing
sessions and leases block their own targets. The gate is process-local: an
external editor or Git process is not locked by ADE, so apply revalidates and
uses Git's own fast-forward/worktree guards. ADE provides no cross-process
transaction or rollback promise if another program races an update.

## Interaction and verification

The dialog takes focus, traps Tab, closes with Escape and restores its opener
(or a visible Git action/selected mode tab when the opener disappears).
Preview focuses the checkbox; completion/cancel/error focuses refresh. The
panel has explicit loading, error, unknown and blocked states and wraps at
compact desktop widths. A failed fetch retains the last local comparison.

`test:repository-sync` uses real disposable Git repositories for clean/dirty/
divergent/detached targets, sessions/leases, pending rebase, preview invalidation,
hostile fetch refspecs, ignored-file protection and disabled hooks.
`test:git-sync-electron` drives the production renderer through Graph, inspector,
New Run, keyboard confirmation, late edits, offline recovery and restart.
Both are included in `pnpm verify`. No personal repository is mutated by tests.

## Mobile administration — Goal 14 (2026-09-08)

The four desktop invokes retain their desktop-only classification. Goal 14
adds a separately scoped application boundary over the same sync service:
`POST /api/v1/admin/git` accepts bounded overview/preview queries;
`POST /api/v1/admin/commands` accepts explicit `git-fetch` and `git-apply`
operations. Signed device/session/CSRF checks apply, mutations additionally
require `repositories:write`, a durable idempotency receipt and audit.

The mobile **Verwalten → Git-Abgleich** view exposes redacted names, refs, SHAs,
counts, measured fetch freshness and blockers. Preview ownership is bound to
the device as well as the existing target/source/drift checks. Dirty/divergent,
detached, leased or busy targets cannot be updated. Native projects only;
remote publishing/approval and other deployment-model acceptance are separate.
Evidence and final-gate state: `REMOTE_WORKSPACE_RESULTS.md`.
