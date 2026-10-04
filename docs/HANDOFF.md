# ADE — aktuelle Übergabe

Neuer Kontext für Goal 34.6: zuerst [Kontexthandoff 3. Oktober](CONTEXT_HANDOFF_2026-10-03.md)
lesen (Haltepunkt, offene Benutzerentscheide, Code-Landkarte H1, Stolpersteine).

## Stabilisierung vor H2c (4. Oktober 2026, abends)

Auf Benutzerauftrag Feature-Stopp an der H2b-Grenze; kein Produktcode geändert,
persönliche Aktivierung siehe unten.

- **Git:** alle gemergten Branches lokal und auf GitHub gelöscht; es bleiben
  `main` und lokal `feat/coordinator-linux` (auf Wunsch behalten).
- **Doku:** `8a1a683` kürzt HANDOFF/STATUS/ROADMAP und verschiebt abgeschlossene
  Nachweise sowie das Ursprungsmaterial aus dem Root nach `docs/archived/`
  ([Audit](DOCUMENTATION_AUDIT.md)).
- **Windows-CI:** war seit 30. September rot. `2d521a0` behebt drei Testfehler
  (Import-Graph-Pfade, Pfadtrenner, Fixture unter Runner-Node statt Electron);
  `13f9b15` trägt die gemessenen Windows-Mindestzahlen ein. CI-Lauf
  `37224990040`: Linux und Windows grün, je 114 Suiten.
- **Port-Helfer:** `scripts/helpers/fixturePort.ts` ersetzt die
  `listen(0)`-Reservierung in `conversation-electron` und den sieben weiteren
  Electron-Treibern. Unter Linux liegt der Port unterhalb des Ephemeral-Bereichs;
  unter Windows bleibt das Verhalten unverändert. Vollständiges `pnpm verify`
  danach: **31 bestanden / 0 Fehler / 16 nicht gemessen**, 114 Suiten / 4.735
  Checks; `conversation-electron` 90/0, `mobile-electron` 43/0,
  Sitzungsnavigation 96/0. Die fünf Windows-only-Treiber (Diktat, Reply-Speech,
  Setup, Remote-Restart, Remote-Terminal) sind hier nur typgeprüft.
- **Lokal:** vier `home/`-Caches alter Prüfläufe unter `test-results/` gelöscht
  (9,0 GB → 195 MB); zitierte Logs und JSON-Belege bleiben.
- **Nur durch den Benutzer:** siehe
  [ROADMAP, offene Abnahmen](ROADMAP.md#offene-abnahmen-durch-den-benutzer).
- **Persönlich aktiviert (4. Oktober 2026, 21:26 CEST):** Commit `32f2b17`
  (Tag `v0.1.0-stable.1`) über `pnpm activate -- -Label Stable1`. Vorher lief
  keine ADE-Instanz (Port 4317 frei). Gate 14/0/1 nicht gemessen; neuer Host
  **PID 4009266**, Quelle `00567b74157e5f033baa`; Backup
  `~/ADE-Backups/Activate-Stable1-2026-10-04T19-26-17-199Z`. HTTPS `:8443`
  liefert 200; Tailscale Serve unverändert. Tablet-Abnahme durch den Benutzer
  läuft. Rollback: `pnpm activate -- -Rollback`.
- **Tablet-Test und Korrekturen (4. Oktober 2026, 22:09 CEST):** Befunde und
  Stand in [ROADMAP](ROADMAP.md#befunde-aus-dem-tablet-test-vom-4-oktober-2026).
  Behoben: Überlappung im Tablet-Graph (`873a1cc`), beendete CLI-Sitzung liess
  sich am Tablet nicht entfernen und blendete alle zehn Sekunden eine Ablehnung
  ein (`c252f6b`), Hinweis im Auftragsdialog (`320e843`). Vollständiges
  `pnpm verify`: 31/0/16 nicht gemessen, 114 Suiten / 4.737 Checks. Aktiviert
  über `pnpm activate -- -Label TabletFixes`: Gate 14/0/1 nicht gemessen,
  vorherige Instanz regulär beendet, neuer Host **PID 225150**, Quelle
  `16cebfbef53cbc5b1d6f`; Backup
  `~/ADE-Backups/Activate-TabletFixes-2026-10-04T20-09-18-994Z`; HTTPS `:8443`
  liefert 200. Offen: Abnahme der Korrekturen und der Codex-Rückfrage am Tablet.
- **Antwort auf beendete Aufträge (4. Oktober 2026, nachts):** umgesetzt für
  Claude Code und Codex ([Entscheide und Nachweise](TASK_REPLY_PLAN.md)).
  Suiten 115/115 mit 4.776 Checks; `remote-workspace-browser` 30/0,
  `mobile-electron` 46/0, `linux-agent-tablet` 61/0. Vollständiges
  `pnpm verify`: 30 bestanden, **1 Fehler**, 16 nicht gemessen. Der Fehler ist
  der H2b-Treiber `linux-secret-service`, der sporadisch scheitert (4 von 14
  Einzelläufen; siehe ROADMAP). Echte Probe der Fortsetzung mit Modell steht aus.
- **Nächster Schritt:** Schlüsselbund-Treiber stabilisieren, dann H2c ([HOST_SECRETS_H2](HOST_SECRETS_H2.md)).

## Goal 34.6 H2b: nativer Linux-Schlüsselbund (4. Oktober 2026)

Auf Benutzerauftrag H2a als **`61322f3`** committet und mit den Goals
selbstständig fortgesetzt. H2b implementiert den profilgebundenen Secret-
Service-Anschluss, einen begrenzten nativen Kindprozess und Polling/Retry.
Details und Grenzen: [HOST_SECRETS_H2](HOST_SECRETS_H2.md).

- `LinuxWrappingKeyStore.ts`: Hash des kanonischen Profilpfads, private
  Prozess-Pipes, reduzierte Umgebung, Zeit-/Ausgabelimits, Abbruch.
- `linuxSecretService.ts` / `keyringWorker.ts`: `@napi-rs/keyring` **2.1.0**,
  explizit Secret Service, Metadaten über `busctl`, tatsächliche Sammlung und
  beide Suchmengen (locked/unlocked), Mehrdeutigkeit verweigert, Read-back.
  GNOME-Protektion aus 16 Header-Bytes; sonst `unknown`.
- `SecretVaultMonitor.ts`: gesund 2-s-Polling, Ausfall-Backoff bis 30 s,
  Cache-Invalidierung bei Dienst-, Schlüssel- oder Protektionswechsel.
  Erkennung ist intervallgebunden; credentialabhängige Launchpfade müssen
  später `checkNow()` abwarten. Keine produktive Verdrahtung in H2b.
- `electron.vite.config.ts` emittiert zusätzlich `main/keyringWorker.js` und
  gemeinsame Chunks in `main/chunks/`. `package.json`/Lockfile enthalten das
  native Paket und ein vorbereitetes asar-Unpack-Muster; Packaging ist noch
  nicht gemessen. Die Host-Grenze prüft beide Einstiegspunkte: **219 Module**.
- Tests: `linux-keyring-boundary` **21/0** und weiterhin `host-secret-vault`
  **59/0**. Neuer Linux-Verify-Treiber `linux-secret-service` misst private
  D-Bus-/GNOME-Fixtures unter Node und Electron RunAsNode. Voraussetzungen
  für diesen Treiber: `dbus-daemon`, `busctl`, `gnome-keyring-daemon`, Python
  mit `dbus`-Modul. Fehlende Linux-Voraussetzungen lassen ihn fehlschlagen;
  andere Plattformen sind in `verify.ts` explizit *nicht gemessen*.

Die ersten realen Proben scheiterten an der unterschiedlichen JSON-Form von
`busctl call` und `get-property`, der Headerlänge und dem Fixture-Entsperren.
Diese Test-/Parserfehler sind behoben; sie zählen nicht als erfolgreiche
Negativkontrollen. GNOME-Testmethoden zum Entsperren/Passwortändern laufen nur
am privaten Bus. Der letzte Schutz ergänzt die Erkennung eines ersetzten
Schlüssels im selben OS-Eintrag unabhängig von der Sekundenauflösung von
`Modified`. Die native Integration besteht **42/0**; der Prozess-/Monitor-
Vertrag **21/0**. Finales `MISE_PNPM_VERSION=9.15.9 pnpm verify` am 4. Oktober,
**01:45–01:48 CEST**: **31 bestanden / 0 Fehler / 16 nicht gemessen** (Windows),
**114 Suiten / 4.735 Checks**, 3 min 34 s. Alle drei TypeScript-Projekte,
beide Builds, der native Treiber und die unter Linux gemessenen Electron-/
Browser-Flows grün; Aktivierung/Rollback **21/0**, visuell **22/0**.
Bericht: `test-results/verify/report.json`. Gemessene Umgebung: Node 26.8.2,
Electron 43.1.0, GNOME Keyring 50.0, natives Linux.

Im vollständigen Zwischenlauf scheiterte ausserdem ein bestehender
Modellwahl-Check (`electron-workflow`, 203/1): der gespeicherte Wert war schon
sichtbar, während die erste Katalogabfrage noch laufen konnte. Der Treiber
`scripts/helpers/modelPickerFlow.ts` wartet jetzt vor dem Entfernen des Modells
und dem Refresh auf das bestätigte Fixture-Modell sowie den aktivierten
Refresh-Button. Die Aussage des Checks bleibt unverändert. Gezielte
Wiederholung über `pnpm verify --only electron-workflow --reuse-build`:
**204/0**, im finalen Gesamtlauf ebenfalls **204/0**. Separater Commit
**`99d351b`**; kein Produktcode des Modellwählers geändert.

Kein persönlicher Schlüsselbund, keine persönliche Unit und kein `out/`
verändert; kein Push, keine persönliche Aktivierung. H2c ist als Nächstes
offen: Decoder/Manifest der drei Altstores und Konsumenten auf den Tresor
umstellen, danach H2d UI/Startblockaden. H3–H7 und der benutzerabhängige
Reboot-Nachweis bleiben offen.

## Goal 34.6 H2a: Tresor-Kern und Migrationsempfänger (3. Oktober 2026, spät abends)

Der Benutzer hat die Fortsetzung beauftragt und ausdrücklich bestätigt:
selbstständig **ohne Orchestrator** weiterarbeiten. Umsetzungsschritt und
Folgearbeit: [HOST_SECRETS_H2](HOST_SECRETS_H2.md).

- Neu: `src/main/host/secrets/HostSecretVault.ts` und `vaultFile.ts`:
  AES-256-GCM, profilgebundene Authentifizierung, begrenzte private Dateien,
  fsync/atomarer Austausch/Read-back, Zustände und fail-closed Schlüsselverlust.
  Migrationseinträge werden einzeln dauerhaft bestätigt, nach Abbruch
  idempotent wieder angenommen und nur als vollständiger Satz freigegeben.
- Fokussierter Linux-Nachweis: `test-host-secret-vault.ts` **59/0**;
  `host-boundary` **18/0**, Mindestzahl **215 Module**. Neue Suite in
  `run-suites.ts`, damit im `suites`-Schritt von `pnpm verify`.
- Grenzen: OS-Port simuliert; kein nativer Secret-Service-/DPAPI-Nachweis,
  kein Altdatei-Decoder, keine UI, keine produktive Verdrahtung. H2 ist offen.
  Der Empfänger erhält keine Pfade zu alten Stores; seine Abbruchkontrolle
  belegt deren Unverändertheit im Fixture, nicht bereits die komplette
  safeStorage-Migration. Bestehende Stores und Launchpfade bleiben produktiv.
- Arbeitsstand: Änderungen im Arbeitsbaum auf Basis `95d8a8c`, nicht committet,
  nicht gepusht, nicht persönlich aktiviert. Kein persönlicher Schlüsselbund
  oder Dienst verändert. Test-Builds ausschliesslich unter `test-results/`.

Vollständiger Verify-Abschluss auf dem finalen Code-Stand, 3. Oktober
23:39–23:42 CEST: `MISE_PNPM_VERSION=9.15.9 pnpm verify`, **30 bestanden /
0 Fehler / 16 nicht gemessen** (Windows), **113 Suiten / 4.714 Checks**,
3 min 31 s. Alle drei TypeScript-Projekte, beide Builds und sämtliche unter
Linux gemessenen Electron-/Browser-Flows grün, einschliesslich isolierter
Aktivierung/Rollback **21/0** und visueller Regression **22/0**.
Bericht: `test-results/verify/report.json`. Der frühere Lauf war ebenfalls
grün; nach dem zusätzlichen Schutz gegen gelöschte Tresordateien wurde der
gesamte Lauf wiederholt. `out/main/index.js` behält den Zeitstempel
2026-10-02 12:51:14; die persönliche Instanz wurde nicht aktiviert.

Nächster Umsetzungsschritt H2b: profilgebundener nativer Linux-Schlüsselbund,
`Locked`-Abfrage, passwortlose Diagnose, begrenzte Aufrufe und Wiederanlauf;
isolierte D-Bus-Negativkontrollen. Danach H2c Migration/Konsumenten und H2d UI
mit echten Startblockaden. Der Reboot-Nachweis bleibt vom Benutzerneustart
abhängig; der Spike-Dienst wurde nicht zurückgebaut.

## Goal 34.6 H1: Composition Root getrennt, abgeschlossen (3. Oktober 2026)

Ergebnis: Die gesamte Komposition liegt in `src/main/host/composeHost.ts`
und läuft ohne Electron (belegt in reinem Node durch die Suite
`host-handlers`); `ipc.ts` ist ein Desktop-Adapter mit 13 Electron-gebundenen
Handlern. Weiterhin ein Prozess: „ADE beenden“ stoppt alle PTYs, bis H3 den
eigenständigen Host bringt. Kein Verhaltenswechsel für Renderer oder Tablet,
**nicht persönlich aktiviert** (Aktivierung nur auf Auftrag über
`pnpm activate`). Der exklusive Besitz von `src/main/ipc.ts` (R7) endet mit
diesem Abschluss.

Abschluss H1h: Gegenprobe vorgeführt (nicht committet), absichtlicher
Electron-Import in `composeHost.ts` → `src/main/host/index.ts ->
src/main/host/composeHost.ts -> electron`, 17/1; danach 18/0.
Vollständiges `pnpm verify` zum Abschluss: **30 bestanden / 0 Fehler / 16 nicht
gemessen** (Windows), Suiten 112/112 mit 4.655 Checks.

Offen danach: H2 (Secrets-Tresor) auf Auftrag; der kleine Fix für die
`conversation-electron`-Last-Flakiness (nur Treiber, siehe Befund unten) als
eigener Commit nach H1; der vorbereitete Reboot-Nachweis (H0, Experiment 5)
wartet auf einen Neustart durch den Benutzer.


- **H1a, Grenzprüfung:** `scripts/test-host-boundary.ts` (Suite
  `host-boundary`, 6 Checks) läuft den Laufzeit-Importgraphen ab
  `src/main/host/index.ts` (`scripts/helpers/importGraph.ts`, TypeScript-API;
  Type-only-Importe zählen nicht, `require()` und `import()` schon). Sie
  schlägt mit der Kette fehl, sobald `electron` erreicht wird, und verlangt
  mindestens **102** Module. Fixtures: Laufzeitkette und lazy `require` müssen
  fehlschlagen, Type-only muss bestehen.
- Gegenprobe vorgeführt (nicht committet): absichtlicher Electron-Import in
  `HostOperationService.ts` → `src/main/host/index.ts -> …/HostOperationService.ts
  -> electron`, 5/1.
- `src/main/host/ports.ts` beschreibt die Ports (Ereignisse, Benachrichtigung,
  Bild, Secrets, Power, Autostart, Relaunch, App-Info, Profilpfade); noch
  ungenutzt.
- **H1b, Ereignis- und Benachrichtigungs-Port:** `PtyManager`
  (`setClientPorts`) und `RunCoordinator` (`setNotifier`) erreichen Fenster und
  native Hinweise nur noch über `HostEvents`/`HostNotifier`. Der
  Desktop-Adapter übergibt `broadcastToRenderers` und `desktopNotifier`
  (`notifications.ts`). Die Grenzprüfung erreicht jetzt **133** Module
  (Mindestwert angehoben) und verbietet zusätzlich `rendererWindows.ts`,
  `notifications.ts`, `ipc.ts` und `index.ts` im Host-Graphen.
- **H1c, Profilpfade und Secrets explizit:** `index.ts` leitet alle Pfade
  einmal aus `app.getPath('userData')` ab (`host/profilePaths.ts`, nach dem
  `ADE_USER_DATA_DIR`-Override) und übergibt sie an `ConfigStore` und
  `registerIpcHandlers`. `identity.ts`, `photos.ts`, `config/store.ts` und
  `HarnessCredentialService` laden kein Electron mehr; das
  `ade-photo://`-Protokoll liegt in `desktop/photoProtocol.ts`. Eine
  gemeinsame Desktop-`SecretProtection` (safeStorage) dient Harness-Keys,
  Geräten und Push. Neue Suite `profile-paths` (16 Checks) belegt, dass jede
  Ableitung der bisherigen Formel entspricht, auch für `~/.config/ade`; der
  Electron-Workflow vergleicht `app.getPath('userData')` des echten Laufs.
  Grenzprüfung: **142** Module.
- **H1d, Plattform-Ports:** `desktop/desktopPorts.ts` enthält die bisher in
  `ipc.ts` eingebetteten Electron-Implementierungen unverändert: `nativeImage`
  (Organizer-Grösse, Terminalbild → PNG, Profilfoto 256/128/64 ≤ 32 KB),
  `safeStorage`, `powerSaveBlocker`, Autostart, `app.relaunch` und App-Info.
  `ipc.ts` nutzt nur noch die Ports und importiert von Electron nur Fenster,
  Dialog, Zwischenablage, `ipcMain` und `shell`. Die Grenzprüfung verbietet
  `src/main/desktop/**` im Host-Graphen; **145** Module.
- **H1e, clientId:** `desktop/DesktopClients.ts` gibt jedem Renderer-Fenster
  eine zufällige Kennung (`HostClient`: `id`, `alive()`, `onClose()`).
  Antwortsprache, Diktat (Terminal, Gespräch, Organizer) und Bundle-Import
  besitzen ihren Zustand jetzt als `desktop:<clientId>` statt über
  `event.sender.id`; das Mikrofon bleibt eine Electron-Berechtigung pro
  webContents. Persistenzprüfung: Die Owner liegen nur in In-Memory-Maps
  (`DictationJobs`, `ReplySpeechService`, Import-Maps in `ipc.ts`), die
  Usage-Attribution hat kein Owner-Feld, also keine Migration. Neue Suite
  `desktop-clients` (13 Checks) inklusive der Isolation zwischen zwei Clients.
- **H1f, Konstruktion verschoben:** `src/main/host/composeHost.ts` baut alle
  Dienste, Stores, Timer und Recovery-Schritte in der bisherigen Reihenfolge;
  `ipc.ts` ist der Desktop-Adapter darüber. Die Exporte für `index.ts` sind
  gleichnamige dünne Wrapper; `dispose` ist wortgleich. Veränderliche
  Host-Dienste erreichen die Handler über Live-Getter (`live.ptyManager` …),
  damit sie nach dem Herunterfahren wie bisher `null` sind. Grenzprüfung:
  **210** Module. Vollständiges `pnpm verify` (über `pnpm`, mit
  `MISE_PNPM_VERSION=9.15.9`, weil der mise-Shim hier keine pnpm-Version hat):
  Suiten 111/111 mit 4.638 Checks, 16 Windows-Schritte nicht gemessen, ein
  Ausfall in `conversation-electron` (siehe nächster Punkt).
- **Befund `conversation-electron` (Last-Flakiness, vorbestehend):** Am
  3. Oktober zwei Ausfälle mit H1f: um 11:44 im vollen `verify` (vier parallele
  Treiber) mit `mobileAccess:pair` → „ade: zuerst die mobile Verbindung
  aktivieren“ direkt nach `mobileAccess:setEnabled`
  (`scripts/helpers/conversationMobileFlow.ts:12`), und ein Einzellauf bei
  Load 23–25, dessen Log überschrieben wurde. Danach: Basis `c0cc4e5`
  **12/12** bestanden (Load 1,7–17,7), H1f **12/12** in Serie (Load 3,4–23,3);
  insgesamt H1f 14/15 Einzelläufe. Die Spur deutet auf Zeitverhalten beim
  Start des Mobile-Listeners unter Last; H1f ändert `MobileAccessController`
  und dessen Handler nicht. Bereits am 26. September als Last-Flakiness in
  unveränderten Pfaden notiert (siehe unten). Nicht behoben; keine
  Treiberänderung in H1f.
  **Behoben in `d83bb7b`** (nur Treiber, Controller unverändert): Ursache war ein
  TOCTOU-Port. Der Treiber reservierte per `listen(0)` einen Ephemeral-Port,
  gab ihn frei, und ADE band ihn erst rund 60 s später; `setEnabled` fing
  dann EADDRINUSE ab, und `pair` meldete den irreführenden Folgefehler. Jetzt
  liegt der Port unterhalb von `ip_local_port_range`, der
  `setEnabled`-Status wird geprüft, und `ADE_TEST_BLOCK_MOBILE_PORT=1` ist
  die dauerhafte Negativkontrolle (rot mit EADDRINUSE). Nachweis: 3×
  einzeln 90/0, voller `pnpm verify` grün. Dasselbe Reservierungsmuster haben
  noch `test-mobile-electron`, `test-dictation-electron`,
  `test-remote-restart-electron`, `test-reply-speech-electron`,
  `test-setup-electron`, `test-remote-terminal-electron` und
  `test-session-navigation-electron`; seit dem 4. Oktober nutzen alle den
  gemeinsamen Helfer `scripts/helpers/fixturePort.ts`.
- **H1g, Handler-Tabelle:** 138 der 151 Kanäle sind Host-Handler in
  `composeHost` (Registrierungen unverändert, die `live.`-Präfixe aus H1f
  entfallen) und werden nur über `host.dispatch` erreicht; `ipc.ts` registriert
  sie generisch und behält 13 Electron-gebundene Desktop-Handler. Beide Wege
  laufen durch `host.guard` (`host/handlers.ts`, die frühere Hülle). Neue Suite
  `host-handlers` (10 Checks) komponiert den Host in reinem Node; die
  Grenzprüfung (18 Checks, **213** Module) sichert zusätzlich, dass
  `src/main/remote` nur `AdeApplicationService` nutzt. `desktop-clients`
  prüft jetzt, dass `desktop:<clientId>`-Owner nur in der Host-Tabelle
  entstehen. Vollständiges `pnpm verify`: alle unter Linux gemessenen Schritte
  grün, Suiten 112/112 mit 4.655 Checks, 16 Windows-Schritte nicht gemessen.

## Goal 34.6: Spike H0 abgeschlossen (3. Oktober 2026)

- Messprotokoll: [H0_SPIKE_2026-10-03](research/host/H0_SPIKE_2026-10-03.md),
  Spike-Code in `scripts/spikes/h0/` (`.mjs`, nicht in `pnpm verify`). Keine
  Produktänderung, kein Build, keine Aktivierung; die persönliche Instanz
  (PID 2394729) lief unverändert weiter.
- Ergebnisse:
  - Secret Service ist aus einer systemd-User-Unit unter
    `ELECTRON_RUN_AS_NODE` erreichbar. Der Schlüsselbund ist hier
    unverschlüsselt (Autologin).
  - node-pty lädt im gepackten Build.
  - Bildbibliothek: `@napi-rs/image`, im Kindprozess.
  - Latenz-Basis p95 24,2 ms, also H4-Grenze 29,2 ms.
- Systemspuren:
  - keine Spike-Units, keine Spike-Einträge im Schlüsselbund
  - die Schlüsselbund-Datei wurde durch den Testeintrag neu geschrieben
    (gleiche Grösse)
  - zwei `sharp`-Coredumps vom 3. Oktober 10:17
  - gepackter Build und Kandidatenpakete nur im Scratch-Verzeichnis der
    Sitzung
- Ungeprüft und braucht Benutzerentscheid bzw. Neustart:
  - echter Boot mit enabled Unit
  - Schlüsselbund mit Passwort
  - ob ein Schlüsselbund-Passwort gesetzt werden soll (Entscheidung des
    Benutzers)
- Nächster Schritt: H1, auf Auftrag des Benutzers.

## Goal 34.6: Host-Architekturentscheid angenommen und extern geprüft (3. Oktober 2026)

- Nur Dokumentation, kein Code, keine Aktivierung: Die persönliche Instanz
  (PID 2394729 laut letzter Aktivierung) ist unverändert.
- Entscheid E1–E12 für den unabhängigen ADE-Host in
  [HOST_ARCHITECTURE_DECISION](HOST_ARCHITECTURE_DECISION.md); verbindlicher
  Zielvertrag in ARCHITECTURE („Decision: independent ADE host“) und SPEC
  („Unabhängiger ADE-Host“). Bestehende Abschnitte beschreiben bis zur
  Umsetzung weiterhin das ausgelieferte Verhalten.
- Externer Review der Orchestrator-Session: R1–R8 angenommen und eingearbeitet
  (buildspezifisches Host-Verzeichnis, Dauertest, Latenzkriterium,
  `SO_PEERCRED` optional, `secrets: unavailable`, SIGKILL-Selbstheilung,
  `ipc.ts`-Besitz in H1, Betreuung als Host-Konsument); R9 (SPEC übersetzen)
  abgelehnt, Sprachkonvention in `docs/README.md` benannt.
- Gelesener Systembefund: SDDM-Autologin, `gnome-keyring-daemon` mit beiden
  Sammlungen entsperrt, Linger aus.
- Nächster Schritt: Spike H0, zuerst Secret Service aus einer systemd-User-Unit
  beim Booten. Start erst auf Auftrag des Benutzers.
- Weiterhin offen und verschoben: Tablet-Probe „Autokauf“ / `idee-…` aufräumen.

## Fehlende Projektordner und wiederholbarer Projektstart aktiviert (2. Oktober 2026, 12:51 CEST)

- Commit 2dd8fdc über `pnpm activate -- -Label MissingProjects`: Gate 14/0/1 nicht
  gemessen; neuer Host **PID 2394729**, Quelle `0a5adb1d7414093997c3`; Backup
  `~/ADE-Backups/Activate-MissingProjects-2026-10-02T10-51-14-250Z`.
- HTTPS `:8443` liefert 200; Mobile-Bundle und Host melden dieselbe Build-Kennung
  `629d2297827d38d68930`. Tailscale Serve unverändert.
- Die Registrierung von `idee-2026-10-02-0235` (Ordner vom Benutzer gelöscht) ist
  weiterhin in der Konfiguration und wird jetzt ausgeblendet; Entfernen bleibt
  eine ausdrückliche Benutzeraktion.
- Offen: Tablet-Probe durch den Benutzer — „Autokauf“ über „Erneut versuchen“
  anlegen und `idee-…` über „Aus ADE entfernen“ aufräumen.

## Stabile Ordner-Kennung persönlich aktiviert (2. Oktober 2026, 10:22 CEST)

- Anlass: Tablet-Screenshots 10:08/10:09 (`~/Austausch/Screenshot_20261002_10*`).
  „Projekt-Stammordner hat sich geändert“ beim Start von „Autokauf“: btrfs hatte
  `/home/mcmuff/Work` nach dem Neustart vom 1. Oktober 14:15 die Geräte-Nummer 57
  statt 55 gegeben; Inode und Erstellzeit waren unverändert. Der zusätzliche
  Build-Hinweis stammte von einem Tablet-Tab vor der Aktivierung von 23:34.
- Fix 76b6fbd über `pnpm activate -- -Label FolderIdentity`: Gate 14/0/1 nicht
  gemessen; neuer Host **PID 2126755**, Quelle `8e6bb207cb1cf4f600a4`; Backup
  `~/ADE-Backups/Activate-FolderIdentity-2026-10-02T08-22-12-624Z`.
- Nach dem Start: persönliche Konfiguration enthält nur noch zweiteilige
  Kennungen (Stammordner + 3 × 4 Arbeitsordner-Kennungen); jede passt zum
  tatsächlichen Ordner. HTTPS `:8443` liefert 200, Mobile-Bundle und Host melden
  dieselbe Build-Kennung `1152764245953ea92d8a`. Tailscale Serve unverändert.
- Offen: „Start fortsetzen“ für „Autokauf“ auf dem Tablet durch den Benutzer
  (Tab vorher neu laden). Rollback über `pnpm activate -- -Rollback`; der alte
  Build lehnt die neuen Kennungen ab, bis der Stammordner erneut gewählt wird.

## Goal-34-Stabilisierung persönlich aktiviert (1. Oktober 2026, 23:34 CEST)

- Aktiviert über `pnpm activate -- -Label Goal34Stabilization` mit den Commits
  5ea398f, 198e39b, e5fda7f, 2dde188, 54c7563 und eee3615.
- Erster Versuch abgebrochen, die bestehende Instanz blieb unverändert: Die Prüfung
  „a notification on a revoked device opens no work“ war unter der parallelen
  Gate-Last zeitabhängig (feste Wartezeit von 1 s). Ursache behoben in eee3615:
  Die Prüfung wartet jetzt, bis der Zustand stabil ist, und schlägt fehl, sobald
  irgendwann ein Run-Dialog erscheint. Einzeln 6/6 und parallel 4/4 bestanden.
- Gate: 14 bestanden / 0 Fehler / 1 nicht gemessen (`tablet-layout`, nur Windows);
  Suiten 4.541 Checks, Web-Push-Browser 33/0, Sitzungsnavigation 96/0,
  Linux-Aktivierung 21/0.
- Neuer Host **PID 1766400**, Quelle `2cc73003979cc98efdb3`; Backup
  `~/ADE-Backups/Activate-Goal34Stabilization-2026-10-01T21-34-51-236Z`.
  Rollback über `pnpm activate -- -Rollback`.
- HTTPS-Probe auf `:8443`: HTML und alle 7 referenzierten JS-/CSS-/Manifest-Dateien
  liefern 200; der ausgelieferte `sw.js` enthält `renotify: true`. Die Tailscale-
  Serve-Konfiguration (:8443 → 127.0.0.1:4317, :8444) ist unverändert.
- Weiterhin offen: physische Tablet-Prüfung der neuen Entscheidungsaktionen,
  Unterbrechungsanzeige und Push bei gesperrtem Bildschirm; Windows-Abnahmen.

## Ältere Übergaben

Einträge vom 11. September bis 1. Oktober 2026 (23:19 CEST) liegen unverändert im
[Archiv-Checkpoint vom 4. Oktober](archived/HANDOFF_2026-10-04_CHECKPOINT.md).
