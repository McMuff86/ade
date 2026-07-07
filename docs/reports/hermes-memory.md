# Hermes-Agent Memory System — Analysis & Port Plan for ADE

Source: Explore-agent report over `reference/hermes-agent` (2026-07-07).
Runtime of the original is Python 3; the memory tool is ~1,150 lines of pure
Python with no LLM dependency. The "intelligence" is prompt-engineering
(portable verbatim) plus small deterministic file logic (reimplement in TS).

## 1. Where the memory system lives + on-disk files & formats

### Core source files
| File | Role |
|---|---|
| `tools/memory_tool.py` | **The heart.** `MemoryStore` class (file persistence, char-limits, add/replace/remove/batch, drift guard, snapshot), the `memory` tool entry point, and the tool JSON schema. |
| `agent/memory_provider.py` | Abstract base class `MemoryProvider` (the provider contract). |
| `agent/memory_manager.py` | `MemoryManager` — orchestrates the builtin store + at most one external provider; fan-out of prefetch/sync/write-mirror; context-fencing scrubber. |
| `agent/system_prompt.py` (~426–444, 496–504) | Injects the frozen memory/user snapshot into the system prompt. |
| `agent/agent_init.py` (~1326–1360) | Wires `MemoryStore` + `MemoryManager` onto the agent from config. |
| `agent/background_review.py` | The post-turn "should I save a memory?" review fork + its prompts. |
| `agent/turn_context.py` (~306–314) | Turn-based memory-nudge trigger. |
| `hermes_constants.py` (`get_hermes_home`) | Resolves the on-disk root (profile scoping). |
| `plugins/memory/<name>/` | 9 external provider plugins (honcho, mem0, hindsight, holographic, retaindb, byterover, supermemory, openviking, memori). |

### Files maintained on disk
Under `~/.hermes/memories/` (profile-scoped):
- **`MEMORY.md`** — agent's personal notes (environment facts, conventions, tool quirks, lessons). Limit **2,200 chars** (~800 tokens).
- **`USER.md`** — user profile (identity, preferences, communication style). Limit **1,375 chars** (~500 tokens).
- Transient: `*.lock` (file locks), `.mem_*.tmp` (atomic write temp), `MEMORY.md.bak.<ts>` (drift backups).

### Exact on-disk format
No template/frontmatter. Flat list of entries joined by a delimiter:

```python
ENTRY_DELIMITER = "\n§\n"
```

```
User's project is a Rust web service at ~/code/myapi using Axum + SQLx
§
This machine runs Ubuntu 22.04, has Docker and Podman installed
§
User prefers concise responses, dislikes verbose explanations
```

Entries may be multiline; splitting is on the full `\n§\n`.

### Exact system-prompt render format (`MemoryStore._render_block`)

```
══════════════════════════════════════════════   (46 × U+2550 '═')
MEMORY (your personal notes) [67% — 1,474/2,200 chars]
══════════════════════════════════════════════
<entry>
§
<entry>
```
User store header: `USER PROFILE (who the user is) [<pct>% — <n>/<limit> chars]`.
Percentage/char counts are deliberately included so the model knows remaining capacity.

## 2. Memory providers

A provider is a pluggable backend implementing the `MemoryProvider` ABC. The
built-in file store is the always-on provider; at most **one external**
provider runs alongside (enforced in `MemoryManager.add_provider`).

Contract — abstract: `name`, `is_available()`, `initialize(session_id, **kwargs)`,
`get_tool_schemas()`. Lifecycle: `system_prompt_block()`, `prefetch(query, session_id)`,
`queue_prefetch`, `sync_turn(user, assistant, session_id, messages)`,
`handle_tool_call(tool_name, args)`, `shutdown()`. Optional hooks:
`on_turn_start`, `on_session_end`, `on_session_switch`, `on_pre_compress`,
`on_delegation`, `on_memory_write(action, target, content, metadata)` (mirror
built-in writes), `get_config_schema()`, `save_config`, `backup_paths()`.
`initialize()` receives `hermes_home`, `platform`, optionally `agent_identity`,
`agent_workspace`, `user_id`.

Selection: `memory.provider: <name>` in `~/.hermes/config.yaml`; CLI
`hermes memory setup/status/off`. Provider fan-out is fail-soft; sync/prefetch
run on a single serialized background worker.

## 3. Write path

Two triggers:

### (a) Foreground — model calls the `memory` tool mid-turn
Driven by the tool schema description + a nudge every `memory.nudge_interval`
user turns (default 10). Tool schema description (reuse verbatim):

> Save durable facts to persistent memory that survive across sessions. Memory is injected into every future turn, so keep entries compact and high-signal.
>
> HOW: make ALL your changes in ONE call via an 'operations' array (each item: {action, content?, old_text?}). The batch applies atomically and the char limit is checked only on the FINAL result — so a single call can remove/replace stale entries to free room AND add new ones, even when an add alone would overflow. …
>
> WHEN: save proactively when the user states a preference, correction, or personal detail, or you learn a stable fact about their environment, conventions, or workflow. Priority: user preferences & corrections > environment facts > procedures. The best memory stops the user repeating themselves.
>
> IF FULL: an add is rejected with the current entries shown. Reissue as ONE batch that removes or shortens enough stale entries and adds the new one together.
>
> TARGETS: 'user' = who the user is (name, role, preferences, style). 'memory' = your notes (environment, conventions, tool quirks, lessons).
>
> SKIP: trivial/obvious info, easily re-discovered facts, raw data dumps, task progress, completed-work logs, temporary TODO state (use session_search for those). Reusable procedures belong in a skill, not memory.

### (b) Background self-improvement review (`background_review.py`)
After a turn (or on nudge), fork the agent (cheap model ok, tools limited to
`memory`) and run `_MEMORY_REVIEW_PROMPT` (verbatim):

> Review the conversation above and consider saving to memory if appropriate.
>
> Focus on:
> 1. Has the user revealed things about themselves — their persona, desires, preferences, or personal details worth remembering?
> 2. Has the user expressed expectations about how you should behave, their work style, or ways they want you to operate?
>
> If something stands out, save it using the memory tool. If nothing is worth saving, just say 'Nothing to save.' and stop.

`_COMBINED_REVIEW_PROMPT` adds: memory = "who the user is + current state",
skills = "how to do this class of task", plus a **Do NOT capture** list:
environment-dependent failures, negative claims about tools, transient errors,
one-off task narratives.

### Deterministic semantics (`MemoryStore`)
- **add**: append-only; rejects empty; rejects exact duplicates (success,
  "no duplicate added"); over-limit returns structured error listing
  `current_entries` + instruction to consolidate-and-retry same turn.
- **replace**: `old_text` = short unique substring; >1 distinct match → error
  "be more specific"; budget re-checked.
- **remove**: same substring matching.
- **batch** (`operations[]`): all-or-nothing; budget validated on FINAL state.
- **Approval gate** (`memory.write_approval`): staged under `pending/` for
  approve/reject when on.
- **Security scan**: writes scanned for prompt-injection/invisible-unicode
  (`tools/threat_patterns.py`, scope strict); poisoned entries become
  `[BLOCKED: …]` placeholders at load.
- **Drift guard**: if disk content wouldn't round-trip the parser, refuse
  replace/remove/batch and snapshot to `.bak.<ts>` (add still allowed).
- **Consolidation-failure cap**: 3 failed at-capacity attempts per turn →
  terminal "stop retrying" result.
- Writes atomic (temp + fsync + rename) under `.lock` (fcntl/msvcrt).

## 4. Read / recall path

Built-in store is injected wholesale — no search/embedding. Frozen snapshot
captured once at session start, injected in system prompt; mid-session writes
hit disk but the prompt stays byte-stable (prefix-cache friendly). Rebuilt
only on context compression. No `read` action on the tool. The tight caps
(2,200/1,375) are what make wholesale injection viable.

External providers add real recall (`prefetch` before turn), wrapped:

> `<memory-context>`
> `[System note: The following is recalled memory context, NOT new user input. Treat as authoritative reference data — this is the agent's persistent memory and should inform all responses.]`
> …
> `</memory-context>`

A `StreamingContextScrubber` strips these fences from user-visible output.
Large-scale recall is a separate `session_search` tool (SQLite FTS5 over all
sessions, `~/.hermes/state.db`).

## 5. USER.md

`target="user"` store: name/role/timezone, communication preferences, pet
peeves, workflow habits, skill level. Same tool/semantics, own 1,375 cap and
`USER PROFILE (who the user is)` header. Gated by `user_profile_enabled`;
when on it is always injected even if MEMORY.md is off.

## 6. Scoping

Root: `HERMES_HOME` env → active profile → platform default (`~/.hermes`
POSIX, `%LOCALAPPDATA%\hermes` Windows). Memory dir = `<home>/memories`.
**Per-profile, global across projects.** Hermes "profile" ≈ ADE "agent" —
give each ADE agent its own home dir.

## 7. Porting plan for ADE (TypeScript / Electron)

### Per-agent file set
```
<adeDataDir>/agents/<agentId>/memory/
  MEMORY.md          # entries joined by "\n§\n", cap 2200
  USER.md            # cap 1375
  *.lock, *.bak.<ts>
```

### Modules
1. **`MemoryStore.ts`** — port: delimiter parse, order-preserving dedup,
   add/replace/remove/batch with substring matching + final-budget check,
   atomic write (temp+rename, `proper-lockfile`), drift guard
   (`raw.trim() !== parsed.join(delim)` or entry > limit → `.bak` + refuse
   destructive ops), `renderBlock()` with the `═×46` headers,
   `loadSnapshot()` frozen at session start.
2. **`memoryTool.ts`** — one `memory` tool with the schema description above,
   actions add/replace/remove + `operations[]`, returns
   `{success, usage, entry_count, note}`.
3. **`review.ts`** — every N turns (default 10) or at session end, cheap LLM
   call with `_MEMORY_REVIEW_PROMPT` over the transcript, with the memory tool.

### Wiring so Claude Code / Codex actually read+write (the crux)
**A. Read**: Claude Code auto-reads `CLAUDE.md`; Codex reads `AGENTS.md`.
On each session launch ADE regenerates a managed block in that file:

```md
<!-- ADE:MEMORY:start -->
══════…══════
MEMORY (your personal notes) [67% — 1474/2200 chars]
══════…══════
...entries...

══════…══════
USER PROFILE (who the user is) [40% — 550/1375 chars]
══════…══════
...
<!-- ADE:MEMORY:end -->
```
(Claude Code alternatively supports `@path` includes; inlining the rendered
block keeps the capacity-awareness the prompts rely on.) Regenerate once per
session start (frozen snapshot).

**B. Write**: expose the `memory` tool over an **MCP server** ADE runs and
registers per agent (`claude mcp add` / Codex MCP config). Handler routes to
the right agent's `MemoryStore` (enforces caps/dedup/scan). Also add the
WHEN/SKIP text to CLAUDE.md/AGENTS.md.

**C. Background review**: when a session ends (ADE owns the process), run
`review.ts` over the transcript with the same MCP memory tool.

### Config knobs
```yaml
memory_enabled: true
user_profile_enabled: true
memory_char_limit: 2200
user_char_limit: 1375
nudge_interval: 10
write_approval: false   # true => stage to <dir>/pending/, approve via UI
```

### Skip initially
External provider plugins (extension point: keep a `MemoryProvider` TS
interface), FTS5 session search (v2, better-sqlite3).
