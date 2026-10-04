# ADE delivery roadmap

## Aktueller Stand (4. Oktober 2026)

Goal 34 ist unter **nativem Linux (Omarchy)** bis einschliesslich **34.5**
implementiert und geprüft; 34.6 steht bei H2b. Letztes vollständiges
`pnpm verify` (4. Oktober) **31 bestanden / 0 Fehler / 16 nicht gemessen** (nur
Windows), **114 Suiten / 4.735 Checks**. Der Windows-Job der GitHub-CI war vom
30. September bis 4. Oktober rot (Testfehler in `host-boundary`,
`desktop-clients` und `session-processes`, kein Produktfehler); mit den
Korrekturen vom 4. Oktober sind beide CI-Jobs grün (114 Suiten je Plattform,
`session-processes` unter Windows erstmals gemessen: 19 Checks). Details je Teilziel: [STATUS](STATUS.md),
[Fähigkeitsmatrix](AGENT_SESSION_PLATFORM_RESULTS.md), [Betrieb](HANDOFF.md).

| Teilziel | Linux-Stand | Offen |
|---|---|---|
| 34.1 Tablet-Zugriff | HTTPS :8443 persönlich aktiv, Kopplung erhalten | frischer Host, Windows, Mobilfunk |
| 34.2 Mehrere Sitzungen | Navigation **96/0**, geschützte Prompts/Profile, echte Codex-Proben | Windows-ConPTY, weitere native CLIs, physisches Tablet |
| 34.3 Betrieb | `pnpm activate` mit Gate/Backup/Rollback, Opt-ins für Autostart/Tray/Wachhalten, Unterbrechungsursache (Aktivierung **21/0**, Lebenszyklus **24/0**) | echter Rechnerneustart, physische Anmeldung/Sperre, Windows |
| 34.4 Entscheidungen | Gemeinsamer Einstieg mit Aktionen nach Fähigkeit, gebundenen Eingaben, Entwürfen (**56/0**) | echte Codex-Rückfrage über die Ansicht, Windows, Tablet |
| 34.5 Push | Web Push für bestätigte Run-Ereignisse, Testsperre mit Countdown, `renotify`, Burst-Grenze (**74/0**, Browser **33/0**); physischer Testempfang bestätigt | Empfang bei gesperrtem Tablet, echte Aufgabenereignisse am Gerät, Windows |
| 34.6 Unabhängiger Host | H0/H1 abgeschlossen; H2a Tresor-Kern und H2b nativer Linux-Schlüsselbund implementiert und isoliert gemessen, noch ohne produktive Verdrahtung ([H2-Schritte](HOST_SECRETS_H2.md)) | H2c Altstore-Migration/Konsumenten, H2d sichtbare Zustände/Abnahme; danach H3–H7. Desktop-Beenden stoppt weiterhin alle PTYs |

Commits der Stabilisierung: `5ea398f` (Push-Countdown), `198e39b` (34.4),
`e5fda7f` (34.3), `2dde188` (34.5). Persönliche Aktivierung dieser Commits
über `pnpm activate` wird in [HANDOFF](HANDOFF.md) protokolliert. Frühere
Zwischenstände des Tages (Aktivierungen 08:14, 10:35:46 und 12:32:53 CEST,
Verify-Läufe 103–105 Suiten) stehen in STATUS und HANDOFF.

## Offene Abnahmen durch den Benutzer

Diese Punkte kann kein Agent erledigen; sie blockieren H2c nicht.

| Abnahme | Was zu tun ist | Betrifft |
|---|---|---|
| Reboot-Nachweis H0 | Rechner neu starten, danach `bash scripts/spikes/h0/boot-collect.sh`; anschliessend Rückbau der Unit `ade-host-spike-boot.service` beauftragen ([Kontexthandoff](CONTEXT_HANDOFF_2026-10-03.md)) | 34.6, 34.3 |
| Tablet: Registrierung aufräumen | `idee-2026-10-02-0235` über „Aus ADE entfernen“ entfernen, falls noch sichtbar. Die Probe „Autokauf“ entfällt: Der Benutzer hat das Projekt am 4. Oktober auf Tablet und Workstation absichtlich gelöscht | Projektstart |
| Tablet: Entscheidungen und Unterbrechung | neue Entscheidungsaktionen und Unterbrechungsanzeige am physischen Gerät prüfen; echte Codex-Rückfrage über die Ansicht | 34.3, 34.4 |
| Tablet: Push | Empfang bei gesperrtem Bildschirm und für echte Aufgabenereignisse | 34.5 |
| Tablet: Mobilfunk und Audio | Zugriff ausserhalb des WLAN, Mikrofon/Diktat am Gerät | 34.1, 34.2 |
| Windows | Mehrsitzungs-, Aktivierungs-, Entscheidungs- und Push-Vertrag auf nativem Windows; 16 Verify-Schritte sind unter Linux nicht gemessen | 34.1–34.5 |
| Persönliche Aktivierung | `pnpm activate` für den Stand nach H1/H2b; sichtbar ändert sich nichts | Betrieb |

## Befunde aus dem Tablet-Test vom 4. Oktober 2026

Am physischen Tablet mit dem Stand `v0.1.0-stable.1` bestätigt: Verbindung ohne
neue Kopplung, Claude-Code- und Codex-Sitzung parallel im selben Projekt,
Wechsel zwischen beiden. Offene Punkte daraus:

| Punkt | Befund | Stand |
|---|---|---|
| Terminal-Sitzung wartet auf Eingabe | Eine interaktive CLI, die ihren Turn mit einer Rückfrage beendet hat, steht unter „Arbeitet“; ADE leitet aus dem laufenden Prozess bewusst keine Modellaktivität ab. Gewünscht: ein bestätigter Zustand „wartet auf dich“ unter „Braucht dich“, gespeist aus einem Turn-Ende-Signal der CLI (Hook/Notify von Codex und Claude Code), nicht aus Terminalruhe | beauftragt, nicht begonnen; Signalwege noch nicht geprüft |
| Auftrag endet mit Rückfrage | Ein einmaliger Claude-Code-Auftrag, dessen Antwort nur eine Rückfrage ist, erscheint als „Abgeschlossen“ (Exit 0, 0 Dateien); im Graph liess sich nicht antworten | umgesetzt: [Antwort auf beendete Aufträge](TASK_REPLY_PLAN.md) für Claude Code und Codex, Fortsetzung derselben CLI-Unterhaltung im selben Run. Offen: echte Probe am Tablet, Aktion direkt in der Übersicht |
| Überlappung im Tablet-Graph | Betreuungsplan-Kopf und Run-Leiste lagen übereinander | behoben, Treibernachweis Sitzungsnavigation 97/0 mit Negativkontrolle |
| Beendete CLI-Sitzung am Tablet | Nach `/exit` lehnte der Host Lebenszeichen und „Terminal beenden“ ab; die Fehlermeldung erschien alle zehn Sekunden, verschob den Knopf, und die Sitzung liess sich nicht entfernen | behoben (Host und Tablet), Remote-Terminal 84/0, Linux-Agent-Tablet 58/0 |
| Details-Spalte am Tablet zu schmal | Wunsch aus dem Test: die rechte Details-Spalte breiter ziehen | umgesetzt: Trenner mit Zug- und Tastaturbedienung, 280 bis 760 Pixel, pro Gerät gemerkt; `mobile-browser` 66/0 |
| Graph zeigt nur einen Run, Einzelaufträge heissen alle „Single task“ | Wunsch aus dem Test: mehrere Aufträge gleichzeitig sehen, erkennen worum es geht, Boxen verschieben | Tablet umgesetzt: Ansicht „Alle Aufträge“ mit verschiebbaren Boxen; Namen aus der am Gerät getippten ersten Zeile, ohne Auftragstext vom Host; `mobile-browser` 77/0. Offen: Desktop-Graph angleichen; Dateizähler und letzte Ausgabe in den Boxen; Namen für am PC gestartete Aufträge (bräuchte eine bewusste Öffnung des Host-Vertrags) |
| Sporadischer Fehler im Schlüsselbund-Treiber | `linux-secret-service` (H2b) schlug am 4. Oktober abends in 4 von 14 Einzelläufen fehl, einmal bei „electron-run-as-node: unlock allows native key provisioning“ mit `secret vault unavailable`; drei volle Verify-Läufe davor waren grün. Kein gemeinsamer Code mit den Änderungen des Tages | offen, vor H2c zu klären (Zeitverhalten des isolierten Schlüsselbunds unter Last vermutet, nicht belegt) |

## Beauftragt: Goal 35 — Zugang für Aufsichts-Sessions (3. Oktober 2026)

[Goal 35](SUPERVISOR_ACCESS_GOALS.md) macht die heute als Text erteilte
Vollmacht einer Aufsichts-Session zu einem geprüften, widerrufbaren und
protokollierten Vertrag mit eigenem, begrenztem Prinzipal. Es ist nicht
begonnen. 35.1 hängt nicht vom Host ab; 35.2 folgt nach 34.6 H3.

## Priorisiert: eigenständige Agent-Sitzungsverwaltung (30. September 2026)

[Goal 34](AGENT_SESSION_PRODUCT_GOALS.md) führt bestehende Sitzungs-, Remote-,
Betriebs- und Betreuungsverträge für native Linux- und Windows-Hosts zusammen.
ADE verwaltet seine Sitzungen eigenständig; OpenClaw ist keine Voraussetzung.
Die Umsetzung wurde beauftragt und beginnt mit 34.2: mehrere Agent-Sitzungen,
Fähigkeiten und Plattformnachweise. 34.1 ergänzt den eigenen Tablet-Zugriff,
34.3 den verlässlichen Plattformbetrieb. Danach folgen 34.4 Entscheidungen und
Eingriffe, 34.5 mobile Benachrichtigungen und 34.6 der unabhängige ADE-Host.
34.1–34.3 bilden die erste nutzbare Lieferung. Alle neuen Abnahmen bleiben offen;
frühere Funktionsnachweise gelten nur in ihrem dokumentierten Umfang.

34.2: [Fähigkeitsmatrix und Nachweise](AGENT_SESSION_PLATFORM_RESULTS.md): Linux-Kern
17/0, Desktop-/Tablet-Treiber 78/0, echte native Codex-Browserprobe 16/0.
34.1: persistierte HTTPS-Portwahl und separater Funnel-Hinweis, Mobile-Verträge
108/0. 34.3: Linux-Aktivierung mit Gate, Profilbackup, Sitzungsblockade und
Rollback, Electron-Nachweis 15/0. Vollständiges Linux-Verify: 25 bestanden,
0 Fehler, 17 ausdrücklich nicht gemessene Windows-Schritte. Persönliche
8443-Freigabe und TLS-Evidenz: [Betriebsstand](HANDOFF.md).
Linux-Profil-/Prompttransport ist inzwischen implementiert: native Prozesschecks
30/0, Profil-Electron 39/0, integrierter Tablet-/Agent-Ablauf 29/0. Codex 0.159.0
mit gpt-5.6-sol/high bestätigt in einer echten interaktiven Sitzung Profilinhalt,
Promptübergabe und reguläres Ende. Abschliessendes Linux-Verify **27 bestanden /
0 Fehler / 16 nicht gemessen**, **102 Suiten / 4.325 Checks**. Aktuelle Nachweise und Grenzen im
[Prüfstand](AGENT_SESSION_PLATFORM_RESULTS.md).
Nächste Abnahmen: physisches Android/Mobilfunk einschliesslich Audio, weitere
native Agenten sowie derselbe Mehrsitzungs- und Aktivierungsvertrag auf Windows.
Die Folgelieferung wurde am **1. Oktober um 08:14 CEST** sicher persönlich
aktiviert: Gate **13/0/1 nicht gemessen**, Backup/Rollback-Build vorhanden,
reales HTTPS/Assets geprüft, Kopplung und fremde Freigaben erhalten. Zuvor
blockierte die nach beendetem Codex verbliebene leere Shell den Sitzungsschutz;
Details im [Betriebsnachweis](HANDOFF.md).

Tablet-Rückmeldung am Abend: benannte Codex-Weblinks behalten jetzt ihr geprüftes
Ziel und öffnen vor der Navigation eine Adressvorschau. Linux-Browserablauf mit
Linkbedienung **87/0**. Persönliche Aktivierung dieser Ergänzung separat in
[HANDOFF](HANDOFF.md); aktive Sitzungen bleiben geschützt.

## Further proposed product slices

The active CLI, dictation, cost and terminal-latency work is defined at the top
of this roadmap. Physical Samsung/DeX/rotation and network-transition acceptance
remains necessary for mobile claims. Additional WSL backend flows and wider
accessibility/localization work need their own executable evidence.

Multi-host switching, target-host-approved access and SSH presets remain a
separate proposal: [Goals 28–30](MULTI_HOST_ACCESS_PLAN.md). Renumbering the plan
resolves duplicate identifiers and does not authorize implementation.

## Existing engineering tracks and exit criteria

The historical Goal numbering below is retained for contract traceability. Current support must be read with STATUS; a completed historical goal is not a new task.

## Goal 1 - runtime reliability baseline

Status: implemented; verification recorded in the Goal 1 commit.

- Distinguish interactive terminals from one-shot task sessions.
- Replace fixed-delay prompt typing with non-interactive runtime transports.
- Cap active task CLIs at four with a FIFO queue and cancellation.
- Reconcile main-owned sessions after renderer reload.
- Sequence replay and live output so attach cannot drop a chunk.
- Stop sessions when their agent/category is deleted; remove closed sessions;
  reap naturally exited sessions after a bounded retention period.
- Drive Graph completion from real process exit rather than timers.

Exit criteria: typecheck/build clean; memory, dispatch, and runtime reliability
checks pass; ConPTY smoke marker observed.

Verification: `pnpm run typecheck`, `pnpm test` (24 memory + 10 dispatch +
15 runtime assertions), and `pnpm run build` pass. The direct ConPTY smoke
reported `PTY_SMOKE_OK`; an isolated Electron dev launch created its config and
renderer data successfully, and its process tree was explicitly stopped.

## Goal 2 - run and task domain model

Status: implemented; verification recorded in the Goal 2 commit.

- Keep categories and named agents permanent.
- Add persisted `Run`, `Task`, `Participant`, `Event`, and `Artifact` entities.
- Make lead/worker roles run-scoped instead of permanent agent fields.
- Make Graph render normalized run events rather than timer/view state.
- Migrate existing Graph-created categories without deleting user data.
- Persist PTY start, completion, failure, cancellation, and restart recovery as
  normalized task events.
- Scope task cancellation to persisted task ids so one run cannot stop another.

Exit criteria: a run survives reload, status is reconstructible from its event
journal, and spawning a run does not create permanent categories or identities.

Goal 5 checkpoint verification (historical): `pnpm run typecheck`, `pnpm test` (24 memory + 12 dispatch +
16 runtime + 19 orchestration assertions), and `pnpm run build` pass. The
orchestration checks cover one-time legacy migration, reload reconstruction,
restart recovery, artifact journaling, and catalog identity preservation. An
isolated production preview at 1440x900 verified the default Graph layout,
Inspector reflow, and new-run roster dialog without overlap.

## Goal 3 - terminal beta

Status: implemented; verification recorded in the Goal 3 commit.

- Run Windows CI over typecheck, focused checks, a compiled Electron workflow,
  and an unpacked production-package smoke.
- Diagnose configured CLI availability, version, authentication and task
  transport without executing custom commands or changing credentials.
- Provide keyboard navigation for views and session tabs, including create,
  close, previous/next and direct tab shortcuts.
- Notify in the OS when background tasks finish/fail or an interactive terminal
  exits abnormally.
- Enable the renderer sandbox and a default-deny CSP; validate the main-frame
  sender and exact runtime payload for every privileged IPC call.
- Reconcile exit/removal events that race a renderer reload; preserve exit
  reason and output; show retry, restart, diagnostics and close actions.
- Produce an x64 NSIS installer and retain the verified node-pty Node-API
  prebuild inside the asar-unpacked payload.

Exit criteria: focused checks/typecheck/build clean; the production Electron
workflow proves real ConPTY I/O, reload recovery and failure/restart behavior;
the unpacked packaged executable passes the same workflow; an NSIS artifact is
created. Local artifacts may be unsigned, while release CI signs when the
Windows certificate secrets are configured.

Verification: `pnpm run typecheck`, `pnpm test` (24 memory + 12 dispatch +
16 runtime + 19 orchestration + 51 Windows security assertions), and
`pnpm run build` pass. The production Electron workflow passes 23 checks in
both the source-built app and `dist/win-unpacked/ADE.exe`. `pnpm package:win`
creates `dist/ADE-0.1.0-x64-Setup.exe`; the local artifact is deliberately
unsigned. Visual inspection at 1264x781 confirmed the failure bar and runtime
diagnostics modal do not obscure terminal or panel controls.

## Goal 4 - orchestration beta

Status: implemented; verification recorded in the Goal 4 commit.

- Runtime adapter interface, worker-specific tasks, structured results,
  worktree ownership, verification and integration.
- Prefer native runtime coordination where it is reliable; keep a file-based
  mailbox as a generic fallback.
- Add concurrency, token/cost and approval budgets per run.

Exit criteria: a managed run produces participant-specific work rather than
same-prompt fan-out; accepts only schema-valid results; owns clean worktrees for
its lifetime; stops for a durable human integration approval; transactionally
integrates every ADE-authored commit whose exact diff matches the worker report;
runs a distinct integration review and read-only verification; and fails closed
on missing required telemetry, exhausted budgets, dirty worktrees, runtime Git
history changes, report/diff mismatches, invalid commits or conflicts.

Verification: `pnpm run typecheck`, `pnpm test` (24 memory + 12 dispatch +
17 runtime + 19 domain-orchestration + 41 orchestration-beta + 56 Windows
security assertions), `pnpm run build`, and the 32-check production Electron
workflow pass. Goal 4 checks cover native Codex JSONL/schema wiring, strict
result validation, worker-specific planning, dependency/concurrency scheduling,
mailbox routing, exclusive leases, approval gating, usage budgets, exact-diff
ADE commits, full commit ranges, transactional conflict rollback, integration
and verification. The same Electron workflow is also run against the unpacked
Windows executable.

## Goal 5 - repository scopes and reusable agents

Status: implemented and locally verified; this Goal 5 commit records the result.

- Make repositories first-class catalog entries instead of category-owned
  paths. Preserve categories as organizational groups.
- Give an agent an optional default repository. An agent without one remains
  portable and may receive an explicit repository per session, task or run.
- Resolve one independent ADE worktree binding for each agent/repository pair;
  snapshot that immutable binding onto every execution.
- Add a repository-scope header above Files/Changes with repository, binding
  source, branch/worktree and lease state plus choose/default/detach actions.
- Never hot-switch a live PTY. Choosing another repo opens a new scoped session.
- Add immutable agent templates whose spawn creates an independent agent,
  memory directory and optional default repository.
- Migrate existing category `repoPath` and agent workspaces without deleting or
  moving user files, branches, worktrees, sessions or historical run state.

Exit criteria: a specialized agent can default to one repo; a portable agent
can work safely in at least two repos; Files/Changes always uses the selected
execution's actual binding; managed runs retain exclusive same-repository
worktrees and all current integration guarantees; template instances share no
mutable identity, memory or workspace; migration/restart is non-destructive.

Verification: `pnpm run typecheck`, `pnpm test` (24 memory + 12 dispatch +
17 runtime + 19 domain-orchestration + 41 orchestration-beta + 21 repository-
scope + 64 Windows security assertions), `pnpm run build`, and the 41-check
production Electron workflow pass. Goal 5 checks cover deterministic migration,
linked-worktree deduplication, two-repository reuse, concurrent binding
creation/rollback, physical-worktree uniqueness, portable/default resolution
across restart, template memory isolation/redaction and run/task/session/
artifact snapshots. The Electron workflow proves
plain-to-repository session creation, tab switching, renderer reload, exact
binding restart, full app restart and the complete managed integration
lifecycle. Detailed
decisions live in `docs/REPOSITORY_SCOPES_PLAN.md`.

## Graph P0 - orchestrator foundations

Status: implemented between Goal 5 and Goal 6; verification recorded in the
Graph P0a-P0c commits. Design sources: `docs/research/agent-orchestration/`
(GRAPH_ORCHESTRATOR_DESIGN.md P0 items) plus the mobile-readiness rules from
`REMOTE_CONTROL_PLAN.md`.

- Give events and messages one global monotonic `seq` (with one-time backfill)
  and a cursor-paged `run:events` query as the Goal 7 SSE base.
- Accept an optional `commandId` on mutating run commands and replay recorded
  successful outcomes from a bounded command log.
- Project sanitized `RunSummary` snapshots without absolute paths, prompts or
  mailbox bodies.
- Add main-owned team pause/resume that managed scheduling honors without
  cancelling running tasks; renderer idle state is manual-dispatch-only.
- Commit each logical phase transition (planning, working, approval,
  completion) as one atomic save.
- Move phase prompts into a versioned module; journal a path-free run context
  manifest and per-task context packets with bounded dependency results and
  provenance; tell the planner and workers that dependent worktrees inherit
  their dependencies' validated commits; inject agent memory as a read-only
  snapshot outside the leased worktree.
- Render every non-terminal run as its own canvas cluster with journal-driven
  edge/node activity, a visible task-slot/queue panel, a provenance inspector
  and live task-session attach on double-click.

Exit criteria: no orchestration semantics change beyond pause and atomicity;
summaries, manifests and prompts contain no absolute host paths; the focused
suite and the production Electron workflow stay green.

Current regression verification: `pnpm run typecheck`, `pnpm test` (Memory 27,
Dispatch 12, Runtime 29, Orchestration 45, Orchestration-Beta 100, Prompts 31,
Repository-Scopes 43, Workspace-FS 7 and Windows Security 99), `pnpm run
build`, and the 46-check production Electron workflow pass. Renderer behavior
was additionally
verified headless against a deep-cloning `window.ade` stub: multi-run
clusters, seq-gated travel dots, pause command wiring, provenance inspector
and task-session attach.

## Goal 6 - product validation

Status: **completed 2026-07-19 with a bounded GO for Goal 7.** F1-F8 and the
single-agent comparison arms are documented. The final F8v6 run completed on
a Codex-only (`gpt-5.6-sol`, bypass, orchestrator `xhigh`) roster after closing
the expected-failure representation, Codex stdin transport and integration
path-set prompt findings. Fixture protocol and result log live in
`docs/goal6/VALIDATION_PLAN.md` and `docs/goal6/RESULTS.md`; per-run metrics
are extracted with `pnpm goal6:report` (`scripts/goal6-report.ts`). The pilot
baseline (SHA `81820b9`, vitest 77/77, server 5/5, tsc clean) was recorded on
2026-07-14. The go/no-go follow-up "dependency-aware worker bases/ownership"
shipped 2026-07-21: dependent workers now start from a prepared worktree
containing their dependencies' validated commits. Focused real-Git coordinator
tests and completed live Codex reruns `3a2773cc` (F3) and `9bcd8932` (F4)
prove exact prepared bases, owned-delta integration, integration review and
verification with zero rollback. The excluded driver interruption and
external DNS outage, complete SHA evidence and cleanup state are recorded in
`docs/goal6/F3F4_RETEST.md` and `docs/goal6/RESULTS.md`.

- Validate the orchestration beta and the new repository bindings on the
  `2D_rpg_jumpnrun` repository using disposable ADE worktrees and branches. Do
  not touch its current working tree, update its main branch or push without
  separate approval.
- Define 6-10 representative tasks: isolated fixes, tests, a cross-file
  feature, refactoring and work with a credible parallel decomposition.
- Compare suitable tasks against a single-agent baseline using the same goal
  and acceptance criteria.
- Record completion, test/verification outcome, elapsed time, token usage,
  conflicts, integration attempts and human interventions. Cost remains
  unknown for adapters that do not provide trusted billed-USD telemetry.
- Resolve reliability or safety failures before adding a network control
  surface, then record an explicit go/no-go decision for the remote goals.
- Validate the resulting workflow with external users before a public remote
  beta or broader feature expansion.

Exit criteria: representative runs finish without losing user changes,
misreporting completion, crossing repository scopes, mutating worker history,
integrating an unreported diff or bypassing approval. Results identify where
managed multi-agent work is better, neutral or worse than the single-agent
baseline. Any critical safety failure blocks Goal 7.

Verification plan: task fixtures and measurements are committed separately
from changes to the pilot repository; ADE's full `pnpm verify` remains green.

## Platform track - Linux package and Windows GUI→WSL backend

Status: **implemented and locally plus hosted verified 2026-07-19; public
package-release gates remain.** This track is orthogonal to remote Goals 7-10
and is specified in `MULTIPLATFORM_PLAN.md`.

- Native Ubuntu/WSL2 builds Linux `node-pty`, passes the focused/source
  Electron gates and produces unpacked x64, AppImage and Debian artifacts.
- AppImage, unpacked and Debian-payload artifacts pass the same 47-check
  packaged workflow; Debian metadata/payload are valid. The first hosted
  release workflow also passed installed-`.deb` verification and uploaded
  SHA-256 artifacts.
- Windows ADE now imports an explicit `wsl:<distribution>` repository and
  routes its Linux paths, Git, files, worktrees, diagnostics, PTY and managed
  run through that distribution without fallback or mixed-Git access.
- Local WSL evidence is 31/31 backend integration checks and 67/67 extended
  Electron/Playwright checks, including a complete managed run, app restart,
  reopen and cleanup.

Remaining release gates: establish the public license/release policy, publish
checksummed versioned Linux assets, add clearer
first-run WSL prerequisite guidance, and keep macOS explicitly unverified.

## Verified publishing track - repository Draft PRs and CI handoff

Status: **implemented and locally verified 2026-07-19.** This is a local,
explicit desktop capability and not part of the remote Goals 7-11 command
surface. The binding contract is `VERIFIED_PUBLISHING_PLAN.md`.

- Atomically attest the exact clean repository HEAD and verification task when
  a managed run completes; legacy completed runs remain ineligible.
- Add a read-only Graph preflight for repository identity, approved integration,
  final test evidence, unchanged remote base, exact candidate range, safe
  generated branch and GitHub CLI access.
- Require a second explicit operator confirmation before any external write.
  Create only a new collision-protected `ade/run-*` branch and GitHub Draft PR;
  expose no default-branch push, force update, branch deletion or merge action.
- Persist requested/completed/failed publication state and recover interrupted
  I/O as retryable failure. Verify an exact existing branch/PR on retry and keep
  errors/evidence credential- and local-path-redacted.
- Execute Git and `gh` in the repository's native or selected WSL backend and
  show the provider check rollup without treating it as a merge decision.
- Keep publishing absent from the future mobile/remote API. A bypass coding
  agent remains a fully trusted OS process; this product gate does not claim to
  sandbox a malicious agent from ambient Git credentials.

Exit criteria: 29 focused publication contracts exercise real isolated Git
pushes plus deterministic provider behavior; security validation covers exact
new IPC payloads; Electron/Playwright proves preview, disabled-before-confirm,
exact remote branch, Draft-PR audit, unchanged `main` and restart persistence.
The full Windows source gate is 446 focused assertions plus 56 Electron checks.
Before any real target-repository PR, its existing local worktree remains
untouched and the external push receives separate operator authorization.

## Repository inspector track - selected-repository context

Status: **implemented and locally verified 2026-07-19.** The binding and noise
budget are defined in `REPOSITORY_INSPECTOR_PLAN.md`.

- Separate the selected catalog repository Overview from active-session
  Changes/Files instead of silently mixing their scope.
- Show bounded local branch, dirty/sync health and 12 recent commits without a
  fetch; load only the chosen full-SHA commit patch into the shared capped diff
  pane.
- Discover at most 20 open GitHub PRs through host-qualified, backend-local
  `gh`; render provider/offline/auth errors independently from local history.
- Revalidate repository identity, IPC payloads and external PR URLs in the
  trusted boundary; expose no repository or provider mutation.
- Use semantic roving tabs, stable panel mounting, narrow-width reflow and
  deterministic close/focus behavior so added information remains navigable.

Exit criteria: 16 focused repository-inspector checks cover real isolated Git,
dirty/history/diff caps, malformed provider data, unsafe URLs and WSL backend
propagation; security reaches 108 assertions; the 64-check Electron/Playwright
workflow proves selection, PR rendering, keyboard tabs, lazy diff, focus and
refresh. The complete Windows gate is 465 focused assertions plus build and
Electron workflow.

## Overview home track - ADE journal inventory

Status: **slices A and B implemented 2026-08-19.** Densification/charts
stay unbuilt until the interactive journal has operator time.

- Project catalog, bindings, runs and live PTYs into a third top-level mode
  without new telemetry or inspector polls.
- Keep unknown token/cost fields unknown; do not reuse `usageByRun`'s zero
  fill for the hero number.
- Persist interactive session bookends (start/end, no transcripts) and mix
  closed sessions into Work; last activity includes bookends.
- Leave Overview on click: agents, projects and sessions open Terminals,
  runs open Graph.

Exit criteria: focused projection and bookend-journal checks; config
migrates a missing `sessionBookends` array; Electron/Playwright proves a
closed interactive session appears in Work and opens Terminals.

## Goal 7 - transport-neutral core and local host API

Status: **local command surface complete (2026-09-06). Goal 8 now supplies
the durable device store, audit and interactive browser pairing.** The first slice added a transport-neutral
application service plus mobile-safe health/catalog/run DTOs and a
disabled-by-default, Bearer-authorized HTTP adapter fixed to `127.0.0.1` with
`GET /api/v1/health`, `/catalog` and `/runs`. The second slice (2026-09-03)
added the resumable `GET /api/v1/events` stream over the journal `seq`, the
device-signed, idempotent managed-run commands `POST /api/v1/runs`,
`/runs/{id}/start` and `/runs/{id}/cancel`, the per-channel remote
authorization requirement in the IPC policy and host-path redaction for
everything that leaves over the wire. The third slice (2026-09-06) adds the
bounded single-task submission `POST /api/v1/tasks` as the first-class
`runTask:submit` command (atomic run/participant/task record, main-owned
launch, journal-driven progress) and lets `run:cancel` end a manual run's
work. The original environment bootstrap stays loopback-only. Goal 8 adds a
separate paired browser path through private Tailscale Serve; public ingress
remains unavailable.

The orthogonal Linux/WSL/macOS track no longer blocks this goal's local
foundation: Linux packaging and the hybrid Windows-to-WSL execution backend are
implemented and hosted-verified. Versioned package publication and macOS work
remain separate from the remote API security gates below.

Prerequisite closed 2026-09-03 (`PROFESSIONALIZATION_REVIEW_2026-07-26.md`,
Thema 2): the managed-run loop is repeatable over the same worktrees without
manual Git — an explicit per-run opt-in archives and resets divergent worker
worktrees onto the orchestrator base, late results on ended runs no longer leak
leases, and a per-task time budget bounds hanging CLIs. The loopback API can
therefore drive consecutive runs without inheriting a one-shot defect.

Prerequisites closed 2026-09-06 (Thema 3 and Thema 5): finished and failed
runs stay readable long after their sessions ended (pinned older runs, full
results, `run:report`, failed test commands in the alert, approval
notification, `integration.applied` with `fromSha`/`toSha`, rotating main log,
Graph keyboard path); the journal is bounded (compact config, `OrchestrationView`
without prompts/bodies coalesced per tick, archive-before-prune retention with
a monotonic `seq` floor so the SSE cursor contract survives pruning).

Prerequisite closed 2026-09-03 (Thema 6, boundary hardening): every IPC
channel carries a typed privilege policy (`effect`/`surface`/`audit`) with
`surface: 'shared'` reserved for read-only operations the host API may expose;
handler errors and backend stderr leave main only through one redaction
funnel; stored keys reach WSL through `WSLENV` instead of argv; dashboard
windows guard redirects and scope cookie persistence to their origin; ADE
events and sender trust are bound to registered renderer windows; native
workspace reads apply the link discipline of mutations. The write/SSE slice
built on this: the run channels it needs moved to `shared` together with the
per-channel authorization requirement the policy test now demands.

- [x] Extract the first transport-neutral ADE application boundary from Electron IPC so
  desktop IPC and remote HTTP commands share authorization, validation and
  orchestration behavior; `run:getSummary` now uses the shared projection.
- [x] Add mobile-specific DTOs with repositories and agents as independent choices
  instead of exposing `AdeConfig`, raw IPC channels or the complete desktop
  orchestration snapshot.
- [x] Extend the versioned loopback-only read API with managed-run
  create/start/cancel (explicit `repositoryId`/`agentIds`) and a resumable
  server-sent event stream (bundled snapshot, `Last-Event-ID`/`?cursor=`
  resume, strictly ascending `seq`, no duplicates, bounded clients and
  per-client buffer). Proven by `scripts/test-host-api.ts` against a real
  loopback server, a real `RunCoordinator` and real TCP reconnects.
- [x] Bounded single-task submission (`POST /api/v1/tasks`) with explicit
  agent/repository ids as a first-class application command
  (`runTask:submit`): one atomic save for run, participant, task and
  idempotency record; the one-shot task session launches through the managed
  task launcher without blocking the reply; a refused launch is journaled as
  a failed task; the wrapping run is cancellable and cannot be started as a
  managed orchestration. Proven by `scripts/test-host-api.ts` (122 → 163)
  against a real coordinator, including replay, key reuse, concurrent
  duplicates, prompt/path absence on the wire and the launch-failure path.
- [x] Require idempotency keys for mutations and monotonic cursors for reconnecting
  event clients. The key is bound to channel and payload digest through the
  coordinator command log; exact retries replay, concurrent duplicates coalesce,
  and a retry with another payload is rejected — no duplicate run or launch.
- [x] Lift `shared ⇒ read` per channel instead of deleting it: shared mutations
  must be in `REMOTE_COMMAND_CHANNELS` (`run:create/start/cancel`,
  `runTask:submit`) and demand `runs:write` scope, a device signature, an
  idempotency key and audit (`ipcPolicy.ts`, pinned by the security suite;
  rationale in `ARCHITECTURE.md`).
- [x] Keep the listener disabled by default and reject non-loopback binds, unknown
  hosts/origins, invalid content types, chunked or oversized requests,
  malformed payloads, unknown/unsigned/stale/tampered device proofs and
  bearer-only commands.
- [x] Replace live environment-device authorization with a durable revocable
  store and persist remote audit entries outside the main log (Goal 8 step 1).
  The old environment device is a one-time migration; Goal 8 adds QR pairing.

Exit criteria: local API integration tests can drive and reconnect to a full
managed run without changing the Electron workflow; duplicate, reordered,
unauthorized and malformed requests fail closed. No interactive PTY, arbitrary
IPC, filesystem/configuration mutation or absolute host path crosses the API.
Met for create/start/cancel and the event stream on 2026-09-03 and for
bounded task submission on 2026-09-06; the paired-device model is Goal 8's
first deliverable.

## Goal 8 - personal mobile companion alpha

Status: device inventory, pairing, browser sessions, private Tailscale setup and
responsive PWA implemented (2026-09-08). Physical-device/carrier acceptance stays
open until measured. Concrete Goals **8.2 pairing**, **8.3 Tailscale**, **8.4 PWA**
and **8.5 connection evidence** are defined in `goal8/MOBILE_CONNECT_PLAN.md`;
validation and limitations are in `goal8/MOBILE_CONNECT_RESULTS.md`.

Goals **8.6 shared desktop appearance**, **8.7 Overview/Work**, **8.8 Graph and
inspector**, and **8.9 continuity/validation** are implemented and locally
validated; criteria are in `goal8/MOBILE_DESKTOP_PARITY_PLAN.md`.
These use the existing remote DTOs and preserve the active host during
development; activation waits for a normal
restart unless the operator explicitly authorizes one. Evidence is recorded in
`goal8/MOBILE_DESKTOP_PARITY_RESULTS.md`.

Step 1 adds Settings → Verbundene Geräte, encrypted persistent identities,
rename/revoke, tombstones, immediate HTTP/SSE disconnection and a bounded fsynced
audit. Production reads require a signed active device as well as the bearer.
Already accepted runs continue; revoke removes access, not completed domain effects.
The new storage suite and real HTTP/Electron workflows cover restart, stale
bootstrap, audit failure, encryption, keyboard/focus and compact layout.
The follow-on implementation includes five-minute one-use QR/manual pairing,
non-exportable browser signing keys, 30-minute secure sessions, exact origin/CSRF,
signed idempotent commands, independent task/managed-run forms and resumable
fetch-based SSE. Offline state disables submissions and caches only public shell
assets. Desktop opt-in controls a private Serve route; conflicting routes and
Funnel fail closed. Next: real devices on a mobile network, platform/browser
matrix, then the remaining availability work before privileged remote approvals.

Windows evidence and exact final gate counts are recorded in
`goal8/MOBILE_CONNECT_RESULTS.md`: all three TypeScript projects, focused suites,
production build, real Electron, Chromium mobile and visual flows, additional
WebKit measurements, and the actual PC's private HTTPS route. Physical iOS and
Android acceptance and new Linux/macOS execution evidence remain open.

- Build an installable responsive PWA for host readiness, sanitized project
  and agent selection, single-agent tasks, managed runs, budgets, live run
  state, results and cancellation.
- Select repository and agent independently; the ADE core resolves the same
  immutable execution binding used by the desktop Files/Changes panel.
- Use Tailscale Serve as the supported personal-alpha ingress. ADE remains
  bound to loopback; Tailscale Funnel, direct LAN binds and public router ports
  are unsupported.
- Pair each phone from the trusted desktop with a short-lived, one-use QR
  challenge and issue a separate revocable ADE device identity.
- Use exact Origin/Host checks, short-lived secure sessions, CSRF protection,
  rate/request limits and an app-shell-only service-worker cache.
- Persist an audit record for pairing, authentication and every remote mutation;
  provide desktop device inventory and immediate revocation from the first
  remotely writable release.
- Make desktop availability explicit: the host must be powered on, logged in,
  online and running ADE.

Exit criteria: from a phone on a mobile network, a paired device can create,
start, observe, reconnect to and cancel single- and multi-agent work. An
unpaired or revoked device receives no catalog, project or run data; a network
retry cannot duplicate a command. The mobile client exposes no terminal,
configuration, raw command or unrestricted file surface. Every mutation is
attributable, and device revocation closes active HTTP responses and event streams
immediately and denies subsequent requests. Already accepted ADE work remains
locally controllable and is not implicitly rolled back or cancelled.

## Goal 9 - remote approvals, audit review and notifications

Status: planned after Goal 8.

- Add a mobile integration-approval view with the exact changed-file set,
  tests, risks, commit SHAs and an optional bounded diff.
- Require recent passkey/device reauthentication for approve/reject; a normal
  remembered session is insufficient for the privileged transition.
- Extend the audit record with approval evidence and step-up authentication
  context, and add a bounded audit viewer/export without credential contents.
- Add opt-in Web Push only for completion, failure and approval-required
  events; mobile offline state never queues an implicit future command.

Exit criteria: approval is single-use, durable, attributable and protected by
step-up authentication. Revocation takes effect immediately for commands and
event streams, audit survives restart, and notification failure cannot change
run state.

## Goal 10 - available and recoverable desktop host

Status: close-to-tray slice implemented alongside Goal 8 (2026-09-08).
Login startup, sleep policy and broader restart recovery remain planned.

- Add tray/headless host mode in the logged-in user session and an opt-in start
  at Windows login. Do not run task CLIs as a pre-login Windows service.
  Closing an enabled mobile host now keeps the existing process/window in the
  tray; explicit tray quit shuts down normally. This is not headless startup.
- Publish host/version/readiness health and a clear last-seen/offline state.
- Reconnect the mobile event stream after host, app or network restart without
  losing or inventing run transitions.
- Optionally prevent sleep only while a run is active; ordinary idle behavior
  remains under user control.
- Exercise active run, pending approval and interrupted-task recovery through
  host and Windows restart workflows.

Exit criteria: after login the opted-in host becomes reachable without opening
the desktop window, remains low impact while idle, and recovers every persisted
run to an explicit safe state. A sleeping/offline host is reported accurately;
remote wake and unattended pre-login execution remain out of scope.

## Goal 11 - remote product hardening

Status: planned after personal-alpha validation.

- Reassess indexed storage only after measured history/audit or latency pressure
  justifies migrations, backup and corruption-recovery costs. Bounded retention
  with per-run archive files exists since 2026-09-06 (Thema 5); an archive
  browser, `run:events` delta consumption in the renderer and `React.memo`
  on Graph slices are the remaining renderer-side cost items.
- Ship signed releases and an authenticated auto-update path before asking
  non-technical users to keep an always-available host current.
- Decide from alpha evidence whether to support Cloudflare Tunnel plus Access
  or an ADE-operated outbound relay for users without a tailnet client.
- Threat-model accounts, multiple desktops/users, relay end-to-end encryption,
  abuse handling and recovery before implementing any hosted control plane.
- Consider native iOS/Android packages only if the PWA has demonstrated a
  concrete platform limitation worth two additional release pipelines.

Exit criteria: history and audit remain bounded and recoverable, updates are
authentic, the selected ingress has end-to-end authorization tests, and a
documented security review approves any public-beta exposure. Additional terminal
capabilities beyond the dedicated granted API, public port forwarding, remotely initiated or unattended
integration/push, Wake-on-LAN and unattended pre-login execution require
separate goals. The local, separately confirmed Draft-PR publisher above is not
exposed through these remote goals.

Detailed scope, trust boundaries and endpoint exclusions live in
`docs/REMOTE_CONTROL_PLAN.md`; repository-binding behavior and migration live
in `docs/REPOSITORY_SCOPES_PLAN.md`.

## Gelieferte Abschnitte

Abgeschlossene und datierte Lieferabschnitte vom 11. bis 25. September 2026 liegen
unverändert im [Archiv-Checkpoint vom 4. Oktober](archived/ROADMAP_2026-10-04_CHECKPOINT.md).
