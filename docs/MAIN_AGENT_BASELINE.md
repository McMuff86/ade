# ADE-Agent: Ausgangsstand und Prüfungen

17. September 2026, Ausgangscommit **465b639**. Bestandsaufnahme für die
[vorbereiteten Goals](MAIN_AGENT_GOALS.md), keine Implementierung des neuen
Assistenten und keine repositoryweite oder native Multi-Agent-Abnahme.
Der Checkout war zu Beginn sauber. Persönliche Profile und laufende persönliche
Agenten wurden nicht für die Prüfungen verwendet.

## Was im Code bereits verbunden ist

| Bereich | Befund im aktuellen Quellstand | Lücke zum Benutzerbild |
|---|---|---|
| Desktop: Sitzung wieder öffnen | `CliWorkPanel` → `openCliSession` → `openProjectSession`; tatsächliche Sitzungs-ID, Workspace und Branch werden geprüft; Navigation startet keine PTY | Gemeinsamer projektübergreifender ADE-Einstieg und direkte Rückkehr aus einer Betreuung fehlen |
| Tablet: Weiterarbeiten | `ContinueWork` lädt `/api/v1/terminal/sessions`; `main.tsx` übergibt bei Projektarbeit Workspace-ID und Terminal-ID an `ProjectOpenIntent` | Übersicht liegt unter Overview; keine vollständige Parität zur gefilterten Desktop-CLI-Arbeitsliste, kein globaler Betreuungsdialog |
| Tablet: Terminals | `terminalTarget` und `RemoteTerminalPane` unterscheiden freien Terminal, Projektworkspace und Agent-Home; Eingabebesitz wird separat behandelt | Einfache durchgängige Wechsel zwischen drei Projekten, Graph und ADE samt Entwürfen sind noch gesondert abzunehmen |
| Projektstarts | `createProjectInteractive` startet feste CLI-Auswahl oder ausdrücklich ausgewähltes Profil im geprüften Checkout; normale CLI erzeugt keine zusätzliche Agent-Identität | Gewähltes Profil, Prozess und langfristig zuständiger Projektagent sind noch keine gemeinsame Betreuungszuordnung |
| Verwaltete Arbeit | `RunCoordinator`, Journal, Scheduler, Ergebnisberichte und Mailbox; je managed Run gemeinsame Git-Identität; maximal vier aktive Task-Sessions im PTY-Scheduler | Elternbetreuung über getrennten Projekten fehlt; vier Task-Slots begrenzen nicht sämtliche interaktiven oder nativen Unteragenten |
| Einzelaufgabe | `submitSingleTask` erzeugt atomar Run/Teilnehmer/Task und startet über den Tasklauncher | Einzelaufgabe ist kein dauerhafter Dialog und kein vollständiger managed Integrationslauf |
| Native Adapter im Code | Codex-JSONL, Claude-Stream-JSON, Grok-Streaming-JSON, strukturierte Ergebniswege | Beweist noch keine einheitliche laufende Gesprächssteuerung, Wiederaufnahme oder Unteragentensichtbarkeit |
| Fragen | `RunQuestionService` und Codex-App-Server-Prozess mit aufgabenbezogener Antwort und Empfangsbestätigung | Kein gleichwertiger Frage-/Antwortweg für alle drei CLIs nachgewiesen; Vermittlung durch den ADE-Agenten fehlt |
| Desktop-Graph | `buildClusters` / `GraphView` zeigen Runcluster, Teilnehmer und Aktivität; Inspektor/Report und Terminaldock | Keine dauerhafte ADE → Projekt → Sitzung/Run-Beziehung für das beschriebene Gesamtbild |
| Tablet-Graph | `Graph` erhält einen ausgewählten `MobileRunSummary`; Teilnehmerknoten, Aktivität, Resultate und Dateien; Runtime-Symbol wird derzeit über einen eindeutigen Namensvergleich im Katalog bestimmt | Projektübergreifende Elternansicht und direkte Sitzungsnavigation fehlen; Runtime-Anzeige muss bei doppelten Namen aus stabiler Identität/gespeichertem Laufzeitstand folgen |
| Direkte Betreuung | Interaktive Eingabebesitzregeln und getrennte managed Leases existieren | `createProjectInteractive` lehnt bei aktiver managed Lease derselben Git-Identität ab; Übernahme benötigt einen neuen ausdrücklichen Vertrag |
| Sprache | Gemeinsame Sprachleiste, Diktat, Computer-Aufruf und geprüfter Vorleseweg | `dictation:prepare` verlangt eine konkrete Sitzung; globaler Dialog ohne Terminal sowie aktionsfähiger ADE-Agent fehlen |
| Morgenüberblick | Ergebnisberichte, Agent-Memory und ein Vorschlag für Sprachrückblick vorhanden | Projektübergreifende dauerhafte Abendübergabe, eigener Gesprächsstand und belegter Morgenplan fehlen |

Codequellen: [Desktop-Wechsel](../src/renderer/work/openCliSession.ts),
[Auswahl](../src/renderer/stores/selection.ts),
[Tablet-Weiterarbeiten](../src/mobile/ContinueWork.tsx),
[Tablet-Navigation](../src/mobile/main.tsx),
[Tablet-Projekte](../src/mobile/ProjectDirectoryPage.tsx),
[Tablet-Terminals](../src/mobile/Terminals.tsx),
[Tablet-Graph](../src/mobile/Graph.tsx),
[Desktop-Graph](../src/renderer/graph/GraphView.tsx),
[PTY](../src/main/pty/PtyManager.ts),
[Coordinator](../src/main/orchestration/RunCoordinator.ts),
[Adapter](../src/main/orchestration/runtimeAdapters.ts),
[Fragen](../src/main/orchestration/RunQuestionService.ts),
[Diktat-IPC](../src/main/ipc.ts).

## In dieser Vorbereitung ausgeführte Prüfungen

Lokale Logs und Exit-Metadaten: `test-results/main-agent-planning/`.
Die nachstehenden Zählungen gehören zum aktuellen Audit, nicht zu alten
Aktivierungsberichten. Die Electron-Driver verwenden isolierte temporäre
Profile und Testrepositories. CLI-Prozesse sind dabei deterministische Fixtures;
die Prüfung löst keine reale Codex-/Claude-/Grok-Modellarbeit aus.

| Aufruf | Ergebnis | Aussage |
|---|---|---|
| `pnpm install --frozen-lockfile` | Exit 0 | Fehlende lokale Abhängigkeit `@xterm/addon-search` aus bestehendem Lockfile ergänzt; kein Paket-/Lockfilewechsel |
| `pnpm build` | Exit 0 nach Installation | Aktueller Desktop-/Tablet-Produktionsbuild erstellt; erster Versuch scheiterte an fehlender lokaler Abhängigkeit |
| `pnpm exec tsx scripts/test-cli-work.ts` | 25 bestanden, 0 Fehler | Identität, Sortierung, Filter, ehrliche CLI-Zustände und profilfreie Projekte |
| `pnpm exec tsx scripts/test-project-launch.ts` | 50 bestanden, 0 Fehler | Projekt-/Branch-/Profilwahl und feste Startverträge |
| `pnpm exec tsx scripts/test-run-questions.ts` | 26 bestanden, 0 Fehler | Aufgabenbezogene Rückfragen und bestätigte Antworten über Protokollfixture |
| `pnpm exec tsx scripts/test-orchestration-beta.ts` | 151 bestanden, 0 Fehler | Bestehende Koordination, Adapter-/Ergebnisverträge, Leases, Abhängigkeiten und Zeitbudgets |
| `pnpm exec tsx scripts/test-terminal-workspace-identity.ts` | **8 bestanden, 1 Fehler; Exit 1** | Windows verweigert Dateisymlink-Erzeugung (`EPERM`); Test endet beim Aufbau der HEAD-Symlink-Fixture |
| `pnpm exec tsx scripts/test-work-electron.ts` | 20 bestanden, 0 Fehler | Desktop Work, Fokus, Auswahl, idempotenter Aufgabenentwurf und Übergang zum richtigen Run im Graph |
| `pnpm exec tsx scripts/test-remote-terminal-electron.ts --workspace-cli-only` | 75 bestanden, 0 Fehler | Reale Electron-/Browser-/PTY-Flows mit CLI-Fixtures, gleicher Workspace, Tablet-Weiterarbeiten ohne Doppelstart, Desktop-CLI-Liste |
| `pnpm exec tsx scripts/test-remote-terminal-electron.ts --run-inspection-only` | 27 bestanden, 0 Fehler | Graph-Aktivität, vollständige Ergebnisse und Dateien über Desktop/Tablet |
| `pnpm exec tsx scripts/test-remote-terminal-electron.ts --tablet-layout-only` | 20 bestanden, 0 Fehler | Bestehende Tablet-Navigation und Layout, kein neuer Drei-Projekte-Ablauf |

Damit bestehen acht vollständige Suiten/Driver mit **394 Prüfungen**. Die
zusätzliche Identitätssuite ist mit 8/1 unvollständig; ihre acht positiven
Teilprüfungen machen die Suite nicht grün.

Der Identitätstest ist **kein bestandener Negativnachweis**: Die vorbereitende
Symlink-Erstellung schlug fehl, bevor die beabsichtigte Ablehnung durch ADE und
der abschliessende positive Kontrolllauf erreicht wurden. Auf einem Windows-
Testhost mit erlaubter Dateisymlink-Erstellung erneut ausführen; keine
Produktprüfung abschwächen und keinen bestandenen Gesamtlauf ableiten.

`pnpm verify` wurde für diese Dokumentationsvorbereitung nicht ausgeführt.
Die vorhandenen Prüfungen belegen einzelne Grundlagen. Der kombinierte Ablauf
mit drei nativen Modellagenten, ADE-Koordination, Langzeitfortsetzung und einem
physischen Tablet ist **offen**. Native Windows ist die Umgebung dieses Audits;
Windows→WSL, native Linux/WSLg und macOS wurden hier nicht neu geprüft.

## Nächste ausführbare Prüfung

Nach Auflösung der Dateisymlink-Testvoraussetzung zunächst den fehlgeschlagenen
Identitätstest mit seinem positiven Abschluss wiederholen. Dann Goal 26.6 mit
einer Matrix je tatsächlicher CLI-Version und Sitzungstyp abschliessen; die
vorhandene UI ist Grundlage für Goal 27.3. Die geplanten neuen Driver stehen im
[Pilotplan](MAIN_AGENT_GOALS.md#durchgängiger-pilot-und-testlieferung) und sind
noch keine vorhandenen Kommandos.
