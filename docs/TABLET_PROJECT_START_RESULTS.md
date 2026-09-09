# Tablet project start validation — 2026-09-09

Final native Windows `pnpm verify` exited **0**: **1,972 checks passed**, all
three TypeScript projects passed and the desktop/mobile production build passed.
The final log is `test-results/tablet-project-start-verify.log` (local generated
artifact). No home-host deployment or physical tablet measurement was performed.

| Suite | Passed |
| --- | ---: |
| Focused suites (29 suites) | 1,601 |
| Desktop Electron workflow | 164 |
| Git synchronization Electron | 20 |
| Mobile browser (Chromium) | 56 |
| Mobile Electron | 15 |
| Remote restart Electron | 10 |
| Remote workspace browser | 24 |
| Remote workbench browser | 25 |
| Remote terminal Electron, including tablet project start | 35 |
| Visual regression | 22 |
| **Total** | **1,972** |

Focused coverage includes config 31, security 210, remote workspaces 54, remote
terminal 34 and device drafts 13. Platform-specific checks that the existing
drivers skip on Windows are not included in this total.

## New flow and recovery evidence

`scripts/helpers/projectStartFlow.ts` runs inside the real Electron/Chromium
terminal driver, using an isolated ADE profile and temporary repositories.
The final run proves desktop default-directory/profile setup, useful missing
setup feedback, dropped successful project and terminal replies with browser
reload and explicit same-key recovery, exactly one repository and one Codex PTY,
and a scaffold file written through terminal input in the bound agent worktree.
The saved agent's runtime settings remain unchanged.

The same run verifies offline input retention, selected workspace/session/draft
restoration after reload without relaunch, Continue Working attaching the existing
process, and a lost input acknowledgement blocking implicit resend after reload.
Separate browser suites verify device-local task drafts across real reload and
host reconnection, while appearance preferences remain separate from draft content.

Native workspace controls reject collisions without touching existing files,
path-like/reserved project names, changed root identity and root links/junctions.
A final valid creation passes after those negative controls. Session inventory
controls reject missing grants and bearer-only access and exclude managed/login
sessions and raw PTY/path data. Device-draft tests cover device isolation,
corruption, expiry, recovery retention, storage limits and quota failure.

Tablet screenshots were also inspected:
`test-results/remote/tablet-project-workspace.png` and
`test-results/remote/tablet-project-keyboard.png`. The short viewport control
checks that the input composer and send action remain visible. These are browser
viewport measurements, not measurements of Samsung's physical software keyboard.

## Corrections during validation

An early combined Electron run identified an invalid separator in wizard
idempotency keys. The existing URL-safe validator correctly refused the request;
the client now uses a valid stage suffix without widening the validator. The
lost-reply control checks that creation succeeded before withholding its reply.
The scaffold check now waits for the actual shell write after input acknowledgement.

The first full verify then exposed two obsolete browser expectations: storage
containing appearance preferences only and an endpoint list without the new
session inventory read. Both now assert the intended device-scoped persistence
and precise read endpoint. The final complete positive run above passes, including
the unchanged committed visual baselines.

## Remaining operator and platform acceptance

The PTYs execute a controlled Codex CLI fixture; no real model inference or
personal Codex authentication was tested. Test profiles, device grants and
project-root configuration are isolated from the operator's ADE instance.
Activate the updated host and configure its defaults using
`TABLET_PROJECT_START.md`, then test the physical Galaxy tablet in Chrome with
its real keyboard, screen lock/unlock and network changes. The new project flow
does not claim native Linux/macOS or WSL evidence. Experiment promotion and
application preview remain follow-up work.
