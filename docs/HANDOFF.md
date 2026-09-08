# Handoff — 2026-09-08

## Goals 8.6–8.9 — mobile Oberfläche an Desktop angeglichen

Auftrag: Mobile möglichst wie die lokale ADE gestalten und die bereits
verbundene persönliche Sitzung während der Arbeit erhalten. Basis: `9483353`.
Goals und Abnahme: `goal8/MOBILE_DESKTOP_PARITY_PLAN.md` und
`goal8/MOBILE_DESKTOP_PARITY_RESULTS.md`.

- **Oberfläche:** Tatsächliche Desktop-Tokens, Dark/Light, `ade_`-Leiste,
  Overview/Work/Graph, Agents/Projects, Run-Suche und Statusfilter. Der Graph
  zeigt Teilnehmer und Teams mit Zoom/Einpassen; der Inspector sitzt auf dem
  Tablet daneben und öffnet auf dem Smartphone als modale Detailansicht.
  Neue Aufgabe/Neuer Run verwenden Dialoge mit vorbefüllter Agent-/Projektauswahl.
- **Verbindung und Daten:** Ein `useMobileHost` über alle Ansichten hält
  Authentisierung/SSE unabhängig von Navigation, Theme und Auswahl. Unversandte
  Entwürfe bleiben im Seitenspeicher; Widerruf/lokales Trennen leert private
  Zustände. Nur Ansicht und Theme werden als Präferenz gespeichert. Unklare
  Befehle verwenden weiterhin dieselbe Idempotenz-ID. Keine neuen Endpunkte,
  Privilegien, Browser-Schlüsselschemata oder persönlichen Geräteidentitäten.
- **Ehrliche Projektion:** Aktive Task-Slots statt erfundener Terminalaktivität,
  unbekannte Token-/Kostenangaben bleiben unbekannt. Graph-Verbindungen zeigen
  Teamrollen, keine nicht gelieferten Task-Abhängigkeiten. Detaillierte Reports,
  Terminals, Dateien, Git und Freigaben bleiben in der Desktop-App.
- **Bedienung:** Roving Tabs, Graph Enter/Space/Escape, Dialog-Fokusbindung und
  Rückgabe an Opener oder existierenden Ersatz. WebKit-Pointeraktivierung setzt
  den Opener explizit; die drei anfänglichen Fokusfehler sind im positiven Lauf
  behoben. Layouts von 320×568 bis 1280×800 sind automatisiert geprüft.
- **Validierung:** `pnpm verify` vollständig grün: drei TypeScript-Projekte,
  **21 Suiten / 1337 Checks**, beide Production-UIs, **163** Electron-, **20**
  Git-sync-, **54** Chromium-Mobile-, **15** Mobile-Electron- und **22** visuelle
  Checks; zusätzlich **53 WebKit-Checks**. Logs:
  `goal8/MOBILE_DESKTOP_PARITY_RESULTS.md`. Chromium/WebKit verwenden echte
  Domain-/HTTP-Dienste mit deterministischen Runtime-Fixtures; Electron nutzt
  Wegwerfprofile. Physisches iOS/Android und Mobilfunk bleiben separate Abnahme;
  Windows-WebKit misst weder SameSite-Introspektion noch Offline-Kaltstart.
  Der vorhandene Host-API-Negativtest verändert nun garantiert die Signatur:
  Ein abschliessendes `0` wurde zuvor zufällig durch dasselbe `0` ersetzt.
  Die produktive Authentisierung bleibt unverändert; der fokussierte Lauf
  besteht alle 184 Checks inklusive negativem und folgendem positivem Kontrollfall.
- **Operatorzustand:** Der persönliche Host bleibt derselbe Prozess (PID 19188,
  Loopback-Port 4317). Keine Profiländerung, kein Logout/erneutes Pairing, keine
  Änderung der privaten Serve-Route und kein erneuter Tailscale-Operatorfixture
  gegen den belegten Host. **298 HTTPS-Proben über 49 Minuten, kein Ausfall**;
  anschliessend nur den eigenen Messprozess beendet.
  **Die laufende Sitzung zeigt weiterhin die zuvor geladenen Assets.** Die neue
  Ansicht wird erst nach einem vom Nutzer gewählten normalen ADE-Neustart und
  Neuladen am Mobilgerät sichtbar; die Gerätekopplung bleibt erhalten. Anleitung:
  `goal8/MOBILE_CONNECT_GUIDE.md`, „Neue Version aktivieren“.

---

## Goal 8.2–8.5 — Tablet/Smartphone über privates Tailscale

Auftrag: Nach Git-Abgleich und Geräteverwaltung den mobilen Einstieg umsetzen,
weitere Goals definieren und die Verbindung bis zur echten HTTPS-Messung testen.
Die vorhandenen uncommitteten Git-/Geräteänderungen und visuellen Baselines wurden
erhalten. Neue Goals und Abnahmekriterien: `goal8/MOBILE_CONNECT_PLAN.md`.

- **Bedienung:** Settings → **Mobiler Zugriff** aktiviert die private
  Tailscale-Serve-Freigabe. **Tablet oder Smartphone koppeln** zeigt einen
  fünf Minuten gültigen einmaligen QR-/manuellen Code. Das Mobilgerät braucht
  Tailscale im selben Tailnet. Die responsive PWA kann Einzelaufgaben starten,
  Managed Runs vorbereiten/starten, Fortschritt anzeigen und Runs abbrechen.
  Gerätewiderruf bleibt in Settings → Verbundene Geräte.
- **Vertrag:** Loopback `127.0.0.1:4317`, exakter privater HTTPS-Origin,
  OS-verschlüsselte Host-Keys, nicht exportierbarer Browser-Schlüssel,
  Secure/HttpOnly/Strict-Sitzung, CSRF und signierte idempotente Befehle.
  Lebenszyklus/Kopplung sind vier Desktop-only IPC-Kanäle; kein erweiterter
  Remote-Command-Allowlist. Audit, Rate-/Asset-Grenzen und Widerruf greifen
  auch bei offenen SSE-Verbindungen. Fremde Serve-Routen und Funnel blockieren
  die Aktivierung. Automatisch aus Prompts gebildete Titel werden in Summaries
  ersetzt, auch bei vorhandenen Records; gespeicherte Daten bleiben erhalten.
- **Zuverlässigkeit:** Neuladen und Host-/Netzwechsel stellen die Gerätesitzung
  wieder her. Ein unklarer Auftrag wird mit derselben ID geprüft; Widerruf
  löscht alte Wiederholungen. Abbrechen erhält andere Formularentwürfe und
  setzt den Fokus auf den Run. Der Service Worker hält nur die öffentliche
  App-Hülle. Bei aktiviertem mobilem Zugriff hält Schliessen ADE im Tray;
  ausdrückliches Beenden stoppt den Host. Loginstart und Schlafpolitik folgen.
- **Echte Verbindung:** Tailscales erste DNS-/ACME-Bereitstellung verursachte
  zunächst Timeouts. Nach abgeschlossener Bereitstellung bestanden **9 echte
  HTTPS-Checks**, ohne TLS-Bypass oder DNS-Fixture. ADE unterscheidet jetzt
  eingerichtete Freigabe und per Zertifikatsprüfung bestätigte Erreichbarkeit.
  Fehler sind nicht als positive Evidenz gezählt. Details/Operatoraufruf:
  `goal8/MOBILE_CONNECT_RESULTS.md` und `goal8/MOBILE_CONNECT_GUIDE.md`.
- **Gesamt-Gate:** `pnpm verify` vollständig grün auf nativem Windows:
  drei TypeScript-Projekte, **21 Suiten / 1337 Checks**, beide Production-UIs,
  **163** bestehende Electron-, **20** Git-sync-, **24** Chromium-Mobile-,
  **15** Mobile-Electron- und **22** visuelle Checks. Zusätzlich **23 WebKit-
  Checks**; dessen Windows-SameSite-Introspektion und Offline-Kaltstart gelten
  ausdrücklich nicht als iOS-Evidenz. Das bestehende Grok-Terminaltest-Rennen
  wartet nun auf beide Ausgabezeilen, statt die erste als vollständige Ausgabe
  zu behandeln. Finales Gate: `test-results/mobile-verify-final.log`.
- **Operatorzustand:** Mobiler Zugriff im vorhandenen persönlichen Profil
  aktiviert und ADE regulär mit `pnpm start` gestartet. HTTPS-Hülle 200,
  ungepaarter Katalog 401, Loopback-Bind und kein Debugging-Endpunkt bestätigt.
  **9 Agents, 4 Repositories und 4 Runs** vor/nach Aktivierung unverändert;
  lokale Config-Sicherung unter `userData/ade/backups`. Keine Testidentität
  im persönlichen Profil. Private Serve-Route und Opt-in bleiben für Neustarts
  erhalten. Keine persönlichen Repository-Aufgaben gestartet, nichts committed
  oder veröffentlicht. Für das echte Gerät jetzt in Settings den QR-Code öffnen.
- **Offene Abnahme / Folgegoals:** Physisches iOS/Android, Home-Screen-Installation
  und Mobilfunkzugriff brauchen die tatsächlichen Geräte. Native Linux/WSLg,
  Windows-UI mit WSL-Ausführung und macOS haben keine neue Plattformmessung.
  Goal 10: Loginstart/Verfügbarkeit/Recovery; Goal 9: begrenzte Ergebnisansicht,
  zusätzliche Authentisierung vor Freigaben und Benachrichtigungen; Goal 11:
  Audit-Wartung, Updates und gemessene Geräte-/Browser-Matrix.

---

# Handoff — 2026-09-06 (Session 4)

## Git-Abgleich in Graph, Inspector und Run-Vorbereitung

Auslöser: Der Inspector zeigte das lokale RhinoClaw-Hauptrepository, während
der Agent einen deutlich älteren eigenen Worktree verwendete. Ein lokaler
Refresh war bisher leicht mit einem Remote-Update zu verwechseln.

- **Bedienung:** `Git-Abgleich` öffnet den gemeinsamen Dialog. `Anzeige
  aktualisieren` liest lokal, `Remote prüfen · Fetch` holt origin-Refs. Danach
  lokale oder Remote-Basis wählen und je Ziel `Update prüfen`, Checkbox und
  `Fast-forward ausführen`. Der Run-Dialog bietet denselben Vergleich vorab.
  Der alte Gleichstands-Text lautet jetzt `Lokal gleichauf` mit Erklärung.
- **Vertrag:** Desktop-only IPC für Übersicht, Fetch, Vorschau und Apply;
  Daten ohne Host-Pfade. Vorschau ist fünf Minuten gültig, einmalig nutzbar und
  bindet konkrete SHAs, Repository und Ziel. Apply prüft den Stand erneut.
  Dirty-/Divergenz-/Detached-/Git-Operations-/Session-/Lease-Blocker bleiben
  sichtbar. Unlesbare Worktrees sind unbekannt, nicht sauber. Fetch überschreibt
  keine lokalen Refs, auch bei abweichendem konfiguriertem Fetch-Refspec.
  Kein Auto-Stash, Reset, Push oder Merge-Commit; ignorierte Dateien werden
  nicht überschrieben und Repository-Hooks laufen nicht.
- **Koordination:** Ein Prozess-Gate verhindert Überlappung mit ADE-eigenem
  Scope-/PTY-/Login-/Run-Start. Externe Git-Prozesse werden nicht gesperrt;
  erneute Prüfung plus Git-eigene Fast-forward-/Worktree-Guards bleiben nötig.
- **Grenzen:** Vergleichsbasis ist kein persistiertes Run-Feld. Neue Worktrees
  starten weiterhin vom Hauptrepository, Managed Runs vom Orchestrator-HEAD.
  Bestehende Teilnehmer einzeln angleichen. Remote-Zeit gilt nur für diese
  App-Sitzung; ein Neustart setzt sie auf ungeprüft. Mobile Git ist nicht
  freigeschaltet. QR-/Handy-Pairing bleibt der nächste separate Produkt-Schritt
  auf Basis der Geräteverwaltung aus Session 3.
- **Fokussierte Evidenz:** 38 echte Git-Fixture-Checks und 20 neue
  Electron-/Playwright-Checks grün. Abgewiesene Updates wegen später Änderungen,
  ignorierter Dateien oder geänderter Zuordnung haben jeweils positive
  Folgekontrollen. UI-Evidenz unter `test-results/git-sync/`, Logs unter
  `test-results/repository-sync.log` und `test-results/git-sync-electron.log`.
  Sieben Windows-Inspector-Baselines wegen des neuen Git-Einstiegs bewusst
  aktualisiert; 22 visuelle Checks grün.
- **Gesamt-Gate:** `pnpm verify` auf nativem Windows vollständig grün:
  drei TypeScript-Projekte, **20 Suiten / 1262 Checks**, Production-Build,
  **163 bestehende + 20 neue Electron-/Playwright-Checks** und **22 visuelle
  Checks**. Log: `test-results/git-sync-verify-final.log`. Für die neue
  Git-Funktion wird damit keine Linux-, WSL- oder macOS-Evidenz behauptet.
- **Operatorzustand:** Kein persönliches Repository/Profil durch die neuen
  Tests geändert, nichts committed oder veröffentlicht. Build: `pnpm build`,
  Start nach Schliessen der alten App: `pnpm start`. Vertrag und Bedienfolge:
  `REPOSITORY_SYNC_PLAN.md`.

---

# Handoff — 2026-09-06 (Session 3)

## Goal 8, Schritt 1 — Geräteverwaltung und dauerhaftes Remote-Audit

Auftrag: Geräte in ADE anzeigen, dauerhaft benennen und widerrufen können;
ein Widerruf beendet die aktiven Verbindungen. QR-Pairing ist der nächste Schritt.

- **Desktop:** Settings → **Verbundene Geräte** zeigt aktive und widerrufene
  Identitäten. Enter speichert den Namen; danach erhält das Namensfeld den Fokus
  nach dem React-Commit. Entfernen persistiert den Widerruf und gibt den Fokus
  an den stabilen Aktualisieren-Button zurück. Lade-, Leer- und Fehlerzustände,
  ein schmaler umgebrochener Aufbau und die Settings-Fokusrückgabe sind abgedeckt.
- **Speicher:** `RemoteDeviceStore` hält `ade/remote/devices.json` neben der
  App-Konfiguration. Geheimnisse sind OS-verschlüsselt (`safeStorage`, dieselbe
  Linux-Provider-Prüfung wie bei Harness-Keys); weder Config, Bundles noch IPC
  erhalten sie. Atomarer Rename nach fsync; begrenztes Lesen; Link-Komponenten,
  kaputte Dateien und fehlende Entschlüsselung sperren den Zugriff.
- **Migration:** `ADE_HOST_API_COMMAND_DEVICE` wird einmalig übernommen. Danach
  liest der Authorizer ausschließlich den persistenten Store. Entfernte Geräte
  behalten einen Tombstone ohne verschlüsselten Schlüssel; alte oder geänderte
  Bootstrap-Werte können sie nach Neustart nicht wieder aktivieren. Fehlt die
  Gerätedatei trotz vorhandener Geräte-Audit-Historie, wird ebenfalls gesperrt.
- **Zugriffsvertrag:** In der Produktion brauchen auch GET und SSE einen aktiven
  Gerätenachweis zusätzlich zum Bearer. GET signiert den vollständigen Request-
  Target inklusive Query mit leerem Idempotency-Key-Feld und Empty-Body-Digest;
  POST bleibt unverändert. Widerruf zerstört aktive HTTP/SSE-Antworten des Geräts
  und verweigert neue Anfragen. Andere Geräte bleiben verbunden. Bereits
  akzeptierte Aufgaben laufen weiter und bleiben lokal abbrechbar.
- **Audit:** `ade/remote/audit.jsonl` ist append-only und fsynced, unabhängig von
  Run-Journal und Retention. Geräteänderungen und Commands protokollieren vor dem
  Effekt `requested` und danach den Ausgang; HTTP-Ablehnungen tragen stabile
  Gründe und unbewiesene Absender bleiben anonym. Erfolgreiche Leseanfragen
  protokollieren Authentifizierung. Keine Namen, Bodies, Signaturen, Schlüssel
  oder Host-Pfade. 8 MiB Obergrenze; beschädigtes/volles oder nicht schreibbares
  Audit sperrt Gerätezugriffe und trennt Verbindungen. Diagnose über Main-Log.
- **Grenzen:** Kein QR-Pairing, keine neue Geräteanlage in der UI, keine PWA,
  keine Session-Cookies und kein Tailscale-Vertrag. Der Listener bleibt opt-in
  und loopback-only. Audit-Browser/Export und Wartungs-/Recovery-UI fehlen.
  Volle/defekte Audit-Dateien müssen vor Offline-Wartung gesichert und geprüft
  werden. Die Anwendung löscht Audit-Historie nicht automatisch.
- **Prüfstand:** 38 fokussierte Store-/IPC-Prüfungen und 184 Host-API-Prüfungen
  grün, inklusive echtem TCP/SSE, Neustart, zwei Geräten und Audit-Ausfall vor
  Domain-Effekten. Vollständiges `pnpm verify` auf dem finalen Stand grün:
  drei TypeScript-Projekte, **19 Suiten / 1220 Checks**, Production-Build,
  **163/163 Electron-/Playwright-Checks**, **22/22 visuelle Checks** gegen
  unveränderte Windows-Baselines. Die gemessenen Suite-Böden wurden angehoben
  (Host-API 184, Remote-Devices 38, Security 195). Der zunächst fehlgeschlagene
  Fokus-Check nach Rename ist mit einer Layout-Effect-Fokusrückgabe behoben;
  gezielter positiver Electron-Test und abschließendes vollständiges Gate grün.
  Lokales Prüfprotokoll: `test-results/device-verify-final.log`.
  Ausgeführte Plattform ist natives Windows; neue Linux-/macOS-Evidenz wird
  damit nicht behauptet.
- **Operatorzustand:** Nur Repository-Dateien und isolierte temporäre
  Testprofile geändert. Kein persönliches ADE-Profil migriert, kein dauerhafter
  Netzwerkzugang eingerichtet und nichts veröffentlicht.

## Nächster Schritt

Kurzlebiges, einmalig nutzbares Pairing aus dem Desktop heraus entwerfen und
implementieren; danach Tailscale-Serve-/Session-Vertrag und erst dann PWA-Shell.
Die Geräteverwaltung und der Widerrufsvertrag können dabei wiederverwendet werden.

---

# Handoff — 2026-09-06 (Session 2)

## Ergebnis dieser Session — Thema 3 und Thema 5

Bezug: `PROFESSIONALIZATION_REVIEW_2026-07-26.md` (beide Themen mit
Status-Block), Vertrag in `ARCHITECTURE.md` („Renderer view, run report and
history retention", IPC-Katalog), Matrix in `STATUS.md` (neue Zeilen
„Finished-run readability", „Main-process log", „History retention";
„Keyboard navigation" und „Background notifications" erweitert), Roadmap-
Voraussetzung unter Goal 7 und Goal-11-Hinweis.

- **Zwei Projektionen (`src/shared/types.ts`, `OrchestrationService`):**
  `snapshot()` bleibt die interne Vollform; `view()` liefert
  `OrchestrationView` für `run:get` und `orchestration:changed` — Tasks mit
  `promptDigest`/`promptChars`/`provenance` statt Prompt, Artefakte mit
  `contentChars`, Mailbox mit `textChars`, plus `seqCursor`. `onChange` trägt
  keinen Payload mehr; `ipc.ts` koalesziert den Broadcast pro Tick.
- **`run:report({runId})` → `RunReport`** (Policy `read`/desktop, Validator,
  Security-Fixture): pro Task alle Dateien, alle Tests mit gebundener
  Ausgabe (16 KiB), Risiken, SHA, Participant-Name/Rolle; pro Run Failure mit
  den fehlgeschlagenen Testkommandos, Integrationsbereich, Verifikation,
  Approvals, Publication. Texte gebunden (4 KiB), nicht geteasert.
- **`integration.applied`** trägt `{commitCount, fromSha, toSha}` — der
  Coordinator inspiziert das Integrator-HEAD vor/nach `integrateCommits`.
- **Approval-Notice:** `runApprovalNotice` + `showRunApprovalNotification`
  in `beginApprovalPhase` (Name, Task-/Commit-Zahlen, kein Prompt/Pfad).
- **Main-Log:** `src/main/logging/mainLog.ts` (`MainLogSink`,
  `userData/ade/logs/main.log`, 2 MiB × 5, 8 KiB/Zeile, Redaktion inkl.
  Secret-Feldnamen, Selbstabschaltung statt Throw), installiert in `index.ts`.
- **Graph:** Selector mit Aktiv/Beendet-Gruppen und Status; ausgewählter
  älterer Run wird gepinnt (`buildClusters(..., pinnedRunId)`,
  `data-run-id` auf `.gcluster`); Fehler-Alert listet Testkommandos und
  öffnet den Bericht; `ResultDetails` (neu) im Inspector; `RunReportPanel`
  (neu, `role="dialog"`, Fokus rein/Escape/Fokusrückgabe mit Fallback auf
  den Toolbar-Button, weil der Alert-Button beim Öffnen unmountet);
  Karten/Cluster-/Team-Bars `role="button"` + `tabIndex` + Enter/Space,
  Escape löscht Auswahl; `.gteam-actions` per `:focus-within`.
- **Retention (`applyRetention`, `RunArchiveStore`, `journalRetention`):**
  `HISTORY_RETENTION = {keepTerminalRuns: 40, keepTerminalDays: 30,
  maxConfigBytes: 4 MiB}`; Archiv `ade-run-archive` v1 nach
  `userData/ade/archive/runs/<uuid>.json` (atomar) vor dem Save; offene,
  geleaste, veröffentlichte Runs nie; `prunedSeq` als Seq-Floor (auch
  `deleteRun`); Start + stündlich. Config kompakt serialisiert.
  Migration/Validierung von `journalRetention` in `migrate.ts`/`store.ts`
  (die Root-Key-Schleife im Validator behandelt den Nicht-Array-Key
  explizit — ohne das schlug jedes `replace()` fehl).
- **Nachweis:** `pnpm test` 18 Suiten / **1158** Checks (Orchestration
  49 → 81, Runtime 43 → 47, Config 27 → 30, Security 185 → 192, neu
  `test-main-log.ts` 14 mit Rotation, Redaktion, Tee/Restore, Selbst-
  abschaltung, Archiv atomar/UUID). Electron-Workflow **151** Checks, neu: Seed
  mit drei beendeten Runs (der älteste standardmäßig unsichtbar), Alert mit
  `pnpm test:integration`, Enter auf fokussierter Karte → Inspector mit
  beiden Dateien und Test-Ausgabe, Escape, Bericht mit Risiko und
  `aaaaaaa → bbbbbbb`, Fokus im Dialog, Escape → Fokus auf Toolbar-Button,
  Pinning des ältesten Runs, `run:get` ohne `prompt`. `pnpm verify` grün.
- **Bewusst offen:** kein Archiv-Browser (archivierte Runs verschwinden aus
  Graph und Host-API); Renderer ersetzt weiter ganze Slices (kein
  `run:events`-Konsument, kein `React.memo`); `run:report` bleibt Desktop-
  only bis der Host-Adapter es durch `redactForWire` führt (Goal 9);
  `deleteRun` unverändert; `useSessionShortcuts` außerhalb des Terminals-
  Modus unverändert.

## Nächster Schritt

Goal 8 beginnen: Paired-Device-Store mit Revocation ersetzt den
`ADE_HOST_API_COMMAND_DEVICE`-Bootstrap ohne Änderung des Signaturvertrags;
durables Remote-Audit; Tailscale-Serve-Vertrag; erst danach PWA-Shell.

Manuell prüfen: ADE mit einem alten Profil starten — in
`userData/ade/logs/main.log` erscheint eine Zeile `history retention archived
N run(s)`, sobald mehr als 40 beendete Runs älter als 30 Tage vorliegen, und
`userData/ade/archive/runs/` enthält je eine Datei; im Graph einen beendeten
Run auswählen, `Bericht` öffnen, mit Escape schließen.

---

# Handoff — 2026-09-06 (Session 1)

## Ergebnis dieser Session — Goal 7 abgeschlossen: `POST /api/v1/tasks`

Bezug: `ROADMAP.md` Goal 7 (Checkliste geschlossen bis auf den Paired-Device-
Store, der Goal 8 eröffnet), Vertrag in `ARCHITECTURE.md` („Transport-neutral
application boundary“, „ADE host API“), Matrix in `STATUS.md` (neue Zeile
„Single-task submission“), Tabelle in `REMOTE_CONTROL_PLAN.md`. Der bisher
uncommittete Write/SSE-Slice vom 2026-09-03 wurde zuerst mit grünem `pnpm
verify` als eigener Commit gesichert und gepusht (`ad891a6`).

- **Neuer Invoke-Channel `runTask:submit`** (`src/shared/ipc.ts`,
  `RunTaskSubmitInput = {agentId, repositoryId, prompt, name?, commandId?}`
  → `RunTaskSubmission = {run, task}`). Validator in `ipcValidation.ts`
  (exakte Keys, IDs, Prompt ≤ 8000, Name ≤ 200, commandId ≤ 128). Policy:
  `sharedLaunch` und Aufnahme in `REMOTE_COMMAND_CHANNELS` — die einzige
  Allowlist-Erweiterung dieser Session. `runTask:create`, `pty:*` bleiben
  Desktop-only; der Remote-Aufrufer bekommt keinen PTY-Zugriff (kein write/
  resize/attach), nur den Launch.
- **`OrchestrationService.createSingleTaskRun`:** ein atomarer Save für
  manuellen Run (Name = optional oder 80-Zeichen-Titel), einen Worker-
  Participant in einem Ein-Personen-Team mit Agentennamen, den Task
  (`phase: 'manual'`, `managed: false`) und den Command-Log-Eintrag.
  Journal-`seq` in logischer Reihenfolge (`run.created` mit
  `kind: 'single-task'`, `participant.added`, `task.queued`). Der
  Command-Log speichert nur `{runId, taskId}` und löst beim Replay gegen den
  Snapshot auf — ein 8000-Zeichen-Prompt kann das 16-KiB-Result-Limit nicht
  reißen.
- **`RunCoordinator.submitSingleTask`:** Replay-Prüfung, dann Create, dann
  Launch über den verbundenen `TaskLauncher` (= `PtyManager.create` mit
  `runTaskId`, also mit `assertTaskTarget`/Scope-Auflösung/Lease-Prüfung und
  der globalen FIFO) **ohne await** — die HTTP-Antwort wartet nicht auf einen
  Queue-Slot. Rejected der Launcher, bevor die PTY-Schicht den Fehler selbst
  meldet, journaliert der Coordinator `task.failed` (Muster aus dem Managed-
  Launch übernommen). `run:cancel` gilt jetzt auch für manuelle Runs:
  queued + running Tasks werden abgebrochen, der Run-Status folgt aus den
  Tasks; ein manueller Draft ohne Arbeit wird abgelehnt (`422`). Managed-
  Cancel unverändert.
- **Facade/Adapter:** `AdeApplicationService.submitTask` +
  `validateRemoteTaskSubmit` (verweigert `runId`, `participantId`,
  `workspaceBindingId`, `commandId`, `repositoryId: null`, Pfade als IDs,
  Steuerzeichen — ohne Echo). `command()` liefert jetzt `{runId, taskId?}`;
  `MobileCommandResult.taskId` ist neu, Audit-Target ist die Task-ID.
  `HostApiServer`: Route `/api/v1/tasks` (nur POST, JSON-Body Pflicht),
  keine Task-Liste, kein `/tasks/{id}/…`.
- **Nachweis:** `test-host-api.ts` 122 → 163 (Validator-Negativkontrollen;
  HTTP gegen echten Coordinator: 415/400 ohne Body, Desktop-Felder → 400,
  Pfad-ID ohne Echo, unbekannter Agent/Repo → 422 ohne Run/Task/Launch,
  Submit ⇒ Summary mit `taskId`, Worker-Team, Status running, genau ein
  Launch, Titel = 80 Zeichen und **Prompt-Tail nirgends auf dem Draht**
  (Antwort, Stream, Runs-Liste), Audit auf Task-ID, Replay ohne zweiten
  Launch, Key-Reuse 409, Key-Crossover 409, gleichzeitige Duplikate ⇒ ein
  Task, `start` auf Single-Task-Run → 422, Draft-Cancel → 422, Cancel ⇒
  Task cancelled + Run cancelled + Replay ohne zweiten Cancel; separater
  Fixture mit ablehnendem Launcher ⇒ `task.failed` im Journal pfadfrei, Run
  failed, Replay liefert den gescheiterten Task statt neu zu starten).
  `test-security.ts` 182 → 185 (Contract-Payload, Feldgrenzen, Allowlist-Pin
  auf vier Channels, `runTask:submit` = shared launch, PTY-Channels bleiben
  desktop). Floors angehoben; `pnpm verify` grün (siehe unten).
- **Bewusst offen:** Desktop-Renderer nutzt weiterhin `runTask:create` +
  `pty:create` (zwei Schritte) — Umstellung auf `runTask:submit` wäre eine
  UI-Vereinfachung, kein Muss. Eine remote gestartete Session erscheint im
  Renderer erst nach Reload als Terminal-Tab (gleiches Verhalten wie
  Managed-Tasks; Graph/Status aktualisieren sofort über
  `orchestration:changed`). Plain-Workspace-Submission (ohne Repository)
  absichtlich nicht angeboten. Alles Weitere aus Session 2 (Pairing,
  Revocation, durables Audit, TLS) unverändert offen → Goal 8.

## Nächster Schritt (Stand Session 1, erledigt in Session 2)

Thema 3 und Thema 5 aus `PROFESSIONALIZATION_REVIEW_2026-07-26.md` — siehe
oben. Danach Goal 8.

Manuell prüfen (Loopback): mit gesetztem Device wie unten ein
`POST /api/v1/tasks` mit `{"agentId":…, "repositoryId":…, "prompt":…}`,
`Content-Type: application/json`, `Idempotency-Key` und Device-Headern
antwortet `200` mit `taskId` und `run.tasks[0].status` `queued`/`running`;
der `/events`-Stream zeigt `run.created` (`kind: single-task`),
`task.queued`, `task.started`; im Desktop-Graph erscheint der Run mit einem
Team.

---

# Handoff — 2026-09-03 (Session 2)

## Ergebnis dieser Session — Goal 7 Write/SSE-Slice der lokalen Host-API

Bezug: `ROADMAP.md` Goal 7 (Checkliste aktualisiert), Vertrag in
`ARCHITECTURE.md` („Transport-neutral application boundary“, „ADE host API
(Goal 7 write/SSE slice)“, „Electron IPC contract“ Schritt 3/4), Matrix und
Known constraints in `STATUS.md`. Bewusst nicht enthalten: PWA-UI (Goal 8),
Tailscale/öffentliche Exposition, Remote-Approvals (Goal 9), Thema 3/5.

- **Policy-Öffnung (`src/main/ipcPolicy.ts`):** `ChannelPolicy.remote =
  {scope: 'read' | 'runs:write', idempotency: 'none' | 'required', proof:
  'bearer' | 'device-signature'}` ist für jeden `shared`-Channel Pflicht.
  Die Invariante `shared ⇒ read` gilt weiter für alle Channels außer der
  Allowlist `REMOTE_COMMAND_CHANNELS = run:create/start/cancel`; diese
  müssen `runs:write` + `required` + `device-signature` + `audit: true`
  tragen. `host`/`shell` sind nie shared, Desktop-Channels tragen kein
  `remote`. `run:events` ist jetzt shared/read (SSE-Basis).
  `channelPolicyViolations()` meldet jede Abweichung; `handle()` wirft bei
  Registrierung. Begründung in `ARCHITECTURE.md` (Schritt 3).
- **Wire-Redaktion (`src/main/errors.ts`):** `redactHostPaths` (Windows-
  Laufwerk, UNC/`\\wsl$`, mehrsegmentige POSIX-Absolutpfade, `~/`),
  `redactForWire` (Credential-Trichter + Pfade, 300 Zeichen) und
  `redactedWireMessage`. Relative Repo-Pfade und URLs bleiben lesbar.
- **Autorisierung (`src/main/remote/authorization.ts`):** zwei Schichten.
  Bearer-Token ⇒ `bootstrap-token`-Principal mit nur `read`. Kommandos
  brauchen zusätzlich `X-ADE-Device`/`X-ADE-Timestamp`/`X-ADE-Signature`
  (`v1=` HMAC-SHA256 über `ADE-HTTP-V1\nMETHOD\npath\ntimestamp\nIdempotency-
  Key\nsha256(body)`, ±5 min Skew, constant-time compare) ⇒ `device`-
  Principal mit `runs:write`. Einziges Device in diesem Slice aus
  `ADE_HOST_API_COMMAND_DEVICE=<id>:<secret>` (32–128 URL-safe Zeichen,
  ≠ Listener-Token); `consumeHostApiConfig` löscht beide Variablen aus dem
  Prozess-Env vor jedem Child-Spawn. Ohne Device: `health.commands =
  'disabled'`, jedes signierte Kommando ⇒ `unknown_device`.
- **Application-Facade (`src/main/application/AdeApplicationService.ts`):**
  `command(channel, principal, key, payload)` prüft Policy-Requirement
  (Proof, Scope, Idempotenz), bindet `commandId = remote:<key>:<sha256
  (channel+payload)>` an den vorhandenen Coordinator-Command-Log (exakter
  Retry ⇒ Replay; anderer Payload ⇒ `409 idempotency_key_reused`;
  gleichzeitige Duplikate koalieren auf einem In-flight-Promise), ruft den
  injizierten `ApplicationCommandPort` (createRun/startRun/cancelRun aus
  `ipc.ts`) und auditiert jede Entscheidung pfadfrei. `events(cursor)`,
  `snapshot()`, `journalCursor()` projizieren das Journal mit
  `WIRE_EVENT_DATA_KEYS`-Whitelist (kein `workspaceDir`, keine PTY-
  `sessionId`, keine Mailbox-Bodies; Freitext durch `redactForWire`).
  `validateRemoteRunCreate` verweigert Desktop-Felder
  (`resetWorktreeToBase`), Pfade als IDs, Steuerzeichen, Übergröße — ohne
  den Wert zu echoen. `RemoteApiError` mappt auf stabile Codes
  (`422 command_rejected`, `401 device_proof_required`,
  `403 scope_not_granted`).
- **Journal-Cursor (`OrchestrationService`):** `journalCursor()` liefert
  den höchsten `seq`; `JournalChangeHub` (in `ipc.ts`) versorgt Desktop-
  Broadcast und SSE-Streams aus einem Publikationspunkt.
- **HTTP-Adapter (`src/main/remote/HostApiServer.ts`):** zusätzlich zu den
  drei GETs: `GET /api/v1/events` (SSE: `Accept: text/event-stream`, Cursor
  aus `Last-Event-ID` oder `?cursor=` — beide müssen übereinstimmen; ohne
  brauchbaren Cursor ein gebündeltes `snapshot`-Event, danach `journal`-
  Events strikt aufsteigend, max. 200 Records/Frame, `id` = höchster `seq`;
  `retry: 2000`, `: ping` alle 15 s; 8 Clients ⇒ `503 too_many_streams`;
  >256 KiB ungesendet ⇒ Verbindung getrennt, Client resumed vom letzten id)
  und `POST /api/v1/runs`, `/runs/{id}/start`, `/runs/{id}/cancel`
  (`Content-Length` Pflicht ⇒ `411` bei chunked; 64 KiB ⇒ `413` vor dem
  Parsen; `application/json` ⇒ `415`; `Idempotency-Key` 8–64 URL-safe;
  Refused-Bodies ≤ 1 MiB werden gedraint, damit der Client die Antwort
  liest). Host-Header exakt, Browser-`Origin` immer abgelehnt,
  `X-ADE-Request-Id` pro Antwort, JSON-Antworten ≤ 512 KiB. `stop()`
  beendet offene Streams sofort.
- **Nachweis:** `test-host-api.ts` 30 → 122 (echter Loopback-Server, echter
  `RunCoordinator` mit Fake-Runtime, echte TCP-Reconnects: Snapshot,
  Heartbeat, Denials/Audit, jede Signatur-Negativkontrolle, chunked/415/
  413/malformed, create/start/cancel mit Replay, Key-Reuse-Konflikt,
  gleichzeitige Duplikate ⇒ genau ein Run, Start-Retry ⇒ genau ein Launch,
  Reconnect mit `Last-Event-ID` ⇒ Union beider Verbindungen = Journal exakt
  einmal, `?cursor=`, Cursor jenseits des Journals ⇒ Snapshot, Client-Limit,
  Backpressure-Trennung, Redaktion von Anwendungsfehlern, Stop mit offenen
  Streams). `test-security.ts` 169 → 182 (Allowlist gepinnt, vier neue
  Policy-Negativkontrollen, Wire-Redaktion). Floors in `run-suites.ts`
  angehoben; `pnpm test` 17 Suiten / 1054 Checks grün. `pnpm verify` grün
  (siehe Abschnitt unten).
- **Bewusst offen:** ein Device per Env-Bootstrap, kein Pairing, keine
  Revocation/Rotation ohne Neustart; Remote-Audit nur im Main-Log;
  `POST /api/v1/tasks` (gebundener Einzeltask) nicht gebaut; kein TLS auf
  Loopback (Tailscale-Serve-Vertrag folgt mit Goal 8); Journal teilt weiter
  die atomare JSON-Config (Retention gilt auch für den Stream).

---

# Handoff — 2026-09-03 (Session 1)

## Ergebnis dieser Session — Thema 6 „Grenze härten“

Bezug: `PROFESSIONALIZATION_REVIEW_2026-07-26.md`, Thema 6. Vertrag in
`ARCHITECTURE.md` („Electron IPC contract“, „Terminal beta security and UX“,
„execution backend“), Matrix in `STATUS.md`.

- **Channel-Policy (`src/main/ipcPolicy.ts`):** `CHANNEL_POLICY` klassifiziert
  alle 78 Invoke-Channels als `read | mutate | host | launch | shell` mit
  `surface: desktop | shared` und `audit`. Exhaustiv per Typ (neuer Channel
  ohne Eintrag = Compile-Fehler). `handle()` ruft `assertChannelPolicy` bei
  Registrierung; `shell` nur `agent:openDashboard`, `shared` nur `read`,
  `armsShell` auf `agent:create/update`, `agentTemplate:create/spawn`,
  `workspaceBundle:apply`. Auditierte Channels (launch/shell/host außer
  `pty:write`/`pty:resize`) loggen eine Zeile pro Aufruf.
- **Redaktions-Trichter (`src/main/errors.ts`):** `redactSensitiveText`
  (aus `PublicationService` hochgezogen, dort re-exportiert) plus Vendor-Key-
  Formen (`sk-…`, `sk-ant-…`, `xai-…`, `AIza…`, `ghp_…`, `xox…`) und
  `NAME=value` für KEY/TOKEN/SECRET/PASSWORD-Namen. `handle()` loggt
  redigiert mit Stack und wirft `toIpcError` (2000 Zeichen). Ebenfalls im
  Trichter: `ExecutionBackendService.checked` (stderr), `pty:create`-argv-Log.
- **WSLENV statt argv:** `wslHostEnvironment(process.env, fields)` legt
  Backend-Felder ins Host-Env von `wsl.exe` und listet sie als `NAME/u` in
  `WSLENV`; kein `/usr/bin/env NAME=value` mehr in argv. Guards: kein
  Override von `WSLENV`, keine Case-Kollision, kein NUL, 32 000-Zeichen-
  Grenze; inherited `WSLENV`-Einträge bleiben, außer ADE besitzt den Namen.
  `PtyBackendCommand.hostEnv` wird vom PtyManager als PTY-Env verwendet;
  `run()` nutzt es für `spawnAndCollect`. Echt belegt mit Ubuntu:
  `printf "$ADE_WSLENV_PROBE|$ADE_PROBE_TOKEN"` → `via wslenv ü|sk-ant-probe-value`.
- **Dashboard-Fenster:** `will-redirect` teilt den Origin-Guard mit
  `will-navigate` (fremder Origin → block + Systembrowser bei http(s)).
  `persistSessionCookies(partition, origin)` filtert per
  `cookies.get({url})` und `cookieBelongsToOrigin` (host-only exakt, Domain-
  Cookies inkl. Subdomains, Secure nur https/loopback). `forget(agentId)`
  schließt das Fenster und ruft `clearStorageData` + `clearCache`;
  `agent:delete` ruft es.
- **Renderer-Fenster-Registry (`src/main/rendererWindows.ts`):**
  `registerRendererWindow` im `createWindow`; `broadcastToRenderers` für
  Orchestration/PTY-Events; `rendererWindows()` für Notification-Ziel,
  Dialog-Parent und `activate`; `assertTrustedSender` verlangt
  `isRendererWindow(owner)` zusätzlich zur URL-Prüfung.
- **Lesepfad-Symlink-Parität (`workspaceFs`):** `readableEntryExists` prüft
  Root bis Blatt per `lstat` (Link/Junction → Fehler), dann Realpath-
  Containment; `readLevel` nutzt `lstat` (Link-Verzeichnis erscheint als
  Datei, nicht expandierbar); `agentFiles` nur reguläre Dateien. Missing
  bleibt missing.
- **Nachweis:** `test-security.ts` 149 → 169 (Cookie-Origin, Policy-
  Invarianten, Fehlinjektion → 3 Violations, Redaktion inkl. Idempotenz und
  Pfad-/SHA-Erhalt, `toIpcError`). `test-execution-backends.ts` 16 → 27 pure
  (+16 mit `--wsl`, davon 1 neu: WSLENV-Probe). `test-workspace-fs.ts`
  7 → 14. Floors in `run-suites.ts` angehoben. `pnpm verify` grün.
- **Bewusst offen:** kein „Dashboard abmelden“ in der UI; Audit nur im Main-
  Log; `dashboardCommand` bleibt Shell-Text; Workspace-Roots, die selbst
  Junctions sind, sind im Files-Panel jetzt unlesbar (konsistent mit den
  Mutationsguards — bewusst so gelassen).

---

## Ergebnis der Vorsession — Thema 2 „Wiederholbare Run-Schleife“

Bezug: `PROFESSIONALIZATION_REVIEW_2026-07-26.md`, Thema 2. Vertrag in
`ARCHITECTURE.md` („Managed-run coordinator“), Matrix in `STATUS.md`.

- **`resetToBase` (nativ + WSL):** `WorkspacePort.resetToBase(dir, baseSha,
  archiveRef)`. Guards: Repo, clean, auf Branch, Ziel ist Commit und teilt
  Historie mit HEAD (`merge-base`). Vor dem `reset --hard` wird der alte Tip
  per `update-ref <ref> <head> 0000…` unter
  `refs/ade/archive/<runId>/<participantId>` gepinnt — existiert der Ref
  schon, bricht es ab statt zu überschreiben. Danach Re-Inspektion: clean,
  HEAD = Basis, Branch unverändert.
- **`Run.workspacePrepare = 'reset-to-base'`:** nur aus der expliziten
  Checkbox im „Neuer Run“-Dialog (sichtbar nur mit Repository, Default aus,
  Hinweistext wechselt mit dem Zustand, `aria-describedby`). Persistiert auf
  dem Run, IPC-validiert als Enum, Store-Schema erweitert.
- **`start()`:** Basis = HEAD des Orchestrator-Worktrees (Integrationsziel).
  Ohne Flag: Fehler `same Git base` nennt jetzt jede abweichende Worktree
  mit Kurz-SHA und den Opt-in. Mit Flag: erst Prüfung, ob ein anderer aktiver
  Run eines der Worktrees leased (dann Abbruch ohne Ref-Bewegung), dann je
  Worktree Reset + `workspace.rebased` (`fromSha`, `toSha`, `archiveRef`),
  dann Re-Inspektion, dann Leases auf der angeglichenen Basis. Reihenfolge:
  nach dem Clean-Check, vor `acquireWorkspaceLeases`.
- **Lease-Leak geschlossen:** Erfolgszweig in `onTaskFinished` prüft
  `isTerminalRun`. Ein spätes `completed` auf einem beendeten Run wird als
  `cancelled` mit Grund protokolliert, weder validiert noch committet, und
  der Run wird gedraint → alle Leases `released`.
- **`RunBudget.maxTaskMinutes`:** `null` = kein Limit (Modell-Default),
  Dialog-Default 60, Bereich 1–1440. Coordinator-eigener Timer pro laufendem
  Managed-Task (`TaskTimerPort`, injizierbar), disarmed auf jedem
  Finish/Launch-Fail-Pfad. Läuft er ab: `budget.exhausted` (`task minutes`)
  + `failRunCore` mit Task-Titel und Limit → normaler Cancel-Pfad über den
  PtyManager. Migration: alte Budgets erhalten einmalig `maxTaskMinutes:
  null` und gelten danach als kanonisch.
- **Nachweis:** `test-orchestration-beta.ts` 130 → 151
  (`repeatableRunLoopChecks` mit echtem Git: (a) strict fail-closed ohne
  Lease/Task/Ref, (b) Opt-in → Archiv-Refs zeigen auf alte Tips, beide
  Worker auf Orchestrator-HEAD, `workspace.rebased` ×2, Run läuft bis
  `completed`, dritter Run startet ohne Handarbeit, (c) dirty → Abbruch vor
  jeder Ref-Bewegung, fremder Lease → Verweigerung;
  `lateResultAfterRunEndChecks`; `taskTimeBudgetChecks` mit Fake-Timern).
  `test-orchestration.ts` 48 → 49 (Budget-Migration). `test-security.ts`
  147 → 149. Electron-Workflow: Checkbox vorhanden/aus, Tastatur-Toggle,
  Hinweistext, Minutenfeld mit Default 60 und `max=1440`.
- **Bewusst offen (Thema 2, Hinweise):** Kill-Eskalation in `forceStop`,
  `cols: 4096` für Task-PTYs, `attempt > 1`. Archiv-Refs werden nicht
  automatisch gepruned. Goal-6-Treiber setzt weiterhin auf die
  aufgezeichnete Baseline zurück (anderer Vertrag als der Alltagsbetrieb).

## Nächster Schritt

Goal 7 abschließen: `POST /api/v1/tasks` als gebundenes First-Class-Kommando
(`submitSingleTask` in der Facade, gleiche Policy-Anforderungen wie
`run:create`) — danach ist die Goal-7-Checkliste bis auf den Paired-Device-
Store vollständig. Anschließend Thema 3 (beendete Runs lesbar, Graph-
Tastaturpfad), dann Thema 5. Goal 8 (Pairing-UI, Device-Store mit
Revocation, durables Remote-Audit, Tailscale-Serve-Vertrag) ersetzt den
`ADE_HOST_API_COMMAND_DEVICE`-Bootstrap, ohne den Signaturvertrag zu ändern.

Manuell prüfen (Loopback, ohne UI): `ADE_HOST_API_ENABLED=1
ADE_HOST_API_TOKEN=<32+ Zeichen> ADE_HOST_API_COMMAND_DEVICE=phone:<32+
Zeichen>` setzen, ADE starten,
`curl -H "Authorization: Bearer …" -H "Accept: text/event-stream"
http://127.0.0.1:4317/api/v1/events` liefert `event: snapshot` und danach
`: ping`; ein `POST /api/v1/runs` ohne Device-Header antwortet
`401 device_proof_required`.

---

# Handoff — 2026-08-19

## Ergebnis dieser Session

- **Terminals-Layout (optional):** Settings → Inspector Rechts/Links.
  Default bleibt Rail links / Inspector rechts. Persistiert in
  `settings.inspectorSide`. Kein Zwangstausch.

- **Overview Schnitt B (Session-Bookends):** Interaktive PTY-Spawns
  schreiben einen path-freien Bookend (`endedAt: null`), Exit füllt
  `endedAt`/`exitReason`. Task-PTYs bleiben im Run-Journal. Restart
  schließt verwaiste offene Bookends als `interrupted`. Journal ist
  FIFO 100 in `AdeConfig.sessionBookends`. Overview-Work mischt
  geschlossene Sessions mit Runs (20 newest); Live bleibt die PTY-Liste.
  Klick auf Session → Terminals. Fokus overview 30, config 26.

- **Overview A-Schliff:** Agent-Zeilen nehmen `lastActivityAt` als
  `max(letzter Run, binding.lastUsedAt)`. Ohne beides steht „keine
  Aktivität“, nicht mehr „kein Run“. Ein Run-Name bleibt Zusatz, nicht
  die einzige Uhr. Fokus 19.

- **Overview Home (Schnitt A):**
  - Dritte Top-Level-Ansicht (`Overview` / `Ctrl+3`) über Katalog,
    Bindings, Runs und lebende PTYs. Kein Inspector-Poll, keine neue
    Telemetrie, keine Charts.
  - `overview:get` projiziert path-frei: Live = laufende PTYs, Offen =
    `running` oder Phase `approval`, Tokens = Summe gemeldeter in+out
    sonst `—`. Kosten stehen separat mit Unknown-Zählern; `null` wird
    nicht zu 0.
  - Agenten folgen Kategorie-Mitgliedschaft, Projects sind nur
    Katalog-Repos, Work sind die 20 neuesten Runs. Klick auf Agent/Projekt
    → Terminals, Klick auf Run → Graph.
  - Fokus: `scripts/test-overview.ts` (17). Security 145 inkl. void-Channel
    `overview:get`. Electron/Playwright: Tab, `Ctrl+3`, drei Zahlen,
    Work-Zeile → Graph, Agent-Zeile → Terminals. Der Inspector-Tab
    „Overview“ bleibt über `Repository panel` adressiert.

- **Grok Build Activity-Feed (Schnitt 3):**
  - `GrokActivityParser` rendert `thought` / `tool_call` / `text` / `end` /
    `error` aus `--output-format streaming-json`. Tools werden einmal pro
    `toolCallId` genannt, ohne Rohpayloads.
  - Der Adapter startet jetzt `streaming-json` statt des einzelnen JSON-
    Envelopes. Ergebnis und Usage kommen aus `text`/`end`; das alte Envelope
    bleibt lesbar.
  - Operator-Check (nicht im `pnpm test`-Floor):
    `pnpm exec tsx scripts/test-grok-operator.ts` — echter CLI-Lauf in einem
    Wegwerf-Repo. Lokal 2026-08-19 grün: `hello-ade.txt` geschrieben,
    14 Activity-Zeilen, outcome `succeeded`, 63257 in / 982 out,
    `$0.0132`. Der echte Stream ist tokenweise; der Parser coalesced
    Thought/Text und zieht das letzte JSON-Objekt aus dem Text.

- **Grok Build native Managed-Task-Adapter (Schnitt 2):**
  - `GrokJsonAdapter` (`grok-json-v1`) vor dem File-Fallback: `--prompt-file`,
    `--output-format streaming-json`, `--no-auto-update`, Permission/Modell/
    Reasoning der Identity. Niemals `--worktree`. `--json-schema` bleibt
    ungenutzt, weil die CLI nur Inline-JSON akzeptiert.
  - ADE schreibt `PROMPT.txt`, WSL übersetzt den Prompt weiter über
    `ADE_TASK_PROMPT_FILE`. Tokens (uncached + Cache-Buckets) und
    `total_cost_usd` überschreiben modellgeschriebene Usage, fehlende/
    partielle Kosten bleiben `null`.
  - Fokus-Evidenz: Runtime (Prompt-File-Transport, kein Worktree),
    Orchestration-Beta (Adapterwahl, Stream/Envelope, Activity, ConPTY,
    fail-closed Cost).

- **Grok Build interaktiv first-class (Schnitt 1):**
  - Launch-Profil: `default` → `grok`, `accept-edits` →
    `grok --permission-mode acceptEdits`, `bypass` → `grok --always-approve`.
  - Identitäten persistieren `grokModel` / `grokReasoningEffort` analog Codex
    (Default `grok-4.6` / `high`; `ultra` ist Codex-only und wird fail-closed
    abgelehnt). Interactive Launch hängt `--model` und `--reasoning-effort` an.
  - New/Edit-Agent und die Agent-Card zeigen das Grok-Profil. Templates,
    Workspace-Bundles und die Rollen-`AGENTS.md` tragen die Pins mit.
  - Settings öffnet `grok login`. Diagnose wertet `grok models` (Login-Zeile),
    einen gespeicherten ADE-`XAI_API_KEY` und die Prozessumgebung; gespeicherte
    Keys zählen jetzt als angemeldet, nicht nur `process.env`.
  - **Nicht** in diesem Schnitt: native Managed-Task-Adapter (`--prompt-file`,
    `--json-schema`, `streaming-json`). Graph-Tasks für Grok bleiben der
    generische File-Result-Adapter mit stdin.
  - Fokus-Evidenz: Runtime 40, Security 144, Memory 28, Harness 21. Electron-
    Workflow muss den interaktiven Launch mit Key + `--always-approve --model
    grok-4.6 --reasoning-effort high` plus Login-Kommando und Auth-Badge
    nachweisen.

## Vorheriger Stand (2026-07-23)

Dieser Abschnitt beschreibt den zusammenhängenden Stand aus Goal-6-/Plattform-
Abschluss, Verified Draft-PR Publishing, dem Repository Inspector (`40bc1b2`
auf `origin/main`) und dessen Progressive-Disclosure-Slice: kompakte
`Scope & session`-Offenlegung, CI-Rollups mit On-demand-Einzelchecks,
Run→Publication→PR-Traceability, ausschließlich entscheidungsrelevante
Hervorhebung, visuelle Regressions-Baselines, die explizite Harness-Wahl
pro Run im "Neuer Run"-Dialog samt Repo-Pfad-Import sowie die Settings-Seite
für Harness-Verwaltung: Subscription-Anzeige aus dem CLI-Status, Login-
Terminal pro Harness, verschlüsselte write-only API-Keys und generische
Service-Keys mit Injektions-Scope.

## Ergebnis der Session 2026-07-23

- **Progressive-Disclosure-Slice des Inspectors (neu):**
  - Seltene Scope-Aktionen (`Add repo`, `Pfad…`, `Set agent default`,
    `Remove worktree`) liegen hinter einer kompakten `⋯`-Offenlegung
    (`Scope & session`) mit `aria-expanded`; Identität, Health, Repository-
    Auswahl und `Open new session` bleiben sichtbar. Die Offenlegung übersteht
    den 5-Sekunden-Poll und schließt nur bei Agent-/Session-Wechsel.
  - PR-Zeilen tragen ein **CI-Rollup** (`none/pending/passed/failed` mit
    Zählern), im Main-Prozess konservativ aus `statusCheckRollup` reduziert;
    rohe Provider-Checks erreichen den Renderer im Listen-Read nie.
  - **Traceability Run → Publication → PR:** offene PRs werden gegen die
    durablen `runPublications` gematcht (exakte PR-Nummer zuerst, sonst
    ADE-eigener Head-Branch) und tragen dann ein neutrales `ADE run`-Badge
    mit Run-/Status-Tooltip.
  - **Einzelchecks nur on demand:** Der CI-Chip ist ein Button und öffnet die
    geteilte Detail-Pane; `repository:pullRequestChecks` validiert PR-Nummer
    und URL erneut und liefert höchstens 100 benannte Check-Zustände ohne
    Provider-URLs. Logs bleiben auf GitHub; Escape gibt den Fokus an den Chip
    zurück.
  - **Nur entscheidungsrelevante Zustände** sind farbig: dirty, Divergenz,
    fehlgeschlagene CI, Reviewbedarf, Changes-requested. Clean, up to date,
    draft, approved und passing CI sind bewusst neutral.
  - **Visuelle Regression:** `pnpm test:visual` rendert die Sidebar
    deterministisch (eingefrorene Renderer-Uhr, fixe Git-Daten, Scale 1.0,
    en-US) in Dark/Light × 300/380/540 px plus offener Checks-Pane und
    vergleicht Pixel-Baselines pro Plattform
    (`scripts/fixtures/visual-baselines/`); Hosted-CI erfasst Screenshots und
    Strukturchecks, überspringt aber den Pixel-Diff.
  - Ein priorisiertes UI/UX-Review des Gesamtprodukts (Quick Wins wie der
    Light-Theme-Terminalrahmen, Typografie-/Kontrast-/Sprachbefunde,
    Run-Dialog-Entzerrung, Signatur-Vorschlag „Beweiskette“) steht in
    `docs/DESIGN_REVIEW_2026-07-19.md`.

- **Harness-Wahl pro Run (neu):** Der "Neuer Run"-Dialog bietet für den
  Orchestrator und jeden ausgewählten Teilnehmer eine explizite Harness-
  Auswahl (Agent-Standard plus Claude Code, Codex, OpenCode, Grok Build,
  Gemini CLI). Der Override gilt nur für diesen Run: Er wird auf dem
  RunParticipant gespeichert, verändert den Katalog-Agenten nicht und wird
  über `effectiveParticipantAgent` an jeder Start-/Capability-/Manifest-Naht
  angewendet (Roster, Task-Launch, PTY-Spawn). Ein Override verwirft bewusst
  das agent-eigene `customCommand`; `shell`, `custom` und `ollama` bleiben
  nur als Agent-eigene Runtimes zulässig, und IPC/Service lehnen unbekannte
  Harnesses fail-closed ab. Das gewählte CLI muss installiert und angemeldet
  sein — der Dialog sagt das ausdrücklich; eine Settings-Seite für
  Harness-Anmeldung ist der nächste Schritt.

- **Repo-Pfad-Import im "Neuer Run"-Dialog (neu):** Unter der Repository-
  Auswahl öffnet `Pfad…` eine Zeile für die direkte Pfadeingabe mit bewusster
  Backend-Wahl (Native/WSL-Distribution). Der Import nutzt denselben
  verifizierten `repository:import`-Vertrag wie der Scope-Header, ist
  idempotent und wählt das importierte Repository direkt für den Run aus.

- **Settings-Seite für Harness-Verwaltung (neu):** Der Header besitzt einen
  `Settings`-Dialog, der pro First-Class-Harness (Claude Code, Codex,
  OpenCode, Grok Build, Gemini CLI, Ollama) den echten CLI-Status zeigt
  (Installation/Version/Auth über einen synthetischen, read-only
  Diagnose-Probe pro Harness), das dokumentierte Login-Kommando nennt und
  optional einen API-Key entgegennimmt. Keys sind **write-only**: Sie werden
  mit Electron `safeStorage` (Windows-DPAPI) verschlüsselt in einer eigenen
  Datei neben `config.json` gespeichert, nie wieder angezeigt, nie über IPC
  oder `config:get` herausgegeben und ausschließlich Sessions der passenden
  effektiven Runtime als dokumentierte Umgebungsvariable übergeben
  (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`).
  Fehlende OS-Verschlüsselung schlägt fail-closed fehl statt Klartext zu
  schreiben; unlesbare Records starten die Session ohne Key. Der
  Playwright-Gate beweist die Kette real: Key im UI gespeichert →
  verschlüsselt persistiert (kein Klartext in beiden Dateien) → eine
  Grok-Session sieht ihn als `XAI_API_KEY` → Status überlebt den
  App-Neustart. OAuth-basierte CLIs melden sich weiterhin selbst an; ADE
  führt bewusst keine eigenen OAuth-Flows aus.

- **Settings v2 — Subscription-Anzeige, Login-Terminal, Service-Keys (neu):**
  - Eine bestehende CLI-Anmeldung (z. B. Claude Pro/Max, ChatGPT für Codex)
    wird als **„Angemeldet“ samt Methode** angezeigt; ADE ersetzt sie nicht.
    Das API-Key-Feld ist ausdrücklich als Alternative gekennzeichnet
    (API-Abrechnung), und liegen Anmeldung **und** gespeicherter Key
    gleichzeitig vor, warnt die Seite, dass der Key die Subscription in
    ADE-Sessions überschreiben würde.
  - **„Anmelden im Terminal“** öffnet pro Harness eine Terminal-Session mit
    dem dokumentierten Login-Kommando aus ADEs fester Tabelle (`claude auth
    login`, `codex login`, `opencode auth login`); der OAuth-/Device-Flow
    gehört vollständig dem CLI, die Login-Session erhält bewusst keine
    gespeicherten Keys. Vorerst nativ; WSL-Distros haben eigenen
    Login-Zustand pro Home.
  - **Service-Keys** für Zusatzdienste (z. B. `ELEVENLABS_API_KEY`):
    UPPER_SNAKE_CASE-Namen, reservierte Namen (PATH, NODE_OPTIONS, `ADE_*`,
    Harness-Key-Slots …) werden abgelehnt, Werte verschlüsselt wie
    Harness-Keys, Scope wählbar („alle Sessions“ oder bestimmte Harnesses),
    Injektion in native und WSL-Session-Umgebungen. Der Playwright-Gate
    beweist real: Subscription-Anzeige aus dem CLI-Status, Login-Terminal
    führt das Kommando aus, ein Service-Key erreicht eine Shell-Session als
    Umgebungsvariable, und beides überlebt den App-Neustart verschlüsselt.

- **Design-Review Quick Wins 1-3 (neu):** Der Light-Theme-Terminalrahmen ist
  behoben (xterm.css malte den Viewport `#000` und gewann per
  Bundle-Reihenfolge; ein Drei-Klassen-Selektor in terminal.css/graph.css
  gewinnt jetzt deterministisch, strukturell per Playwright abgesichert).
  Das Scope-Header-Select ellipsiert lange Namen vor dem Dropdown-Pfeil.
  Die bewusste Theme-Wahl („Darstellung“: Dunkel/Hell) lebt in der
  Settings-Seite; im Header bleibt ein Icon-Schnellumschalter (☀/☾).

- Die rechte Sidebar besitzt jetzt ein bewusst getrenntes **Overview** für das
  im Katalog ausgewählte Repository. **Changes** und **Files** bleiben ehrlich
  auf dem unveränderlichen Workspace der aktiven Session.
- Overview zeigt lokalen Branch-/Dirty-/Upstream-/Backend-Zustand, die letzten
  12 Commits und einen erst auf Klick geladenen, begrenzten Commit-Patch. Bis zu
  20 offene GitHub-PRs kommen optional über das repo-eigene native/WSL-`gh`;
  Offline/Auth/Provider-Fehler verdecken lokale Daten nicht.
- Der Main-Prozess akzeptiert nur Repository-ID und exakte Full-SHA, prüft die
  Repository-Identität erneut und validiert GitHub-PR-URLs doppelt. Es gibt
  keinen Fetch, Checkout, Push, Merge oder PR-Schreibbefehl im Inspector.
- Semantische Tabs unterstützen Pfeil/Home/End; die stabile Split-Pane erhält
  Daten und Scrollzustand, und `Escape` gibt den Fokus an den Commit zurück.
  Provider-Netzwerkreads hängen ausdrücklich nicht am 5-Sekunden-Lokalpolling.

- ADE besitzt jetzt einen **lokalen, expliziten Verified-Publishing-Flow**:
  erfolgreicher Managed Run → unveränderliches HEAD-/Verify-Attest → read-only
  Preview → separate Checkbox-Bestätigung → neuer `ade/run-*`-Branch → GitHub
  Draft PR. Es gibt keinen ADE-Befehl für direkten `main`-Push, Merge,
  Auto-Merge, Ref-Überschreiben oder Branch-Löschung.
- Der Main-Prozess prüft vor der Mutation erneut Repository/Backend, freigegebene
  Lease, sauberes identisches HEAD, approved Integration, finale Testevidenz,
  unveränderte Remote-Default-Base, GitHub-`origin`, Ref-Kollision und `gh`-
  Zugriff. Ein unterbrochener/teilweiser Versuch wird dauerhaft als Fehler
  protokolliert und kann nur gegen exakt denselben Branch/HEAD wiederholt werden.
- Native und WSL-Repositories verwenden Git und `gh` ausschließlich in ihrem
  gespeicherten Backend. Für WSL muss `gh` in der Distro installiert und
  authentifiziert sein. Der zukünftige mobile Host erhält absichtlich keinen
  Publish-Endpunkt.
- Diese Garantie schützt ADEs eigenen Produktpfad. Der gewünschte Codex-
  Bypass-Modus ist ein bewusst voll vertrauter OS-Prozess und kann unabhängig
  auf vorhandene Git-Credentials zugreifen; echte Isolation erfordert einen
  Nicht-Bypass-/Container-/Credential-Boundary.

- **Goal 6 bleibt abgeschlossen**; F1-F8, Einzelagent-Arme, Negativkontrollen
  und das begrenzte GO für Goal 7 stehen vollständig in
  `docs/goal6/RESULTS.md`.
- Der reale Pilot-Roster bleibt **Codex-only**: `Main Chef` nutzt
  `gpt-5.6-sol`, `xhigh` und bypass als Orchestrator; Leads/Worker nutzen
  `gpt-5.6-sol`, `high` und bypass. Absichtliche Shell-Helfer bleiben Shell.
  Es gibt keine gespeicherte Claude-Identity im Pilotprofil.
- Jede gespeicherte Identity besitzt ihr von ADE nachgeführtes Rollen-
  `AGENTS.md`. Managed Orchestrator-/Lead-/Worker-Tasks erhalten zusätzlich
  einen read-only Snapshot mit Digest und Provenance, ohne ihr Worktree zu
  verschmutzen. Der Roster-Enforcer erkennt außerdem vollständig ADE-eigene
  Legacy-`CLAUDE.md`-Scaffolds, archiviert sie im Apply-Lauf und verweigert die
  Löschung, sobald fremder Inhalt oder fehlerhafte Marker vorhanden sind.
- Der native Linux-/WSLg-Pfad ist nicht mehr nur ein Source-Smoke: ADE baut
  jetzt reproduzierbar als unpacked x64, AppImage und Debian-Paket.
- Die Windows-GUI besitzt einen eigenständigen, expliziten
  `wsl:<Distribution>`-Ausführungsbackend. Repositorypfad, Linux-Git,
  Worktrees, Filesystem, Diagnostik, PTY, Codex/Custom-Runtime, Managed-
  Taskdateien, Approval, Integration und Verifikation bleiben durchgehend in
  derselben Distribution.

## Windows-GUI → WSL-Vertrag

- Backendwahl wird auf Repository, Binding und Session-Snapshot persistiert;
  Legacy-Daten migrieren idempotent zu `native`.
- `wsl.exe` wird ausschließlich argv-basiert mit validierter Distribution und
  Linux-cwd gestartet. Prompts oder Pfade werden nicht in den Aufruf
  interpoliert.
- Windows-eigene Task-/Result-/Mailbox-/`AGENTS.md`-Artefakte werden gezielt
  über `wslpath` übersetzt. Linux-Git und Windows-Git werden niemals gegen
  dasselbe Binding gemischt.
- WSL-Dateioperationen prüfen Containment und Symlink-Komponenten, lesen mit
  no-follow, benennen Dateien/Ordner atomar ohne Überschreiben um und rollen
  eine fehlgeschlagene Trash-Quarantäne zurück.
- Eine fehlende Distribution fällt geschlossen aus und wird nicht zu
  „Verzeichnis fehlt“ oder einem nativen Windows-Fallback herabgestuft.
- Der UI-Import entdeckt Distributionen, verlangt eine bewusste Backendwahl,
  zeigt Native Windows/Native Linux korrekt an und beschriftet jeden WSL-Scope.
  Diagnostik verwendet bei einem konkreten Terminal dessen unveränderlichen
  Session-Backend-Snapshot.

## Linux-Paket

Implementiert:

- `pnpm package:linux:dir` → `dist/linux-unpacked/ade`;
- `pnpm package:linux` → `ADE-<version>-x86_64.AppImage` und
  `ADE-<version>-amd64.deb`;
- Desktop-/Icon-/Maintainer-/Homepage-Metadaten, Debian-Section `devel`;
- GitHub-Workflow für Source-Gate, unpacked, AppImage, installiertes Debian-
  Paket, SHA-256 und Artifact-Upload.

Lokal greifbare, Git-ignorierte Artefakte:

- `dist/linux-x64/ADE-0.1.0-x86_64.AppImage`
  (`5de4a7824476efd7ad7b617e719f41f17da4f1a9407e24bc1434bb73772268fe`);
- `dist/linux-x64/ADE-0.1.0-amd64.deb`
  (`bf1394d66a2ada1272af68ce91d38b230a721ffde6dd73b0357578d83d81fce3`);
- `dist/linux-x64/SHA256SUMS.txt`.

Der native Linux-Build-/Evidence-Checkout liegt unter
`/tmp/ade-linux-package-goal-20260719`. Er enthält ausschließlich generierte
Test-/Paketartefakte und kann später vollständig entfernt werden; der
Windows-Ordner oben behält die beiden fertigen Pakete.

## Historischer verifizierter Qualitätsstand vor dem Linux-Vertragsnachtrag

Windows, zusammenhängender `pnpm verify`-Lauf:

- beide TypeScript-Projekte grün;
- **507/507** fokussierte Unit-/Integrations-/Security-Assertions:
  Memory 27, Dispatch 12, Runtime 32, Execution-Backends 16,
  Orchestration 48, Orchestration-Beta 101, Publication 29, Prompts 31,
  Repository-Scopes 43, Repository-Inspector 27, Harness-Credentials 17,
  Workspace-FS 7, Security 117;
- Production-Build grün;
- **86/86** reale Electron-/Playwright-Checks grün, inklusive Repository-
  Übersicht/PRs/Commit-Diff/Keyboard/Fokus, Scope-&-Session-Offenlegung,
  CI-Rollup-Chip, On-demand-Checks mit Fokusrückgabe, ADE-Run-Provenance des
  veröffentlichten Draft-PR, Harness-Wahl und Repo-Pfad-Import im "Neuer
  Run"-Dialog, Settings-Seite mit Subscription-Anzeige, Login-Terminal,
  verschlüsseltem Harness-Key- und Service-Key-Roundtrip bis in die
  Session-Umgebung sowie disabled-before-confirm, realem isoliertem
  Git-Push, unverändertem Remote-`main`, Draft-PR-Audit und Persistenz nach
  App-Neustart;
- **21/21** visuelle Regressionschecks (Dark/Light × 300/380/540 px plus
  offene Checks-Pane) gegen die committeten `win32`-Baselines.

Realer Windows-GUI→Ubuntu-Backend:

- **31/31** Backend-Contracts/Integrationschecks, inklusive fehlender Distro,
  Unicode/Leerzeichen, POSIX-Case, Symlink-Abwehr, atomarem Rename, Linux-Git,
  ADE-owned Commit, PTY und Cleanup;
- **67/67** erweiterte Electron-/Playwright-Checks: UI-Import, WSL-Scope,
  Session-Diagnostik, echter Managed Run mit Approval/Integration/Verify,
  Windows-eigene Kontrollartefakte, vollständiger App-Neustart, Reopen,
  erneute Terminaleingabe und Entfernung aller vier Worktrees.

Ubuntu 24.04/WSL2, nativer ext4-Checkout mit Linux-`node_modules`:

- Typecheck, Production-Build und **409/409** fokussierte Assertions grün
  (nur der Windows-`.cmd`-Diagnostiktest entfällt);
- Source-App **47/47** unter Xvfb;
- unpacked Linux-Binary **47/47**;
- AppImage **47/47** mit `APPIMAGE_EXTRACT_AND_RUN=1`;
- aus dem `.deb` extrahierter `/opt/ADE/ade`-Payload **47/47**;
- `.deb`-Metadaten `amd64`, `devel`, Maintainer und Homepage korrekt;
- der isolierte native Codex-Sol/xhigh/bypass-Smoke bleibt grün.

GitHub Actions auf `d32faa9`:

- [Main-CI](https://github.com/McMuff86/ade/actions/runs/29676483968)
  vollständig grün: Ubuntu Source + unpacked und Windows Source + unpacked;
- [Package Linux](https://github.com/McMuff86/ade/actions/runs/29676490871)
  vollständig grün: 409 fokussierte Assertions sowie je 47/47 für Source,
  unpacked, AppImage und das wirklich installierte `/opt/ADE/ade`; SHA-256 und
  unsigned AppImage-/Debian-Artefakte wurden hochgeladen;
- der erste Lauf fand eine reine Test-Harness-Race: Der Dialog war sichtbar,
  bevor sein asynchrones Diagnoseergebnis gerendert war. `d32faa9` wartet auf
  die unverändert strenge Inhaltsassertion; lokal 47/47 und beide Hosted-Runs
  bestätigen den Fix.

Goal-6-Quality-Kandidat für `2D_rpg_jumpnrun`:

- lokaler, nicht veröffentlichter Branch `ade/goal6-quality-candidate` im
  separaten Worktree
  `C:\Users\Adi.Muff\repos\.ade-quality-worktrees\2d-rpg-goal6-quality`,
  finaler HEAD `77cdaff` auf unveränderter Basis `81820b9`;
- ausschließlich die erfolgreich integrierten/verifizierten Managed-Ergebnisse
  F1, F2, F5, F6 und F8; F3/F4 sowie Drafts, Abbrüche und Baseline-Arme bleiben
  bewusst ausgeschlossen. Die späteren F3v4-/F4v3-Live-Ergebnisse liegen auf
  separaten Evidence-Branches und wurden nicht nachträglich in diesen
  historischen Kandidaten aggregiert;
- eine frische Frozen-Installation deckte beim kombinierten F2/F8-Test einen
  zuvor ambient erfüllten Node-Typvertrag auf. Der Kandidat deklariert deshalb
  `@types/node@22.18.0` explizit und reproduzierbar im Lockfile;
- finaler HEAD: **130/130** Vitest-Tests, **5/5** Server-Tests, TypeScript und
  Production-Build grün; die F8-Negativkontrolle nannte bei entferntem
  `impact.png` exakt Waffe und Asset-Pfad und stellte die Datei wieder her;
- der echte Headless-Chrome-Smoke lief vor und nach dem finalen Dokumentations-
  commit grün und prüfte Gameplay, alle zwölf Waffen, Audio, Kamera/Pause,
  Arena-Größen, Workshop/Arsenal, Team-Editor und 5v5-Setup. Die ignorierten
  Screenshots liegen im Kandidaten-Worktree unter `artifacts/`;
- vollständige Evidence und Grenzen stehen in
  `docs/ade-goal6-quality-candidate.md` auf dem Kandidatenbranch.

## Sicherer Arbeitszustand

- Die erweiterten WSL-Tests hinterließen keine Test-Repositories, Worktrees,
  Prompt-Scratchpads oder ADE-Testprozesse.
- Auch der Publishing-/Playwright-Gate hinterließ keine temporären Repositories
  oder Test-App-Prozesse. Die bereits laufende echte ADE-Instanz mit dem normalen
  `%APPDATA%\ade`-Profil wurde erkannt und bewusst nicht beendet.
- Keine aktiven Goal-6-Runs oder Leases. Das Pilot-Originalrepo ist clean;
  `main` und `origin/main` blieben während der Retests unverändert auf
  `ee28d79`. Die vier disponiblen ADE-Pilot-Worktrees sind clean auf der
  gemeinsamen Run-Basis `81820b9`. F3v4/F4v3 bleiben über lokale
  `goal6/f3v4-*`-/`goal6/f4v3-*`-Evidence-Refs erreichbar; der ausgeschlossene
  F4v2-D1 über `goal6/f4v2-a1-worker-d1`.
- Das ADE-Pilotprofil bleibt unter `%APPDATA%\ADE`; echte Profil-Läufe brauchen
  weiterhin `ADE_USER_DATA_DIR=%APPDATA%\ADE`.
- `out/` gehört zum geprüften Windows-Quellstand. `dist/linux-x64` ist bewusst
  Git-ignoriert und enthält die auslieferbaren lokalen Linux-Pakete.
- Der abschließende Codex-Apply hat drei vollständig ADE-eigene Alt-Scaffolds
  (RhinoClaw Home + Binding, Main-Chef-Binding) hash-verifiziert nach
  `%APPDATA%\ADE\ade\legacy-instruction-backups\2026-07-19T06-46-58-123Z`
  archiviert. Beide betroffenen Git-Worktrees sind clean; der anschließende
  Dry-Run bestätigt fünf Codex-Identitäten und fünf echte Memory-`AGENTS.md`.

## Bewusste Grenzen

- Vor einer öffentlichen stabilen Linux-Veröffentlichung muss die
  Projektlizenz bewusst festgelegt werden. Auto-update, Linux-Signierung und
  Release-Feed fehlen noch.
- Der Hybridbackend ist Windows-only und benötigt WSL2 sowie `/bin/bash`, Git,
  Python 3, `gio` und die ausgewählten Agent-CLIs samt Login in der Distro.
- Der Windows-Ordnerpicker browsed keine Linux-Pfade; WSL-Repositories werden
  als absolute Linux-Pfade eingegeben. WSL-Worktrees liegen bewusst im
  benachbarten `.ade-worktrees` statt im Windows-globalen Worktree-Verzeichnis.
- Managed WSL-Tasks erhalten ihr Rollen-`AGENTS.md`. Interaktive WSL-Sessions
  lesen Repository-Anweisungen normal, aber ADE injiziert den Windows-eigenen
  Memory-Block noch nicht in ein Linux-Worktree.
- macOS bleibt vorbereitet, aber ungeprüft und ungepackt.
- Verified Publishing unterstützt zuerst nur GitHub über `origin`. Es verlangt
  eine exakt unveränderte Remote-Base und führt keinen Rebase/Branch-Update aus.
  Alte abgeschlossene Runs ohne neues Verification-Attest müssen neu laufen.
  Der neue Slice ist lokal auf Windows verifiziert und muss im nächsten Hosted-
  /Native-Linux-Lauf in die dortige Evidenz aufgenommen werden. Push-Hooks sind
  absichtlich deaktiviert; Git-LFS-/Hook-abhängige Repositories brauchen vorerst
  einen manuellen Publish oder einen späteren expliziten Provider-Vertrag.

## Nachtrag 2026-07-21 — Dependency-aware Worker-Bases (F3/F4-Fix)

- `dependsOn` überträgt jetzt Git-Zustand statt nur Ergebnisdaten: Vor dem
  Start eines abhängigen repo-gestützten Workers präpariert ADE dessen
  geleasten Worktree mit den validierten Commits seiner Abhängigkeiten
  (erster Parent verbatim per `reset --hard`, weitere Parents als owned
  Deltas in Assignment-Reihenfolge, Diamanten werden übersprungen). Die
  präparierte Basis wird als `preparedBaseSha` auf dem Task persistiert und
  als `workspace.prepared` journaliert; Validierung und Integration zählen
  ausschließlich owned Deltas (`preparedBaseSha..tip`). Konfligierende
  Parent-Deltas schlagen fail-closed VOR dem Worker-Start fehl und stellen
  die Run-Basis wieder her.
- Planner-/Worker-Prompts sprechen die neue Wahrheit (Versionen plan=2,
  work=2): Abhängige Assignments dürfen auf Upstream-Dateien aufbauen und
  sie verändern; Re-Authoring ist ausdrücklich verboten.
- Beweis: `pnpm run test:orchestration-beta` (117 Checks) enthält die
  F3/F4-Klasse als echten Koordinator-Test auf realem Git — 2 parallele
  Producer → 1 abhängiger Consumer inklusive 3-Commit-Integration und
  Verifikation — plus Negativkontrollen (divergentes Re-Authoring,
  konfligierende Parents, dirty/falsche Basis). Voller `pnpm test` grün
  (13 Suiten).
- Live-Reproof abgeschlossen: F3v4 `3a2773cc` führte eine Kette mit drei
  Owned-Commits durch zwei exakt übernommene Prepared-Bases bis zum
  tree-identischen integrierten/verifizierten HEAD `06962ae9`; F4v3
  `9bcd8932` führte zwei Owned-Commits plus read-only Audit analog bis
  `b8a1229d`. Beide Runs: `completed`, null Rollbacks, Integration-Review und
  unabhängige Verifikation grün, alle Leases freigegeben. F4v2 `c3c232c6`
  bleibt wegen eines belegten externen DNS/API-Ausfalls ausgeschlossen (D2
  ohne Partial-Diff, keine Integration). Vollständiges Protokoll und Refs:
  `docs/goal6/F3F4_RETEST.md` und `docs/goal6/RESULTS.md`.

## Nächste Schritte

1. Für neue operator-gesteuerte ADE-Produkt-, Managed-Run- und General-Use-
   Tests RhinoClaw als bevorzugtes reales Repository verwenden. Ausschließlich
   disposable ADE-Worktrees/-Branches nutzen; RhinoClaw-Arbeitsbaum, `main`,
   deployed Skill und laufende Rhino-Installation bleiben ohne separate
   Freigabe unverändert. Deterministische CI-/Electron-Tests behalten ihre
   synthetischen lokalen Fixture-Repositories. Der lokale
   `2D_rpg_jumpnrun`-Kandidat `77cdaff` bleibt historische Goal-6-Evidence und
   wird nicht als laufendes Standard-Testziel weitergeführt oder veröffentlicht.
2. Sprache (DE/EN-Mix) und Typografie (zweite Schriftstimme für Fließtext,
   Typo-Skala als Tokens, eigenes Warn-Token) gemäß
   `docs/DESIGN_REVIEW_2026-07-19.md` vereinheitlichen; die dortigen Quick
   Wins 1-3 sind umgesetzt.
3. Eine Version/Tag-basierte Linux-Release-Runde erst nach expliziter Lizenz-
   und Release-Policy veröffentlichen.
4. Einen geführten WSL-Prerequisite-Check mit klaren Reparaturaktionen in das
   Onboarding integrieren.
5. Goal 7 ausschließlich im bereits dokumentierten bounded GO fortsetzen:
   Der read-only Foundation-Slice ist umgesetzt; als Nächstes folgen SSE,
   Geräte-Pairing/Audit und erst danach idempotente Schreibkommandos. Der Host
   bleibt deaktiviert, loopback-only und ohne Roh-PTY-/Filesystem-Exposition.
6. Danach Persistenz/Retention, Accessibility-/Performance-Budgets und erst
   dann macOS/Updater als eigene Release-Tracks angehen.

Operator-Kommandos:

```powershell
pnpm verify
pnpm test:visual                  # visuelle Baselines prüfen
pnpm test:visual:update           # Baselines nach gewollter UI-Änderung erneuern
pnpm test:wsl-backend
$env:ADE_WSL_BACKEND_E2E='1'; pnpm exec tsx scripts/test-electron-workflow.ts
pnpm agents:codex                 # Audit/Vorschau
pnpm agents:codex -- --apply      # gesicherten Codex-only Roster anwenden
```

Produktmeinung: ADE besitzt inzwischen einen ungewöhnlich belastbaren,
fail-closed Orchestrierungs- und Plattformkern. Das nächste Qualitätsniveau
entsteht nicht durch möglichst viele neue Schalter, sondern durch geführtes
Onboarding, progressive Offenlegung, hervorragende Recovery-Zustände,
messbare Accessibility/Performance und wenige, sehr gut gestaltete
End-to-End-Flows für „schnelle Aufgabe“ versus „Managed Run mit Beweiskette“.

## Nachtrag 2026-07-23 — Linux-E2E- und Baseline-Vertrag

- Der aktuelle WSL-Lauf `NODE_ENV=development pnpm verify` ist vollständig
  grün: beide TypeScript-Projekte, **553/553** fokussierte Assertions,
  Production-Build, **96/96** Source-Electron-Checks und **22/22** visuelle
  Struktur-/Baseline-Policy-Checks. Das frisch gebaute unpacked Linux-Paket
  besteht denselben **96/96**-Electron-Vertrag.
- Der Settings-E2E fragt den realen `harness:status` ab. Windows/DPAPI behält
  den positiven verschlüsselten Harness-/Service-Key-Roundtrip bis in die
  Session-Umgebung und über den App-Neustart. Headless Linux ohne Secret
  Service prüft stattdessen den vorgesehenen Fail-closed-Vertrag: sichtbare
  Warnung, deaktivierte Secret-Eingaben, keine Credential-Records und derselbe
  Zustand nach Neustart. Electrons Linux-Backend `basic_text` und unbekannte
  Backends werden trotz `isEncryptionAvailable() === true` abgelehnt; nur
  bekannte OS-Secret-Stores sind zulässig. Produktion fällt weiterhin nie auf
  Klartext zurück. Bereits gespeicherte Records werden bei späterer Storage-
  Unverfügbarkeit weder entschlüsselt noch in neue Session-Umgebungen injiziert.
- Der visuelle Test schreibt auf Plattformen ohne autoritativen Baseline-Satz
  (aktuell Linux) unabhängig von `--update` nur nach `test-results/visual/`
  und ignoriert dort versehentlich vorhandene Repository-Baselines. Auf der
  autoritativen Windows-Plattform schlägt bereits eine fehlende erwartete
  Baseline auch im CI fehl. Repository-Baselines entstehen oder ändern sich
  ausschließlich mit `pnpm test:visual:update`; ein normaler Verify-Lauf
  verschmutzt den Worktree nicht mehr.
- Historische Goal-6-Dokumente und der abgeschlossene Driver bleiben bewusst an
  `2D_rpg_jumpnrun` gebunden. Neue reale ADE-General-Use-Validierung verwendet
  RhinoClaw unter den oben beschriebenen Worktree- und Freigabegrenzen.

## Nachtrag 2026-07-26 — Professionalisierungs-Review und Config-Durability

- Ein Multi-Agent-Review des gesamten Quellstands liegt als
  `docs/PROFESSIONALIZATION_REVIEW_2026-07-26.md` vor: sechs Subsystem-Reader,
  adversarielle Gegenprüfung der kritischen Befunde, sechs Themen mit
  Exit-Kriterien und eine ausdrückliche „nicht jetzt"-Liste. Belegstufen sind
  im Dokument je Befund markiert (*verifiziert* vs. *Hinweis*).
- **Thema 1 ist umgesetzt.** `ConfigStore.load()` ersetzte bisher bei jedem
  Lesefehler — gesperrte Datei, korruptes Byte, Throw in `normalizeConfig` —
  die einzige Kopie von Katalog, Bindings, Run-Journal und Publication-Audit
  durch Defaults, ohne Log, Backup oder UI-Fehler. Jetzt seeded nur `ENOENT`;
  jeder andere Fall wandert zuerst nach `userData/ade/corrupt/config-<ISO>.json`
  und schlägt, falls auch das scheitert, in einen read-only Store um, der jedes
  `save()` verweigert, bevor er den In-Memory-Snapshot verändert. `persist()`
  fsynct jetzt vor dem Rename.
- Der Zustand ist sichtbar: `config:health` liefert eine `ConfigLoadFailure`
  ohne absoluten Pfad, der Renderer zeigt sie als Banner über der Shell — im
  read-only-Fall blockierend. Ein leerer Katalog sieht sonst wie eine
  Neuinstallation aus.
- Nebenbefund mit behoben: `scripts/test-security.ts` deklariert
  `Record<InvokeChannel, unknown>`, damit ein Channel ohne Fixture ein
  Typfehler ist — aber `scripts/**` steht in keinem tsconfig-`include`, also
  lief der Guard nie. `wsl:list` fehlte tatsächlich und ist ergänzt. Der
  dritte `tsc`-Lauf über `scripts/` steht als Thema 4 aus.
- Gate auf diesem Stand (Windows): Typecheck grün, **597/597** fokussierte
  Assertions (inkl. 12 neuer Config-Store-Checks), Production-Build grün,
  **104/104** Electron-/Playwright-Checks (inkl. truncated-config Restart mit
  Banner, byte-identischer Quarantäne und Dismiss) und **22/22** visuelle
  Checks gegen die committeten `win32`-Baselines.


## Nachtrag 2026-07-27 — Thema 4, erste zwei Punkte

- **Die Driver werden jetzt typgeprüft.** `tsconfig.scripts.json` deckt
  `scripts/**` ab und ist der dritte `tsc --noEmit` in `pnpm typecheck`. Das
  Einschalten förderte 16 echte Typfehler zutage, überwiegend Fixtures, die
  eine Form bauten, die die Produktionstypen nicht zulassen: `Repository` und
  `WorkspaceBinding` ohne `executionBackend`, `RunTask` ohne `title`/`phase`/
  `managed`/`dependsOn`/`attempt` — darunter der Fake für `runTask:create`,
  der damit eine Antwort lieferte, die der echte Handler nie erzeugt. Alle
  behoben, ohne Testsemantik zu ändern (ein fehlender `executionBackend`
  normalisiert ohnehin zu `native`).
- **Jede Suite hat einen Boden.** `pnpm test` ruft `scripts/run-suites.ts`:
  alle 15 Suiten laufen (eine kaputte verdeckt die übrigen nicht mehr), jede
  meldet ihre Check-Zahl, und ein Unterschreiten des gemessenen Bodens ist ein
  Fehler. Böden sind plattformabhängig; gemessen und erzwungen ist bisher
  nur `win32`, und der Runner benennt jede Plattform ohne Messung ausdrücklich,
  statt eine Zahl zu erfinden. Für Linux fehlt die Messung noch
  (`pnpm test -- --record` auf einer Linux-Installation).
- **Beide Guards gegengeprüft, nicht nur behauptet.** Ein testweise
  ergänzter Channel `probe:guard` erzeugt in `scripts/test-security.ts` einen
  TS2741; beide Sonden wurden zurückgenommen. Wird ein einzelner Check aus
  `test-workspace-fs.ts` entfernt, meldet die Suite selbst `6 passed, 0 failed`
  und beendet sich mit 0 — grün — und der Runner lehnt sie trotzdem ab.
  Zur Einordnung des Vortags-Nachtrags: ein Channel *ohne Validierung* war nie
  ungeschützt, weil `ipcValidation.ts` in `const exhaustive: never = channel`
  endet. Ungedeckt war der validierte Channel ohne Security-Fixture.
- Gate auf diesem Stand (Windows): Typecheck über drei Projekte grün,
  **597/597** fokussierte Assertions über 15 Suiten, Production-Build grün,
  **104/104** Electron-/Playwright-Checks, **22/22** visuelle Checks.
