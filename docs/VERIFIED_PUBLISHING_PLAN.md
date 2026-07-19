# ADE verified publishing

Status: implemented and locally verified, 2026-07-19.

This track adds an explicit external-publication boundary after ADE's managed
integration and verification pipeline. It is separate from remote-control
Goals 7-11: a local desktop operator may publish a verified candidate without
exposing ADE over a network.

## Product outcome

ADE may publish one completed managed run as a new branch and open a GitHub
Draft Pull Request. ADE does not update, force-push or merge the repository's
default branch. The operator remains the final authority and GitHub branch
protection plus repository CI remain authoritative after publication.

The intended lifecycle is:

`managed run -> integration approval -> integration -> verification ->`
`verified HEAD attestation -> publication preview -> explicit confirmation ->`
`new ade/** remote branch -> Draft PR -> repository CI -> human merge`

## Trust boundaries and invariants

- Managed runtimes receive no publication IPC capability and ADE does not
  inject a GitHub token, SSH key or publisher command into their task contract.
  Publication runs only in the trusted Electron main process after a renderer-
  initiated confirmation. A deliberately selected bypass worker is still a
  fully trusted, unrestricted OS process and may independently reach ambient
  credentials or invoke Git; this gate does not pretend to sandbox a malicious
  bypass agent.
- A run is eligible only when it is managed, completed, repository-backed and
  has an immutable verification attestation written atomically with run
  completion: final HEAD, verification task id and completion time.
- A repository verification task snapshots its expected HEAD before launch and
  must finish clean at that identical HEAD. A clean but newly committed HEAD is
  a verification failure, not a publishable attestation.
- Legacy completed runs without that attestation fail closed and must be
  verified again. ADE never infers a verified HEAD from a mutable worktree.
- The released orchestrator worktree must still be clean, on the attested HEAD
  and in the same repository/backend recorded by its run lease.
- The selected remote is `origin` in the first release. It must have exactly
  one stored URL, and that URL must be a credential-free-identifiable GitHub
  repository URL; credentials are never returned to the renderer or persisted
  in publication records.
- An explicit `origin.pushurl` must identify that same provider repository and
  there may be at most one. Git URL rewrites remain trusted local operator
  configuration; bypass agents are not isolated from that configuration.
- The remote default-branch HEAD must still equal the run's leased base SHA.
  A moved base invalidates the old verification evidence and requires a fresh
  integration/verification run.
- ADE generates the publication ref itself under `ade/run-*`. It creates that
  ref atomically and never overwrites a different remote ref. A retry may reuse
  the ref only when it already points at the exact attested HEAD.
- The Git push skips repository hooks. This prevents a managed repository from
  injecting code into ADE's trusted publisher, but Git-LFS/hook-dependent
  repositories need a later explicit provider contract or a manual publish.
- Pull requests are always created as drafts. ADE exposes no merge, auto-merge,
  direct-main-push, remote-branch-delete or force-update operation.
- Publication request, completion and failure are durable audit events.
  Interrupted attempts recover as failed/retryable rather than successful.
- Every error crossing into the renderer is bounded and credential-redacted.

## GitHub provider

The first provider uses Git for the branch push and the authenticated `gh` CLI
for GitHub repository/PR operations. Both execute inside the repository's
recorded execution backend. A WSL repository therefore requires Git and `gh`
to be installed and authenticated inside that same distribution; ADE never
falls back to Windows Git or Windows credentials.

Every `gh` repository argument is host-qualified as `github.com/owner/repo`;
an ambient `GH_HOST` cannot redirect the provider mutation to another host.

The preview performs read-only preflight checks for:

- a clean, attested source worktree and a non-empty linear candidate range;
- GitHub `origin`, remote default branch and unchanged base SHA;
- absence of a conflicting remote publication branch;
- installed/authenticated `gh` and access to the target repository;
- an existing idempotent Draft PR for the same branch/head, when applicable.

Publishing re-runs the preview immediately before mutation, compares the
operator-confirmed head SHA and branch, creates the new remote ref, verifies
its exact SHA, rechecks the remote base, creates or recovers the Draft PR,
verifies the PR's draft, repository, base, head and head-SHA fields, and checks
the remote base again before recording success. A failure after the branch push leaves an
audited retryable record; ADE does not hide or destructively remove the branch.

## PR evidence and CI

The generated PR body contains the run id, repository, base/head SHAs, commit
and changed-file counts, the final verifier's recorded commands and risks, and
an explicit statement that ADE did not merge `main`. It contains no absolute
host paths, task prompts, secrets or raw activity logs.

GitHub CI is not replaced by ADE verification. The UI reports the provider's
status-check rollup as none, pending, passed or failed. Required checks and
branch protection are configured in each target repository; the operator may
merge only after those controls and product review are satisfactory.

## Validation

- Focused unit/security tests cover URL parsing, generated refs, eligibility,
  stale-base rejection, dirty/head-drift rejection, secret redaction, remote
  branch collision, idempotent retries and Draft-only PR validation.
- A real local Git integration test pushes the attested SHA to an isolated bare
  remote while a deterministic fake GitHub CLI exercises PR creation without
  network access or personal credentials.
- Electron/Playwright drives the completed-run publication modal, explicit
  confirmation, persisted result and external PR link against the same
  isolated fixture.
- `pnpm verify` remains the repository-wide release gate.

## Deliberate first-release limits

- GitHub via `origin` only; GitLab/Bitbucket/provider abstraction can follow
  after this contract has production evidence.
- No automatic rebase, conflict resolution, branch update or merge. A changed
  base requires another verified run.
- No unattended publishing and no publication initiated by an agent prompt.
- No claim that green automated checks approve gameplay balance, visual taste
  or UX. Those remain explicit human review concerns.
