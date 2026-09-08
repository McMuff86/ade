# Remote workspace tools — Goals 16–19

Requested 2026-09-08 after the operator updated the home ADE. Implement in this
order. Existing Goals 12–15 remain the provisioning/synchronization foundation.

## Goal 16 — workspace, files and Git

- [x] Agent selection opens a project-specific workspace, even without a session.
- [x] Bounded lazy file tree, filename search and text preview.
- [x] Changed files with staged/unstaged diffs, branch and recent commits.
- [x] Read-only requests never provision a workspace; explain missing bindings.
- [x] Catalog identities and relative paths only; revalidate root/Git identity,
  refuse links and secrets, redact wire text, keep truncated/redacted files read-only.
- [x] Focus, keyboard, phone/tablet layouts and real domain/browser evidence.

## Goal 17 — explicitly granted interactive terminal

- [x] Separate desktop-only device grant with a plain explanation of Windows
  user-level command execution; existing devices gain no terminal rights.
- [x] Dedicated application API, no desktop PTY/IPC proxy and no widening of
  REMOTE_COMMAND_CHANNELS. Resolve agent/project on the host.
- [x] Start configured agent or shell, attach existing interactive sessions;
  managed-task sessions never accept remote terminal input.
- [x] One input owner across desktop/tablet, bounded output, reconnect to the
  same session, no automatic replay of uncertain input, immediate revocation.
- [x] Permission, ownership, duplicate-input and real Electron/terminal tests.

## Goal 18 — small text edits

- [x] Text editor with line numbers, search, undo and explicit save.
- [x] Revision check and conflict comparison; never overwrite a changed file.
- [x] Separate file-write device grant, atomic bounded writes, preserve encoding
  and newlines, refuse managed/busy workspace, secrets, links and Git metadata.
- [x] Draft preservation and identity cleanup; domain and browser tests.

## Goal 19 — profile maintenance

- [x] Existing agent names/roles and profile photos visible and editable remotely.
- [x] Bounded validated photo upload/read through authenticated application API.
- [x] Desktop and tablet share stored profiles; no arbitrary configuration edits.
- [x] Focus/error/loading states and positive/negative tests.

## Delivery

- [x] Architecture/spec/status/roadmap/handoff and operator grant guide updated.
- [x] Full native Windows pnpm verify succeeds; record exact evidence and limits.
- [ ] Commit and push verified delivery. Home activation remains an operator step.
