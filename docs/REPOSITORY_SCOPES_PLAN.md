# ADE repository scopes and reusable agents plan

Status: implemented and locally verified, 2026-07-12. Goal 5 now separates
agent identity from repository/worktree ownership without deleting existing
categories, agents, worktrees or user files.

## User intent

An agent identity and a Git repository are independent concepts:

- a specialized agent may have one default repository;
- a general agent may have no default and be assigned to a repository when a
  session, task or run starts;
- the same general agent may work in multiple repositories through separate
  workspace bindings;
- a reusable template may spawn a new independent agent and optionally attach
  that new identity to a repository; and
- the Files/Changes panel must always show which repository and worktree the
  selected work is actually using.

Linking a repository gives the work a concrete filesystem/Git scope. It does
not copy the repository into the agent identity, silently change a running
terminal's current directory or make one mutable worktree serve two concurrent
owners.

## Model decision

Category remains an organizational grouping. It may offer a default repository
as an onboarding convenience, but it no longer owns an agent's workspace.

The target model adds these concepts:

| Concept | Responsibility |
|---|---|
| `Repository` | Catalog entry for a local repo root, display name and stable Git identity |
| `Agent` | Persistent identity, runtime, permissions, skills and global memory; optional default repository |
| `WorkspaceBinding` | One agent + one repository + one ADE-managed worktree/branch |
| `ExecutionScope` | Immutable binding selected by a session, task or run |
| `AgentTemplate` | Spawn defaults and memory seed; never owns a PTY, worktree or mutable history |

Illustrative target fields:

```ts
interface Repository {
  id: string;
  name: string;
  rootPath: string;
  commonGitDir: string;
  createdAt: number;
}

interface Agent {
  // Existing identity/runtime fields remain.
  defaultRepositoryId?: string;
  homeWorkspaceDir: string;
  memoryDir: string;
}

interface WorkspaceBinding {
  id: string;
  agentId: string;
  repositoryId: string;
  workspaceDir: string;
  branch: string;
  createdAt: number;
  lastUsedAt: number;
}

interface ExecutionScope {
  repositoryId?: string;
  workspaceBindingId?: string;
  source: 'agent-default' | 'explicit' | 'plain-home';
}
```

Actual shared types may normalize these fields differently, but the ownership
and immutability rules are binding.

## Scope resolution

Every new execution resolves its repository explicitly:

1. A task/run/session request may name a repository.
2. Otherwise ADE uses the agent's optional default repository.
3. Otherwise ADE uses the agent's plain home workspace and reports
   `No repository` in the UI.

For a repository scope, ADE reuses or creates that agent/repository pair's
`WorkspaceBinding`. Different repositories always receive different worktrees.
The run snapshots its repository choice; each participant lease, session, task
and task artifact snapshots its resolved binding/workspace so later default
changes cannot redirect existing work.

A live PTY's scope is immutable. Choosing a different repository while a
terminal is selected offers **Open new session in this repository**; it never
changes the current process's working directory behind its back. An active
managed run owns and locks all of its participant bindings until release.

Repo-backed managed runs select one repository at run level. Every participant
gets its own binding/worktree for that repository, preserving the current
same-common-Git-dir integration invariant. Cross-repository integration inside
one run remains unsupported; it requires a future explicit multi-repository
transaction design.

## Files/Changes panel

The right panel gains a repository-scope header above the existing Files and
Changes tabs. For the selected session or run participant it shows:

- repository name, with `No repository` for a plain workspace;
- binding source: explicit, agent default or plain home;
- current worktree branch and a shortened path;
- clean/dirty and active-lease state; and
- actions appropriate to the current state.

Implemented actions:

- **Choose repository...** selects an existing catalog entry or imports a local
  Git repository.
- **Open new session here** resolves a binding and starts a new session without
  disturbing the current one.
- **Set as agent default** affects only future sessions/tasks/runs that omit an
  explicit repository.
- **Clear agent default** makes the identity portable again; it does not delete
  bindings, branches, worktrees or files.

Destructive repository/worktree cleanup remains intentionally unavailable; a
future management workflow must make stale references and deletion effects
explicit before it is added.

While no agent/session is selected, the panel keeps its current empty state.
While an active managed run is selected, repository choice is read-only and
explains that the run owns the binding. Files and Changes always query the
selected execution's binding, never a mutable global `selectedAgent` path.

## Reusable agents and templates

A portable agent (`defaultRepositoryId` absent) keeps the same identity,
runtime, skills and explicitly global memory across repository bindings. ADE
must label that memory as global so users understand that it can influence work
in more than one repository.

Repository-specific instructions and context come from the selected worktree
and an optional binding-local memory overlay. ADE must not silently promote
repository content into the agent's global memory. The exact overlay format may
land after the binding model, but the storage boundary must be reserved in Goal
5 so later isolation does not require another worktree migration.

An `AgentTemplate` is immutable spawn configuration, not a live agent alias. It
may include name/role defaults, photo, runtime, permission mode, skills and a
memory seed. Spawning creates a new agent id, independent memory directory and
optional default repository; later edits do not mutate the template or sibling
agents. A template never shares a writable memory directory or worktree.

## Migration and compatibility

Existing data is migrated once and without deletion:

1. Each distinct category `repoPath` becomes one deduplicated `Repository`.
2. Each existing repo-backed agent receives that repository as its default.
3. Its current `workspaceDir` becomes the initial `WorkspaceBinding` when it
   resolves to the expected repository/worktree; unsafe or ambiguous paths are
   retained as legacy plain workspaces and reported for manual repair.
4. Existing sessions and historical run leases retain their snapshotted paths;
   migration does not redirect a live or retained execution.
5. Legacy category `repoPath` remains readable during one compatibility window
   and is never removed until round-trip/restart tests prove the new records.

Repository catalog identity uses normalized real paths plus Git common-dir
verification. Importing the same repository through a different casing,
separator or worktree path must not create duplicate roots.

## Safety requirements

- Binding creation validates the repository before writing config or creating
  a worktree and rolls back partial filesystem/config changes on failure.
- One binding cannot be leased by two concurrent runs, and one worktree cannot
  be registered to two agent/repository pairs.
- Changing or clearing defaults never kills a session, moves a worktree,
  deletes a branch or removes user files.
- Repository removal is blocked while any live session, queued task, active
  lease or retained approval references it.
- Files, Changes, task launch and integration receive a binding id and resolve
  paths in main; renderer-provided absolute paths are never trusted.
- Portable-agent memory and template seeds must not contain repository
  credentials or copy `.env`, Git config or other discovered secrets.
- All migration, binding and template inputs receive runtime validation and
  security tests equivalent to the existing privileged IPC surface.

## Delivered steps

1. Add repository/binding/template types, atomic persistence and non-destructive
   migration fixtures.
2. Move workspace resolution behind a `RepositoryScopeService`; preserve the
   existing identity, PTY, Git and orchestration behavior through adapters.
3. Snapshot the repository on runs/participants and exact binding/workspace on
   sessions, tasks, leases and artifacts; enforce immutable live scopes.
4. Update onboarding and agent editing with optional default repository and a
   portable-agent choice.
5. Add the Files/Changes scope header, repository chooser and new-session
   behavior shown above.
6. Add template create/spawn flows with independent memory/workspaces.
7. Migrate real existing config in an isolated profile, restart, and verify
   sessions, Files/Changes, managed integration and cleanup behavior.
8. Run the full Goal 5 security, domain and Electron workflow before using the
   model for Goal 6 product validation.

## Exit criteria

- Existing repo-backed agents migrate with the same effective worktrees and no
  deleted catalog data or files.
- A specialized agent can default to one repository; a portable agent can open
  independent sessions in at least two repositories without path, state or
  Git-history crossover.
- Files/Changes always names and reads the selected execution's actual repo and
  worktree, including after renderer/app restart.
- Switching a live session to another repository is impossible; the UI creates
  a new scoped session instead.
- A managed run gives every participant an exclusive binding in one selected
  repository and preserves all current diff/commit/integration guarantees.
- A spawned template instance has independent identity, memory and bindings.
- Default changes and detach operations are non-destructive and fully covered
  by migration, runtime, security and packaged-Electron tests.

The remote-control work depends on this model: mobile commands choose a
`repositoryId` and one or more `agentId` values independently, while the ADE
core resolves immutable bindings before any task starts.

## Goal 5 completion verification record

The counts below are the historical Goal 5 checkpoint. Current regression
totals live in `STATUS.md` and `HANDOFF.md`.

- `pnpm run typecheck` and the production build pass.
- `pnpm test` passes 198 focused assertions, including 21 Goal 5 repository-
  scope assertions and 64 privileged IPC/security assertions.
- The 41-check production Electron workflow creates a repository-scoped
  session from a live portable session, verifies immutable scope across tab
  changes, renderer reload and PTY restart, then completes a repository-scoped
  managed run through approval, integration and verification and confirms the
  catalog/bindings/run scope survive a full application restart.
