# Graph and Orchestrator Design Recommendations

Status date: 2026-07-12

## Design rule: models propose, ADE disposes

The model may propose decomposition, tool use, evidence, and follow-up. ADE owns
and enforces:

- participant and workspace identity,
- task and subagent limits,
- immutable repository scope,
- allowed tools and side-effect class,
- budgets and timeouts,
- task state transitions,
- path ownership and overlap checks,
- result-schema validation,
- Git commits and integration,
- approval gates,
- final completion state.

This split preserves flexibility without delegating authorization to a prompt.

## Recommended hierarchy

### Orchestrator

Owns the global goal, decomposition, dependency graph, resource allocation,
integration strategy, and coverage matrix. It should not implement ordinary
worker work. It receives summaries and artifact references, not every raw log.

### Team leader

Use only when a team has a meaningful bounded domain, such as renderer, Electron
main process, or test/verification. A leader owns a team brief and may:

- refine tasks inside its assigned domain,
- monitor progress and evidence,
- request one bounded repair/review cycle,
- consolidate team artifacts,
- report coverage and unresolved risks to the orchestrator.

A leader must not create permanent identities, exceed the team's delegated
budget, broaden repository scope, or integrate Git history. If there is no
meaningful team-level coordination, omit the leader; decorative hierarchy adds
cost and information loss.

### Worker

Owns one specific outcome, a path budget, acceptance criteria, required checks,
and a result contract. It should receive only relevant context and dependencies.

### Verifier

Runs in a fresh, read-only context against the original goal, final workspace,
and requirement-to-evidence matrix. It should not receive persuasive planner or
integration narratives beyond factual artifact references.

## Run lifecycle V2

```text
DRAFT
  -> CONTEXT_BUILD
  -> PLAN
  -> PLAN_VALIDATE
  -> WORK
  -> TEAM_REVIEW          (optional, only for real teams)
  -> COVERAGE_CHECK
  -> APPROVAL
  -> INTEGRATE
  -> INTEGRATION_REVIEW
  -> VERIFY
  -> COMPLETE | FAILED | CANCELLED
```

### CONTEXT_BUILD

ADE deterministically discovers and snapshots:

- repository identity, root, base SHA, branch and binding;
- applicable instruction files and scopes;
- package/build/test commands from trusted project metadata;
- top-level structure and language/toolchain;
- run goal, explicit user decisions, non-goals, and approval policy;
- participant runtime/model/capability summaries;
- relevant prior binding-local lessons;
- prompt, schema, tool-set, and context-builder versions.

Store a hashable `RunContextManifest`. A task context packet references this
manifest plus a task-specific projection.

### PLAN_VALIDATE

Reject or send one bounded repair request when the plan has:

- unknown/duplicate participants;
- cycles or impossible dependencies;
- missing acceptance/evidence criteria;
- overlapping owned paths without an explicit serialization dependency;
- excessive workers for task complexity;
- tightly coupled assignments presented as parallel;
- unowned requirements;
- forbidden operations or scope expansion;
- no explicit integration and verification strategy.

The validator must also distinguish two dependency types:

- `information`: the downstream task receives an immutable upstream result and
  artifact references;
- `code`: ADE validates and applies the upstream commit range to a newly based
  downstream workspace before launch, then records the new base SHA.

Until code dependency transfer exists, reject code-dependent parallel plans
rather than merely delaying the downstream worker on an unchanged worktree.

### COVERAGE_CHECK

Before approval, create a machine-readable matrix:

| Requirement | Owning task | Evidence | Status | Risk |
|---|---|---|---|---|

No requirement may be marked complete solely from a worker summary. Evidence
must link to an observed diff, test result, artifact, or explicit inspection.

## Effort scaling policy

Multi-agent work is valuable only when decomposition creates real independence.
The planner should classify the goal before allocating workers:

| Class | Typical shape | Suggested execution |
|---|---|---|
| S | one narrow file/fix | one worker; no leader |
| M | 2-3 independent concerns | 2-3 workers, direct orchestrator |
| L | broad feature with separable layers | 3-5 workers, optional domain leads |
| XL | research/large migration with broad parallelism | staged discovery, bounded teams, explicit checkpoints |

The numbers are starting hypotheses, not universal rules. ADE evals should tune
them. Never require one assignment per roster member. The planner should select
the smallest useful subset and explain why unused participants are unnecessary.

## Dynamic replanning without runaway spawning

Current one-shot planning is safe. Add adaptability incrementally:

1. Allow one read-only discovery wave before implementation.
2. Allow at most one planner repair when plan validation fails.
3. Allow at most one worker repair task for a verifier-evidenced defect.
4. Keep child depth bounded (for example, orchestrator -> leader -> worker only).
5. Charge every spawned task against explicit count/token/time budgets.
6. Persist the parent task, reason, new scope, and budget delta.
7. Never let a worker spawn another worker directly.

## Inter-agent communication

The existing mailbox and artifact model should become the canonical exchange
layer.

Messages should be typed:

- `assignment`
- `question`
- `answer`
- `progress`
- `artifact_ready`
- `blocked`
- `result`
- `review_finding`
- `replan_request`

Every message includes run/task/participant IDs, monotonic sequence, timestamp,
context-manifest version, and optional artifact references. Free-form prose may
exist inside a bounded field but must not replace typed status.

Prefer asynchronous delivery. A coordinator should continue independent work
while workers run. Avoid global broadcast context. Route only relevant messages
to participants with an explicit reason.

## Phase-specific result schemas

Replace one overloaded schema with a discriminated union:

- `PlanResultV2`: assignments, assumptions, coverage, integration order.
- `WorkResultV2`: outcome, changed paths, deliverables, checks, risks, blockers,
  artifact refs, usage.
- `TeamReviewResultV1`: assignment coverage, cross-worker conflicts, missing
  evidence, repair requests.
- `IntegrationResultV2`: applied ranges, integration-only changes, checks,
  unresolved risks, evidence refs.
- `VerificationResultV2`: original-criterion verdicts, commands, observed output,
  regression checks, final pass/fail.

Each result stores its schema version and rejects unknown fields unless a schema
explicitly provides an extension map.

## Graph UX recommendations

Graph should expose control-plane truth rather than model narration:

1. **Context inspector** — manifest version, authoritative instructions,
   repository/base SHA, model/runtime settings, and task-specific context.
2. **Ownership overlay** — planned path domains, actual changed paths, and overlap
   warnings.
3. **Dependency edges** — why each edge exists and what artifact unlocks it.
4. **Coverage view** — original criteria mapped to tasks and evidence.
5. **Budget view** — task count, concurrency, tokens/cost when trusted, elapsed
   time, and approvals.
6. **Prompt/version trace** — template version, schema version, model snapshot,
   effective effort/mode, and tool-set version.
7. **Artifact panel** — results, diffs, logs, screenshots, and review findings by
   immutable reference.
8. **Replan events** — visible reason, scope delta, and budget impact.
9. **Critical path** — blocked/running dependencies and estimated—not invented—
   progress. Unknown duration remains unknown.
10. **Approval evidence** — exact commits, changed paths, tests, risks, coverage,
    and unresolved warnings.

Do not show hidden chain-of-thought. Show plans, decisions, tool evidence,
structured rationale, and state transitions intended for users.

## Priority implementation sequence

### P0 — prompt/context observability

- Extract prompt builders from `RunCoordinator.ts` into a versioned module.
- Persist prompt/schema/model/reasoning/tool-set versions.
- Add context manifest and task packet artifacts.
- Add fixtures and snapshot tests for every phase prompt.
- Inject agent-global memory into managed runs as a versioned read-only snapshot,
  without mutating the leased worktree.

### P0 — semantic correctness of the current Graph

- Make `dependsOn` transfer the required upstream result/artifacts and, for true
  code dependencies, a validated commit range plus new workspace provenance.
- Bind edge animation and node activity to real run/message/task events.
- Make managed pause a Main-owned command/event or label the current control as
  manual-dispatch-only.
- Persist each logical phase transition, its event, approval/task mutation, and
  materialized state as one domain transaction.

### P1 — stronger planning contract

- Add goal-level success criteria/non-goals to run creation.
- Add path ownership, evidence, effort, and integration fields to planning.
- Validate overlap and requirement coverage.
- Permit selecting fewer participants than the roster.

### P2 — independent evidence pipeline

- Add typed artifacts and requirement-to-evidence coverage.
- Run final verification in fresh context and support a separate verifier.
- Base completion on original criteria plus evidence.

### P3 — real team leadership

- Introduce a bounded team brief and optional team-review phase.
- Add leader-specific budgets and one repair cycle.
- Omit leaders for small or flat work.

### P4 — controlled adaptive orchestration

- Add discovery wave, plan repair, and verifier-triggered repair.
- Add asynchronous progress/questions and coordinator steering.
- Keep depth, count, budget, workspace, and approval limits deterministic.
