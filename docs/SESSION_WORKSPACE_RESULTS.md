# Goals 20–21 validation — 2026-09-08

Implementation: projectless native/WSL agent homes and shared per-session launch
selection. Final `pnpm verify` passed on native Windows: **1,919 checks**, all three
TypeScript projects and the production main/preload/desktop/mobile builds.
The final typecheck was also repeated after the WSL trailing-slash correction.
Full log: `test-results/session-workspace-verify.log`.

| Final verify component | Passed |
|---|---:|
| 28 focused suites | 1,563 |
| Desktop Electron workflow | 164 |
| Git sync Electron | 20 |
| Mobile Chromium | 55 |
| Mobile Electron | 15 |
| Remote restart Electron | 10 |
| Remote workspace browser | 23 |
| Remote workbench browser | 25 |
| Remote terminal/session-launch Electron | 22 |
| Visual regression | 22 |
| Total | 1,919 |

Additional detail and WSL measurements:

- `scripts/test-home-workspace.ts`: 22 native Windows checks; `--wsl`: 21 checks
  against the actual Ubuntu-24.04 distribution (Python 3.12.3). Includes no-create
  reads, explicit home creation, read/save/conflict, BOM/CRLF, size/redaction,
  busy-workspace fencing, links/hardlinks and changed-root refusal with a final
  positive read. No Git metadata is created for home workspaces.
  The WSL run also uses a configured home ending in `/`; log:
  `test-results/session-home-wsl.log`.
- `scripts/test-session-launch.ts`: 28 checks for fixed discovery, per-session
  profile isolation, permissions, model revalidation and unsafe payload refusal.
- `scripts/test-remote-workbench-browser.ts`: 25 checks, including a real
  projectless file edit with catalog projects present and existing editor/draft/
  focus/phone flows.
- `scripts/test-remote-terminal-electron.ts --wsl`: 26 checks, including real
  desktop launch/restart, tablet Codex/Ollama selection and the WSL home
  shell → file read → edit → saved-profile launch flow. Log:
  `test-results/session-terminal-wsl.log`; screenshots under `test-results/remote/`.
- The scope suite adds a regression for the desktop inspector: explicit home
  sessions cannot inherit their agent's default Git binding (62 checks total).

Iteration corrections: the first Electron fixture update omitted required agent
update fields; those were corrected without widening the production validator.
Restart and WSL save checks initially inspected state before the asynchronous
operation completed; final checks wait for the new main-owned session or closed
editor. An early concurrent desktop run timed out waiting for its managed approval
gate; final UI validation is sequential. The existing mobile composer test now
selects a project explicitly after asserting that managed task submission is
disabled in a home workspace. The CLI fixture now keeps version probes
read-only. WSL cleanup retries transient service failures for its exact generated
test directory; such failures are never counted as passing behavioral controls.
Automatic approval review blocked cleanup of one earlier failed fixture directory
under the Windows temporary directory (generic “blocked by policy” response).
It remains outside the repository; the successful fixture cleans its own data.

Electron fixtures compile tiny local command executables named Codex, Hermes and
Ollama to verify exact launch arguments, model selection and working directory.
They do not exercise vendor authentication or a real model. The WSL extension
uses a real Bash PTY, configured fixture command, files and Python filesystem
boundary in an isolated `/tmp/ade-session-*` home. It does not change a personal
Hermes profile, shell startup file or model installation.

The new Windows→WSL claim concerns agent homes on Ubuntu-24.04, not native Linux,
WSLg-hosted Electron or remote Git against WSL repository bindings. macOS, native
Linux packaging, a physical tablet and the home-host deployment require their own
acceptance. Existing remote device grants are preserved. Text terminal limitations
(no full color/mouse TUI fidelity), bounded editor limits and the native verified-
path ancestor-race limitation still apply.

The user authorized commit/push. Verified implementation commit `1c301bb`
(`feat: add projectless workspaces and session launcher`) was pushed successfully
to `origin/main` on 2026-09-08. Deployment at home remains an operator action;
these isolated tests neither pull/build on that host nor restart it.
