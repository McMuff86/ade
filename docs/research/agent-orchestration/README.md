# ADE Agent Orchestration Research

Status: research baseline, 2026-07-12

This folder translates current OpenAI and Anthropic guidance into a concrete
prompting, context-engineering, planning, orchestration, and evaluation strategy
for ADE.

## Documents

- [`ADE_CONTEXT.md`](ADE_CONTEXT.md) — concise product and architecture model;
  what ADE is, what already exists, and the important gaps.
- [`PROMPTING_PLAYBOOK.md`](PROMPTING_PLAYBOOK.md) — model-aware prompting and
  context assembly for GPT-5.6 Sol and Claude Fable 5.
- [`GRAPH_ORCHESTRATOR_DESIGN.md`](GRAPH_ORCHESTRATOR_DESIGN.md) — recommended
  Graph/Orchestrator control contracts, worker packets, lifecycle, and UI.
- [`EVALUATION_PLAN.md`](EVALUATION_PLAN.md) — an eval-driven method for proving
  that prompt and orchestration changes improve results.
- [`SOURCES.md`](SOURCES.md) — primary sources and the claims taken from them.

## Executive conclusion

ADE already has unusually strong deterministic safety around managed runs:
persisted run state, exclusive worktree leases, schema-validated results,
ADE-owned commits, approval-gated integration, transactional cherry-picking,
and read-only final verification. The largest remaining quality gap is not the
state machine. It is **context construction and orchestration policy**.

Today, the planning prompt in `src/main/orchestration/RunCoordinator.ts` gives
an orchestrator the run goal and a participant list, but not a structured
repository brief, participant capabilities, ownership constraints, prior task
state, relevant files, authoritative instructions, or a resource-scaled
planning rubric. Worker prompts carry the assignment and acceptance criteria,
but not a versioned context packet or explicit evidence requirements beyond
changed paths and tests.

The recommended next architecture is:

1. Keep deterministic lifecycle, leases, schemas, budgets, and approvals in ADE.
2. Add a versioned `RunContextManifest` assembled from authoritative sources.
3. Let the model choose decomposition within explicit effort and ownership
   bounds; do not let it invent participants, tools, scope, or success criteria.
4. Give every worker a minimal, immutable, task-specific context packet rather
   than the whole run transcript.
5. Preserve large outputs as artifacts and pass references plus compact summaries
   to avoid the coordinator becoming a lossy "game of telephone".
6. Add independent review/verification contexts and outcome-based evals before
   changing production prompts.
7. Treat prompt builders and schemas as versioned code with fixtures, traces,
   canary rollout, and rollback.

## Verified model names

The names in the research request are valid as of 2026-07-12:

- OpenAI documents `gpt-5.6-sol`; the `gpt-5.6` alias routes to Sol. GPT-5.6
  supports `reasoning.effort: "max"` and a separate `reasoning.mode: "pro"`.
  Max effort and Pro mode are independent controls.
- Anthropic documents `claude-fable-5` as its most capable generally available
  model. Fable 5 uses adaptive thinking; it does not use the older manual
  extended-thinking token-budget pattern.

Model behavior and APIs can change. ADE should therefore store the exact model
identifier, adapter version, prompt version, schema version, and effective
reasoning configuration on every run/task result.
