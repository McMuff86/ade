# Primary Sources

Accessed: 2026-07-12

Only first-party OpenAI and Anthropic sources are used for provider/model claims.
Product-specific recommendations in this folder are ADE design conclusions, not
claims made by the providers.

## OpenAI

1. [Using GPT-5.6](https://developers.openai.com/api/docs/guides/latest-model)
   - `gpt-5.6` aliases to `gpt-5.6-sol`.
   - Reasoning efforts include `max`; Pro mode is a separate execution mode.
   - Recommends Responses API, deliberate effort selection, representative
     benchmarks, lean prompts, explicit autonomy/approval boundaries, and
     task-specific Programmatic Tool Calling contracts.
2. [GPT-5.6 Sol model](https://developers.openai.com/api/docs/models/gpt-5.6-sol)
   - Verifies the exact model ID and the documented context/output limits.
3. [Prompt engineering](https://developers.openai.com/api/docs/guides/prompt-engineering)
   - Recommends authority-separated messages, Markdown/XML boundaries,
     relevant context, diverse examples where useful, prompt caching layout,
     exact model snapshots, and eval suites.
4. [Reasoning models](https://developers.openai.com/api/docs/guides/reasoning)
   - Reference for reasoning effort, multi-step planning, tool use, and reasoning
     workflow behavior.
5. [Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs)
   - Basis for schema-constrained machine-consumed planning/results.
6. [Function calling](https://platform.openai.com/docs/guides/function-calling)
   - Basis for precise tool schemas and tool-call lifecycle handling.
7. [Multi-agent](https://developers.openai.com/api/docs/guides/responses-multi-agent)
   - Beta root/subagent orchestration, concurrency guidance, limitations, and
     separately compacted agent contexts.
8. [Code generation](https://platform.openai.com/docs/guides/code-generation)
   - Current provider guidance for coding workflows and Codex integration.

## Anthropic

1. [Models overview](https://platform.claude.com/docs/en/about-claude/models/overview)
   - Verifies `claude-fable-5`, general availability, and model-family position.
2. [Prompting Claude Fable 5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5)
   - Fable-specific guidance on effort, long-running autonomy, concise
     instruction following, evidenced progress, boundaries, asynchronous
     subagents, memory, fresh-context verification, and avoiding reasoning
     extraction prompts.
3. [Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
   - General guidance for clarity, examples, XML boundaries, tools, thinking,
     and agentic systems.
4. [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
   - Orchestrator-worker architecture, delegation contracts, effort scaling,
     parallelism, artifacts, context compression, outcome evals, observability,
     and limits of multi-agent execution for tightly coupled tasks.
5. [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
   - Context curation, compaction, structured notes, and multi-agent context
     separation.
6. [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
   - Distinguishes deterministic workflows from dynamic agents and argues for
     simple composable patterns before added complexity.
7. [Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)
   - Tool ergonomics, precise descriptions, MCP/tool testing, and evaluation.
8. [Create custom subagents](https://docs.anthropic.com/en/docs/claude-code/sub-agents)
   - Subagent isolation, specialized prompts, tool restrictions, and context
     boundaries.
9. [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
   - Agent evaluation design and outcome-focused rubrics.

## Evidence caveats

- Provider benchmark and internal-evaluation figures describe provider-specific
  systems and are not guaranteed ADE outcomes.
- Multi-agent improvements are task-shape dependent. Anthropic explicitly notes
  high token cost and weaker fit where work is tightly coupled or requires a
  shared context.
- Model aliases, pricing, limits, and API parameters may change. ADE should query
  adapter capabilities and record effective runtime metadata rather than embed
  mutable provider facts in old run history.
