# ADE — Agentic Development Environment · Product Spec

Status: v0.13 (desktop Git sync, mobile pairing/PWA, private Tailscale setup and
close-to-tray implemented; physical-device acceptance tracked separately, 2026-09-08)
Owner: Adi. This document is the source of truth for coding agents.

Desktop Git workflow: Graph and the repository inspector expose **Git-Abgleich**;
New Run exposes the same preflight panel. The user chooses a local/origin basis,
compares each worktree, explicitly fetches remote state and confirms one exact
fast-forward at a time. Uncommitted files, own commits, active sessions/leases
and unfinished Git operations block target updates. A local refresh never means
the server was checked. New worktrees still use main HEAD and managed runs use
orchestrator HEAD. Full boundary and mobile follow-up: `REPOSITORY_SYNC_PLAN.md`.

## What it is

One desktop app where all of the user's CLI agents live — for coding, writing
and content work. The terminal is the execution plane: every interactive
session is a real terminal running a real CLI agent. Graph is the optional
control plane for dispatching and observing bounded task runs over those same
agents. It is not a separate fake-agent system or a replacement chat UI.

Overview is the read-only home over that same journal: who is live, which
catalog projects exist, and which runs last moved. It does not invent
telemetry or replace Terminals or Graph.

The desktop remains the only execution host. After local product validation,
an installable mobile companion may submit, observe and cancel a narrow set of
bounded single- and multi-agent operations through that host. It is a remote
control plane, not a mobile terminal, cloud copy of ADE or second agent runtime.

References:
- Layout sketch: `mock/PENUP_20260707_214207.png`
- Approved clickable mockup: `mockup/index.html` (visual reference for
  layout, spacing, copper accent)
- Superset (`reference/superset`, Elastic 2.0) — architecture donor
- Hermes (`reference/hermes-agent`, MIT) — memory system donor
- Conductor screenshots (`mock/Screenshot1.png`, `Screenshot2.png`) — tab feel,
  explicitly WITHOUT macOS traffic-light styling

## Core model

- **Category** — top-level organizational group (a YouTube channel, a repo, a
  book). Has: name and profile photo. It may suggest a default repository for
  onboarding, but it does not own an agent's workspace.
- **Repository** — a first-class catalog entry for one local
  Git repository. The same repository may scope many agents, sessions and runs.
- **Agent** — lives under a category. Has: name, profile photo, runtime
  (which CLI it runs), permission mode, optional default repository, a plain
  home workspace, its own skills, and its own Hermes-style global memory
  (`MEMORY.md`, `USER.md`, providers).
  An agent is an identity, not a repository workspace; its workspace bindings
  supply execution scope.
- **Workspace binding** — one agent plus one repository plus
  one ADE-managed worktree/branch. Bindings are independent per repository and
  may be reused by later non-conflicting executions.
- **Agent template** — immutable spawn defaults and a memory
  seed. Spawning creates a new agent identity, memory directory and optional
  default repository; a template owns no process or mutable workspace.
- **Session** — a terminal window of one agent. Selecting an agent shows its
  sessions as tabs across the top. Multiple sessions of the same agent run
  in parallel. Each session snapshots an immutable repository/workspace scope;
  selecting a different repo opens a new session instead of changing a live
  PTY's working directory. Sessions are NOT split by model — one agent, N
  terminals.
- **Run** — a persisted execution of one user goal. It references existing
  agents as participants and selects an explicit repository scope when Git
  work is required; it does not create permanent agent identities.
- **Task** — one run-scoped unit of work assigned to a participant, with real
  queued/running/completed/failed/cancelled state and an event history.
- **Publication** — a durable audit record for an explicitly confirmed export
  of one attested managed-run HEAD to a new `ade/**` branch and GitHub Draft
  Pull Request. It is not a merge approval or an agent capability.
- **Participant role** — orchestrator/lead/worker is scoped to a run. The same
  named agent may play a different role in a different run.
- **ADE host** — the logged-in desktop process that owns all
  runtime credentials, PTYs, repositories and orchestration state. It may
  expose a disabled-by-default, loopback-only control API through an explicitly
  configured private ingress.
- **Remote device** — a durable revocable control identity with an OS-encrypted
  secret, desktop name and revocation record. Settings can list, rename and
  revoke imported and QR-paired identities. Pairing never
  grants raw terminal, configuration or unrestricted filesystem access.

Graph assigns participants and roles per run. Older Graph-created categories
and agent `teamRole` fields are imported once as a legacy run and retained so
the migration never deletes user data.

## Layout (per approved mockup)

- Left rail, two levels: category tiles (square-ish avatar + name), agent rows
  underneath (round avatar + name + role + presence dot when a session runs).
- Top: session tabs of the selected agent. `+` opens a session, `×` closes.
- Center: the terminal.
- Right: collapsible panel with **Overview**, **Changes** and **Files**. Overview
  inspects the repository selected in the scope header: local health, recent
  commits, on-demand commit patches and optional open GitHub Pull Requests.
  Changes (real git diff) and Files (agent files plus lazy workspace tree) remain
  bound to the active immutable session workspace. The header names both scopes
  and offers safe choose/default/detach/new-session actions.
- All three regions resizable via drag handles (rail width, panel width).
  The default order is rail | terminal | inspector. Settings may place the
  inspector on the left instead; the choice is optional and persisted. Overview
  and Graph stay full-bleed.
- Top-level Overview / Terminals / Graph tabs switch views without creating a
  second copy of agent, workspace, session, or task state. Overview is a
  full-bleed inventory; Terminals keeps the rail, session tabs and inspector;
  Graph keeps the orchestration canvas. A per-agent OpenClaw Dashboard window
  is a different surface and is not this home view.

## Overview home (implemented)

- Overview is a third top-level mode (`Ctrl+3`; `Ctrl+1` Terminals, `Ctrl+2`
  Graph). It is read-only: no spawn, no run start, no inspector Git poll.
- The projection is `overview:get` over the persisted catalog, workspace
  bindings, run journal and the live PTY list. It never includes host paths,
  prompts, mailbox bodies or diagnostics.
- Three hero numbers: **Live** (running PTYs), **Offen** (runs with status
  `running` or phase `approval`), **Tokens** (sum of reported input+output;
  `—` when no managed task reported tokens). Cost is a caption with an
  explicit unknown-task count; missing telemetry is never filled with zero.
- Agent rows follow category membership then leftovers. An agent's
  `lastActivityAt` is the max of its last run `updatedAt`, any binding
  `lastUsedAt`, and interactive session bookends; a run name is extra context,
  never the only clock. Project cards are catalog repositories only —
  portable homes do not appear.
- Work is the 20 newest **closed** interactive sessions and runs. Live
  sessions stay in the Live figure, not in Work. Session rows have no token
  rollup. Task PTYs are not booked here; they already live in the run journal.
- Clicks leave Overview: an agent or project opens Terminals; a run opens
  Graph on that run; a session opens Terminals on that agent (and that tab
  if the PTY is still live). Refresh is event-driven (`orchestration:changed`,
  `pty:exit`, `pty:removed`), not a timer.

## Graph control plane

- Task dispatch is explicit and cancellable. One-shot task sessions use a
  runtime's non-interactive transport and exit when the CLI finishes.
- A global scheduler caps active task CLIs; queued work and the cap are visible.
- UI state must come from real queue/process/run events. Timers may animate an
  event but must never invent working or completion state.
- Runs, tasks, participants, events, and artifacts survive renderer reloads and
  app restarts. Interrupted tasks must resolve to a terminal failure state.
- Selecting a failed run must reveal its persisted actionable error directly
  and accessibly; a generic red status without the task/journal reason is not a
  sufficient recovery state.
- Fan-out must state the process count before launch. Worker-specific planning,
  communication, verification and integration are required before Graph is
  described as orchestration rather than dispatch.
- Desktop IPC and remote commands must enter through one transport-neutral
  application boundary. A remote endpoint must never proxy arbitrary Electron
  IPC channels.
- Retried remote mutations must be idempotent, and remotely observed state must
  come from resumable authoritative events rather than client timers or local
  optimistic completion.
- Repo-backed managed runs select one repository at run level. Every participant
  receives an exclusive agent/repository binding in that repository; one run
  does not transactionally integrate across multiple repositories.
- A successful final verifier atomically attests the exact repository HEAD,
  verification task and time with run completion. Older or plain-workspace
  runs do not gain publication eligibility by inference.
- External publication is a separate local-desktop action after completion. A
  read-only preview and a second explicit confirmation may create only a new
  ADE-owned branch plus a Draft Pull Request. ADE never directly pushes or
  merges the repository default branch.
- Publishing must re-prove clean/same verified HEAD, repository identity,
  unchanged remote base, a collision-free generated ref, provider access and
  exact Draft-PR base/head/head-SHA. Request, success, interruption and failure
  remain durable audit state.

## Repository scopes and reusable agents (implemented Goal 5)

- Repository choice and agent identity are independent. A specialized agent
  may have one default repository; a portable agent has none and receives an
  explicit scope per new session, task or run.
- Scope resolution is explicit request → optional agent default → plain home
  workspace. The result is snapshotted and cannot be redirected by later
  default changes.
- Files/Changes always resolves through the selected session/task/run binding,
  never through a mutable global agent path.
- Choosing another repository while a terminal is live creates a new session.
  Clearing or changing a default never kills a process or deletes/moves files,
  worktrees or branches.
- An agent/repository pair has its own binding/worktree. Active managed runs
  lease bindings exclusively under the current Goal 4 safety rules.
- Portable-agent memory is explicitly global. Repository-specific context comes
  from the selected worktree and a reserved binding-local memory boundary; ADE
  does not silently promote repository content into global agent memory.
- Existing category `repoPath` values and workspaces migrate once into
  repository/default/binding records without deleting legacy data.
- The right-panel scope header shows repository, resolution source, branch,
  shortened worktree path, clean/dirty state and active lease. Repository and
  filesystem IPC resolves the selected session snapshot in main.
- The default Overview tab inspects the selected catalog repository without
  retargeting the active session. It shows at most 12 local commits and 20 open
  GitHub PRs; a full-SHA commit patch is loaded only on demand and is capped.
  GitHub failure is an independent state and cannot hide local repository data.
  The inspector performs no fetch, checkout, branch/PR mutation or push.
- Inspector IPC accepts catalog IDs and exact commit object IDs, never renderer-
  supplied paths or commands. Main revalidates repository identity and routes
  Git/`gh` through the repository's persisted native or WSL backend.
- Agent settings can save an immutable template seed. New-agent onboarding can
  spawn that template into an independent identity and optionally bind it to a
  selected repository.

Detailed model, UI behavior, migration and exit criteria are binding in
`docs/REPOSITORY_SCOPES_PLAN.md` and `docs/ROADMAP.md`.

## Mobile companion (personal alpha implementation)

- The first client is a responsive installable PWA for iOS and Android. A
  native mobile package is justified only by validated platform gaps.
- The personal alpha uses Tailscale Serve over a private tailnet. ADE listens
  on loopback only; direct LAN/public binds, router port forwarding and
  Tailscale Funnel are unsupported.
- The desktop must be powered on, logged in, online and running the ADE host.
  The mobile client must show offline/stale state clearly and may not queue a
  command for implicit execution after connectivity returns.
- A paired phone may inspect host readiness and a sanitized catalog, choose
  repository and agent independently, submit a bounded single-agent task,
  create/start/cancel a managed run, and observe task/run status and approval
  requirements. Detailed results and approval decisions remain on the desktop.
- Interactive PTY access, arbitrary commands, permission/configuration changes,
  deletion, absolute paths and unrestricted file reads are excluded from the
  personal alpha.
- Integration approval is a later privileged capability. It requires exact
  review evidence, recent passkey/device reauthentication, a single-use
  transition and a durable audit record.
- Every device has a distinct identity that can be listed and revoked from the
  desktop. Tailscale is an outer access boundary, not a replacement for ADE's
  endpoint authorization.
- Implemented desktop slice: Settings → Verbundene Geräte persists names and
  revocations, closes the revoked device's HTTP/SSE connections immediately and
  records device changes and remote requests in a bounded durable audit. Already
  accepted tasks continue and can be cancelled separately. Desktop Settings
  creates five-minute single-use QR/manual challenges. Browser identity keys
  are non-exportable WebCrypto keys in IndexedDB; reads/commands require signed
  proof plus a Secure HttpOnly Strict 30-minute cookie, with exact Origin and
  CSRF on mutations. The listener remains disabled by default and loopback-only.
- Settings enables/rechecks/disables the native host's private Tailscale Serve
  route and distinguishes configuration from HTTPS reachability verified with
  normal certificate validation. Initial certificate provisioning can take time.
  Unrelated routes are preserved. Unsafe ingress stops the host.
  Closing the window with mobile access enabled keeps ADE in the tray; explicit
  quit ends the host. Login autostart and remote wake remain future work.
- Implementation and platform evidence are in `goal8/MOBILE_CONNECT_RESULTS.md`;
  physical iOS/Android and mobile-network acceptance must be measured separately.
- Goals 8.6–8.9 align the mobile shell with the desktop: shared dark/light tokens,
  `ade_` title bar, Overview/Work/Graph navigation, agent/project inventory,
  searchable runs, team nodes and a tablet side inspector or phone detail dialog.
  New task/run dialogs preserve unsent drafts across view/theme changes. One
  connection remains mounted across views; localStorage holds appearance/view
  preferences only. No new remote endpoint or privilege is introduced.
  The prior host keeps serving its loaded UI until the user's next normal restart.
  Acceptance: `goal8/MOBILE_DESKTOP_PARITY_RESULTS.md`.
- The service worker caches only the versioned application shell. Credentials,
  API responses, patches and run details are not intentionally available
  offline.

The complete scope, trust boundaries and sequenced delivery plan are binding in
`docs/REMOTE_CONTROL_PLAN.md` and `docs/ROADMAP.md`.

Verified Draft-PR publishing remains local to the trusted desktop renderer/main
boundary and is deliberately absent from the planned remote API. Its provider,
Git and recovery contract is binding in `docs/VERIFIED_PUBLISHING_PLAN.md`.

## Feedback-driven requirements (2026-07-07, binding)

1. **Resizable** rail and right panel (drag to resize, persisted).
2. **No emojis anywhere** in the UI. Identity = profile photos.
3. **Uploadable profile photo** per category and per agent (PNG/JPG, alpha
   respected). Fallback: initials avatar. Stored in app data.
4. **Remove superfluous chrome**: no Open/Run buttons, no always-visible or
   session-global model picker, no worktree path in a status bar, no setup
   buttons. Sessions are just terminal windows you pull open. An agent's
   advanced settings may persist the exact native runtime model/reasoning
   profile needed for reproducible orchestration; changing it is an identity
   configuration action, not transient terminal chrome.
5. **Real CLI layer**: the terminal is a true PTY wrapper that launches the
   agent CLIs. No fake chat layer.
6. **Supported runtimes** (launch profiles): Claude Code, Codex, OpenCode,
   Grok Build, Ollama (open-source models), plain shell. Extensible list.
7. **Permission modes** per agent (translated to the right flag per CLI):
   - Claude Code: default / `--permission-mode acceptEdits` /
     `--dangerously-skip-permissions`
   - Codex: default / `--sandbox workspace-write` / `--dangerously-bypass-approvals-and-sandbox`
   - Grok Build: default / `--permission-mode acceptEdits` / `--always-approve`
   - OpenCode: their equivalents; plain shell: none.
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

First run: create a category (name + photo) → optionally register/select a
repository → add an agent (name + photo + runtime + permission mode + optional
default repository) → rails and tabs build themselves. Portable agents and
template spawning remain reachable later alongside "+ New category" / "+ Add
agent". One-command install.

## Non-goals (v1)

- No cloud sync, accounts, hosted relay or public ADE endpoint in the personal
  remote alpha.
- No native iOS/Android package in the first mobile milestone.
- No raw remote terminal, remote desktop replacement or general ADE
  administration surface on mobile.
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
- Repository defaults and explicit execution scopes never redirect a live PTY.
  Files/Changes must identify and use the selected execution's actual binding.
- Repository migration, default changes, detach and template spawning are
  non-destructive; no operation silently shares mutable memory/worktrees or
  deletes user files, branches or history.
- Session launch, attach and non-zero exits must be visible and recoverable;
  never strand a main-owned PTY because renderer reconciliation failed.
- CLI/auth diagnostics are read-only and must not execute custom command text
  or expose credential contents.
- Background task completion/failure may notify through the OS; cancellation
  and clean interactive exits should remain quiet.
- Production renderers are sandboxed with a restrictive CSP. Every privileged
  IPC invoke validates both its ADE main-frame sender and runtime payload.
- Remote control is disabled by default, loopback-bound and HTTPS-only behind
  the configured private ingress. Every endpoint validates identity,
  authorization, Origin/Host, content type, size and exact payload shape.
- Remote mutations are rate-limited, idempotent and audit-recorded. Pairing is
  short-lived and single-use; device revocation takes effect for commands and
  event streams without waiting for restart.
- Remote approval requires recent step-up authentication and visible evidence;
  no network, notification or client failure may imply approval or success.
- A publication preview never authorizes mutation. Publication requires a fresh
  explicit desktop confirmation of the exact attested HEAD and generated ref;
  stale base/head state and branch collisions fail closed. Repository CI and a
  human merge remain authoritative.
- Windows beta distribution is an x64 installer; signing is required for a
  trusted release but local verification artifacts may be unsigned.

## Remote workspace administration — operator goals 12–15

Remote ADE administration is opt-in per paired device, granted from Settings
on the host. A permitted device can request an explicit ADE restart; the host
refuses while work or host operations are active and the client confirms the
new authenticated instance after reconnect. Pairing survives. The operation
restarts ADE only and does not install updates or restart Windows.

Goals 13–15 add bounded creation of agents from host-configured settings,
ADE-owned projects and isolated agent workspaces, previewed Git synchronization,
and project/agent filtering with independent in-memory drafts. Acceptance and
current delivery state: `REMOTE_WORKSPACE_GOALS.md`; executable evidence:
`REMOTE_WORKSPACE_RESULTS.md`. These are not arbitrary filesystem/config/shell
access, automatic Git reset/push or the separate Goal 9 approval contract.
