# ade_

Agentic development environment — one desktop workspace where all of your CLI
agents (Claude Code, Codex, OpenCode, Grok Build, Ollama models) live as real
terminals around named agents.

- **Two-level rail**: categories (a channel, a repo, a book — each with a
  profile photo) and named agents underneath, each with its own photo,
  runtime and permission mode.
- **Sessions are terminals**: selecting an agent shows its sessions as tabs;
  each tab is a real PTY (ConPTY on Windows) auto-launching that agent's CLI.
  Scrollback survives tab and agent switches.
- **Permission modes** per agent, translated to the right CLI flags
  (`claude --dangerously-skip-permissions`,
  `codex --dangerously-bypass-approvals-and-sandbox`, …).
- **Git-aware workspaces**: link a category to a repo and every agent gets its
  own worktree on branch `ade/<agent>`; the right panel shows real
  status/diffs (Changes) and the workspace tree incl. pinned agent files
  (Files).
- **Memory out of the box** (Hermes-style): every agent gets `MEMORY.md` +
  `USER.md` with hard caps; a managed block is injected into
  `CLAUDE.md`/`AGENTS.md` at each session start so the CLI agent reads and
  maintains its own memory.
- **Light + dark theme** — including the terminal itself (full ANSI palette
  per theme).
- **Terminal beta safeguards**: read-only CLI/auth diagnostics, actionable
  exit/restart UI, background native completion notifications, keyboard tab
  navigation, sandboxed renderer, strict CSP and runtime-validated IPC.
- **Two views over the same agents**: Terminals is the interactive execution
  workspace; Graph creates persisted runs that reference those catalog agents
  with run-scoped roles. Its bounded one-shot tasks survive reload, can be
  cancelled per run, and report completion from real process exit events.
- **Orchestration beta**: a managed Graph run asks its orchestrator for a
  worker-specific plan, schedules validated assignments within the run budget,
  waits for an explicit integration approval, transactionally cherry-picks
  worker commit ranges, and finishes with integration review plus read-only
  verification. Codex uses native JSONL/schema output; other CLIs can use the
  inspectable file-mailbox contract.

Product spec: `docs/SPEC.md` · Architecture: `docs/ARCHITECTURE.md` ·
Reference analyses: `docs/reports/`

## Run

```
pnpm i
pnpm dev
```

`pnpm build` builds to `out/`; `pnpm start` previews the built app.
`pnpm verify` runs typecheck, all focused checks, the production build and the
real Electron/ConPTY workflow against an isolated temporary profile.

Focused checks: `pnpm test:memory`, `pnpm test:dispatch`,
`pnpm test:runtime`, `pnpm test:orchestration`,
`pnpm test:orchestration-beta`, and `pnpm test:security`.
`pnpm test:electron` builds and runs the Electron workflow separately.

## Keyboard

| Action | Shortcut |
|---|---|
| New / close terminal session | `Ctrl+Shift+T` / `Ctrl+Shift+W` |
| Previous / next session | `Ctrl+PageUp` / `Ctrl+PageDown` |
| Select session 1–9 | `Alt+1` … `Alt+9` |
| Terminals / Graph view | `Ctrl+1` / `Ctrl+2` |

Tab lists also support arrow keys plus Home/End with visible focus.

## Windows package

```
pnpm package:dir   # dist/win-unpacked/ADE.exe
pnpm package:win   # dist/ADE-<version>-x64-Setup.exe
```

The assisted NSIS installer is unsigned for local/branch builds. The Windows
package workflow uses `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` when configured
to Authenticode-sign release artifacts. Auto-update is not implemented yet.

## Notes

- node-pty 1.1.0 ships Node-API prebuilds — no Electron rebuild needed. If a
  future version drops them, run `pnpm rebuild:pty`. PTY smoke test:
  `ADE_PTY_SMOKE=1` logs `[ade] pty-smoke: ade-pty-ok` at startup.
- First session in a fresh agent workspace: Claude Code shows its one-time
  "trust this folder" prompt — answer it in the terminal like in any shell.
- Dev/E2E affordances: `ADE_REMOTE_DEBUG_PORT`, `ADE_USER_DATA_DIR`,
  `ADE_E2E_EXECUTABLE`, `ADE_E2E_PTY_LIST_SNAPSHOT_DELAY_MS`, and
  `window.__ade` (dev builds only).
- Managed runs require exactly one orchestrator, at least one lead/worker, clean
  exclusive workspaces, a concrete goal, and at least one approval in their
  budget. Repo-backed participants must be worktrees of the same repository.
- Token and monetary limits are fail-closed and are available only when every
  selected runtime adapter provides the corresponding telemetry. Codex JSONL
  currently provides tokens but not provider-billed USD; ADE keeps that cost
  unknown instead of treating it as zero.
