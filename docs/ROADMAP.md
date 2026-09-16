# ADE delivery roadmap

## Aktives Goal 31 — Ollama-Coding-Harness wählen

**31.1** ergänzt die Auswahl Codex CLI/Qwen Code und persistierte Profile;
**31.2** liefert Start-, Berechtigungs-, Profil- und Ergebnisverträge;
**31.3** umfasst reale PC-/Tablet-/Modellproben, Gesamtprüfung und Aktivierung.
Beide Auswahlpfade und Qwen3-Coder-Dateibearbeitung sind fokussiert positiv
geprüft. `pnpm verify` besteht vollständig mit 72 Suiten / 3.088 Fachchecks,
Build und allen App-/Browser-/Visualprüfungen. Commit, finaler Build und
persönlicher Neustart folgen.
[Detaillierter Liefervertrag](OLLAMA_HARNESS_GOALS.md). Andere Goals bleiben
unverändert; Goal 6 bleibt ausschliesslich native Codex-Validierung.

## Vorherige Lieferung

Aktuelle Operatorrückmeldung: neuer Build funktioniert. Live-Diktat wird auch
auf dem Tablet gebraucht; Codex, Claude Code und Grok erhalten scharfe
Profilbilder. Tablet-Live-Anbindung und gebündelte Vektorlogos sind implementiert
und mit 57 durchgehenden Diktatchecks geprüft; `pnpm verify` besteht vollständig.
Codecommit **441f0ce**, finaler Build und persönlicher Neustart sind abgeschlossen.
Profile, Projekte und Gerätekopplung sind erhalten; Tablet-Seite mit HTTP 200
erreichbar. Persönlicher Tablet-Mikrofontest bleibt offen.
[Stand und Nachweise](LIVE_DICTATION_RESULTS.md).

Neue Operatorrückmeldung: Diktat funktioniert wie gewünscht; Arbeit mit Ollama-
Anbindung und sichtbaren verfügbaren Modellen fortsetzen. Ollama-Coding über die
Codex CLI und direkter Modellchat sind implementiert und fokussiert geprüft.
Gesamtprüfung in zwei Teilläufen bestanden; persönliche Aktivierung nach
Neustartfreigabe abgeschlossen: Ollama-Profil mit `qwen3-coder:30b` und 13 sichtbaren
Modellen. Sicherung und Betriebszustand stehen im [Handoff](HANDOFF.md).
Interaktive Ollama-Verbrauchserfassung bleibt offen; bisherige native
Codex-/Claude-/Grok-Erfassung verwendet CLI-Quellen, keinen Reverse Proxy.
[Ollama-Nachweise](OLLAMA_RESULTS.md). Andere offene Ziele bleiben offen.

## Aktives Ziel: laufende CLI-Arbeit und Diktat (15. September 2026)

Operator bestätigt die neue Ordnung der vier Originalprojekte und beauftragt
die nächsten Goals: **Goal 27** führt interaktive CLI-Sitzungen in Work/Overview
zusammen; **Goal 23.1 Desktop** ergänzt einen sitzungsgebundenen Promptentwurf
und ElevenLabs-Diktat mit gezielter CLI-Übergabe. Reihenfolge: Arbeitsliste,
Orientierung/Wechsel, Textentwurf, Diktat, vollständige Abnahme und Windows-Build.
Desktop-Arbeitsliste, erste native Latenzoptimierung und Diktat bestehen die
vollständige Code-Abnahme mit 3.735 Checks; Windows-Paket mit zehn weiteren
Checks geprüft. Reale ElevenLabs-/Codex-/Claude-/Grok-Proben sind erfolgreich.
Der frühere CLI-Checkpoint `b2e134e`/`5ea3b3c` ist gepusht; persönliche Aktivierung
der neuen Lieferung wegen offener WSL-Sitzung ausstehend. Auch Diktatcommit
`128b503` ist inzwischen gepusht. Die anschliessende erste Projektansicht und der
mobile Prompt-Projektname sind fokussiert geprüft. Das native Verbrauchsjournal
ist mit neuen CLI-Starts und der PC-/Tablet-Sitzungsanzeige verbunden und besteht
130 native Vertragschecks. ElevenLabs-STT-/TTS-Versuche sind mit weiteren 36
Vertragschecks angebunden, samt sitzungsbezogenen Audiosekunden und getrennten
Antwortzuständen. Die neue Gesamtabnahme und der weitere Goal-24-Ausbau laufen noch.
[CLI-Nachweise](CLI_WORK_LATENCY_RESULTS.md), [Diktat-Nachweise](DICTATION_IMPLEMENTATION_RESULTS.md).
Erweiterung: Goal 23.1 umfasst auch mobiles Tablet-Diktat; Goal 25 zur Messung
und Optimierung der Tablet-Terminal-Latenz ist ebenfalls aktiver Lieferumfang.
Die Desktop-Lieferung allein erfüllt diesen erweiterten Auftrag nicht.
Weiterer Auftrag: **Goal 24** um die implementierbare Verbrauchs-/Kostenbilanz
für Codex, Claude Code, Grok und ElevenLabs erweitern. Zähler, Quelle und
Abrechnung unterscheiden; [führender Plan](USAGE_AND_COST_GOALS.md).
Zusätzlich beauftragt: vollständiger Dokumentationsabgleich gegen Code,
Abnahmen und Zielstruktur; dieser ist Teil der abschliessenden Lieferung.
[Umfang, Abnahmekriterien und weitere priorisierte Verbesserungen](CLI_WORK_AND_DICTATION_GOALS.md).

Die folgenden Liefernotizen sind datierte Meilensteine. Frühere Pendenzen und
Prozess-IDs beschreiben den jeweiligen damaligen Stand; aktueller Betrieb steht
in [HANDOFF](HANDOFF.md), eindeutige Zielnummern im [Zielregister](GOAL_REGISTRY.md).

## CLI direkt im Workspace und Terminal-Bedienung

Workspace-Auswahl ohne Agent-Zuweisung, direkte Codex-/Claude-/Shell-Aktionen,
optionale Profile und Desktop-Terminalwerkzeuge sind implementiert.
Die vollständige UI-/Gesamtabnahme ist bestanden und in
[Workspace-Terminals](WORKSPACE_TERMINALS_RESULTS.md) dokumentiert.

## Desktop/Tablet-Bedienung angleichen

Work wird auch am PC als eigener Reiter mit derselben Filterauswahl angeboten.
Profile können über die normalen PC-Agent-Einstellungen bearbeitet werden,
einschließlich Anweisungen, Markdown-Kopien und Stimme. Umsetzung und neue
Electron-Prüfungen sind abgeschlossen; `pnpm verify` ist vollständig grün.
Abnahme und persönliche Aktivierung um 06:49 Uhr sind in
`WORK_PARITY_RESULTS.md` dokumentiert. Die übrigen Sprach-, Quoten- und
Mehr-PC-Meilensteine bleiben separat geplant.

## Sprache, Projektauswahl und Terminal-Bedienung

### Bisheriger Meilenstein: mobile Stimme und wirksame Agent-Profile

Benutzerauftrag vom 13. September, 23:57 Uhr: nach der aktuellen Abnahme
weiterarbeiten und Aktivierungen zu spürbaren Verbesserungen bündeln.
Keine Neustarts im 5–10-Minuten-Takt; Commit/Push, Build und persönlicher
Neustart erfolgen pro sinnvollem Meilenstein.

- **Goal 23.0a:** globale Stimmenwahl und fester Stimmtest auf dem Tablet;
  Provider-Key bleibt am PC, eigene begrenzte Remote-Berechtigung. Implementiert,
  fokussiert geprüft, persönlich seit 14. September 00:54 Uhr aktiviert;
  vollständige Prüfkette in zwei Teilläufen bestanden (Details in HANDOFF).
- **Goal 23.0b:** optionale Stimmen pro Agent und Projekt. Auflösung:
  explizite Agent-Stimme → Projekt-Stimme → ADE-Standard; bei einer normalen
  CLI ohne Agent-Profil gilt Projekt → Standard. „Erben“ ist ausdrücklich
  auswählbar; die Oberfläche zeigt die wirksame Stimme und ihre Herkunft.
  Implementiert und geprüft; mobile Standard-, Agent- und Projektwahl sowie
  Zurücksetzen und Vererbung bestehen die Browser- und Domain-Abnahme.
- **Goal 26.1a:** Agent-Profil mit Spezialisierung, konkreten Arbeitsanweisungen
  und zuweisbaren Markdown-Dateien. Bestehende Repository-Anweisungen bleiben
  wirksam; Identitätsanweisungen liegen außerhalb geleaster Repositories.
  Editor und native Transportanbindung implementiert, geprüft und seit
  14. September 02:41 Uhr persönlich aktiviert (`661b41a`).
  Echte einmalige Codex-/Claude-Proben bestätigen Profilmarker in `exec`/`-p`;
  interaktiver ADE-Lifecycle wird separat geprüft.
- **Goal 26.1b:** Kontextansicht zeigt Herkunft, Reihenfolge, Version/Digest
  und tatsächlich beim Start verwendete Anweisungen. Profiländerungen gelten
  für neue Sitzungen; laufende Sitzungen erhalten einen Versionshinweis.
  Start-Digest/Quellen, expliziter Vergleich und eingefrorener Sitzungstext sind
  angebunden; 39 Electron-Prüfungen bestanden. Gesamtabnahme vollständig grün.
- **Goal 26.1c:** Profil vom Agenten und Projekt aus bearbeiten/auswählen;
  spezialisierter Agent oder normale Codex-/Claude-CLI bleibt eine bewusste
  Auswahl. Eine Rollenbeschreibung ist keine zusätzliche Systemberechtigung.
  Native Windows-Codex-/Claude-Profile geliefert; weitere Runtime-Transporte
  benötigen eigene Nachweise. Projektübergreifende Main-Chef-Delegation bleibt
  Goal 26.2 ff. gemäß Koordinationsplan.

Abnahme: Desktop und Tablet, Vererbung/Zurücksetzen/Neuladen, fehlende Stimmen,
widerrufene und eingeschränkte Geräte, bestehende Sitzungen, tatsächlicher
CLI-Kontext sowie unveränderte Projekt-AGENTS.md und Agentbindungen.

Desktop-Stimmenwahl/Stimmtest, Meine ADE Projekte und einklappbare mobile
Terminal-Bedienung werden im aktuellen Arbeitsstand umgesetzt und geprüft.
Erweiterungen: **Goal 23 Diktat**, **Goal 24 belastbare CLI-Nutzungsdaten**,
**Goal 25 gemessene Tablet-Latenz**. Reihenfolge, Quellen und messbare
Abnahmekriterien stehen im [Ausbauplan](VOICE_USAGE_TERMINAL_PLAN.md).
Der bestehende [Multi-Host-Plan mit Goals 28–30](MULTI_HOST_ACCESS_PLAN.md)
bleibt Grundlage für einen zweiten Tailscale-PC; konkrete erste Abnahme ist
Hostwechsel zwischen zwei getrennt gekoppelten ADE-Hosts.
Diese Ausbauziele sind geplant, keine Freigabe bereits unterstützter Funktionen.

**Goal 26 Main Chef** ergänzt zuweisbare, versionierte Markdown-Anweisungen,
Projektverantwortliche und einen Koordinationsauftrag über getrennte Runs je
Repository. Der vom Benutzer angeforderte Sub-Agent hat dazu den
[Main-Chef-Plan](MAIN_CHEF_COORDINATION_PLAN.md) erstellt. Erste Lieferung:
Anweisungen zuweisen und wirksamen Kontext vor dem Start anzeigen; danach
namensbasierte Projektauswahl und begrenzte Delegation.

## Tablet-Bedienung und einzelne Projekte

PC-Import einzelner Projekte, gespeicherte Tablet-Seitenbreiten und korrigierte
PWA-Startnavigation sind implementiert. Chromium-Prüfungen decken externe
Navigation und Wiederanmeldung mit Geräteschlüssel ab. Der reale Android-PWA-
Launcher bleibt eine Geräteabnahme. [Details](TABLET_POLISH_RESULTS.md).

## Mobile Commit-Details

Commit-Metadaten, Dateistatistik und historische Datei-Diffs sind umgesetzt und
auf Tablet-/Smartphone-Größen mit Chromium geprüft. Persönliche Aktivierung
erfolgte am 13. September um 21:17 Uhr. Gesamtabnahme bleibt durch den bereits
bekannten Codex-Quota-Fixture-Timeout offen; Commit-Prüfungen bestehen.
[Nachweise](MOBILE_COMMIT_DETAILS.md).

## Linke Navigation anordnen

Sichtbarer Desktop-Modus für Projekt-, Obergruppen- und Agent-Reihenfolge
implementiert und im echten Windows-Electron geprüft (zwölf Anordnen-Checks).
Gesamtabnahme bleibt durch den Codex-Quota-Fixture-Timeout offen. Persönliche
Aktivierung samt Anordnung und fehlenden Profilbildern erfolgte am 13. September,
20:53 Uhr, auf ausdrücklichen Benutzerauftrag.
[Nachweise](RAIL_ORDERING_RESULTS.md).

## Historischer Zwischenstand: Terminal, Aboanzeige und Git-Bedienung (13. September)

Vom Benutzer angeforderter Zwischencommit für den PC-Abgleich. Native Codex-
Quotaabfrage und Bedienhilfen sind implementiert; Gesamtprüfung, Latenzmessung
und persönliche Aktivierung stehen aus. Claude/Grok bieten den CLI-Einstieg.
[Fortsetzung](WORKSPACE_IMPROVEMENTS.md).

## Terminalverlauf (13. September 2026)

Direkter mobiler Verlauf und ruhige Leseposition sind implementiert und fokussiert
geprüft. Vollständige Abnahme und Aktivierung der persönlichen Instanz stehen noch
aus. [Nachweise und Grenzen](TERMINAL_SCROLL_RESULTS.md).


## Abgeschlossen: Terminals, Übernahme und Obergruppen (13. September 2026)

Freie Terminals, CLI-Auswahl, Projektbrowser und geprüfte Workspace-Zuweisung
sind auf Desktop/Mobile umgesetzt. Dazu kommen die geprüfte Übernahme älterer
Änderungen, optionale Agent-Obergruppen und das Löschen abgeschlossener Runs auf
Mobile. Vollständiges `pnpm verify`: **3.018 Checks bestanden** — 48 fokussierte
Suiten mit 2.329 Checks und 689 reale Electron-/Browser-Prüfungen, einschliesslich
22 visueller Vergleiche. Alle drei TypeScript-Projekte und Produktionsbuild bestehen.
RhinoLayoutTools enthält die in Rhino 8/9 geprüfte FastenerPlace-Palette auf
`main`, nach `origin/main` gepusht als `5c4b820`.
ADE-Code ist als `bab7df7` nach `origin/main` gepusht. Seit 12:48 Uhr
Europe/Zurich läuft genau eine geprüfte ADE-Instanz (PID **53592**); die bisherige
Instanz 35068 ist beendet. Hermes Agent, OpenClaw und GrokBuild liegen unter
**Agent-Systeme**. Sechs Agenten, fünf Projekte und die Gerätekopplung sind erhalten.
Private Mobile-HTTPS-Auslieferung stimmt per SHA-256 mit dem geprüften Build
überein. Mobile einmal neu laden. Dieser Betrieb ersetzt die älteren Einträge unten.
[Übernahme-Vertrag](WORKSPACE_INTEGRATION.md) · [Teilziele und Evidenz](INTEGRATION_NAVIGATION_GOALS.md).

## Projekte durchsuchen und Workspace-Zuweisung (12. September 2026)

Mobiler Projektbrowser mit Vorschau und bestätigter Workspace-Zuweisung ist
implementiert und unter Windows mit **2.880 Checks** vollständig abgenommen.
Genau eine persönliche ADE-Instanz wurde mit dem geprüften Stand neu gestartet.
[Workspace assignment](WORKSPACE_ASSIGNMENT.md).

## Freie Terminals und Mobile-Terminalansicht (12. September 2026)

Aktuelle Ergänzung: direkte native Home-Terminals ohne Agent/Projekt und ein
eigener Mobile-Reiter mit Agent-/Sitzungsnavigation, CLI-Auswahl und Darstellung.
Native Windows-Abnahme mit **2.828 Checks** und Start genau einer geprüften
ADE-Instanz abgeschlossen. Siehe [Terminal workspace](TERMINAL_WORKSPACE.md).

## Tablet-Arbeitsplatz: Windows-Abnahme und Neustart (12. September 2026)

Freigaben, Startwiederholung, native Codex-Rückfragen mit Live-Aktivität sowie
haltbare Ergebnisdateien und Ergebnisseiten sind implementiert. Vollständiges
`pnpm verify`: 2.770 Prüfungen bestanden, zusätzlich 5 reale Codex-Prüfungen.
Die geprüfte ADE-Kopie läuft mit dem persönlichen Profil; private HTTPS-Adresse,
bestehende Samsung-Kopplung, fünf Projekte und sechs Agentenprofile sind geprüft.
Physisches Samsung/DeX und das nicht antwortende Ubuntu bleiben offen.
[Teilziele](TABLET_WORKSPACE_GOALS.md), [Abnahme und Operatorzustand](TABLET_WORKSPACE_RESULTS.md).
Die darunter genannten älteren Gesamtprüfungen gelten für ihre damaligen Stände.

Status: 2026-09-11. [Capabilities](STATUS.md), [project workflow tasks](PROJECT_WORKFLOW_GOALS.md)
and [current product review](research/ADE_PRODUCT_REVIEW_2026-09-10.md) have distinct roles.
Intermediate delivery notes are preserved in the [checkpoint archive](archived/ROADMAP_2026-09-10_CHECKPOINT.md).

## Delivered baseline from September 11

September 11 follow-up S0–S3 is delivered: guided desktop setup, explicit grant
presets and Mobile orientation/build identity. Full pnpm verify passed with
2,651 checks, including 26 focused and 37 real setup-flow checks. The verified
ADE release has restarted with pairing/Serve preserved. Evidence and task commits:
[ONBOARDING_GOALS](ONBOARDING_GOALS.md). The September 10 project workflow remains
the earlier baseline below.

Project root → checkout/branch → optional-profile CLI → Git commit/merge/push/PR
is implemented for native Windows. T7 adds observed run-file changes and downloads
from Graph and project Results. T6 completed the guide, documentation audit and
full `pnpm verify` with 2,588 passing checks. Task commits form one final delivery;
the operator build and publication are recorded in HANDOFF. The extra WSL
lifecycle recheck remains blocked at a read-only readiness probe.

## Delivered follow-up: live run activity and questions

The September 11 follow-up delivered sequenced activity, native Codex questions
on desktop/mobile, result-file storage and retained-history pagination. Its
later full Windows verification and personal-host activation are recorded in
[TABLET_WORKSPACE_RESULTS](TABLET_WORKSPACE_RESULTS.md). The earlier listener
collision and pending restart are historical observations, not current blockers.
Separate WSL lifecycle evidence must not be inferred from native Windows tests;
the subsequently checked Sentinel/Hermes entry points are recorded in HANDOFF.

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
