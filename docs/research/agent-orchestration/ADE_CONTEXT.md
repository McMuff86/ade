# ADE Context and Gap Analysis

Status date: 2026-07-12

## Product intent

ADE is a Windows-first Agentic Development Environment. Its center is a real
terminal execution plane for real CLI agents. Graph is a persisted control plane
for bounded task runs over the same catalog agents; it is not a second chat UI
or a simulated agent system.

The durable product model separates:

- catalog identity (`Agent`),
- organization (`Category`),
- repository and immutable execution scope (planned Goal 5),
- terminal session,
- persisted run and task,
- run-scoped participant role (`orchestrator`, `lead`, `worker`), and
- runtime adapter.

The binding sources of truth are `docs/SPEC.md`, `docs/ARCHITECTURE.md`,
`docs/ROADMAP.md`, and `docs/STATUS.md`.

## What already works

Managed Graph runs currently implement:

1. `planning -> working -> approval -> integrating -> verifying -> terminal`.
2. Exactly one orchestrator and at least one lead/worker.
3. One planner assignment per selected non-orchestrator participant.
4. Acyclic `dependsOn` validation and bounded concurrent scheduling.
5. Exclusive, clean workspace leases from one Git common directory.
6. Runtime-specific structured output through Codex JSONL/schema or a generic
   file mailbox.
7. Exact changed-path reconciliation and ADE-owned task commits.
8. Durable human approval before integration.
9. Transactional cherry-pick integration, integration review, and read-only
   verification.
10. Persisted events, results, messages, artifacts, usage, and restart recovery.

These are strong control-plane foundations. They should remain deterministic
and outside model discretion.

## Current prompt pipeline

The principal prompt builders are at the bottom of
`src/main/orchestration/RunCoordinator.ts`:

- `planningPrompt()` receives a goal and a participant roster.
- `workerPrompt()` receives the goal, owned assignment, acceptance criteria,
  workspace safety rules, and reporting rules.
- `integrationPrompt()` receives compact worker summaries, commit IDs, risks,
  and test statuses.
- `verificationPrompt()` receives the goal and integration summary.

`src/main/orchestration/runtimeAdapters.ts` appends a structured-result contract
and validates `StructuredTaskResult` version 1. It includes assignments, changed
files, tests, commit SHA, risks, and usage.

## Gaps that matter most

### 1. No first-class context manifest

The orchestrator sees no machine-built repository brief. It must rediscover or
guess:

- authoritative instruction files and their precedence,
- relevant specification and roadmap sections,
- repository structure and test commands,
- current branch/base SHA and execution scope,
- participant capabilities and runtime limitations,
- files or ownership zones likely to conflict,
- prior run lessons or binding-local context,
- allowed tools and approval boundaries.

The worker sees only a free-text assignment. Correct context depends almost
entirely on planner prose.

### 2. One schema serves incompatible phases

`StructuredTaskResult` contains `assignments` for every phase even though only
planning should produce them. Planning, work, integration, and verification have
different evidence and invariants. A phase-discriminated result schema would be
clearer and harder to misuse.

### 3. Role semantics are shallow

A `lead` is currently schedulable like any other non-orchestrator participant.
There is no separate team-level contract for leads to refine a bounded team
plan, review worker outputs, or maintain team context. The graph visual model is
richer than the execution semantics.

### 4. Static one-shot planning

The planner creates one assignment per selected participant at most once. This
is safe, but prevents:

- choosing fewer workers when the goal is small,
- staged discovery before implementation,
- replanning after a bounded, evidenced blocker,
- splitting one participant's work into sequential tasks,
- requesting targeted follow-up or repair without failing the whole run.

Any evolution must preserve caps and avoid recursively unbounded spawning.

### 5. Lossy integration context

`integrationPrompt()` truncates worker reports into prose. Artifacts exist in the
domain model, but the prompt does not provide a typed artifact index, exact diff
references, requirement-to-evidence coverage, or unresolved decision log.

### 6. Verification is not independent enough

Final verification runs on the orchestrator identity and receives the
integration summary. It is read-only, which is good, but may inherit assumptions
and blind spots. A fresh verifier context, ideally a different participant/model
when budget permits, should evaluate the final state against the original goal
and acceptance criteria, not merely the integration narrative.

### 7. No prompt-version/eval loop in the domain model

The run captures adapter ID and result data but does not clearly snapshot:

- prompt-template version,
- context-manifest version/hash,
- exact model ID and reasoning settings,
- tool-set version,
- evaluator rubric version.

Without these, regressions are difficult to attribute.

### 8. Dependencies currently delay work but do not transfer its result

`RunCoordinator.scheduleWork()` treats `dependsOn` as a start barrier. A
downstream worker starts after its predecessor completes, but `workerPrompt()`
does not receive the predecessor's structured result, changed paths, tests,
risks, commit, or artifacts. Because workers have separate worktrees based on
the original base SHA, the downstream worker also does not see upstream code.

This makes a genuine implementation dependency misleading. Until ADE supports
validated upstream-result and upstream-commit transfer, `dependsOn` should mean
ordering/information readiness only, and the planner must be told that dependent
workers do not automatically inherit upstream code.

### 9. Graph controls and animations can imply state that Main does not own

`graphStore.ts` keeps `idleTeams` and transient `busy` state only in the
renderer. Managed scheduling ignores `idleTeams`, reload loses it, and transient
busy can temporarily mask journal-backed task state. `GraphView.computeEdges()`
animates edges from `!team.idle`, not from a message or task event. This risks
presenting connection activity that did not happen.

Graph pause, node status, and edge activity should either be explicitly labeled
as local/manual UI state or derive from authoritative run commands and events.

### 10. Managed memory is not equivalent to interactive memory injection

Managed launches intentionally skip mutation of `CLAUDE.md`/`AGENTS.md` to keep
leased worktrees clean. That safety choice is correct, but it also means the
normal injected `MEMORY.md`/`USER.md` block is not freshly supplied. The
structured task/mailbox contract is not a substitute for agent-global memory.

Managed tasks need a versioned, read-only memory snapshot outside the worktree,
separated from the run context and future binding-local repository memory.

### 11. Some domain transitions span multiple persisted operations

The JSON store writes atomically, but a logical transition can still involve
multiple saves—for example creating an integration approval and then changing
the run phase to `approval`. A crash between those writes can leave inconsistent
materialized state. Related event, approval, task, and phase updates should be
committed as one domain transaction.

## Design constraints

Recommendations must preserve ADE's current principles:

- the terminal remains real;
- Graph state comes from authoritative events, never timers;
- repository scope is immutable per execution;
- models cannot bypass leases, budgets, result validation, or approval;
- planning and verification are read-only;
- workers do not alter Git history;
- ADE owns commits and integration;
- telemetry that is unavailable remains unknown;
- prompts never expose credentials or unrestricted host paths;
- agent-global memory and repository-specific context stay separate.
