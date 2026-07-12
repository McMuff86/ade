# Model-Aware Prompting and Context Engineering Playbook

Status date: 2026-07-12

## Core principle

The highest-value unit is not a giant prompt. It is a **versioned context
contract** containing the smallest authoritative information needed for one role
to complete one bounded task, plus deterministic tools and evidence rules.

Prompt quality should be treated as software quality: version it, test it against
representative fixtures, inspect traces, compare end states, and roll it out
incrementally.

## Shared prompt architecture

Build prompts in five layers. Keep stable reusable content first for provider
caching, and dynamic context last.

1. **Role and mission** — one compact identity statement.
2. **Authority and boundaries** — allowed local actions, prohibited actions,
   approval gates, and stop conditions. State each rule once.
3. **Task contract** — goal, owned scope, non-goals, acceptance criteria,
   dependencies, output schema, and evidence requirements.
4. **Tool contract** — only relevant tools, with precise purpose, input/output
   shape, failure behavior, retry limit, and side-effect class.
5. **Context packet** — authoritative instructions, repository facts, relevant
   files/artifacts, prior decisions, and dependency outputs, each with provenance.

Use Markdown headings for hierarchy and XML tags or typed JSON objects for
boundaries around untrusted/dynamic data. Never interpolate retrieved text into
a higher-authority instruction section.

## Context precedence

ADE should assemble and label context in this order:

1. ADE safety and execution policy.
2. Run phase contract.
3. Repository instruction files (`AGENTS.md`, `CLAUDE.md`, project equivalents),
   with path and scope.
4. User goal and explicit decisions.
5. Run plan and owned assignment.
6. Dependency results and immutable artifact references.
7. Retrieved code/docs excerpts.
8. Historical memory or lessons, clearly marked as advisory and scoped.

If two same-authority sources conflict, the context builder should surface the
conflict rather than silently concatenate both.

## Minimum worker packet

Every worker should receive a typed, immutable packet equivalent to:

```ts
interface WorkerContextPacketV1 {
  version: 1;
  run: {
    id: string;
    goal: string;
    successCriteria: string[];
    nonGoals: string[];
  };
  assignment: {
    id: string;
    title: string;
    objective: string;
    ownedPaths: string[];
    forbiddenPaths: string[];
    acceptanceCriteria: string[];
    requiredChecks: string[];
    dependsOn: string[];
  };
  execution: {
    repositoryId?: string;
    bindingId: string;
    baseSha?: string;
    permissionMode: string;
    allowedSideEffects: string[];
    approvalRequiredFor: string[];
  };
  instructions: Array<{
    path: string;
    scope: string;
    digest: string;
    content: string;
  }>;
  dependencies: Array<{
    taskId: string;
    summary: string;
    artifacts: ArtifactRef[];
    evidence: EvidenceRef[];
  }>;
  relevantContext: Array<{
    source: string;
    reason: string;
    contentOrArtifact: string;
  }>;
  outputContract: {
    schemaVersion: string;
    resultPath: string;
    requiredEvidence: string[];
  };
}
```

`ownedPaths` should be a planning claim, not the security boundary. ADE must
still compare actual changes and reject overlaps or unauthorized paths.

## GPT-5.6 Sol guidance

OpenAI currently documents:

- `gpt-5.6` routes to `gpt-5.6-sol`.
- reasoning effort supports `none`, `low`, `medium`, `high`, `xhigh`, and `max`.
- Pro mode is `reasoning.mode: "pro"` and is independent of effort.
- GPT-5.6 Sol has a documented 1,050,000-token context window and up to
  128,000 output tokens; the large window still requires retrieval, milestone
  compaction, and artifact-backed context management.
- the Responses API is preferred for reasoning, tool use, and multi-turn work.
- precise constraints, autonomy boundaries, success criteria, and output format
  remain important, while redundant prompts and tool descriptions can degrade
  quality and efficiency.

Recommended ADE policy:

| Phase | Default configuration | Escalate when |
|---|---|---|
| repository discovery | Sol, medium | architecture is unfamiliar or very large |
| run planning | Sol, high | cross-cutting/high-risk goal; compare xhigh/max by eval |
| bounded worker edit | Sol, medium/high | difficult bug, migration, or broad refactor |
| integration review | Sol, high | multiple worker ranges or security-sensitive changes |
| final verification | Sol, high in fresh context | failed/ambiguous checks or high-value release gate |
| exceptional quality-first task | Sol + measured max and/or Pro | evals prove gain worth latency/cost |

Do not assume `max` or Pro is always best. Compare the same fixtures across
settings and record quality, evidence completeness, tokens, latency, and cost.
Keep prompts outcome-focused; do not tell the model to reveal chain of thought.

For GPT-5.6 specifically:

- prefer a lean prompt and expose only task-relevant tools;
- explicitly define safe autonomy versus confirmation boundaries;
- use structured outputs for machine-consumed planning/results;
- preserve reasoning across turns only while goals and assumptions remain stable;
- use direct tool calls where each result changes the next judgment;
- use programmatic tool calling only for bounded filtering/joining/validation,
  with exact schema, allowed tools, retry/stopping rules, and a direct final
  semantic validation step;
- pin exact production model snapshots when available and maintain evals.

OpenAI also documents a beta Responses API multi-agent mode. ADE should not
replace its deterministic coordinator with that beta. If evaluated later, keep
it behind a feature flag, version event schemas, cap concurrency (three parallel
subagents is OpenAI's documented starting point), isolate mutable workspaces,
and retain ADE as the authority for integration and completion.

## Claude Fable 5 guidance

Anthropic currently documents `claude-fable-5` as its highest-capability
generally available model. Fable 5 uses adaptive thinking and no longer uses
manual extended-thinking token budgets.

Recommended ADE policy:

| Phase | Default effort | Notes |
|---|---|---|
| routine discovery/work | medium | prevents needless overplanning |
| planning/integration | high | Anthropic recommends high for most substantial tasks |
| hardest long-horizon task | xhigh | reserve for measured capability gain |
| final independent review | high/xhigh | fresh context and original criteria |

Fable-specific scaffolding:

- state the purpose behind the task, not only the command;
- keep instructions brief but explicit about scope, non-goals, and irreversible
  actions;
- instruct long-running tasks to audit progress claims against tool evidence;
- require action when enough information exists, rather than repeated planning;
- prevent opportunistic cleanup, abstractions, defensive branches, and feature
  expansion not required by the goal;
- delegate independent work asynchronously and allow the orchestrator to keep
  working while workers run;
- preserve long-lived worker contexts only when follow-up tasks genuinely share
  context; otherwise prefer fresh contexts;
- use fresh-context verifier agents rather than relying only on self-critique;
- store durable lessons outside the context window and pass references;
- do not ask Fable to reproduce or expose private reasoning. Request conclusions,
  evidence, decisions, and concise rationale instead.

## Planning contract

A planner should return a plan, not prose. Recommended `PlanResultV2` fields:

```text
run_summary
assumptions[]
questions[]                  # only blockers that cannot be inspected
strategy
assignments[]
  participant_id
  team_id
  objective
  owned_paths[]
  forbidden_paths[]
  deliverables[]
  acceptance_criteria[]
  required_evidence[]
  depends_on[]
  estimated_effort
  risk_level
integration_order[]
shared_risks[]
stop_conditions[]
```

ADE validates participant IDs, dependencies, ownership overlap, limits, and
question policy before creating tasks. A plan that leaves acceptance criteria
or evidence undefined should be rejected.

## Context compression and artifacts

Do not repeatedly paste full worker outputs into the orchestrator context.
Persist:

- exact patches/diffs,
- test logs,
- structured results,
- architectural notes,
- screenshots or generated assets,
- requirement-to-evidence matrices.

Pass compact summaries plus immutable artifact IDs, hashes, paths, and provenance.
The orchestrator should retrieve an artifact only when needed. Completed phases
should produce a checkpoint summary containing decisions, unresolved risks,
current state, and artifact references.

## Anti-patterns

- Same prompt fan-out to every worker.
- Giving every agent the entire transcript or repository documentation.
- Letting workers infer acceptance criteria.
- Mixing policy, user data, retrieved content, and tool output without labels.
- Repeating the same safety instruction many times.
- Asking for chain-of-thought or hidden reasoning.
- Treating a model-written plan as authorization.
- Treating exit code 0, a confident summary, or `outcome=succeeded` as proof.
- Using all available workers merely because they exist.
- Parallelizing tightly coupled code where workers must continuously share state.
- Changing prompts without prompt version, fixtures, traces, and rollback.
