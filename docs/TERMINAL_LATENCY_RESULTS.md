# Tablet terminal response â€” 2026-09-09

The operator reported more than one second between typing in Hermes TUI and
seeing the characters. A read-only inspection located the ended TUI conversation
in the configured Hermes profile's local history. ADE keeps process bookends;
Hermes retains the conversation. Personal prompts and provider data are not copied
into this repository.

Five measurements through `RemoteTerminalService` against the actual configured
WSL home, using an inert PTY port and no-op audit, found input validation at
457â€“503 ms and display queries at 601â€“629 ms. Every packet launched three WSL
Python processes and every selected display query launched four. These timings
exclude the network, real PTY echo, frame rendering and audit storage. The old
200 ms keyboard buffer and 400 ms display interval added further waiting.

The same measurement after replacing repeated process launches with a persistent
read-only root probe measured input at 2â€“3 ms and queries at 2â€“3 ms. The helper
does fresh descriptor-relative `O_NOFOLLOW` traversal on every request, with no
identity cache. Input buffering is now 16 ms. Display queries are single-flight,
refresh immediately after accepted direct keys, otherwise wait 100 ms between
responses while visible. Signed commands, auditing, sequence receipts and ownership
checks remain in place. The UI reports complete PC response time separately from
the end-to-end echo measurements below.

Logs: `test-results/terminal-latency-before.log` and
`test-results/terminal-latency-after.log`.

The real Windows UI + Ubuntu/WSL browser driver passes **9 checks**. Actual
keydown-to-visible-acknowledgement measurements were **70, 71 and 72 ms**. Its
profile start, shared home files and editing controls also passed. During cold
Electron startup, a separate fixed `true` command took 27.4 seconds before later
WSL calls became fast. The new worker allows 45 seconds for readiness and five
seconds per warm request; read-only browser queries allow 60 seconds. No special
WSL executable path, pipe mode, or desktop sandbox change is needed.

Final native Windows `pnpm verify` passed **2,097 checks**, all three TypeScript
projects and the production build. This includes 1,687 checks in 32 focused
suites, 185 desktop workflow, 20 Git sync, 56 Mobile Chromium, 15 Mobile Electron,
10 restart, 24 workspace, 25 workbench, 53 terminal and 22 visual checks.
Native Hermes/OpenClaw-shaped TUI fixtures measured **248 ms** and **128 ms**
in the full run, both below the 500 ms ceiling.
The separate root-probe driver passed **19 checks**, including three real WSL
controls. Logs: `test-results/terminal-latency-verify-final.log`,
`test-results/terminal-latency-root-probe-final.log`, and
`test-results/terminal-latency-wsl-final.log`.

The first full run exposed a revocation-display race. All query/command/input
paths now clear terminal state on a revoked grant, and the final browser control
waits for the actual scope error before checking the removed screen. It passes.

Deployment is pending. Browser automation measures actual
keydown to DOM-rendered real PTY acknowledgement, and requires less than 500 ms
on the local test connection. This is distinct from the physical tablet's
Tailscale route; the operator must repeat typing there after the updated build.

A separate physical-network spot check found 4–7 ms from PC to the WLAN router,
100–430 ms directly to the Galaxy tablet on LAN (244 ms average), and 85–453 ms
through its Tailscale IP (261 ms average), all without packet loss. Tailscale
discovery confirmed a direct LAN path rather than a relay. The tablet screen/app
state was not confirmed; these are network RTT observations, not typing-echo
measurements or proof of an Android power-saving cause. Active-screen tablet
acceptance remains open. No network, tablet or provider settings were changed.
