# Mobile terminal keyboard activation — 2026-09-09

After the compact keyboard layout was deployed, the operator reported that
tapping the CLI no longer opened the Samsung keyboard. The earlier geometry
tests used programmatic focus followed by simulated visual-viewport resizing;
they did not verify keyboard activation from a real touch gesture. Ownership on
the physical tablet has not yet been confirmed, so it is not asserted as the
cause of that report.

`TerminalScreen` previously focused xterm from pointerdown. The new completed
tap explicitly requests the keyboard on the editable xterm textarea, including
when focus remained after dismissal. An additional Tastatur button provides the
same action. The helper uses the optional VirtualKeyboard API with an editable
focused field, consistent with [Chrome's API documentation](https://developer.chrome.com/docs/web-platform/virtual-keyboard).
It leaves viewport resizing enabled and falls back to refocusing if the API is
absent or rejects the request. It never opens the keyboard from a timer, changes
input ownership, sends terminal characters or starts a process.

`terminalKeyboardActivationFlow.ts` uses real Playwright touch activation and
the existing native Windows PTY fixture. A browser API probe observes editable
focus and user activation without pretending to display a physical OS keyboard.
Coverage includes repeated taps, the explicit button, read-only input, explicit
ownership recovery and absent/rejected API fallback.

The pre-fix asset produced **43 passed, 1 expected failure** at the missing
explicit keyboard request assertion (`test-results/keyboard-activation-negative.log`).
An earlier probe setup error was corrected and is not counted as negative
evidence. The final positive `--assistant-only` driver passed **50 checks**, zero
failures, including all **seven** new activation controls. All three TypeScript
projects pass. Logs: `test-results/keyboard-activation-focused.log` and
`test-results/keyboard-activation-typecheck.log`.

Final native Windows `pnpm verify` passed **2,148 checks**, all three TypeScript
projects and the production build: 32 unit suites / 1,694 checks; Electron 185;
Git sync 20; Mobile browser 57; Mobile Electron 15; restart 10; workspace browser
24; workbench browser 25; terminal Electron 96; visual regression 22. No failures.
Full log: `test-results/keyboard-activation-verify.log`.

Commit `02330e1` was pushed to `origin/main`; `pnpm build` passed. At **18:45:44
Europe/Zurich**, private HTTPS returned HTTP 200 with
`/assets/index-CGSv-1PK.js`, matching the production build. Only the mobile
listener was reloaded through the existing connection monitor. Other Tailscale
Serve routes were compared and unchanged. ADE PID **64500** and Codex PID
**69956** retained their original start times (17:04:21 / 17:08:52).
Evidence: `test-results/keyboard-activation-deploy-build.log`,
`test-results/keyboard-activation-reload.log` and
`test-results/keyboard-activation-deployment.json`.

Operator check: reload Chrome, tap the CLI or the Tastatur button; if input is
disabled and owned by the PC, press Eingabe übernehmen before tapping again.
The physical Samsung keyboard still needs acceptance after loading the fix.
