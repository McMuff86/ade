# ADE — Agentic Development Environment · Product Spec

Status: v0.4 (persisted run/task control plane, 2026-07-10)
Owner: Adi. This document is the source of truth for coding agents.

## What it is

One desktop app where all of the user's CLI agents live — for coding, writing
and content work. The terminal is the execution plane: every interactive
session is a real terminal running a real CLI agent. Graph is the optional
control plane for dispatching and observing bounded task runs over those same
agents. It is not a separate fake-agent system or a replacement chat UI.

References:
- Layout sketch: `mock/PENUP_20260707_214207.png`
- Approved clickable mockup: `mockup/index.html` (visual reference for
  layout, spacing, copper accent)
- Superset (`reference/superset`, Elastic 2.0) — architecture donor
- Hermes (`reference/hermes-agent`, MIT) — memory system donor
- Conductor screenshots (`mock/Screenshot1.png`, `Screenshot2.png`) — tab feel,
  explicitly WITHOUT macOS traffic-light styling

## Core model

- **Category** — top-level group (a YouTube channel, a repo, a book).
  Has: name, profile photo. Optionally backed by a git repo.
- **Agent** — lives under a category. Has: name, profile photo, runtime
  (which CLI it runs), permission mode, its own workspace directory
  (a git worktree when the category is a repo), its own skills, and its own
  Hermes-style memory (`MEMORY.md`, `USER.md`, providers).
  An agent ≈ Superset's "workspace", but named and with an identity.
- **Session** — a terminal window of one agent. Selecting an agent shows its
  sessions as tabs across the top. Multiple sessions of the same agent run
  in parallel. Sessions are NOT split by model — one agent, N terminals.
- **Run** — a persisted execution of one user goal. It references existing
  agents as participants; it does not create permanent agent identities.
- **Task** — one run-scoped unit of work assigned to a participant, with real
  queued/running/completed/failed/cancelled state and an event history.
- **Participant role** — orchestrator/lead/worker is scoped to a run. The same
  named agent may play a different role in a different run.

Graph assigns participants and roles per run. Older Graph-created categories
and agent `teamRole` fields are imported once as a legacy run and retained so
the migration never deletes user data.

## Layout (per approved mockup)

- Left rail, two levels: category tiles (square-ish avatar + name), agent rows
  underneath (round avatar + name + role + presence dot when a session runs).
- Top: session tabs of the selected agent. `+` opens a session, `×` closes.
- Center: the terminal.
- Right: collapsible panel with **Files** (agent files incl. MEMORY.md/USER.md,
  and an all-files tree of the workspace) and **Changes** (real git diff).
- All three regions resizable via drag handles (rail width, panel width).
- Top-level Terminals / Graph tabs switch views without creating a second copy
  of agent, workspace, session, or task state.

## Graph control plane

- Task dispatch is explicit and cancellable. One-shot task sessions use a
  runtime's non-interactive transport and exit when the CLI finishes.
- A global scheduler caps active task CLIs; queued work and the cap are visible.
- UI state must come from real queue/process/run events. Timers may animate an
  event but must never invent working or completion state.
- Runs, tasks, participants, events, and artifacts survive renderer reloads and
  app restarts. Interrupted tasks must resolve to a terminal failure state.
- Fan-out must state the process count before launch. Worker-specific planning,
  communication, verification and integration are required before Graph is
  described as orchestration rather than dispatch.

## Feedback-driven requirements (2026-07-07, binding)

1. **Resizable** rail and right panel (drag to resize, persisted).
2. **No emojis anywhere** in the UI. Identity = profile photos.
3. **Uploadable profile photo** per category and per agent (PNG/JPG, alpha
   respected). Fallback: initials avatar. Stored in app data.
4. **Remove superfluous chrome**: no Open/Run buttons, no model picker,
   no worktree path in a status bar, no setup buttons. Sessions are just
   terminal windows you pull open.
5. **Real CLI layer**: the terminal is a true PTY wrapper that launches the
   agent CLIs. No fake chat layer.
6. **Supported runtimes** (launch profiles): Claude Code, Codex, OpenCode,
   Grok Build, Ollama (open-source models), plain shell. Extensible list.
7. **Permission modes** per agent (translated to the right flag per CLI):
   - Claude Code: default / `--permission-mode acceptEdits` /
     `--dangerously-skip-permissions`
   - Codex: default / `--full-auto` / `--dangerously-bypass-approvals-and-sandbox`
   - OpenCode / Grok Build: their equivalents; plain shell: none.
8. **Light mode must theme the terminal too** — the xterm theme (background,
   foreground, ANSI palette, cursor) switches with the app theme, not only
   the surrounding chrome.
9. Copper accent stays. **Later (not now, no rush): custom background per
   theme — gradients or user PNG with alpha.** Architect for it (background
   layer behind the terminal/UI as a first-class token), do not build UI yet.

## Memory (Hermes-style, per agent)

Each agent gets at creation: `memory/MEMORY.md` (index), `memory/USER.md`
(user profile), providers as designed in the Hermes analysis report. Wired so
the CLI agent actually reads/writes it (CLAUDE.md / AGENTS.md include or
equivalent injection per runtime).

## Onboarding

First run: create a category (name + photo) → add agents (name + photo +
runtime + permission mode) → rails and tabs build themselves. Same flow
reachable later via "+ New category" / "+ Add agent". One-command install.

## Non-goals (v1)

- No cloud sync, no accounts, no mobile.
- No model picker inside a session.
- No built-in chat UI separate from the terminal.
- Custom background images/gradients: architecture only, no UI.

## Quality bar

- Windows first (dev machine is Win11; ConPTY), keep macOS/Linux compatible.
- Terminal scrollback survives tab switches; sessions survive app reload
  where the PTY layer allows it.
- Closing a tab or deleting its owner leaves no inaccessible PTY. Exited
  sessions have bounded retention.
- Keyboard: visible focus, tab switching shortcuts.
- Theme: light + dark, both first-class incl. terminal.
