# Mobile desktop parity evidence — 2026-09-08

Goals 8.6–8.9; follows foundation commit `9483353`.

## Implemented boundary

The mobile shell uses the actual desktop theme tokens, avatar/runtime visuals,
Overview ledger, compact navigation, copper actions and dotted Graph. Work
provides search/filter and task/run dialogs. The responsive Inspector contains
run/participant state, tasks, budget and reported usage. The phone uses a modal
detail panel with focus trapping/restoration; tablet uses a side panel.

The existing server, Tailscale configuration, pairing, IndexedDB schema, session
cookie and signed API contract are unchanged. Navigation/theme/selection share
one `useMobileHost` connection. Private drafts survive these view changes but
are never persisted or queued for automatic offline execution. Revocation and
local disconnection clear private state. Runtime launches/workspaces in UI tests
are deterministic fixtures; domain coordinator and HTTP adapter are real.

## Validation

- Chromium: **54 passed, 0 failed**. Includes original pairing, Secure/HttpOnly
  cookie, non-exportable identity, signed task retry (one launch), session/host
  restart, offline shell, revocation and positive re-pairing. Adds exact shared
  dark/light tokens, Overview, unknown telemetry, prefilled composers, drafts
  across views, unchanged SSE connection, keyboard mode switch, Work filters,
  tablet/phone Inspector, graph Enter/Space/Escape, zoom/fit and dialog focus.
- Viewports: 390×844 and 820×1180, with page-overflow checks at 320×568,
  844×390 and 1280×800. Screenshots inspected against desktop visual conventions.
- WebKit: **53 passed, 0 failed**, including project/Settings/node focus
  restoration after pointer activation. Three initial focus failures exposed
  missing explicit opener focus in WebKit; the corrected positive run passes
  every assertion. Native Windows WebKit still cannot measure SameSite via its
  cookie introspection or offline cold navigation; those existing gaps are not
  counted as iOS/Safari evidence. Chromium measures both contracts.
- Full `pnpm verify`: **passed on native Windows**, all three TypeScript
  projects, **21 focused suites / 1337 checks**, desktop and mobile production
  builds, **163 Electron workflow**, **20 Git-sync Electron**, **54 Chromium
  mobile**, **15 Mobile Electron**, and **22 visual regression** checks, all
  with zero failures. Project/node opening also uses simulated touch input.
- The final gate exposed an existing host-API negative-control defect: replacing
  the signature's last hex digit with `0` sometimes left a valid signature
  unchanged and created fixture work, cascading into seven other assertions.
  The test now always changes that digit. Production authorization is unchanged.
  Focused rerun: **184 passed, 0 failed**, including rejection and the following
  successful signed/idempotent commands. The failed run is retained in
  `test-results/mobile-parity-verify-invalid-negative-control.log` and is not
  accepted as positive evidence; focused log: `mobile-parity-host-api.log`.

Logs: `test-results/mobile-parity-browser.log`, `mobile-parity-webkit.log`,
`mobile-parity-verify-final.log`. Screenshots: `test-results/mobile/phone-overview-dark.png`,
`phone-overview-light.png`, `phone-task.png`, `tablet-managed-run.png`,
`tablet-graph-light.png`. Generated evidence is ignored by Git.

## Active host continuity

The personal ADE process listening at `127.0.0.1:4317` was PID 19188 at the
start and after verification. Its profile, device store and private Serve route
were not mutated by development or fixtures. Read-only normal-certificate HTTPS
probes sampled the public shell every ten seconds: **298 samples, 0 failures**,
from **04:30:16 to 05:19:48 UTC** (49 minutes 32 seconds). The task-owned probe
was then stopped; ADE remained on the same loopback listener/PID. Local log:
`test-results/mobile-parity-availability.json`.
No real Tailscale operator fixture runs against the occupied live route.

The running version keeps its old asset map. The new UI becomes visible after
the user's next normal ADE restart and mobile page reload. No forced restart,
browser logout or device re-pairing is part of this delivery. Continuous host
reachability does not establish every property of the user's physical browser
or network; phone/carrier/iOS acceptance remains separate.
