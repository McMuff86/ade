# Project entry validation — 2026-09-09

Final native Windows `pnpm verify` passed **2,123 checks**, all three TypeScript
projects and the production build. Breakdown: 32 suites / 1,694 checks, desktop
185, Git sync 20, Mobile browser 57, Mobile Electron 15, restart 10, remote
workspace 24, workbench 25, terminal 71, visual 22. Evidence log:
`test-results/project-entry-verify.log`. Operator deployment follows this commit.

Focused checks passed: session-launch contract suite **32**, device-draft suite
**16**, Mobile Chromium navigation **57**, real Electron project flow **27**,
assistant TUI flow **25**, additional Ubuntu/WSL terminal flow **9**.

The project flow verifies files in the same bound workspace, independent
Codex/Claude/Grok launch choices, reuse without duplicate processes, and creating
a new workspace profile after a deliberately lost acknowledgement plus reload.
The latter reuses the original receipt and creates exactly one profile. The
existing project-creation, terminal-command and input-recovery controls pass too.

The assistant flow starts from a blank shell through the visible profile action,
checks a minimum 220 px ordinary display and over 300 px expanded display at
1024×768, preserves the folded composer during direct typing, and reopens both
desktop and Mobile onto the same process. Native fixture keydown-to-echo was
**148 ms** (Hermes-shaped profile) and **124 ms** (OpenClaw-shaped profile); WSL
samples were **197/212/95 ms** while another isolated project fixture ran.
The final full verification measured native echoes of **131/117 ms**.
Screenshots: `test-results/remote/general.exe-tablet.png`,
`openclaw.exe-tablet.png`, `project-cli-tablet.png`, `tablet-project-keyboard.png`.

Iteration exposed a query/open race with lease/resize heartbeats: the heartbeat
could acquire the input lock between selection and launch, silently skipping
the launch. Input now defers throughout that transaction. Focus requests retain
their opener and do not steal focus after navigation. The final positive controls
above passed after the fix. An accessibility selector was also made explicit;
Escape inside xterm correctly remains a terminal key, so workspace-close checks
use the visible Close button.

Tests execute deterministic local CLI fixtures in real native Windows PTYs.
They do not call paid models or prove provider authentication/model availability.
Physical Samsung Chrome acceptance remains an operator check after deployment.
