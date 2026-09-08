# Goals 8.6–8.9 — one ADE interface across desktop, tablet and phone

Status: implemented and validated, 2026-09-08. Builds on `9483353`.
Goals 8.6–8.9 pass the automated acceptance below; results are recorded in
`MOBILE_DESKTOP_PARITY_RESULTS.md`. The user's live host remains untouched;
activation is deferred to their next normal restart and mobile reload.

## Goal 8.6 — shared visual identity and navigation

- Import the desktop's actual dark/light design tokens, avatar and runtime
  visual helpers. Use the `ade_` title bar, compact mode switch, copper actions,
  fine borders and monospace typography.
- Overview, Work and Graph remain views of one live connection. Work provides
  the remotely supported task controls; terminals and local administration keep
  their existing desktop boundary.
- Persist only device-local appearance and view preferences. Do not change the
  PC's settings or persist private run data/prompts in browser storage.

## Goal 8.7 — Overview and Work

- Match desktop Overview's metrics, Agents, Projects and Work inventory.
  Report only telemetry available in the existing mobile DTO; never infer
  terminal activity, dependency links or complete usage from missing data.
- Selecting an agent/project opens a prefilled task composer. Preserve drafts
  while navigating, inspecting runs, reconnecting or changing theme.
- Search/filter work, select a run, and create tasks/managed runs using the
  existing signed, idempotent contract and explicit repository/agent selection.

## Goal 8.8 — Graph and inspector

- Show a dotted canvas with desktop-style participant nodes, orchestration
  hierarchy, team groups, run selector and fit/zoom controls. Edges represent
  membership/roles, never unprovided task dependencies.
- Show run state, participants, tasks, budget and reported usage in a side
  inspector on tablets and an accessible modal detail panel on phones.
- Nodes are buttons: Enter/Space select, Escape clears, focus returns to the
  opener or a stable fallback. Dialogs trap focus and restore it on close.
- Keep loading, empty, offline, revoked and command-uncertainty states useful.

## Goal 8.9 — continuity and executable evidence

- Keep the user's current host (PID 19188 at task start), private Serve route,
  personal device store and active browser identity untouched during development.
  All execution tests use disposable profiles and independent ephemeral ports.
  Do not run the real Tailscale operator driver against the occupied live route.
- The current host keeps its assets in memory. Build/test changes independently;
  without explicit permission for a final restart, deployment waits for the
  user's next normal ADE restart. A page reload alone cannot replace host assets.
- Chromium and WebKit phone/tablet workflows cover layout, both themes, tab and
  graph keyboard behavior, inspector focus, navigation with drafts, existing
  pairing/commands/retry/reconnect/revoke and a final positive control.
- Run `pnpm verify`; record host reachability throughout. Commit and push the
  completed code, documentation and tests. Physical-device acceptance remains
  separate from browser automation.

No new remote mutation, shell, filesystem, prompt/result-body or config endpoint
is required for this visual/workflow parity slice.
