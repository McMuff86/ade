# Assistant access validation

Final native Windows `pnpm verify` on 2026-09-09 passed **2,078 checks**, all three
TypeScript projects and the production build. Log:
`test-results/assistant-access-final-verify.log`.

| Driver | Passed |
|---|---:|
| 31 focused suites | 1,670 |
| Desktop Electron workflow | 185 |
| Git sync Electron | 20 |
| Mobile Chromium browser | 56 |
| Mobile Electron | 15 |
| Remote restart Electron | 10 |
| Remote workspace browser | 24 |
| Remote workbench browser | 25 |
| Remote terminal Electron | 51 |
| Visual regression | 22 |

Focused suites include 29 display/keyboard/dashboard controls, 34 terminal
authorization/recovery controls and 34 Overview projection controls. Real PTYs
execute deterministic Hermes/OpenClaw-shaped CLI fixtures: direct projectless
entry, a large tablet display, RGB/palette color and cursor state, actual rapid
keyboard input written once and in order, desktop/tablet reuse of the same process,
and separate private dashboard tabs without an opener. CSP controls prove fresh
style-only nonces and refusal of inline scripts. Fixtures do not submit prompts
to a paid model or use the operator's provider account.

Additional `--wsl-only` driver: **6 passed**, covering the device-grant controls,
projectless home creation, a real Ubuntu PTY writing to its exact home, tablet file
read/edit/save and the saved WSL profile launch. Log:
`test-results/assistant-access-wsl-focused.log`. This is native Windows Electron
with an Ubuntu/WSL backend, not native Linux/WSLg deployment evidence.

Negative controls include scope revocation, desktop takeover, lost command/input
acknowledgements, oversized output/input, forbidden terminal sequences and unsafe
dashboard URLs. Final positive controls pass. Earlier validation failures exposed
missing catalog broadcasts, layout overflow and a raced empty resize/heartbeat;
those were fixed before the final green run. The WSL file test waits for a process
completion marker before refreshing its listing.

Screenshots: `test-results/remote/general.exe-tablet.png`,
`openclaw.exe-tablet.png`, `session-wsl-tablet.png`, and Mobile/visual captures in
`test-results/mobile` and `test-results/visual`. Physical Samsung Galaxy tablet
acceptance, real provider sign-in/conversation behavior, native Linux/WSLg and macOS
remain separate from these automated results.

The operator profiles were inspected read-only: Hermes General uses `general
--tui` and Sentinel uses `openclaw tui`, both with Ubuntu/WSL homes and separate
private HTTPS dashboard URLs. The tablet connection was restored by restarting
Tailscale; pairing and network configuration have not been reset.
Both configured dashboard pages answered HTTP 200 from the PC. The `general`
command and OpenClaw executable are present in the configured Ubuntu environment.

`2D_rpg_jumpnrun` still exists in the operator project catalog with one binding.
The new Overview distinguishes current inventory from historical work; it does
not remove that catalog entry or delete any project directory.

Operator deployment: commit `38a1b65` was pushed to `origin/main`, then the final
`pnpm build` passed and the personal host restarted at 13:00 Europe/Zurich on
2026-09-09 (PID 61912, window `ade`). The previous process had only Electron
children; no agent terminal was interrupted. The new listener owns
`127.0.0.1:4317`. Private Tailscale HTTPS returns HTTP 200 and serves the expected
`index-AwnVaBWP.js` Mobile bundle, with a terminal style nonce and no inline-script
permission. Pairing, profiles, Tailscale configuration and project directories
were preserved. Reload ADE in tablet Chrome to activate the new UI.

Deployment logs: `test-results/assistant-access-published-build.log`,
`test-results/assistant-access-published-start.stdout.log` and
`test-results/assistant-access-published-start.stderr.log`.
