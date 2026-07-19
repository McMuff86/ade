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
- **First-class Codex profiles** persist an explicit model and reasoning
  effort per identity. New Codex identities default to `gpt-5.6-sol`; managed
  runs preserve the exact model/effort in their context and provenance.
- **First-class repository scopes**: give a specialized agent a default repo,
  keep a general agent portable, or choose a repo per new session/run. Every
  agent/repo pair gets its own ADE worktree; the right panel names the exact
  repo, source, branch/path, changes and lease used by the selected session.
- **Explicit execution backends**: a Windows ADE repository can remain native
  or deliberately run through `wsl:<distribution>`. Linux paths, Git,
  worktrees, diagnostics, terminals and managed agents stay on the selected
  side of that boundary and the UI always labels WSL scopes.
- **Reusable agent templates**: save an agent's runtime/profile and bounded
  memory seed, then spawn an independent identity and optionally attach it to
  another repository.
- **Memory and durable role contracts**: every agent gets bounded `MEMORY.md`
  + `USER.md` plus a role-aware `AGENTS.md`. Managed tasks receive a read-only
  task-local copy and digest, so orchestrator/lead/worker responsibilities stay
  explicit without dirtying a leased repository worktree.
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
Repository-scope plan: `docs/REPOSITORY_SCOPES_PLAN.md` · Remote-control plan:
`docs/REMOTE_CONTROL_PLAN.md` · Reference analyses: `docs/reports/`

## Run

```
pnpm i
pnpm dev
```

`pnpm build` builds to `out/`; `pnpm start` previews the built app.
`pnpm verify` runs typecheck, all focused checks, the production build and the
real Electron/ConPTY workflow against an isolated temporary profile.

Focused checks: `pnpm test:memory`, `pnpm test:dispatch`,
`pnpm test:runtime`, `pnpm test:backends`, `pnpm test:orchestration`,
`pnpm test:orchestration-beta`, `pnpm test:prompts`,
`pnpm test:repositories`, `pnpm test:workspace-fs`, and
`pnpm test:security`.
`pnpm test:electron` builds and runs the Electron workflow separately.
On a Windows host with WSL, `pnpm test:wsl-backend` adds real distro/Git/files/
PTY integration; setting `ADE_WSL_BACKEND_E2E=1` on the Electron workflow adds
the complete cross-boundary managed-run and restart scenario.

`pnpm agents:codex` audits the saved ADE roster without changing it;
`pnpm agents:codex -- --apply` safely backs up the inactive profile and migrates
Claude/Codex coding identities to native Codex, `gpt-5.6-sol`, bypass mode,
role-aware reasoning (`xhigh` for the orchestrator) and durable `AGENTS.md`.
Shell utility identities remain shell identities.

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

## Linux package and WSLg

Build from a native Linux checkout with Linux dependencies (not the Windows
`node_modules` tree mounted through `/mnt/c`):

```bash
sudo apt install python3 make g++
corepack enable
pnpm install --frozen-lockfile
pnpm package:linux:dir  # dist/linux-unpacked/ade
pnpm package:linux      # dist/ADE-<version>-x86_64.AppImage + amd64.deb
```

Run the AppImage or install the Debian package:

```bash
chmod +x dist/ADE-*-x86_64.AppImage
./dist/ADE-*-x86_64.AppImage
# On systems without FUSE: APPIMAGE_EXTRACT_AND_RUN=1 ./dist/ADE-*-x86_64.AppImage

sudo apt install ./dist/ADE-*-amd64.deb
ade
```

The Linux profile is independent at
`${XDG_CONFIG_HOME:-$HOME/.config}/ADE/ade/config.json`. Local Ubuntu 24.04
proof covers the native build, 409 focused contracts, and 47-check source,
unpacked, AppImage and Debian-payload Electron workflows. The
release workflow also installs the `.deb`, reruns the packaged workflow and
publishes `SHA256SUMS.txt`; its first hosted execution remains pending.

## Windows GUI with a WSL backend

Install WSL2 and, inside the chosen distribution, provide `/bin/bash`, Git,
Python 3 and `gio` (Ubuntu: `sudo apt install git python3 libglib2.0-bin`).
Install/authenticate Codex and any other selected runtime in that distribution,
because Windows credentials and executables are not reused.

In the repository scope panel choose **Pfad…**, select the explicit
`WSL · <distribution>` execution backend, enter a Linux absolute path such as
`/home/adi/project`, import it and optionally set it as the agent default. The
Windows folder picker remains for native paths only. WSL worktrees are created
beside the repository under `.ade-worktrees`; ADE never mixes Windows Git with
Linux Git for one binding.

The extended local gate passes 31 backend integration checks and 67 real
Electron/Playwright checks, including Unicode/spaces, symlink refusal, a
missing distro, a managed approval/integration/verification run, app restart,
reopen and cleanup. macOS remains a separate unverified milestone; exact
support boundaries are in `docs/MULTIPLATFORM_PLAN.md`.

## Notes

- node-pty 1.1.0 ships the Windows/macOS Node-API prebuilds used by the current
  distribution, so no Electron rebuild is needed there. Linux/WSL requires a
  fresh platform-native install and local native build prerequisites; never
  reuse the Windows `node_modules` directory from `/mnt/c`. PTY smoke test:
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
