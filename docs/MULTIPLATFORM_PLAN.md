# ADE multi-platform and WSL engineering plan

Status: P0-P3 are implemented and locally plus hosted verified on 2026-07-19. Native
Windows remains the primary release path. Native Linux now has reproducible
AppImage and Debian packaging, and the Windows GUI can explicitly execute one
repository scope inside a selected WSL distribution. CI and the complete Linux
package workflow passed on commit `d32faa9`; publication of versioned Linux
release assets remains a separate release gate.

## Product definitions

These are separate deployment models:

1. **Native Linux / WSLg ADE** — Electron, Git, PTY and agent CLIs are Linux
   processes. WSLg uses a Linux checkout, Linux dependencies and a separate
   Linux ADE profile.
2. **Windows ADE with a WSL execution backend** — Electron remains a Windows
   process. A repository explicitly stores `wsl:<distribution>`, and its
   filesystem, Git, diagnostics, PTY and managed agent commands execute in that
   distribution.
3. **Native macOS ADE** — the portable POSIX path plus macOS packaging,
   signing/notarization and platform-specific interaction verification.

A `\\wsl.localhost\...` path by itself does not select WSL execution. The
backend is explicit, persisted and immutable for a repository/binding/session
scope; ADE never infers it from path spelling.

## Current readiness

| Area | Native Windows | Native Linux / WSLg | Windows GUI → WSL | macOS |
| --- | --- | --- | --- | --- |
| Source/type contracts | verified | verified on Ubuntu 24.04 | verified | unverified |
| PTY | ConPTY verified | Linux `node-pty` verified | Windows `node-pty` → `wsl.exe --exec` verified | POSIX branch present |
| Git/worktrees/files | native services verified | native services verified on ext4 | backend-routed Linux Git/files verified | unverified |
| Focused tests | 410/410 | 409/409 | 31/31 backend contracts and real integration | no CI job |
| Electron/Playwright | 47/47 | 47/47 under Xvfb | 67/67 extended Windows/WSL workflow | unverified |
| Distribution | x64 NSIS | unpacked, AppImage and installed `.deb` verified locally and hosted | uses the Windows package | none |

These are measured local and hosted results from the closing gates, not skipped
or inferred checks. The hosted evidence is the green
[cross-platform CI run](https://github.com/McMuff86/ade/actions/runs/29676483968)
and [Linux package run](https://github.com/McMuff86/ade/actions/runs/29676490871).

## Implemented platform contract

- `Repository`, `WorkspaceBinding`, session scope and diagnostics carry an
  `executionBackend`: `native` or a validated `wsl:<distribution>` id.
- Legacy records migrate deterministically to `native`; bindings inherit their
  repository backend and preserve it across app restarts.
- `ExecutionBackendService` is the single argv-only process/path boundary. It
  validates distribution names, caps time/output and uses controlled `wslpath`
  conversion only when Windows-owned control files or OS UI need it.
- WSL path identity is POSIX and case-sensitive. Windows path identity retains
  its existing case-folded behavior.
- Backend-aware Git, workspace and filesystem services keep one worktree on one
  side of the boundary. WSL mutations use Linux Git and a containment-checked
  Python helper with no-follow reads and atomic no-replace rename.
- WSL managed prompts remain Windows-owned scratch artifacts and are read via a
  translated file path; large or quote-rich prompts, result schemas, mailboxes,
  activity and role-aware `AGENTS.md` contracts are never interpolated into the
  `wsl.exe` command line.
- The repository UI discovers available distributions, requires an explicit
  backend selection, labels WSL scopes, and reports backend-specific runtime
  diagnostics.
- Missing distributions fail closed. A stopped installed distribution may be
  started normally by `wsl.exe`; ADE never silently falls back to Windows Git or
  a Windows runtime.

## P0 — portable contracts and CI

- [x] Centralized path identity, null device and deterministic host shell
  selection.
- [x] Preserved POSIX case sensitivity and Windows case folding in tests.
- [x] Implemented atomic POSIX/WSL no-clobber rename and symlink refusal for
  backend filesystem mutations.
- [x] Made the Electron workflow platform-aware while retaining the same
  reload/restart, repository, managed-run and security assertions.
- [x] Added Ubuntu source, unpacked-package and Electron/Xvfb verification to
  CI. The first hosted Ubuntu and Windows jobs passed on commit `d32faa9`.

## P1 — native Linux and WSLg proof

Local Ubuntu 24.04/WSL2 proof uses a native ext4 checkout and Linux-built
dependencies; it never shares the Windows `node_modules` tree through `/mnt/c`.

- [x] `pnpm install --frozen-lockfile` builds `node-pty` with Python 3, make and
  g++.
- [x] Typecheck, focused suites, production build and the 47-check real
  Electron workflow pass under Xvfb.
- [x] POSIX PTY, repository worktrees, approval, ADE-owned commits,
  transactional integration, verification and app restart are exercised.
- [x] An isolated native Codex `gpt-5.6-sol`/`xhigh`/bypass stdin smoke passed.

Native Linux profile location is
`${XDG_CONFIG_HOME:-$HOME/.config}/ADE/ade/config.json`. It is independent from
the Windows profile and is not automatically migrated.

## P2 — Linux distribution

- [x] Added unpacked x64, AppImage and Debian targets with a 1024px icon,
  desktop metadata, Development/devel categories and deterministic names.
- [x] Added `pnpm package:linux:dir` and `pnpm package:linux`.
- [x] Built AppImage and `.deb` locally from Linux-native dependencies; the
  unpacked executable, AppImage and extracted Debian payload each pass the full
  47-check packaged Electron workflow. Debian metadata is also validated.
- [x] Added a release workflow that verifies source, unpacked executable,
  AppImage and installed Debian package, writes SHA-256 checksums and uploads
  artifacts.
- [x] Observed the first hosted package workflow: every source/package
  Electron gate passed, the `.deb` installed successfully, and checksums plus
  unsigned artifacts were uploaded.
- [ ] Publish a checksummed versioned release after the license/release policy
  is explicit.
- [ ] Decide and record the project license before calling the package a public
  stable release; no license is invented by the build.

Developer prerequisites are Node.js 22, pnpm 9, Python 3, make and g++. The
Debian package declares Electron runtime libraries; AppImage users still need a
working graphical Linux/WSLg session. Upgrade by installing/running the newer
artifact against the same profile. Auto-update and package signing are not yet
implemented.

## P3 — Windows GUI with WSL execution backend

- [x] Persist explicit backend identity through repository import, worktree
  bindings, sessions, tasks, diagnostics and restart migration.
- [x] Route canonical paths, Git, worktree creation/removal, file reads and
  mutations, diagnostics, PTYs, managed task transport and integration through
  the selected distribution.
- [x] Preserve exact diff/path-set validation, exclusive leases, approval,
  ADE-owned commits and fail-closed transactional integration.
- [x] Cover invalid backend ids, a missing distribution, spaces, Unicode,
  symlinks, case-sensitive identity, atomic rename, cancellation/PTY teardown,
  full app restart and cleanup.
- [x] Complete a real Windows Electron/Playwright managed run while evidence
  proves every task process and leased worktree ran in Linux.

Current bounded limitations:

- This backend is available only in the Windows build and requires WSL2 plus a
  selected installed distribution.
- The distribution needs `/bin/bash`, Git, Python 3 and `gio`; agent CLIs and
  their credentials must also exist inside that distribution.
- WSL repositories are entered as Linux absolute paths. The Windows folder
  picker remains native and does not browse the Linux namespace.
- WSL worktrees live beside the source under `../.ade-worktrees`; the Windows
  global worktree-base setting is intentionally not reused across the boundary.
- Native custom commands are not translated. A WSL-scoped custom command must
  be valid for the Linux shell and use Linux paths.
- Managed runs receive the durable role-aware `AGENTS.md` snapshot. Interactive
  WSL sessions discover repository instructions normally, but ADE does not yet
  inject its Windows-owned memory block into a Linux repository worktree.

## P4 — macOS support

- [ ] Add macOS focused/Electron CI and native PTY verification.
- [ ] Verify shell/PATH, dialogs, notifications and keyboard conventions.
- [ ] Produce signed/notarized arm64 and x64/universal artifacts only after the
  behavioral gate passes.

## Test and documentation contract

Every platform slice requires focused unit/integration/security tests, real
Electron/Playwright automation, a production build, packaged-artifact smoke once
packaging exists, deliberate cleanup/restart evidence and synchronized updates
to `ARCHITECTURE.md`, `STATUS.md`, `ROADMAP.md`, this plan and `HANDOFF.md`.

## UI/UX quality bar

Platform choice is visible where it changes behavior, not sprayed across the
interface. ADE keeps one calm hierarchy and copper accent; advanced backend
details stay one interaction away. Loading, unavailable-distro, blocked,
approval, failure, recovery and completed states must be actionable. Keyboard
operation, visible focus, semantic names, contrast, responsive panels and
reduced motion remain release gates alongside screenshot review.

## Next sequence

1. Publish versioned Linux checksums/assets after the license/release policy is
   explicit.
2. Add a first-run prerequisite check and friendlier setup guidance for missing
   WSL tools/agent credentials.
3. Continue Goal 7 only inside its bounded loopback-only security contract.
4. Plan macOS only after Linux and WSL support remain stable through releases.
