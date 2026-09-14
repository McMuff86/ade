# Agent profile implementation evidence — 14 September 2026

The complete release verification passed; personal activation is recorded in
HANDOFF after deployment.

The shared desktop/mobile editor stores explicit instructions and ordered
Markdown copies with a full-context revision. Read-only preview does not write
identity or repository files. Native Windows interactive profile starts use an
external captured snapshot independently of memory; plain CLI and shell choices
do not add new ADE guidance. Existing legacy repository blocks are preserved.

## Executable evidence

- Memory/snapshot: 45 checks, including readonly preview, ordered sources,
  bounded complete context and refusal of unsafe identity files.
- Behavior service: 18 checks for revision conflicts, device/resource grants,
  replay, wire redaction and unchanged repository/identity files.
- Native transport: 12 checks with Windows PowerShell 5.1, PowerShell 7 and an
  npm-style shim; special characters remain data and snapshots stay outside
  execution workspaces.
- Codex config probe: 10 protocol checks plus one real readonly installed CLI
  probe. Matching cwd/environment; only effective developer instructions are
  projected, unknown config blocks launch. No thread or model request.
- Interactive memory snapshot: 10 checks, preserving enabled MEMORY/USER and
  maintenance guidance without repository writes, safe bounded reads, disabled
  sources untouched and separate profile/full-context digests. Added after the
  independent review found the initial transport omitted enabled memory.
- Mobile behavior editor: 12 browser checks, including save/import order,
  conflicts, rejected oversized import followed by successful save, narrow
  viewport, retaining drafts across conflicts and Escape/focus return.
- ADE interactive session fixture: 39 checks with actual Electron
  IPCs, PTYs and deterministic local CLI executables. Covers Claude/Codex,
  existing Codex developer instructions, memory disabled, project profiles,
  unchanged repository guidance, raw CLI/shell separation and visible revision
  comparison. Explicit text reads retain the original snapshot after profile
  edits, ordinary session lists omit it, raw CLI returns null, and the desktop
  shows the captured text only after an explicit action.
  Enabled memory is delivered through real PTYs, disabled USER is omitted,
  profile comparison uses the separate profile digest, and memory files remain
  unchanged through both cases.
- Remote terminal: 64 checks including explicit-only captured-text reads,
  host-path redaction, rejected ambiguous requests and revoked resource access.
- IPC/security: 239 checks; TypeScript and production build passed.

## Actual installed model probes

`scripts/probe-native-profile-cli.ts` made exactly one short call per runtime,
through the shared profile transport and real Windows PowerShell 5.1. A random
response phrase appeared only in the profile. Both CLIs returned it exactly;
workspace contents were unchanged. No raw output/configuration was retained.

- Codex `exec`: 7.9 seconds, 15,586 input / 25 output tokens reported. No
  verified monetary cap; the probe limited request count, time and output.
- Claude `-p`: 3.6 seconds, reported USD 0.103295 under a USD 0.25 budget.

Machine-readable local evidence: `test-results/native-profile-cli-probe.json`.
These calls prove noninteractive option/context consumption; they do not prove
resumed conversations replace existing instructions. The separate Electron
fixture proves ADE's interactive invocation and display lifecycle. No WSL,
Linux or macOS profile transport is claimed.

## Complete release verification

`pnpm verify` completed with exit 0 on native Windows. Log:
`test-results/agent-profiles-release-verify.log`. Both product TypeScript
projects and the script TypeScript project passed, followed by 56 suites /
2,558 checks, production build and every configured UI driver:
speech Electron 10, speech mobile 28, behavior mobile 12, profile Electron 39,
desktop Electron 197, Git Electron 20, mobile browser 60, mobile Electron 36,
restart 12, remote workspace 24, remote workbench 43, tablet layout 17,
remote terminals 202, run inspection 27, project CLI 28, project Git 22,
publication 12, setup 37 and visual comparisons 22. No failing suite remains.

## Earlier runs retained for traceability

The first full verify was deliberately stopped during focused suites after
the independent review identified omitted enabled memory. It is not a green
release verdict. Run the corrected complete `pnpm verify` chain, synchronize release results,
commit/push, and activate one meaningful
personal build. Current personal ADE continues running the mobile-voice release.

The next full run passed all 56 suites / 2,558 checks, production build, speech
and profile UI checks, desktop/mobile workflows through the remote workbench.
It stopped at the existing PC folder-picker cancellation focus check. The
opener is now focused in a layout effect after React re-enables it, instead of
a potentially premature animation-frame callback. The targeted tablet-layout
suite passes all 17 checks afterward. A fresh complete release run follows;
the failed run is retained in `test-results/agent-profiles-verify-final.log`.
