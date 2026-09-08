# Remote workspace tools evidence — 2026-09-08

Goals 16–19 are implemented in the requested order. Final native Windows
`pnpm verify`: **exit 0**, **1,855 checks passed, 0 failed**, all three TypeScript
projects and the production desktop/mobile build passed. Log:
`test-results/remote-workbench-verify-complete.log` (local ignored artifact).

| Final gate component | Passed |
|---|---:|
| 26 focused suites | 1,510 |
| Desktop Electron workflow | 163 |
| Git sync Electron | 20 |
| Mobile Chromium | 54 |
| Mobile Electron | 15 |
| Remote restart Electron | 10 |
| Remote workspace browser | 23 |
| New workbench browser | 23 |
| New terminal/profile Electron | 15 |
| Visual regression | 22 |

## New focused contracts

| Suite | Passed | Evidence |
|---|---:|---|
| `test-remote-workbench.ts` | 46 | Real native Git worktrees, signed HTTP, reads and revision-checked writes |
| `test-remote-terminal.ts` | 30 | Device/lease boundaries, concurrency, acceptance receipts and interpreted output |
| `test-remote-profiles.ts` | 22 | Profile revisions, durable instructions, bounded PNG, grants and shared storage |
| `test-security.ts` | 206 | Existing IPC boundaries plus classified desktop terminal-control channels |

Workspace controls prove absent grants and missing bindings do not expose files
or provision worktrees. Real staged/unstaged/untracked diffs, branch/history,
bounded UTF-8 reads (including a file growing after its size check) and
traversal/metadata/secret/junction/hardlink refusals are
checked. Saves preserve BOM/CRLF, refuse oversized or redacted content and busy
leases/sessions, detect changed workspace/content identity, clean temporary files
and replay only the saved receipt after an external edit. Negative controls are
followed by a successful read of the original worktree.

Terminal tests prove a catalog/read grant cannot start a shell, caller-owned
commands/host paths/raw PTY identities are refused, another device cannot steal
input, concurrent duplicate input writes once, and stale leases cannot type.
Desktop takeover, heartbeat expiry and device-scope withdrawal release ownership
without killing the process. Managed tasks, leases and login sessions are
excluded. A deliberately throwing PTY write remains unaccepted and cannot be
replayed; a new lease/process provides the final positive control. ANSI parsing
and soft-wrap reconstruction precede text redaction. No input body is audited
or persisted in receipts.

Profile tests exercise shared name/role/photo updates while preserving runtime,
command, identity and memory configuration. Repeated upload creates one image;
name/role changes synchronize the durable ADE role block while preserving
operator text. Managed identities and linked instruction storage block updates;
stale revisions, injected config/path fields, SVG, invalid checksums, oversized
dimensions, trailing bytes and revoked devices are refused for the intended
reason. Final removal succeeds and restores initials. The domain fixture uses
a PNG codec; the Electron driver separately exercises the real native decoder.

## Browser and Electron flows

`test-remote-workbench-browser.ts`: **23 passed, 0 failed** in the final gate.
Chromium at tablet and phone sizes pairs through the signed host API, checks
missing grants, opens nested files/search/diffs without a runtime, changes
projects, preserves draft/focus across dialog closure, compares conflicts,
recovers a deliberately lost save reply with the same key, and uploads/removes
authenticated profile images under the production CSP. No uncaught browser
errors. The TLS proxy deliberately uses fixture certificates and localhost
resolution; it is not a new physical Tailscale reachability measurement.

`test-remote-terminal-electron.ts`: **15 passed, 0 failed** in the final gate,
using a disposable Electron profile, real native Git binding and PowerShell
PTYs. It exercises the actual desktop grant UI, attaching a configured session,
remote shell creation, real typed input writing only in the agent workspace,
desktop input fencing and takeover button, reconnect without duplicate process,
phone layout, remote configured-agent start/confirmed close, scope withdrawal
and the native Electron photo decoder.

The configured-agent fixture prints `ADE_CONFIGURED_AGENT_READY`; it does not
call Codex or another model. Tailscale status/Serve are simulated for this
disposable integration host. Fixture processes are closed after each run;
personal ADE profiles and the home host were not modified by verification.

Screenshots (local ignored artifacts):
`test-results/remote/workbench-editor-conflict.png`,
`test-results/remote/terminal-tablet.png`,
`test-results/remote/terminal-phone.png`.

## Corrections during iteration

- The first workspace browser attempt expected decorative glyphs in accessible
  folder names. The corrected test uses the actual accessible names; the
  complete positive flow passed.
- The first terminal fixture omitted the required agent permission mode. The
  fixture now supplies it explicitly. The expanded takeover test initially
  expected `Terminals` as the exact tab name; the actual accessible name is
  `Terminals view`. The corrected full user flow passes all 15 checks.
- The terminal fixture's Tailscale stub initially lost Node's custom promisified
  `execFile` result shape, causing genuine Git identity checks to refuse the
  worktree. Preserving `{stdout, stderr}` fixed the fixture; production identity
  checks were retained. The positive real-PTY flow then passed.
- Failed-write receipt handling was tightened so a reserved sequence is not
  reported as successful input. Its expected failures and final positive
  control pass in the focused suite.
- Final review capped the file read allocation and I/O itself, in addition to
  checking metadata size. A growing-file fixture proves that this remains an
  explicit oversized, read-only result. All 46 workspace checks and all three
  typechecks pass after that change; the final full gate includes it.
- Profile updates now match desktop identity behavior: they refuse managed
  leases and synchronize the durable role block under the link discipline.
  All 22 profile checks and all three typechecks pass. The preceding complete
  gate passed 1,851 checks before these last four focused checks were added;
  it is retained in `test-results/remote-workbench-verify-final.log`. The final
  gate passed against the complete source and raised suite floors.
- The first full gate stopped at an older mobile endpoint assertion (53 passed,
  1 failed): selecting an agent now deliberately queries its workspace. The
  assertion now allows the exact `/api/v1/workspace/query` read route, preserving
  its refusal of other unexpected endpoints. The focused positive run passes
  all 54 checks; the final full gate also passes this positive control.

## Practical limits and operator state

The new execution flows are measured on native Windows only. This does not
certify native Linux/WSLg, Windows UI with WSL backend, macOS, packaging targets
or physical iOS/Android interaction. Native workspace paths are revalidated with
the existing link discipline; descriptor-anchored ancestor race protection is
not claimed. Existing Windows bundle-suite platform exclusions remain explicit.

Files are existing UTF-8 text up to 24 KiB; tree/search/diffs and terminal
history are bounded. File/profile drafts live only in page memory and do not
survive reload. The terminal offers redacted text and control keys, without
full color/mouse TUI fidelity or file transfer. A terminal grant executes with
the Windows user's authority; the workspace is not a sandbox. Revocation stops
further access, not the already started process.

The operator reported loading the previous Goals 12–15 build on the home PC.
Goals 16–19 still need an update, dependency installation, build/restart and
explicit device grants there. Forwardable activation and usage instructions:
[REMOTE_TERMINAL_GUIDE.md](REMOTE_TERMINAL_GUIDE.md).
