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
- **Two views over the same agents**: Terminals is the interactive execution
  workspace; Graph is an early control-plane view for bounded one-shot tasks.
  Graph task sessions use non-interactive CLI transports, run at most four at
  once, can be cancelled, and report completion from real process exit.

Product spec: `docs/SPEC.md` · Architecture: `docs/ARCHITECTURE.md` ·
Reference analyses: `docs/reports/`

## Run

```
pnpm i
pnpm dev
```

`pnpm build` builds to `out/`; `pnpm start` previews the built app.
Focused checks: `pnpm test:memory`, `pnpm test:dispatch`, and
`pnpm test:runtime`.

## Notes

- node-pty 1.1.0 ships Node-API prebuilds — no Electron rebuild needed. If a
  future version drops them, run `pnpm rebuild:pty`. PTY smoke test:
  `ADE_PTY_SMOKE=1` logs `[ade] pty-smoke: ade-pty-ok` at startup.
- First session in a fresh agent workspace: Claude Code shows its one-time
  "trust this folder" prompt — answer it in the terminal like in any shell.
- Dev/E2E affordances: `ADE_REMOTE_DEBUG_PORT`, `ADE_USER_DATA_DIR`,
  `window.__ade` (dev builds only).
- Graph orchestration is still incomplete: workers currently receive the same
  task and there is no task decomposition, result mailbox, verification, or
  integration workflow yet. See `docs/STATUS.md` and `docs/ROADMAP.md`.
