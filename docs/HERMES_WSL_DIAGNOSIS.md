# Hermes shutdown notices during ADE use — 16 September 2026

## Finding

The personal `hermes-gateway-general.service` runs in Ubuntu under WSL systemd.
Its journal records orderly service stops with SIGTERM at 13:48:06, 13:52:57,
13:54:06 and 13:55:26 CEST, matching the operator's Telegram screenshot.
These are guest shutdowns, not evidence of a model failure or a gateway crash.
The 13:48 system journal reaches `poweroff.target`. The gateway reports
`NRestarts=0`; later starts accompany the WSL environment coming up again.

ADE's `ExecutionBackendService.listWslDistributions()` previously followed
`wsl.exe --list --quiet` with `wsl.exe --distribution <name> --exec true` for
every registered distribution. Opening backend selectors and the Electron
tests therefore booted the personal guest and its enabled services. After
the short command returned, WSL could idle-stop the guest. Microsoft's
[systemd documentation](https://learn.microsoft.com/en-us/windows/wsl/systemd)
explicitly states that systemd services do not keep a WSL instance alive.
The repeated lifecycle and the discovery code explain the observed notices;
the records do not identify the Windows caller of every individual boot.

Hermes' installed `gateway/run.py` builds the interruption warning in its
shutdown path. No ADE Telegram sender or direct gateway restart was found.
Test Hermes CLI launches use deterministic executables; passive WSL discovery
was the unintended connection to the operator's real gateway.

## Correction and contract

`wsl:list` now only enumerates registered distribution names. It does not run
any guest command. Names remain selectable; `available` means registration,
not tested runtime health. The existing 30-second cache remains. Explicit
backend operations and diagnostics still start the chosen guest and report
actual failures. No Hermes configuration, notification setting, Windows
autostart, or WSL idle-timeout setting is changed by this fix.

## Evidence and operator state

- New negative control against the old code fails exactly the no-guest-start
  assertion: 33 passed, 1 failed (`test-results/wsl-discovery-negative.log`).
- Fixed focused suite: 34 passed, 0 failed, including UTF-16 names, filtering,
  caching, unsupported hosts, failed enumeration, and explicit guest execution
  (`test-results/wsl-discovery-positive.log`). The regression uses a process
  fixture, so it does not cause another personal gateway shutdown.
- The second full voice-settings verification was stopped deliberately after
  the Telegram report. It is incomplete, not a green verification result.
- Temporary hidden `wsl.exe -d Ubuntu --exec /bin/sleep infinity`, Windows
  PID 37556, was started during diagnosis to hold the guest open. Its receipt
  is `test-results/hermes-diagnostic-keepalive.json` in the main checkout.
  This is a temporary process, not a persistent service setup. Stopping it
  can allow WSL to idle-stop again if no other Windows-owned guest command
  remains. Do not terminate the personal gateway as test cleanup.
- Full `pnpm verify` passed at 14:31 CEST on source `71abb464e4bc9b4196cc`: three TypeScript projects, 72 suites / 3,183 checks, production build, and every Electron/browser/layout driver. Personal activation is pending the second interactive session.

The gateway remained active with the same Linux PID 348 and start time
14:03:38 throughout the observed test window, with no later shutdown entries.
This observation uses the temporary keepalive; it is not evidence of an
unattended restart or permanent Windows autostart setup. The current receipt
is `test-results/hermes-stability-observation.json` in the main checkout.
