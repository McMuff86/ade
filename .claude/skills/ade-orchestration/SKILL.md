---
name: ade-orchestration
description: How agents inside ADE (agentic development environment) understand their workspace, spawn new agents, dispatch work to other agents, and safely remove runs, agents, teams and worktrees — without ever touching the user's original repositories. Use when asked to manage the ADE graph, spawn or remove agents, clean up runs/worktrees, or explain where your checkout lives.
---

# ADE orchestration & workspace safety

You are (most likely) running inside an ADE-managed **git worktree**, not in the
user's original repository clone. Read this before doing anything destructive.

## 1. Mental model — where your files live

| Thing | Where | Owner |
|---|---|---|
| Original repository | e.g. `C:\Users\<user>\repos\<repo>` | The **user** (Cursor/IDE work happens here) |
| Your checkout | `<repo-parent>\.ade-worktrees\<repo-slug>\<agent-slug>` (legacy: `%APPDATA%\ade\ade\worktrees\...`) | ADE, one per agent+repo pair |
| Your branch | `ade/<agent-slug>` | ADE; commits land in the shared `.git` of the original repo |

Your worktree is a **linked checkout** (`git worktree add`) of the original
repository. Both share one object database: every commit you make on your
`ade/...` branch is immediately visible in the original repo. There is no
separate clone, and deleting a worktree never deletes the repository history.

Run `git rev-parse --git-common-dir` if you need to confirm which repository
you belong to. Run `git branch --show-current` to see your agent branch.

## 2. Hard safety rules (never violate these)

1. **Never delete or rewrite the original repository.** No `rm -rf`, no
   `git worktree remove`, no `git branch -D`, no history rewrites targeting the
   original root path (anything outside your own workspace directory).
2. **Stay inside your workspace directory.** Your execution scope is immutable;
   do not `cd` into sibling worktrees or the original clone to "fix" things.
3. **Do not remove worktrees manually.** ADE has a guarded cleanup
   (`Remove worktree` in the Repository-Scope panel) that refuses active
   sessions, running tasks, uncommitted changes and unmerged branches. Manual
   `git worktree remove/prune` bypasses those guards — never do it.
4. **Commit instead of stashing away work.** Anything uncommitted blocks
   cleanup by design; committing on your `ade/` branch is always safe because
   the branch is only deleted once fully merged.
5. **Never copy repository secrets** (`.env`, git credentials) into agent
   memory or task results.

## 3. Spawning a new agent

Agents cannot create other agents from the CLI — identity creation is a
main-process operation with its own validation. The supported paths:

- **UI**: Terminals mode → category → *New agent* (choose runtime, permission
  mode, optional default repository).
- **Template spawn**: an `AgentTemplate` creates a fresh, independent identity
  (own memory dir, own bindings, optional default repo). UI: template list →
  *Spawn*.
- **From a task**: if your task needs an agent that does not exist, say so in
  your result ("blocked: needs a <runtime> agent for X") instead of trying to
  create one. The orchestrator/user spawns it, then re-dispatches.

A new agent gets its own worktree per repository on first use — never share
your worktree with another agent.

## 4. Dispatching work to other agents (orchestrator role)

- **Manual runs**: the user (or you, via the Graph UI composer) sends a prompt
  to a team or a single participant; ADE launches a bounded task session per
  target in that participant's own worktree.
- **Managed runs**: as orchestrator you receive a planning task and return a
  structured plan; ADE schedules worker tasks (with dependencies, budgets,
  pause/resume per team), collects results, and integrates only after the
  user's approval. You never launch worker processes yourself — you describe
  tasks, ADE owns process lifecycle, commits and integration.
- Agents on other runtimes (Codex, custom commands — including a WSL-side
  agent wrapped via `wsl.exe ...`) are addressed exactly the same way: they are
  participants with their own binding; the runtime adapter handles transport.

## 5. Removing things (what is safe, what is blocked)

| Action | Where | What it deletes | What it never deletes |
|---|---|---|---|
| **Run löschen** | Graph run bar (two-step confirm) | Run + participants, tasks, events, artifacts, approvals, leases, messages | Files, worktrees, branches, agents, the repo |
| **Remove worktree** | Repository-Scope panel | The agent's worktree directory + binding record; the `ade/` branch only if fully merged | Uncommitted work (refuses), unmerged branches (kept), the original repo |
| **Agent/Team (category) delete** | Terminals mode | Catalog/config records; stops owned sessions | Workspace files, repositories |
| **Repository remove** | (intentionally restricted) | Catalog entry only, blocked while sessions/tasks/leases reference it | The folder on disk — ADE never deletes a repository from disk |

Blocked-state rules: a running managed run must be cancelled before its run
can be deleted; a worktree with open sessions, queued/running tasks, an active
lease or uncommitted changes cannot be removed. These guards exist so **no
work and no user files can be lost** — do not look for ways around them.

## 6. Finishing a task cleanly

1. Commit your changes on your `ade/` branch (small, described commits).
2. Report exactly which files changed in your structured result — ADE creates
   the managed commit from your report and rejects mismatches.
3. Leave the worktree clean (`git status` empty). A clean worktree is what
   makes later integration, re-runs and cleanup possible.
