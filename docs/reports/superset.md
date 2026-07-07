# Superset Repo Analysis — Reuse Assessment for ADE

Source: Explore-agent report over `reference/superset` (2026-07-07).

## Orientation

- Bun (`bun@1.3.11`) + Turborepo monorepo; workspaces `packages/*`, `apps/*`.
- 10 apps, 21 packages. `apps/desktop` is the client; `apps/api`,
  `electric-proxy`, `streams`, `relay`, `web`, `mobile` are cloud surface.
- The desktop app contains **two parallel generations** mid-migration:
  v1 (`src/renderer/screens/main/**`, terminal via electron-trpc IPC →
  main-process `DaemonTerminalManager` → `terminal-host` subprocess) and
  v2 (`src/renderer/routes/_authenticated/_dashboard/v2-workspace`, terminal
  via WebSocket → `host-service` Hono subprocess → `pty-daemon`). Both land
  on `pty-daemon` + node-pty.
- macOS-first (SF Mono handler, `macos-process-metrics`, apple-events).

## 1. Desktop stack

Electron 40.8.5 · electron-vite 4 + Vite 7 · React 19 · TanStack Router
(file-based, hash) · Zustand (92 store files) + TanStack DB/Query electric
collections · Tailwind v4 + shadcn-style `@superset/ui` · IPC = tRPC over
`trpc-electron` (~150 router files in `src/lib/trpc/routers/**`).
Entries: `src/main/index.ts`, `src/main/windows/main.ts`, `src/preload/index.ts`.

## 2. Terminal core

xterm.js (`@xterm/xterm` 6.1-beta + fit, webgl, search, serialize, unicode11,
ligatures, clipboard, image, progress addons).

Key renderer files (the reusable heart):
- `src/renderer/lib/terminal/terminal-runtime.ts` — creates the Terminal, wires addons
- `src/renderer/lib/terminal/terminal-addons.ts`
- `src/renderer/lib/terminal/write-coalescer.ts` — batches PTY output to one
  `xterm.write` per animation frame (agent CLIs spam small chunks)
- `src/renderer/lib/terminal/terminal-ws-transport.ts` (581 lines, v2) —
  binary frames straight into `xterm.write(Uint8Array)`, JSON control msgs
  (`attached`/`error`/`exit`/`title`), auto-reconnect with backoff, sleep/wake
  watchdog, replay suppression.
- v1 pane hooks: `useTerminalConnection`, `useTerminalRestore`,
  `useTerminalStream`, `useTerminalColdRestore`, `useTerminalLifecycle`
  (electron-trpc mutations `terminal.write/resize/detach`).

`packages/pty-daemon` (standalone, imports only node-pty):
- Long-lived process owning PTYs over AF_UNIX socket (0600 = auth boundary)
- Protocol: 4-byte BE length-prefixed framing, JSON header + binary tail
  (`src/protocol/{framing,messages,version,handoff}.ts`)
- `src/SessionStore/` — in-memory map + **64 KB ring buffer per session** +
  snapshot persistence; `subscribe` supports scrollback replay
- fd-handoff so sessions survive daemon upgrades

Scrollback: survives tab switches (detach keeps session alive, replay on
re-attach) and app restart (`reconcileDaemonSessions()`, history manager
`src/main/lib/terminal/daemon/history-manager.ts`).

**Windows caveat (decisive for ADE):** the daemon is effectively POSIX-only —
`Pty.ts` uses node-pty's private master `_fd` for handoff and resizes by
spawning `stty` against that fd. ConPTY exposes no fd. node-pty itself
supports ConPTY; Superset's daemon does not exercise it.

## 3. Agent launching

`packages/shared/src/builtin-terminal-agents.ts` — read verbatim:

| Agent | Command |
|---|---|
| claude | `claude --dangerously-skip-permissions` |
| codex | `codex --dangerously-bypass-approvals-and-sandbox` (prompt: `… --`) |
| gemini | `gemini --approval-mode=auto_edit` |
| copilot | `copilot --allow-tool=write` (prompt: `-i`) |
| amp | `amp` (stdin transport) |
| opencode | `opencode` (prompt: `--prompt`) |
| mastracode / pi / cursor-agent / droid | plain command |
| polygraph | `polygraph session start` |

Related: `packages/shared/src/agent-command.ts` (heredoc prompt injection
`$(cat <<'SUPERSET_PROMPT_…')`), `src/renderer/lib/agent-launch-command.ts` +
`argv.ts` (env-prefix + shell-quote aware preset parsing), default preset
seeding in `useDefaultV2TerminalPresets/`, per-agent host setup (wrappers,
hooks, settings.json injection for approval-event notifications) in
`src/main/lib/agent-setup/**`. Permission-mode picker (chat side):
`default | acceptEdits | bypassPermissions`.
Auto-launch: preset `executionMode: "new-tab"` runs `commands` in fresh PTY.

## 4. Workspaces & worktrees

- Model: `packages/local-db/src/schema/schema.ts` (Drizzle + SQLite):
  `projects`, `worktrees`, `workspaces`, `workspaceSections`, `settings`, …
- Worktree lifecycle: `src/lib/trpc/routers/workspaces/utils/{worktree,git}.ts`
  (simple-git, `git worktree add/list --porcelain`, hook-tolerant wrappers)
- Diff engine: `src/lib/trpc/routers/changes/**` (`git-operations.ts`,
  `status.ts`, `staging.ts`, numstat parsing, git worker pool) — no network
- Diff UI: v1 `ChangesContent/` (simpler, self-contained) or v2 `DiffPane`
  (needs `@pierre/diffs` worker infra)
- `packages/workspace-fs` — file listing/search/watch (fuzzy scorer,
  @parcel/watcher), mostly standalone

## 5. Theming

`src/shared/themes/**` (built-ins `ember`, `light`, `monokai`) + renderer
store. **xterm is fully themed**: `src/renderer/stores/theme/utils/terminal-theme.ts`
→ `toXtermTheme(colors)` maps theme `TerminalColors` to xterm `ITheme`
(bg/fg/cursor/selection + 16 ANSI colors). New PTYs inherit theme via
`useCreateOrAttachWithTheme`.

## 6. Coupling

Local/decoupled: `pty-daemon`, `local-db`, `src/main/lib/workspace-runtime/`
(`LocalWorkspaceRuntime` is the only impl), v1 terminal path, changes/ diff
engine. Hard-wired to cloud: `_authenticated/layout.tsx` better-auth gate
(bypass only via `SKIP_ENV_VALIDATION` dev hatch), host-service spawn wants
`{authToken, cloudApiUrl}` + relay tunnel, electric collections sync through
their backend, Stripe/Paywall/Sentry/PostHog in the entry path. No
first-class local-only mode.

## 7. Onboarding

`src/renderer/routes/_authenticated/onboarding/` (StepShell, provider connect,
GhAuthTerminal — runs `gh auth` inside xterm), `NewWorkspaceModal/`,
`InitGitDialog.tsx`.

## 8. Recommendation: rebuild fresh, copy specific files (option c)

- (a) fork-and-strip: drags the whole repo (two terminal generations, auth,
  electric, relay, paywall woven through the entry path) — months of removal.
- (b) extract apps/desktop: ~4–5k files, inherits migration debt + cloud
  assumptions.
- (c) fresh shell + copy load-bearing files: **~30–60 files + optionally
  pty-daemon (~30 files) and panes (~40 files)**.

Copy verbatim (highest value / lowest coupling):
1. `packages/pty-daemon/` — POSIX only; on Windows use its *patterns*
   (ring buffer, replay, detach) on plain node-pty/ConPTY instead
2. `terminal-ws-transport.ts` or v1 connection hooks — xterm↔PTY glue
3. `write-coalescer.ts` + `terminal-runtime.ts` + `terminal-addons.ts`
4. `terminal-theme.ts` + `src/shared/themes/**`
5. `src/lib/trpc/routers/changes/**` — git diff/status engine
6. `workspaces/utils/{worktree,git}.ts` — worktree lifecycle
7. `builtin-terminal-agents.ts` + `agent-command.ts` + `agent-launch-command.ts`/`argv.ts`
8. `packages/panes/` — optional tiling model

Build fresh: Electron main entry + window/preload, auth-free routing, left
rail UI, local-only terminal manager wiring.
