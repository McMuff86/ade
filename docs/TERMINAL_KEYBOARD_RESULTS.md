# Mobile terminal keyboard layout — 2026-09-09

The operator's Samsung screenshot showed the running Codex TUI squeezed between
the launcher/status area and transcript/composer chrome. The software keyboard
reduced the visual viewport while the layout viewport remained tall, so the
existing short-window media query did not collapse those controls.

The new layout uses that visual-only reduction to compact both project and agent
terminals. Full behavior and detection limits are specified in `PROJECT_ENTRY.md`.

Focused validation passed **43 checks** (zero failures) in
`pnpm exec tsx scripts/test-remote-terminal-electron.ts --assistant-only`,
including **18** new keyboard controls. `terminalKeyboardFlow.ts`, included in the real
Electron/Chromium terminal driver, changes VisualViewport geometry without
resizing the layout viewport. It exercises a real native Windows PTY and xterm,
tablet/phone layout, touch targets, focus, explicit control expansion, draft
preservation, zoom/toolbar exclusions, viewport offset and interrupted-query
recovery. This is simulated keyboard geometry, not a physical Samsung keyboard.

At a 1024 × 768 layout viewport with only 420 px visually available, the terminal
retains **313 px** (74.5%). All eight keys remain on one row with 44 px touch
targets. Phone coverage uses a 390 × 844 layout viewport with 400 px visible;
the key row scrolls horizontally without widening the dialog. An initial focus
failure on keyboard close exposed Chromium moving focus to body when hiding the
toggle; the final positive run passes with an explicit dialog-heading fallback.

Final native Windows `pnpm verify` passed **2,141 checks**, all three TypeScript
projects and the production build: 32 unit suites / 1,694 checks; Electron 185;
Git sync 20; Mobile browser 57; Mobile Electron 15; restart 10; workspace browser
24; workbench browser 25; terminal Electron 89; visual regression 22. No failures.
The separate focused driver passed 43 checks. Full log:
`test-results/keyboard-layout-verify.log`.

Local evidence: `test-results/keyboard-layout-focused.log`,
`test-results/remote/terminal-keyboard-tablet.png` and
`test-results/remote/terminal-keyboard-phone.png`. Operator deployment is pending:
reload the mobile listener through the existing Tailscale connection monitor
without restarting the host or Codex process. Actual Galaxy Chrome/Tailscale
acceptance remains a separate check after the tablet reloads the deployed build.
