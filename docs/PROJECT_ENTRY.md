# Mobile project entry and readable terminals

Mobile has four navigation tabs: Overview, Projekte, Work and Graph. Projekte
lists searchable project cards. Both these cards and Overview project cards open
the project workspace entry; Work remains the entry for managed tasks and runs.
New Project remains available in the toolbar, using the configured PC project
root and the existing recoverable Codex scaffold flow.

For an existing project, choose **Workspace öffnen**, then **Arbeiten mit**:
Codex, Claude CLI, Grok CLI or Leeres Terminal. The first click prepares or reuses
the ADE agent/project working copy; no CLI starts until its explicit Open action.
Files, Git and the terminal use that same binding. The UI labels it an
ADE-Arbeitskopie and shows its branch. It does not relocate a checkout or silently
edit the repository's original working directory.

The entry defaults to a native profile assigned to that project, otherwise the
configured native Codex start profile, otherwise an existing native Codex profile.
If none exists, it can create the existing standard Codex profile. The optional
Workspace-Profil disclosure allows an explicit different profile/workspace.
It never falls back to an unrelated first agent such as Hermes. This entry
requires a verified native repository; WSL assistant homes remain a separate flow.

Preparation uses existing signed application-service endpoints. Workspace reads
require `workspace:read`, creation/preparation requires `catalog:write`, terminal
access requires `terminal:control`. Browser checkpoints precede every mutation.
An uncertain preparation retains its receipt across reload, normal draft
eviction and expiry. Reopening does not automatically replay a command. A fresh
overview check reuses ready bindings, including busy interactive workspaces,
without attempting to prepare them again. No generic remote IPC channel, host
path or client-selected command was introduced.

Session choices now also include the fixed `claude` and `grok` modes on desktop
and Mobile. Discovery checks executable presence in the selected environment;
main rechecks before launch. A found executable does not prove authentication or
model access. Explicit CLI choices use that CLI's defaults, clear foreign model
pins/custom commands, and use default permissions. Saved agent-profile mode
retains the original command, model and permissions. No profile is rewritten.

In an agent workspace the primary action is **Agent name öffnen**. It opens or
reuses the latest running saved-profile terminal and expands the terminal view.
This also works when a blank shell was previously selected. For Hermes this
preserves `general --tui`; for OpenClaw it preserves the configured TUI command.
Project CLI Open actions reuse a running session with the selected launch mode
in the same workspace. **Neue Sitzung starten** explicitly creates another one.

The empty composer and advanced launcher start folded. Direct typing leaves them
folded. Uncertain composed input stays reviewable, and an unsent draft survives
reload. Opening/claiming a terminal can focus its direct input; resizing and
routine frame refreshes never steal focus. The ordinary terminal has a 220 px
minimum display height; the expanded view gives it the remaining viewport,
with a 120 px floor and scrolling when controls need more space.
Dashboard links still open a separate private tab.

When the software keyboard reduces Chrome's visual viewport, the terminal
automatically hides its launcher, transcript, idle composer and routine notes.
The header retains the project/agent title, **Bedienung** and Close; a single
scrollable row retains all eight terminal keys with 44 px touch targets. The
terminal fills the remainder, with an 80 px minimum in this compact view.
**Bedienung** restores controls while the keyboard stays open. Closing the
keyboard restores the previous layout and resets this temporary override.
An actively edited composer, unsent text, errors and uncertain-input recovery
remain available. Pointer taps on the toggle/terminal keys retain input focus;
keyboard activation and dialog focus fallback also work.

Detection compares the visual and layout viewport heights: more than 160 px
and 20% reduction, at scale 1 (within 0.05). Small browser toolbar changes,
ordinary desktop window resizing and pinch zoom do not trigger compact mode.
This targets visual-only keyboard resizing; floating keyboards that do not
reduce that viewport cannot be detected this way. Executable geometry coverage
and physical-device limits: `TERMINAL_KEYBOARD_RESULTS.md`.

Evidence and operator deployment: `PROJECT_ENTRY_RESULTS.md`.
