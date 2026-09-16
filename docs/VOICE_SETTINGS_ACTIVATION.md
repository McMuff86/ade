# Personal voice settings activated — 16 September 2026

The operator authorized deployment after the completed verification. At
14:48:55 CEST, the prepared release `dist/voice-settings-35c3eec` replaced
the previous personal ADE process through the normal tray Quit action.

## Active release and proof

- Release commit: `35c3eec7198f3d1bba10c6b6312ef7ca105cf0d0` on
  `codex/voice-settings`; source ID: `71abb464e4bc9b4196cc`.
- New personal Electron PID: **52412**; old PID 49568 and its interactive
  Codex PID 5800 are stopped. No force termination was used.
- Startup receipt passed with six unchanged profiles, four unchanged
  projects, the selected voice preserved, and one paired device.
- Desktop and tablet include **Settings / Einstellungen → Stimme**, native
  ElevenLabs tuning, default speed **0.85**, and passive WSL discovery.
- The private HTTPS tablet page returned HTTP 200 and served byte-identical
  assets from this release: <https://number-cruncher.tailfc0b86.ts.net>.
- The Windows ADE shortcut now points at the new release.
- Backup: `C:\Users\Adi.Muff\ADE-Backups\VoiceSettings-20260916-144850`.

Main-checkout evidence: `test-results/voice-settings-restart.json`,
`test-results/voice-settings-release-smoke.json`, and
`dist/voice-settings-35c3eec/activation.json`. The complete preceding
`pnpm verify` passed all three TypeScript projects, 72 suites / 3,183 checks,
the production build and every Electron/browser/layout driver. See
[voice settings](VOICE_SETTINGS.md) for behavioral contracts and limits.

The first automation attempt could not reach the tray icon. Its failed
receipt is retained as `test-results/voice-settings-restart-tray-failure.json`.
Invoking the Windows overflow button through UI Automation and using physical
screen coordinates reached ADE's normal Quit command; the final activation
receipt above passed. No production artifact was changed during deployment.

## Hermes and next use

The existing Hermes gateway retained Linux PID 348 and its 14:03:38 start
time through the ADE restart, with no new shutdown entries. The temporary
Ubuntu keepalive (Windows PID 37556) remains active; this deployment does
not install persistent Windows autostart. Details and operator receipts are
in [the Hermes diagnosis](HERMES_WSL_DIAGNOSIS.md).

Reload the tablet page, open **Einstellungen → Stimme**, choose
**Stimmen laden**, adjust the controls, preview and save. A personal listening
test remains for the operator; deployment did not generate paid preview audio.
The separately edited reply-reading feature in the shared main worktree is
preserved and is outside this frozen, verified release.
