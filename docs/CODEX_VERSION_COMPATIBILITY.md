# Installed Codex version for ADE conversations

Activated 20 September 2026, 09:24:16 CEST on native Windows.

The morning casual conversation failed before `thread/start` because ADE required
exactly Codex 0.154.0 while the PC had 0.155.1. Both project supervision and casual
chat now launch the PC's installed `codex` through the existing native launcher.
The tablet uses the same host service; it has no separate CLI installation.

`ade-coordinator-policy-v3` requires a stable CLI version of at least 0.154.0.
There is no fixed upper version. The initialize user-agent's first product is
parsed and bounded, so a later OS or terminal version cannot satisfy the check.
Older, missing, malformed and prerelease identities are refused. Newer versions
must still confirm every required effective feature/MCP/agent setting and the
read-only thread without network access before receiving the user's prompt.
Unexpected native tools continue to terminate the connection. No CLI installation,
global Codex configuration, model selection or remote permissions are changed.

New connections use the installed CLI. Already running conversations keep their
existing process; an explicit resume after a disconnect uses the installed CLI
and rechecks the policy. The ADE contract stays stable across CLI-only upgrades.
The one-time change from the old v2 policy invalidates old conversation bindings:
history stays readable and the user starts a new conversation. Unconfirmed turns
are never resent automatically.

This permits newer versions that confirm the contract; it does not claim native
evidence for untested future releases or other deployment platforms.

## Evidence collected before the user's test stop

| Check | Result |
| --- | --- |
| Coordinator policy, including minimum/newer versions and malformed identities | 51 passed, 0 failed |
| Deterministic native protocol, policy-before-prompt and resume after simulated upgrade | 25 passed, 0 failed |
| Installed Codex 0.155.1 effective config/thread, no model turn | 3 passed, 0 failed |
| Real project tools, project resume, casual reply and casual resume | 7 passed, 0 failed |
| Actual Electron and paired tablet casual flow, deterministic CLI 0.155.1 peer | 10 passed, 0 failed |
| Same Electron/tablet flow with installed native Codex 0.155.1 | 10 passed, 0 failed |
| All three TypeScript projects | Passed after explicit i18next instance type fixed TS2742 |
| Full `pnpm verify` and broader conversation driver | Stopped on explicit user request; incomplete |
| Production desktop/mobile build after test stop | Passed |

Native model evidence used `gpt-5.6-sol` / `high` in isolated test profiles.
The tablet flow starts casual chat on the PC, reads the answer, reloads without
resending, continues the exact context from desktop, checks 1100px/390px layout
and Escape focus return, and preserves separate project history. No paid speech
or ElevenLabs generation was performed. Actual Samsung interaction remains an
operator check.

Evidence is under `test-results/main-agent-planning/` and
`test-results/codex-version-*.log`. Native opt-in UI command:
`pnpm exec tsx scripts/test-conversation-electron.ts --casual-only --run-native`.
No further tests were started after the user's request to stop.

## Activation

ADE was closed through its existing tray Quit action, then `pnpm build` built
desktop and mobile, and ADE was reopened as PID **73904**. Both builds have source
**`96d53585a058af6915a9`**. The existing private HTTPS endpoint serves
`/assets/index-DzZb5eDq.js` byte-identical to the new local mobile build.
All three paired devices and the project/profile inventory were preserved.
The existing terminal-image changes in the working tree are included in this
common build; no additional device acceptance is implied.

Backup: `C:\Users\Adi.Muff\ADE-Backups\CodexVersion-20260920-092355`.
Receipt: `test-results/codex-version-activation.json`.

Reload the existing tablet page, open **Plaudern & Stimme**, and choose
**Neues freies Gespräch**. No new pairing or model setting is needed.
