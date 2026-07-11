# Handoff — real worker distribution & agent-to-agent communication

> **Superseded for current behavior (2026-07-10):** this is a historical design
> handoff. Goals 1 and 2 replaced fixed-delay typing and permanent Graph roles
> with bounded task sessions plus persisted runs, participants, tasks, events,
> and artifacts. Mailbox and worker-specific decomposition remain unimplemented;
> design them on `ROADMAP.md` Goal 4. See `STATUS.md` for current behavior.

> **Update 2026-07-09:** Feature 1 shipped in its MVP form (same task fanned out
> to every worker, real sessions, behind a composer toggle + pty-count guard).
> See `docs/HANDOFF-worker-distribution-mvp.md`. Feature 2 (mailboxes) and the
> fuller lead-plans-the-split version below are still open and remain accurate.

Status: draft, 2026-07-09. Written after Graph mode was wired into the app
(see the "Graph mode" implementation: `src/renderer/graph/*`, `stores/mode.ts`,
`Category.kind` / `Agent.teamRole` in `src/shared/types.ts`, and the
`pty:create.initialInput` addition).

This document hands off the two pieces that are **still simulated** in Graph
mode so the next contributor can make them real.

## Where we are now (what's already real)

- **Team = Category** (`kind: 'team'`), **orchestrator = Category** (`kind:
  'orchestrator'`), **lead / worker = Agent** with `teamRole`. Leads and workers
  are real agents, so each already has a scaffolded `MEMORY.md` / `USER.md`
  (`src/main/memory/scaffold.ts`) and gets its memory block injected into
  `CLAUDE.md` / `AGENTS.md` on session launch (`src/main/memory/inject.ts`).
- **Dispatch to a team** (`graphActions.dispatchTeam`) opens a *real* pty
  session for the **lead** and types the task into it (via
  `pty:create.initialInput`, written after a delay in `PtyManager.create`).
- Node status is derived from live sessions (`graph/graphModel.ts`).

**What is NOT real yet:**

1. **Worker distribution.** In `dispatchTeam`, workers only get a transient
   `working → done` status animation (`graphStore.setBusy`). No session is
   created for them and they receive no task. See
   `src/renderer/graph/graphActions.ts` → `dispatchTeam`, the
   `workers.forEach(...)` block with the `setTimeout` calls.
2. **Agent-to-agent communication.** There is no channel for a lead to hand a
   subtask to a worker, and no way for a worker to report a result back to its
   lead (or a lead up to the orchestrator). The report-back arrows in the graph
   are pure animation.

---

## Feature 1 — real worker distribution

**Goal:** when a task is dispatched to a team, the lead decomposes it and each
worker gets its own subtask in its own terminal, then reports back.

### Minimal viable version (no LLM planning)

Fan the *same* task (or a per-worker slice supplied by the user) out to every
worker as a real session, exactly like the lead already gets one.

- In `graphActions.dispatchTeam`, replace the simulated `workers.forEach` block
  with, for each worker: `await useSessions.getState().createSession(worker.id,
  subtaskText)`. This reuses everything the lead path uses (pty spawn, memory
  injection). Keep `setBusy` for the visual, but drive `done` off a real signal
  (see "report-back" below) instead of a fixed timer.
- **Cost guard:** N workers = N PowerShell + N CLI processes. Do NOT fan out
  silently on "Runde verteilen" across every team — that can be dozens of ptys.
  Gate it behind an explicit toggle in the composer ("auch an Worker verteilen")
  and `log`/toast how many sessions will be spawned. Consider a concurrency cap.

### Fuller version (lead plans the split)

The lead agent decides the subtasks. Two ways to get the split back out of the
lead's CLI:

- **File-based (recommended, CLI-agnostic):** define a convention where the lead
  writes a `TASKS.json` (or `.ade/tasks.json`) into its `workspaceDir` — an array
  of `{ worker?: string, task: string }`. The lead's injected instructions
  (extend `buildBlock` in `inject.ts`) tell it to write that file when asked to
  delegate. Main watches the file (chokidar or fs.watch) and emits an event; the
  renderer then spawns one worker session per entry. This needs no per-CLI
  integration and works for Claude/Codex/etc. uniformly.
- **Prompt-only (simplest, least reliable):** just send the whole task to the
  lead and let it spawn nothing; workers stay decorative. Not recommended — it's
  what we have.

### Touch points

- `src/renderer/graph/graphActions.ts` — `dispatchTeam`, and a new
  `dispatchToWorkers(teamId, tasks[])`.
- `src/renderer/graph/GraphView.tsx` — composer gains a "distribute to workers"
  option; wire the toast/warning about pty count.
- `src/main/` — (fuller version) a `TASKS.json` watcher + a new event channel.

---

## Feature 2 — agent-to-agent communication

**Goal:** lead → worker (assign) and worker → lead → orchestrator (report),
persisted and visible, so the hierarchy actually coordinates.

The base app has **no messaging bus** today. Sessions are isolated ptys. Two
viable designs, cheapest first:

### Option A — file-based mailboxes (recommended for v1)

Reuse the memory/workspace file model we already inject.

- Give every agent an **inbox** and **outbox** under its `memoryDir` (next to
  `MEMORY.md`), e.g. `INBOX.md` / `OUTBOX.md`, or a structured
  `mailbox.jsonl` (one message per line: `{ from, to, kind: 'task'|'report',
  text, ts }`).
- Extend the injected instructions (`inject.ts` → `buildBlock`) so each agent
  knows: "read your INBOX for tasks; write results to your OUTBOX; your
  teammates are <lead/worker paths>." Include the absolute paths, like the
  memory block already does for `MEMORY.md`.
- **Routing** lives in main: watch each agent's `OUTBOX` (fs.watch); when a line
  appears addressed to another agent, append it to that agent's `INBOX` and emit
  an event so the graph can animate the real hand-off and update status.
- New shared types: a `Message` shape; new IPC: `mailbox:send`,
  `mailbox:read`, and an event `mailbox:changed`. Add them to
  `src/shared/ipc.ts` (channel + `IpcInvokeMap`/`IpcEventMap`) — preload is
  generic and needs no change.
- The graph's transient `busy` status (`graphStore`) gets driven by real
  mailbox events instead of `setTimeout`.

Why this first: it's CLI-agnostic (any agent that can read/write files
participates), it's inspectable (you can open the mailbox in the existing
Files/Changes panel), and it matches the Hermes file-first philosophy already in
the repo.

### Option B — structured message bus in main

A real in-memory broker in `main` (a `MailboxManager` sibling to `PtyManager`)
holding queues per agent, exposed over IPC, with the renderer orchestrating
delivery. More control (acks, retries, typed payloads) but the agents' CLIs
still can't *read* it without a bridge — so you'd end up injecting the messages
into their ptys anyway. Only worth it if you later add a native ADE tool the
agents call. Defer until Option A's limits bite.

### Delivery into a running CLI

However messages are stored, an agent only "sees" a new task if it's surfaced to
its CLI. Options, in order of robustness:

1. The agent proactively re-reads its `INBOX` (instructed to, and/or on a prompt
   nudge). File-first; works everywhere.
2. Main types a one-line nudge into the target session
   (`PtyManager.write`), e.g. `# new task in INBOX.md`. Reuses the
   `initialInput` mechanism; racy if the CLI is mid-turn.
3. A native ADE MCP tool the agents call to pull/push messages. Cleanest, most
   work; a v2 concern.

### Touch points

- `src/shared/types.ts` — `Message` type; maybe `Agent` gains nothing (mailbox
  is on disk under `memoryDir`).
- `src/shared/ipc.ts` — `mailbox:send` / `mailbox:read` / `mailbox:changed`.
- `src/main/` — new `mailbox/MailboxManager.ts` (+ fs watcher), registration in
  `ipc.ts`, and instruction text in `memory/inject.ts`.
- `src/renderer/graph/graphStore.ts` + `graphActions.ts` — drive `busy` from
  `mailbox:changed`; animate the real edge on delivery (the travel-dot code
  already exists in `mockup/graph-mode.html` as a reference).

---

## Suggested order of work

1. **MV worker distribution** (fan real sessions to workers, behind a composer
   toggle + pty-count guard). Small, high signal — makes the workers "alive".
2. **Mailbox (Option A) storage + IPC + injection** so agents can read/write
   INBOX/OUTBOX. No routing yet — verify a lead can write a subtask file.
3. **Main-side routing + `mailbox:changed` event**; drive graph status from it,
   replacing the `setTimeout`-based `working/done` in `graphActions`.
4. **Lead-plans-the-split** (`TASKS.json` convention) once routing is proven.

## Gotchas / constraints (from building Graph mode)

- **Windows-first ptys are heavy.** Each session is a PowerShell + a CLI. Cap
  concurrency and surface counts; never fan out silently.
- **`pty:create.initialInput` is timing-based** (delay before write) so the CLI
  prompt is ready. A mailbox nudge (Delivery option 2) has the same race — file
  re-read (option 1) is safer.
- **Memory injection runs on every `pty:create`** (`PtyManager.create` →
  `injectMemoryBlock`). If you add INBOX/OUTBOX instructions, put them in the
  managed block in `inject.ts` so they stay inside the `<!-- ADE:MEMORY -->`
  fences and don't clobber user edits.
- **Config vs view state.** Team/agent structure is persisted config; node
  positions and transient status are view-only (`graphStore` + localStorage).
  Keep messages/tasks out of `AdeConfig` — they belong on disk (mailbox) or in
  ephemeral state.
- **Deleting is non-destructive by design** (`identity.ts` deletes config
  entries only, never files). A dissolved team's mailboxes/memory stay on disk.
- **Verifying headlessly:** the renderer can be driven in a browser against an
  in-memory `window.ade` stub — but the stub MUST deep-clone every returned
  value (structured-clone emulation), or it leaks object references and the
  appdata store appears to duplicate agents. (Real Electron IPC clones for you.)
