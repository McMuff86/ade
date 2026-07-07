# ADE — Architecture (binding decisions)

Status: v1, decided 2026-07-07 after the Superset/Hermes analyses
(`docs/reports/superset.md`, `docs/reports/hermes-memory.md`).
Product requirements live in `docs/SPEC.md`. When this doc and SPEC conflict,
SPEC wins.

## Decision: fresh app, Superset patterns copied selectively

We do NOT fork Superset (Elastic-2.0 monorepo with two parallel terminal
generations + cloud/auth woven through the entry path). We build a fresh
Electron app and port the load-bearing pieces:

- xterm setup + write-coalescer + attach/replay patterns
  (`reference/superset/apps/desktop/src/renderer/lib/terminal/*`)
- xterm theming (`…/stores/theme/utils/terminal-theme.ts`, `src/shared/themes/**`)
- git diff/status engine patterns (`…/src/lib/trpc/routers/changes/**`)
- worktree lifecycle (`…/routers/workspaces/utils/{worktree,git}.ts`)
- agent launch commands (`packages/shared/src/builtin-terminal-agents.ts`,
  `agent-command.ts`, renderer `agent-launch-command.ts`/`argv.ts`)
- pty-daemon's session model (ring buffer, detach/replay) — but NOT its
  POSIX-only process (fd-handoff/stty). We are Windows-first: node-pty with
  ConPTY lives in the Electron main process.

Hermes memory design is ported per `docs/reports/hermes-memory.md`.

## Toolchain

- pnpm, TypeScript strict, Electron (latest stable), electron-vite, React 19.
- State: Zustand. Styling: plain CSS with design tokens (custom properties)
  taken from `mockup/index.html` — no Tailwind.
- Panels: `react-resizable-panels` (rail / center / right panel).
- Terminal: `@xterm/xterm` + `@xterm/addon-fit` (+ unicode11; webgl optional
  behind a capability check).
- Git: `simple-git`. Config persistence: hand-rolled atomic JSON store in
  `app.getPath('userData')`.
- Icons: text glyphs or lucide-react sparingly. No emojis anywhere (SPEC).

## Repo layout (this repo, root = the app)

```
package.json               # the app; one-command: pnpm i && pnpm dev
electron.vite.config.ts
src/
  main/                    # Electron main
    index.ts               # window, app lifecycle (small; no updater/cloud)
    ipc.ts                 # channel registration
    pty/PtyManager.ts      # node-pty sessions, ring buffers, launch profiles
    git/                   # status/diff/worktree (simple-git)
    config/store.ts        # categories/agents/sessions/settings JSON
    memory/                # MemoryStore.ts port + managed-block injection
    photos.ts              # profile photo import/store (PNG/JPG, alpha kept)
  preload/index.ts         # contextBridge: typed invoke/on wrappers only
  renderer/
    App.tsx                # layout shell (rail | tabs+terminal | right panel)
    theme/                 # tokens.css, themes.ts (incl. xterm ITheme), provider
    rail/                  # categories + agents, avatars, presence
    tabs/                  # session tab strip
    terminal/              # TerminalPane (xterm runtime, coalescer, attach)
    rightpanel/            # Files view + Changes (diff) view
    onboarding/            # first-run + new category/agent modals
    stores/                # zustand stores (app state mirrors config)
  shared/
    types.ts               # Category, Agent, Session, Runtime, PermissionMode
    ipc.ts                 # IPC channel names + payload types (contract)
    runtimes.ts            # launch profiles incl. permission-mode flags
docs/                      # SPEC, this file, reports/
mock/  mockup/             # references (kept)
reference/                 # cloned Superset/Hermes — git-ignored
```

## Core types (shared/types.ts)

```ts
type PermissionMode = 'default' | 'accept-edits' | 'bypass';
type RuntimeId = 'claude' | 'codex' | 'opencode' | 'grok' | 'gemini'
               | 'ollama' | 'shell' | 'custom';

interface Category { id: string; name: string; photo?: string;   // photos/<file>
                     repoPath?: string;                          // optional git repo
                     agents: string[] }
interface Agent    { id: string; categoryId: string; name: string; role?: string;
                     photo?: string; runtime: RuntimeId;
                     permissionMode: PermissionMode;
                     customCommand?: string;                     // overrides profile
                     ollamaModel?: string;
                     workspaceDir: string;                       // resolved abs path
                     memoryDir: string }
interface SessionMeta { id: string; agentId: string; title: string;
                        status: 'running' | 'exited'; createdAt: number }
```

## Launch profiles (shared/runtimes.ts)

Command per runtime × permission mode (adapted from Superset's
builtin-terminal-agents; every profile user-overridable via `customCommand`):

| runtime | default | accept-edits | bypass |
|---|---|---|---|
| claude | `claude` | `claude --permission-mode acceptEdits` | `claude --dangerously-skip-permissions` |
| codex | `codex` | `codex --full-auto` | `codex --dangerously-bypass-approvals-and-sandbox` |
| opencode | `opencode` | — | — |
| grok | `grok` | — | — (flags configurable; CLI naming varies) |
| gemini | `gemini` | `gemini --approval-mode=auto_edit` | `gemini --yolo` |
| ollama | `ollama run <model>` | — | — |
| shell | user's default shell (PowerShell on Windows) | — | — |

Sessions spawn in the agent's `workspaceDir` with the agent CLI as the PTY
command (auto-launch on open). Closing the CLI leaves the shell? No — session
ends (status `exited`), tab shows exit state.

## PTY layer (main/pty/PtyManager.ts)

- `node-pty` spawn with ConPTY on Windows (`useConpty: true` default), shell
  fallback for POSIX.
- Per session: 256 KB ring buffer of raw output for replay on (re)attach —
  Superset pty-daemon pattern. Scrollback survives tab switches; sessions
  live as long as the app (no cross-restart persistence in v1).
- Kill on tab close; SIGHUP semantics via pty.kill().

## IPC contract (shared/ipc.ts) — stable, both build agents code against it

Invoke (renderer → main, `ipcRenderer.invoke`):
- `config:get` → full config; `config:save(partial)` → saved config
- `photo:import(bytesBase64, mime)` → stored filename
- `agent:create(input)` / `agent:delete(id)` / `category:create(input)` …
  (creates workspaceDir, memory scaffold, worktree if repo-backed)
- `pty:create({agentId})` → SessionMeta (spawns CLI per launch profile,
  injects memory block first — see Memory)
- `pty:write({sessionId, dataBase64})`, `pty:resize({sessionId, cols, rows})`,
  `pty:kill({sessionId})`, `pty:attach({sessionId})` → `{replayBase64}`
- `git:status({agentId})` → branch, ahead/behind, files [{path,+,-,state}]
- `git:diff({agentId, path})` → unified diff text
- `fs:tree({agentId})` → workspace file tree (depth-limited, lazy children)
- `fs:read({agentId, path})` → text (size-capped)

Events (main → renderer, `webContents.send`):
- `pty:data` `{sessionId, dataBase64}`   (coalesced renderer-side)
- `pty:exit` `{sessionId, exitCode}`
- `git:changed` `{agentId}` (debounced watcher, v1 optional: poll on focus)

## Theming

- `theme/tokens.css`: all colors as custom properties on `:root[data-theme]`.
- Two themes v1: `dark` (mockup palette: bg #0E0F12, panel #15171C, raised
  #1B1E24, line #262A31, text #D7DBE1, muted #7C838E, accent copper #E09A4A,
  add #4EC98A, del #E0645C) and `light` (same hue family on paper ground —
  design it properly, not naive inversion).
- Each theme carries an **xterm ITheme** (bg/fg/cursor/selection + 16 ANSI
  colors). Theme switch calls `terminal.options.theme = …` on every live
  terminal — the terminal itself changes, not just chrome (SPEC #8).
- Background architected as a dedicated layer token (`--app-bg-layer`) so a
  gradient or user PNG-with-alpha can slot in later without refactor
  (SPEC #9 — architecture only, no UI now).

## Memory (main/memory/) — per docs/reports/hermes-memory.md

- Per agent: `<memoryDir>/MEMORY.md` + `USER.md`, entries joined `\n§\n`,
  caps 2,200/1,375 chars. `MemoryStore.ts` ports add/replace/remove/batch,
  dedup, drift guard (.bak + refuse destructive ops), atomic writes.
- On every `pty:create`, regenerate the managed block
  (`<!-- ADE:MEMORY:start/end -->`, rendered with the `═` headers + usage %)
  inside `CLAUDE.md` (claude) / `AGENTS.md` (codex & others) in the agent's
  workspaceDir, plus the WHEN/SKIP save-instructions and the rule that the
  agent edits the memory files directly (paths given in the block).
- v1 write path = direct file edits by the CLI agent + drift guard on load.
  v1.1 = MCP `memory` tool (schema text already in the report).

## Photos

- Import via file picker (renderer) → bytes to main → stored under
  `userData/photos/<id>.<ext>`; PNG alpha preserved; renderer loads via
  custom `ade-photo://` protocol (registered in main) to avoid file:// CSP
  issues. Fallback avatar: initials on hue gradient (from mockup).

## UI rules distilled from feedback (see SPEC)

No emojis. No model picker. No Open/Run buttons. No status-bar path.
Sessions are terminal windows: tab strip has only tabs + `+`. Right panel:
Files / Changes toggle, collapsible, resizable. Rail resizable. Onboarding
modals per mockup, plus photo upload.

## Build phases & ownership (agents)

- **A. Scaffold** (one agent): toolchain boots, window opens, tokens +
  theme provider, IPC skeleton with typed contract, config store, empty
  panes with resizable layout. `pnpm dev` verified on Windows.
- **B1. PTY/terminal** (agent, after A): PtyManager + TerminalPane +
  launch profiles + attach/replay + exit handling. Owns `src/main/pty`,
  `src/renderer/terminal`, `src/shared/runtimes.ts`.
- **B2. Rail/tabs/onboarding/photos** (agent, parallel to B1): owns
  `src/renderer/{rail,tabs,onboarding}`, `src/main/photos.ts`, stores.
- **C. Workspace/git** (agent): owns `src/main/git`, `src/renderer/rightpanel`.
- **D. Memory** (agent): owns `src/main/memory`.
- **E. Integration + verify** (agent + architect): real CLI smoke test
  (launch claude/codex in a session), theme switch incl. xterm, resize,
  onboarding round-trip.

Phase agents must not touch files owned by a parallel phase; shared files
(`shared/*`, `App.tsx`, `ipc.ts`) change only via the contract above.
