# Tablet project start — 2026-09-09

Scope: the native Windows host and paired Android/Chrome tablet workflow.
The requested device is a Samsung Galaxy tablet. Real-device acceptance remains
separate from Chromium touch/viewport automation.

## Operator setup

1. Build and restart the updated native Windows ADE host, then reload Mobile.
   Finish active tasks before restarting; restarting ADE stops its PTYs.
2. On the PC open **Settings → Neue Projekte vom Tablet**. Select an existing
   project parent directory, for example `C:\Users\Adi.Muff\repos`, and optionally
   a native Codex profile. Save **Projektstart speichern**. The suggested path is
   derived from the current user's home; setup does not move existing projects.
3. Under **Verbundene Geräte**, grant the tablet **Agents und Projekte erstellen**
   and **Interaktive Terminals steuern**. Grant workspace reads separately for files.
   Check Codex installation/authentication in the native host environment.
4. In Mobile Overview choose **Neues Projekt**, enter an optional working title,
   then **Mit Codex starten**. An omitted title gets a generated name. The selected
   saved Codex profile supplies its model and permission settings. With no profile,
   the explicitly selected new standard profile is created through existing agent
   administration.
5. **Weiterarbeiten** lists actual interactive sessions. Opening one attaches the
   same process. If its input lease expired, explicitly take input again. Exited
   processes are labelled; an ADE restart does not resurrect a terminal process.

## Contracts

- Desktop-only `projectDefaults:get` and audited `projectDefaults:save` configure
  an existing absolute native parent directory and optional native Codex agent.
  The saved canonical path and directory identity are checked on provisioning;
  links, junctions, root replacement and existing destination directories fail
  closed. Every new project gets a readable slug below the parent, local `main`
  and an empty initial commit. Legacy administration retains its ADE-owned UUID
  root until a parent is configured. No remote payload supplies a host path.
- Mobile catalog exposes only whether setup exists and the optional agent id.
  The wizard uses existing signed/idempotent agent-create, project-create,
  workspace-prepare and terminal-open commands. Each stage keeps its own stable
  key. Browser reload or a lost reply requires explicit **Start fortsetzen**;
  no command is submitted just because the device reconnects.
- Stage confirmations are stored before moving on. A failed launch preserves the
  project and worktree. Closing the start flow never removes created work. A
  rejected or interrupted operation is not blindly retried under a fresh key;
  inspect the retained project or close the flow before a new attempt.
- Project repositories and agent worktrees remain distinct. With the suggested
  parent, the canonical repository is `C:\Users\Adi.Muff\repos\<project>`;
  Codex's working files initially live in its bound worktree, normally below
  `C:\Users\Adi.Muff\repos\.ade-worktrees` unless a custom worktree root is set.
  Integration into the canonical checkout remains a separate action. Agents
  retain the existing isolated branch/workspace contract; this delivery does not
  integrate, publish, push or relocate repositories.
- `GET /api/v1/terminal/sessions` goes through `AdeApplicationService`, requires a
  signed device and the terminal grant, and returns at most 32 recent validated
  interactive sessions. Main rechecks workspace ownership/identity and excludes
  managed/login sessions. The DTO contains opaque terminal ids, catalog ids,
  redacted titles, creation time, status and current input owner, without output,
  paths, raw PTY ids or lease secrets. Unavailable/omitted entries are counted.
- The workspace is a full-screen focus-managed dialog. A project rail appears at
  1000 CSS pixels; the compact layout remains available below that width. Chrome's
  visual viewport sizes the dialog and input area when the software keyboard opens.
- Device-scoped local browser storage preserves the last workspace, selected
  terminal, unsent terminal/task drafts, pending commands and project-start stages.
  This is local draft storage, not a terminal output or artifact cache. Records
  ordinarily expire after 30 days; pending recovery records do not expire. Storage
  is capped at 24 records of 128 Ki characters each,
  with recovery records protected from normal eviction. Disconnect or observed
  device revocation clears the device's records. Storage failure blocks new command
  submission instead of losing its retry key.
- Input marks its draft uncertain before transmission and clears the marker only
  after acknowledgement. Following reload, a remaining marker blocks sending until
  the operator checks output and explicitly releases the draft. Terminal input is
  never automatically repeated. A lost connection does not prove process exit.

## Validation and remaining acceptance

Focused checks extend config, security, remote workspace and remote terminal
suites. `scripts/helpers/projectStartFlow.ts` runs inside the existing real
Electron/Chromium terminal suite: desktop settings, missing setup, dropped
successful provisioning reply, reload and retry, one Git project/PTY, a scaffold
file written through the actual terminal, offline recovery, draft preservation,
short tablet viewport and Continue Working. Its CLI is controlled fixture code;
it makes no real model call.

Final measurements are recorded in `TABLET_PROJECT_START_RESULTS.md`.
The physical Galaxy tablet, its real software keyboard/display lock, native
Linux/macOS, WSL project creation and home-host deployment need separate evidence.
Experiment promotion and a private application preview remain follow-up work.
