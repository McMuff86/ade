# Remote workspace evidence — 2026-09-08

Goals 12–15 are implemented and verified locally on native Windows.
Final `pnpm verify`: **exit 0**, **1,717 checks passed, 0 failed**, all three
TypeScript projects and the production desktop/mobile build passed.

| Final gate component | Passed |
|---|---:|
| 23 focused suites | 1,410 |
| Desktop Electron workflow | 163 |
| Git sync Electron | 20 |
| Mobile Chromium | 54 |
| Mobile Electron | 15 |
| Real remote restart Electron | 10 |
| Remote workspace browser | 23 |
| Visual regression | 22 |

Full output: `test-results/remote-workspace-verify.log` (ignored local artifact).
At the time of this verification the delivery was not installed on the personal
home host. The operator subsequently reported loading it there. The new follow-up
delivery and pending home activation are tracked in `REMOTE_WORKBENCH_RESULTS.md`.

## Goal 12

- Native Windows focused administration suite: **36 passed, 0 failed**.
  Real HTTP/signature checks cover desktop-only permission grants, migration,
  malformed grants, missing scope/proof/key, unknown payload fields, busy
  work/operations, stale instance, duplicate receipt replay, process-restart
  replay, grant withdrawal, corrupt storage, interrupted reservations, missing
  receipt storage with existing administration audit history, and audit failure.
- Real Electron + Chromium: **10 passed, 0 failed**. The test pairs a browser,
  denies restart before the desktop grant, grants through the desktop UI,
  checks confirmation focus/cancel restoration, performs a real Electron
  relaunch, observes exactly two distinct main-process IDs, confirms the new
  authenticated instance, reconnects SSE and reloads without a second pairing.
  The device inventory and permission survive in the same disposable profile.
- Initial relaunch tests failed: Electron's default relaunch retained
  Playwright's loader, which intercepted app readiness and waited for an absent
  test controller. Passing the app's actual `process.argv.slice(1)` omits that
  launcher instrumentation. Another fixture assertion used the launch wrapper's
  PID instead of the Electron main PID; the fixture now reads `process.pid` in
  main and cleans up its own process tree. Only the final positive run counts.
- The Electron test substitutes Tailscale CLI calls inside a temporary entry
  module inherited by both processes. HTTP/session/device storage, the built
  application, Electron relaunch and Chromium are real. No private Serve route
  or personal ADE profile is changed. Screenshot:
  `test-results/remote/restart-reconnected.png` (ignored generated artifact).

Remote restart is available only in the native Windows production source launch mode,
with a desktop-granted `host:restart` capability. Development hot-reload and the
legacy environment-token listener are excluded. Linux/WSLg, Windows→WSL,
macOS, packaged relaunch and physical-device/carrier acceptance have no new
runtime evidence here. The home PC still needs a local update/restart/grant.

The separate admin receipt file fails closed at 500 receipts or 1 MiB. Corrupt
or interrupted receipts never silently repeat effects; operator maintenance
and broader indexed history remain follow-up work. This is not auto-update,
remote wake, an OS reboot, remote terminal access or a pre-login service.

## Goals 13–15

- Native Windows focused workspace suite: **36 passed, 0 failed**. Real Git
  project initialization, independent profiles/memory/instructions, isolated
  worktrees across two projects, duplicate provisioning, scope denials, strict
  payloads, device-owned Git preview, real fast-forward, replay after preview
  consumption, dirty-worktree refusal/preservation, explicit Fetch/freshness,
  linked project/worktree roots, legacy live sessions and separate project/mode
  drafts with late-reply protection. The final positive creation passes after
  the negative controls. An initial assertion compared Windows short/long path
  aliases incorrectly; the final check uses native canonical paths.
- Chromium on native Windows: **23 passed, 0 failed**. Real domain, native
  Git scope services and signed HTTP/session transport; only agent runtime
  processes are deterministic fixture sessions. Covers desktop permission
  change/reconnect, two new projects, agent creation, workspace preparation,
  Git preview/confirmation/update, dirty-state guidance, modal focus/return,
  per-project drafts, two tasks for distinct agents/projects, identity-based
  filters, phone/tablet overflow and no prompt persistence/renderer errors.
  Lost provisioning replies survive closing/reopening the manager, replay the
  same key and create exactly one project. Active workspaces display the real
  refusal reason; focus returns to the opener or its documented fallback.
  An initial test observed a disabled button during the operation instead of
  waiting for its completion; the final positive control waits for the host
  completion notice and verifies the actual Git HEAD.
  The added lost-reply test initially used Node-side route.fetch, which cannot
  resolve Chromium's fixture hostname. The final test drops the real host reply
  in the existing local TLS proxy instead. The runtime fixture now resolves
  native scopes before reporting sessions; this lets the real busy-workspace
  guard operate on the same binding/path metadata as production.
- Existing impacted suites: **38 device**, **184 host API**, **61 repository**
  and **204 security** checks passed before the full gate.
- Inspected screenshot: `test-results/remote/workspace-browser-failure.png`
  exposed missing exact accessible names on wrapped select labels; explicit
  labels were added. Positive screenshots: `phone-git-blocked.png`,
  `tablet-project-work.png` in the same ignored evidence directory.

No real Codex/model task was launched by these new browser fixtures; scheduling
and filesystem/API contracts are measured independently of model output.
New projects initialize locally; arbitrary remote clone URLs, remote approval,
publication, shells and non-native repository workflows remain out of scope.

## Full-gate portability correction

The first full run stopped at existing config/profile link tests: this work PC
cannot create file symlinks without Developer Mode. The fixtures now fall back
only on Windows EPERM to directory junctions, matching the existing workspace
filesystem suite, and name that limitation. Directory-link fixtures explicitly
use junctions on Windows. The no-follow/quarantine assertions still execute;
file-symlink-specific behavior is unmeasured on this host. No system setting or
test floor was weakened. Focused positive reruns: **30 config**, **200 workspace
bundle**, zero failures (the two existing Linux-only groups remain skipped).
The security floor rises from 203 to the measured **204** checks.

An intermediate full run passed all **1,410 focused checks** and the production build,
then stopped at the old desktop driver's ten-second terminal-input wait. A
disposable real Electron/ConPTY probe measured a **14.8-second** native
PowerShell startup even with `-NoProfile`; the normal profile exceeded the
probe's initial 18-second limit. Renderer animation frames were running and
ConPTY was producing control data. The driver now allows up to 60 seconds for
the actual visible terminal input, then sends keyboard input and checks real
output as before. No shell profile, Windows setting or production launch
behavior was changed. Its report assertion now waits for the asynchronous
report contents instead of testing the loading placeholder. Diagnostic code
and unsuccessful background-rendering experiments were removed.
The same bounded cold-start allowance applies to the login and Grok fixture
shells: the earlier Grok timeout's captured terminal already contained both
expected key/argv markers immediately after the timeout. These drivers use
fake CLI fixtures; their output does not establish real provider/model support.

A subsequent intermediate full run passed all functional suites, including **163 desktop
Electron**, **20 Git Electron**, **54 mobile Chromium**, **15 mobile Electron**,
**10 restart Electron** and **23 remote workspace browser** checks. Its final
visual comparison exposed old snapshots containing the capture machine's user
name and random temporary-directory suffix. On this work PC, the longer path
wrapped and shifted the entire wide inspector. The screenshot driver now gives
only the two displayed workspace path labels canonical fixture text after real
scope loading. The application, actual scope/path/clipboard contracts and pixel
threshold are unchanged. Seven Windows baselines were explicitly regenerated;
the normalized wide snapshot was inspected, then a fresh random-directory run
passed all **22 visual checks** without updating baselines.
