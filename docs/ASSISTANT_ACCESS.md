# Assistant terminals, dashboards and Overview

The Overview now offers **Terminal öffnen / fortsetzen** for each agent on
desktop and Mobile. This opens the saved profile in its own workspace, with no
project required. It reuses the newest running interactive home session launched
with that profile; otherwise the explicit click starts one. Opening a saved
Mobile workspace after reload only attaches; it never starts a process. Existing
sessions require **Eingabe übernehmen** before typing. **Neue Sitzung starten**
keeps the explicit shell/profile/runtime launcher available.

For Hermes General, keep the existing WSL home and `general --tui` profile.
For Sentinel, keep its WSL home and `openclaw tui` profile. ADE hosts those
processes on the PC. Their own authentication, models and conversations remain
owned by the provider. This change does not merge dashboard chats with a TUI
conversation or attach arbitrary processes started outside ADE.

Mobile uses xterm with direct keyboard input, colors, cursor positioning and
application cursor/bracketed-paste modes. Touch can focus the terminal; the
existing composer and special-key buttons remain available. Text history is
available under **Textausgabe und Verlauf**. Direct assistant entry starts in a
large terminal view; **Workspace einblenden** restores project/file controls,
and **Text verfassen** expands the optional composer. Input is serialized and coalesced
over a short buffer. A missing acknowledgement clears queued unsent keys and
requires explicit review; it never replays keys after reconnect. The desktop can
reclaim control at any time. Closing the workspace leaves the process running.

**Web-Dashboard** opens a separate tab on Mobile. Configure a fixed private HTTPS
Tailscale URL in the existing desktop agent profile (for example the Hermes
`/login` page or the OpenClaw root page). The dashboard performs its own login.
Mobile does not execute dashboard commands, forward credentials, proxy pages,
or embed them in ADE. URLs with userinfo, fragments, unsafe query parameters or
non-Tailscale hosts are withheld with a setup hint. The only accepted query is
a simple `profile` selector. Desktop retains its existing dashboard behavior.

Overview refreshes on catalog changes, process exits/removal, orchestration
changes and window focus, and has an explicit **Overview aktualisieren** button.
Mobile refreshes its catalog every 15 seconds while visible and offers
**Aktualisieren**, even when a catalog edit produces no run-journal event.
**Aktuelle Arbeit** shows open/approval runs; **Historie** shows ended sessions
and other runs; **Alles** combines them. Historical identities stay in the run
record after an agent or project is removed. Detached records are marked
**Aus ADE entfernt**; a session belonging to a deleted agent cannot be opened.
Open runs are prioritized before the bounded recent-history limit. Project cards
show their current workspace assignments. Removing a workspace or agent does
not imply that its repository has been removed from the project catalog.

**Neues Projekt** is now in the shared Mobile toolbar on Overview, Work and Graph.
The configured project root and existing project-start recovery are unchanged.

## Transport and limits

The existing signed device terminal endpoints and `terminal:control` grant remain
the boundary. No generic remote IPC/shell channel was added. A main-side headless
terminal follows interactive PTY output from process creation across chunks and
resizes. Mobile receives a sanitized rendered frame, not raw PTY bytes. Complete
soft-wrapped logical lines pass through `redactForWire` before projection; unsafe
lines are rebuilt without their original cells. Known host paths and credentials
are hidden. OSC/DCS, links, clipboard operations and arbitrary terminal control
sequences never cross this boundary. Main synthesizes only bounded positioning,
SGR and selected keyboard/cursor modes. Redaction can shorten a displayed line.
The shell response carries a fresh style-only CSP nonce, applied through xterm's
`documentOverride` to its generated style elements. Inline scripts remain blocked;
neither `unsafe-inline` nor `unsafe-eval` is enabled. See the upstream
[xterm security guidance](https://xtermjs.org/docs/guides/security/) and
[CSP nonce model](https://www.w3.org/TR/CSP/latest).

Frames are polled every 400 ms while visible and online. There is no raw PTY
WebSocket stream. At most 240 columns × 100 rows are sent; the main display caps
its buffer at 500 × 200 with 200 history rows. Excessively styled frames fall
back to plain cells. Oversized frames or output backlog fail closed without
stopping the desktop process. Transcript is capped at 64 KiB of text; pending
headless output at 2 MiB. Mouse reporting and terminal file transfers are not
offered. Only the device with the input lease changes the PTY size.

Keyboard buffering is at most 8 KiB; individual signed packets are at most
2 KiB UTF-8, with a 200 ms coalescing interval and the existing sequence,
idempotency, audit and 30-second lease rules. UTF-8 characters are never split
between packets. Unknown acceptance remains visible across a page reload.

Validation results and operator deployment: `ASSISTANT_ACCESS_RESULTS.md`.
