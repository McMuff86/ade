# ADE multi-platform and WSL engineering plan

Status: P0 implemented and native WSL2 source validation passed on 2026-07-19.
Windows remains the supported packaged distribution; Linux/WSLg is now a
verified developer/source workflow, not yet a shipped product.

## Product definitions

These are separate deliverables and must not be conflated:

1. **Native Linux / WSLg ADE** — Electron, Git, PTY and agent CLIs all run as
   Linux processes. On Windows this appears through WSLg and uses a separate
   Linux checkout and Linux ADE profile.
2. **Windows ADE with a WSL execution backend** — the GUI remains a Windows
   process, while one repository binding deliberately executes filesystem,
   Git, diagnostics, PTY and agent commands inside a selected WSL distro.
3. **Native macOS ADE** — the POSIX runtime path plus macOS packaging,
   signing/notarization and platform-specific UX verification.

Accepting a `\\wsl.localhost\...` path in the current Windows build provides
Windows access to files stored in WSL. It does not select Linux Git, a Linux
shell, Linux credentials or Linux agent CLIs and is therefore not a WSL
execution backend.

## Current readiness

| Area | Windows | Linux / WSLg | macOS |
| --- | --- | --- | --- |
| Electron source build | verified | **verified in Ubuntu/WSL2** | unverified |
| PTY and shell transport | ConPTY verified | **native node-pty build + PTY workflow verified** | POSIX branch present |
| Git/worktree orchestration | verified | **focused + Electron integration verified on ext4** | mostly portable, unverified |
| Focused tests | **393 checks green locally** | **392 checks green locally; Ubuntu CI job added, first hosted run pending** | no CI job |
| Electron/Playwright | **46/46** | **46/46 green under Xvfb in WSL2** | unverified |
| Distribution | x64 NSIS | none | none |

Known code gaps before support can be claimed:

- POSIX directory rename currently fails closed instead of providing a safe
  no-clobber implementation; the rename affordance still needs to be hidden or
  explained for directories on POSIX.
- Goal 6 operator/report scripts remain tied to the real Windows pilot profile;
  they are measurement tooling, not the portable product E2E.
- `node-pty` has no Linux prebuild in this dependency version. A fresh native
  install successfully builds it with Python, make and g++, so those are Linux
  developer/package prerequisites until a prebuild is adopted.
- CI and electron-builder scripts produce only Windows artifacts.

## P0 — portable contracts and CI

- [x] Centralize host-platform semantics for case sensitivity, null device and
  deterministic shell selection.
- [x] Correct POSIX lease/worktree path keys and cover Windows case folding plus
  POSIX case preservation in focused tests.
- [ ] Implement safe POSIX directory no-clobber rename or explicitly remove/
  explain that directory action on unsupported filesystems.
- [x] Replace PowerShell literals in the Electron workflow with platform
  command helpers while retaining the same PTY/reload/restart assertions.
- [x] Add an Ubuntu CI job for typecheck, all focused suites, production build
  and Electron/Playwright under Xvfb. The workflow is committed locally; its
  first hosted GitHub execution remains pending until these changes are pushed.
- Keep Windows `pnpm verify` and packaged-executable E2E mandatory throughout.

Exit criteria: Windows verification remains green; Ubuntu runs every focused
suite with platform-specific filesystem assertions and no skipped core
orchestration/security checks.

## P1 — native Linux and WSLg proof

Local proof completed on Ubuntu 24.04 under WSL2/WSLg on 2026-07-19:

- copied the current source into native ext4 at
  `/tmp/ade-wsl-native-20260719-0038` without Windows dependencies;
- `pnpm install --frozen-lockfile` built `node-pty` for Linux x64;
- typecheck, 392 focused assertions and the production build passed;
- the real Electron workflow passed 46/46 under Xvfb, including POSIX PTY,
  reload/restart races, repository scopes, ADE-owned commits, approval,
  integration, verification, Codex profile UI, durable `AGENTS.md` and the
  directly visible failed-run reason;
- native Codex CLI authentication was present and an isolated stdin smoke with
  `gpt-5.6-sol`, `xhigh` and bypass returned
  `ADE_WSL_CODEX_SOL_XHIGH_OK` (thread `019f776c-ad36-7412-a511-db08d3924e96`).

This proves the source/runtime path on this machine. A hosted CI pass, a clean
machine reproduction and Linux packaging are still required before support is
claimed.

- Use a fresh checkout below the distro's native filesystem (`/home/...`), a
  Linux Node/pnpm install and Linux-built native dependencies. Never share the
  Windows `node_modules` tree through `/mnt/c`.
- Run typecheck, focused suites, production build, PTY smoke and the full
  Electron/Playwright workflow under Linux.
- Exercise repository import, linked worktrees, interactive shell, Claude and
  Codex diagnostics, managed task transport, approval, integration and app
  restart from WSLg.
- Record Linux profile/config location explicitly; do not import Windows paths
  into the Linux profile without a migration/translation design.

Exit criteria: the same behavioral Electron assertions pass under WSLg from a
native Linux checkout, including a real PTY and managed Git integration.

## P2 — supported Linux distribution

- Add unpacked Linux plus AppImage/deb targets and suitable icons/desktop
  metadata.
- Run the Electron workflow against the unpacked Linux artifact in CI.
- Document native-library prerequisites, installation, upgrade and profile
  paths; publish checksums with artifacts.

Exit criteria: a clean Ubuntu/WSLg environment installs or launches the
artifact and passes the packaged smoke without developer tooling.

## P3 — Windows GUI with WSL execution backend

This requires an explicit execution abstraction; it must not be inferred from
UNC-looking strings.

- Store `native` or `wsl:<distro>` on the repository/workspace binding.
- Give the backend one canonical path representation and controlled `wslpath`
  conversion only at the Windows boundary.
- Route Git, worktree creation, filesystem mutation, diagnostics, PTY launch,
  task files and agent CLIs through the same backend. Never mix Windows Git
  and Linux Git against one worktree.
- Transport prompts and result paths without shell interpolation and preserve
  the existing exact-diff, lease and approval guarantees.
- Add cross-boundary tests for spaces, Unicode, symlinks, case-sensitive paths,
  cancellation, restart and a stopped/missing distro.

Exit criteria: a Windows ADE run using a WSL binding completes the same
managed-run E2E while every process and Git mutation is proven to occur inside
the selected distro.

## P4 — macOS support

- Add macOS focused/Electron CI, shell/PATH resolution and native PTY coverage.
- Produce signed/notarized arm64 and x64/universal artifacts as justified.
- Verify native dialogs, notifications, keyboard conventions and window
  behavior without introducing macOS-only visual styling into the design.

## Test and documentation contract

Every platform slice is complete only with:

- focused unit/integration/security regression tests;
- real Electron/Playwright automation for the user-visible workflow;
- a production build and, once packaging exists, packaged-artifact smoke;
- accessibility checks for keyboard flow, focus, names, contrast and reduced
  motion where the UI changes;
- updates to `ARCHITECTURE.md`, `STATUS.md`, `ROADMAP.md`, this plan and the
  current `HANDOFF.md` in the same change.

## UI/UX quality bar

Platform support must feel native without fragmenting ADE's identity:

- one calm visual hierarchy with the current copper accent reserved for
  selection, progress and primary actions;
- progressive disclosure: common actions remain obvious, advanced run evidence
  and diagnostics stay one interaction away;
- every long operation immediately shows ownership, state, elapsed activity
  and a safe cancel/recovery path;
- empty, loading, blocked, failed, approval and completed states are designed
  deliberately rather than falling back to generic text;
- keyboard operation, visible focus, semantic labels, contrast and reduced
  motion are release gates;
- screenshots at representative compact, default and fullscreen sizes are
  reviewed alongside Playwright behavior, not substituted for it.

## Immediate sequence

1. Observe the new Ubuntu hosted CI job and close any environment-only gaps.
2. Resolve the POSIX directory-rename affordance and reproduce from a clean
   WSL/Ubuntu environment.
3. Fix the dependency-aware worker-base architecture found by F3/F4 or record
   the exact bounded scope allowed to proceed into Goal 7.
4. Add Linux packaging only after the source/CI proof stays green; design the
   larger Windows-GUI/WSL backend separately after that.
