# Mobile connection evidence — 2026-09-08

Foundation evidence for `9483353`: Goal 8.2–8.4 plus Goal 10's close-to-tray slice.
The subsequent desktop-aligned interface and continuous-host checks are recorded
separately in `MOBILE_DESKTOP_PARITY_RESULTS.md`; the counts below describe the
foundation, not the newer browser workflow.

- Native Windows: **71** protocol/controller checks pass. Real HTTP, HMAC,
  session/CSRF, pairing expiry/replay, revocation/SSE teardown, restart,
  idempotent task launch, redacted catalog, archived cursor reset, audit failure,
  bounded auth rate, prompt-derived title exclusion, distinct configured/verified
  HTTPS status and fixed-argument Tailscale conflict/ownership checks.
- Chromium on native Windows: **24** browser workflow checks pass at 390×844
  and 820×1180. Real HTTPS test proxy, non-exportable IndexedDB key, Secure
  HttpOnly cookie, lost-response replay (one launch), offline shell/no API cache,
  network and host restart, task cancellation, managed-run create/start, keyboard
  focus, preserved unrelated drafts on cancellation, revocation, cleared pending
  commands across identities and final positive re-pairing. Domain coordinator is real;
  runtime launch and workspaces are deterministic fixtures.
- Real sandboxed Electron + Chromium: **15** checks pass, including production
  controller, OS safeStorage, desktop QR pairing, remote inventory/revocation,
  close-to-tray connectivity and explicit disable. Only the Tailscale CLI is
  replaced inside the test process; production has no test bypass.
- Existing focused host/device suites remain green: **184 / 38** checks.
- Full `pnpm verify`: **passed** on the final implementation. Three TypeScript
  projects; **21 suites / 1337 focused checks**; production main/preload/desktop
  and mobile build; **163** existing Electron checks, **20** Git-sync Electron
  checks, **24** Chromium mobile checks, **15** mobile Electron checks and **22**
  visual checks. Existing user Git-sync changes and their baselines were preserved.
- Additional native Windows WebKit: **23 passed, 0 failed**, including pairing,
  non-exportable key persistence, task retry, network/host recovery, managed run,
  cancellation and revocation/re-pairing. This is an engine measurement, not iOS
  Safari certification. Windows WebKit reports cookie SameSite incorrectly;
  Secure/HttpOnly are measured there, Strict is pinned by protocol and Chromium.
  The upstream test explicitly marks this introspection case as failing on
  [Windows WebKit](https://github.com/microsoft/playwright/blob/main/tests/library/browsercontext-cookies.spec.ts).
  Its offline cold navigation also failed inside the engine despite an active
  worker and correct shell cache; this one check is explicitly **UNMEASURED**
  there, not counted as passed. Offline detection/reconnection still pass.
- Real PC Tailscale **1.102.2**: **9 passed, 0 failed**, using the actual private
  `.ts.net` HTTPS route, normal certificate/hostname validation, no DNS override,
  no custom CA and no TLS bypass. The real controller's independent HTTPS probe,
  unauthenticated denial, browser pairing, signed session/SSE, reload, revocation
  and final positive re-pairing all pass. The fixture uses a disposable ADE
  profile and disables its own opt-in/route afterward. The missing-explicit-flag
  negative control fails before mutation for its intended reason.

Initial actual-tailnet attempts timed out during Tailscale's first DNS/ACME
certificate provisioning; those attempts are failures, not positive evidence.
After provisioning completed, the full real HTTPS workflow passed, including
the final implementation with independent readiness probing. ADE now reports
configured and verified states separately so this delay is visible. No firewall,
router forwarding, Funnel or certificate-verification setting was weakened.

Operator state: mobile access is enabled in the existing personal ADE profile,
and ADE was restarted normally with `pnpm start`. Final probes confirm public
shell **HTTPS 200**, unpaired catalog **401**, listener **127.0.0.1:4317**, and no
debugging endpoint. The personal profile still contains the same **9 agents,
4 repositories and 4 runs**; those records were compared before/after activation.
A local config backup was retained under `userData/ade/backups`. No test phone
was enrolled in this profile; the user's devices pair through Settings. The
owned private Serve route and explicit opt-in persist for the next ADE launch.

Evidence logs: `test-results/mobile-access.log`, `mobile-browser.log`,
`mobile-webkit.log`, `mobile-verify-final.log`, `mobile-tailscale.log`,
`mobile-tailscale-negative.log`, `mobile-personal-activation.log` and
`mobile-personal-running.log`; screenshots in `test-results/mobile/`.
These generated artifacts are ignored by Git. No personal repository is used
for runtime fixture work.

Physical iOS Safari, Android Chrome, PWA installation and access over a mobile
carrier are not established by desktop viewport emulation. Native Linux/WSLg,
Windows UI with WSL execution, and macOS have no new execution evidence here.
These acceptance gates remain explicit; they must not be reported as passed
until measured on the actual devices/platforms.
