# ADE — aktuelle Übergabe

## Desktop Work und Profil-Einstellungen: aktiviert (14. September 2026, 06:49 Uhr)

Work ist auch am PC als eigener Reiter mit Projekt-/Agent-/Statusfilter, Suche,
Run-Bericht, Graph-Wechsel, neuer Aufgabe und neuem Run verfügbar. Normale
PC-Agent-Einstellungen enthalten jetzt Anweisungen, Markdown-Kopien und Stimme.
`pnpm verify` ist vollständig grün: 56 Suiten / 2.558 Checks, Build und alle
Electron-/Browser-Läufe, darunter 20 neue Work- und 7 Profileinstellungs-Prüfungen.
Zwei bestehende asynchrone Testabfragen wurden an den tatsächlichen Viewport-
bzw. ConPTY-Endzustand gebunden; die bisherigen Bedingungen bestehen unverändert.
Details und Nachweise: `WORK_PARITY_RESULTS.md`.

Produktcommit `8c6dd633abd14632c2ad744b7cf8596ea88dcb8b` ist gepusht.
Die persönliche Instanz wurde von PID 3624 auf **21576** neu gestartet;
ausschließlich ihre vier Electron-Prozesse wurden beendet. Releasekopie:
`test-results/operator-work-parity-20260914-064933`; Backup:
`test-results/operator-work-parity-backup-20260914-064933`.
Main-SHA256: `0D35147D32EF84CEBE730154709B7CE0B913EB19FC490EDB8E66AAD7D0A3C199`.

ADE reagiert und zeigt Work mit allen fünf Reitern und den drei Auswahlfiltern.
Die private Tablet-Adresse liefert HTTP 200 und `/assets/index-C1qEXNl6.js`
aus der Releasekopie. Alle sechs Agenten und sechs Repository-Einträge sowie
die verschlüsselten Credentials sind unverändert; Sarah bleibt Standardstimme.
Keine neuen Gerätefreigaben oder Provider-Aufrufe waren erforderlich.
Nachweise: `test-results/work-parity-restart.json`,
`test-results/work-parity-personal-validation.json`, Release/`activation.json`.

## Agent-Profile persönlich aktiviert (14. September 2026, 02:41 Uhr)

Produktcommit `661b41aeeb46fa49acaa9a86d7f24fecb0cf1e1b` ist gepusht.
Persönliche ADE-Instanz von PID 23852 auf **3624** neu gestartet, ausschließlich
die vier zugehörigen Prozesse beendet. Unveränderliche Releasekopie:
`test-results/operator-agent-profiles-20260914-024141`; Backup:
`test-results/operator-agent-profiles-backup-20260914-024141`.
Main-SHA256: `3E6A63DB1479E0D55453FB20D9421EB0D731B4E6EE32EAD8E5D8D535AC4D358E`.

Aktivierung bestätigt Main-Chef-Kontextvorschau und die vorhandene Sarah-Stimme.
Für das gekoppelte Samsung Galaxy S10 Ultra wurden bestehende Freigaben erhalten
und `profiles:write` ergänzt. Alle sechs Agenten, sechs Repository-Einträge,
fünf Meine-Projekte und die verschlüsselten Credentials sind unverändert.
Private Mobile-Adresse liefert HTTP 200 mit dem neuen Asset
`/assets/index-B1pEAKZ-.js`, das in der Releasekopie liegt. App reagiert.
Nachweise: `test-results/agent-profiles-restart.json`, Release/`activation.json`,
`test-results/agent-profiles-personal-validation.json`.

Tablet neu laden. Agent-Profil → Arbeitsweise und Anweisungen erlaubt Text und
Markdown-Kopien; Profil beim Start zeigt eingefrorenen Text und Versionsvergleich.
Gespeicherte Verhaltensprofile gelten für neue native Windows-Codex-/Claude-
Profilsitzungen. Normale CLI-Auswahl bleibt ohne neue ADE-Profilübergabe.
Keine erneute kostenpflichtige Sprach-/Modellprobe bei der Aktivierung.

## Profil-Meilenstein: Gesamtabnahme grün (14. September 2026)

`pnpm verify` vollständig Exit 0, Log
`test-results/agent-profiles-release-verify.log` (Handle 96094 beendet).
56 Suiten / 2.558 Checks, Produktionsbuild und sämtliche konfigurierten
Electron-/Browser-/Visual-Prüfungen grün. Vollständige Zahlen in
`AGENT_PROFILE_RESULTS.md`. Keine weitere Produktänderung seit diesem Lauf.
Commit/Push und persönliche Aktivierung sind inzwischen abgeschlossen, siehe oben.

## Profilanweisungen in Arbeit (14. September 2026)

Noch nicht aktiviert: ein gemeinsamer Desktop-/Mobile-Editor speichert begrenzte
Arbeitsanweisungen und bis zu acht Markdown-Kopien mit Revisionsprüfung. Explizite
Profilabfragen liefern Vorschau und Quellen-Prüfsummen; signierte mobile Änderungen
verwenden `profiles:write`, Ressourcenfreigaben und den Idempotenz-Ledger. Die
Vorschau verändert weder Identitätsdateien noch Repositorys. Mobile blendet
Hostpfade aus und verhindert das Überschreiben einer dadurch gekürzten Kopie.

Fokussierte Nachweise: Memory 45, Profilservice 18, native Argument-/Dateiübergabe
12, Mobile-Browser 10 Checks bestanden; TypeScript und Mobile-Build bestanden.
Der Browsertest umfasst Markdown-Reihenfolge, Speichern, Revisionskonflikt,
abgelehnten Import mit anschließendem erfolgreichen Speichern, schmale Ansicht
und Escape/Fokusrückgabe. Dabei wurde ein initiales Laden während der
Wiederverbindung korrigiert. Logs: `test-results/agent-behavior-browser.log`,
`test-results/agent-behavior-typecheck-current.log`.

Inzwischen angebunden: native PTY-Profilübergabe mit vorhandenen Codex-Anweisungen,
Start-Digest/Quellen, Vergleich sowie explizite Abfrage des eingefrorenen Texts.
29 Electron-Prüfungen belegen den interaktiven Start und eingefrorenen Text mit lokalen CLI-Fixtures;
je eine echte Codex-/Claude-Modellprobe bestätigt den Profilmarker. Details und
Grenzen stehen in `AGENT_PROFILE_RESULTS.md`. Terminal-Berechtigungen bestehen
64 Checks, IPC/Sicherheit 239. Der erste Gesamtlauf
`test-results/agent-profiles-verify.log` (Exec-Handle 28011) wurde gezielt nach
dem Reviewbefund abgebrochen, Exit 1: aktiviertes Memory fehlte im neuen
Profiltransport. Die Korrektur ergänzt Memory/User samt Pflegeanweisungen
außerhalb der Projekte; zehn neue Tests bestehen, TypeScript/Build ebenfalls.
Ergänzte Electron-Prüfungen: 39 bestanden, Mobile-Profil: 12 bestanden;
Memory-Regressionssuite: 45 bestanden. Korrigierte Gesamtabnahme gestartet:
`pnpm verify`, Log `test-results/agent-profiles-verify-final.log`, Exec-Handle
35986 ist inzwischen mit Exit 1 beendet: alle 56 Suiten / 2.558 Checks,
Build und UI-Ketten bis Remote-Workbench grün; anschließend Fokusfehler beim
Abbrechen des PC-Ordnerdialogs. Der Button wird jetzt nach dem React-Commit
fokussiert. Gezielte Tablet-Layout-Abnahme: 17/17 grün.

**Aktiver Gesamtlauf:** `test-results/agent-profiles-release-verify.log`,
Exec-Handle **96094**. Diesen Handle bei Fortsetzung pollen, nicht aufgrund
eines Beobachtungstimeouts neu starten. Persönlicher Stimmen-Release unverändert.

Vorbereitet, noch nicht ausgeführt: `test-results/restart-agent-profiles.ps1`
mit bestätigter persönlicher PID 23852/Wrapper `activate-mobile-voices.cjs`.
Die neue Aktivierung `test-results/activate-agent-profiles.cjs` bewahrt die
vorhandenen Tablet-Rechte und ergänzt das ausdrücklich gewünschte
`profiles:write`; sie prüft Main-Chef-Vorschau und zeigt das Appfenster.
Erst nach grünem Gesamtlauf und Commit/Push ausführen; Prozessidentität vorher
erneut prüfen. Keine Keys oder persönlichen Profiltexte in Prüfberichte schreiben.
Ein Argumenttransport-Test belegt keine Verarbeitung durch das Modell.
Die persönliche Instanz bleibt unverändert auf dem unten beschriebenen
Stimmen-Release; keine Veröffentlichung dieses Zwischenstands.

## Mobile-Stimmen-Abnahme abgeschlossen (14. September 2026)

`pnpm verify` bestand TypeScript, 52 Suiten/2.483 Checks, Produktionsbuild,
Sprach-Electron (10), Sprach-Mobile (28), Desktop-Electron (197) und Git-Electron.
Der Lauf stoppte an der veralteten Monospace-Erwartung im Mobile-Browsertest
nach dem parallelen Calm Pass. Nach Korrektur nur dieser Test-Erwartung wurde
die vollständige verbleibende Kette auf demselben Produktbuild ausgeführt:
Mobile-Browser 60, Mobile-Electron 36, Neustart 12, Remote-Workspace 24,
Remote-Workbench 43, Tablet-Layout 17, vollständige Remote-Terminals 202,
Run-Inspection 27, Projekt-CLI 28, Projekt-Git 22, Veröffentlichung 12,
Einrichtung 37 und visuelle Regression 22 Checks, alle bestanden, Exit 0.
Kein einzelner komplett grüner `pnpm verify`-Aufruf wird behauptet; beide
Teilläufe zusammen decken die vollständige Kette ab.
Logs: `test-results/mobile-voice-verify-final.log` und
`test-results/mobile-voice-verify-continuation.log`.
Persönliche Aktivierung bleibt `8fa89f2`, PID 23852, siehe unten.
Weitere Ziele: wirksame Profilanweisungen (26.1), Diktat (23), belastbare
CLI-Nutzungsdaten (24), gemessene Eingabelatenz (25), Mehr-PC-Koordination (20–22).

## Mobile-Stimmen persönlich aktiviert (14. September 2026, 00:54 Uhr)

Commit `8fa89f2` gepusht, Produktionsbuild erfolgreich. Persönliche ADE-Instanz
gezielt von PID 50460 auf PID 23852 neu gestartet. Unveränderliche Releasekopie:
`test-results/operator-mobile-voices-20260914-005414`, vorheriges Profilbackup:
`test-results/operator-mobile-voices-backup-20260914-005414`. Main-SHA256:
`93BB3655C0DAAB426D419749BECD2E32E34E814682D294B2FC9F593748E35F55`.

Für das bereits gekoppelte „Samsung Galaxy S10 Ultra“ wurde über den
Desktop-IPC die zusätzliche Stimmenfreigabe aktiviert; bestehende Rechte
erhalten. Sarah bleibt ADE-Standard, alle sechs Agenten-/Projektidentitäten,
fünf Meine-Projekte und verschlüsselte Zugangsdaten sind unverändert.
Private HTTPS-Mobile-Seite: HTTP 200, neues Asset `index-BHqyJIBT.js` bestätigt.
Tablet neu laden; Einstellungen → Sprachausgabe, Agent-Profil → Agent-Stimme
und Projekt-Einstellungen → Projekt-Stimme. Kein weiterer kostenpflichtiger
Test bei dieser Aktivierung. Der isolierte Browser-Sprachtest besteht 28 Checks.
Vollständige Gesamtabnahme läuft separat weiter und ist noch nicht als grün
gemeldet. Lokale Nachweise: `mobile-voices-restart.json`, Release-`activation.json`,
`mobile-voice-personal-validation.json`, `mobile-voice-release-build.log`.

## Mobile-Stimmen-Arbeitsstand (14. September 2026)

Einstellungen auf Mobile, globale/Agent-/Projekt-Stimmen und Profilbilddialog
implementiert; persönliche Aktivierung siehe oben. Aktueller Gesamtlauf:
`test-results/mobile-voice-verify-final.log`. Der erste Mobile-Stimmen-Lauf
bestand 52 Suiten/2.480 Checks und stoppte am neuen Projekt-Stimmentest; die
Konkurrenz zwischen Metadatenänderung und Git-Probe ist gezielt korrigiert und
mit 48 Projekt-Workspace- sowie 28 Sprach-Browserprüfungen erneut geprüft.
Der vorherige Sprach-/Projekt-Lauf bestand 51 fokussierte
Suiten/2.444 Checks, blieb aber im Remote-Terminal-Browserlauf stehen. Der
Fortsetzungslauf zeigte Offline beim Grok-Start. Terminal-Polling konnte das
allgemeine Requestbudget erschöpfen; es erhält jetzt einen eigenen begrenzten
Topf. Eine gemessene Verbesserung der Eingabelatenz ist noch nicht belegt.
Persönliche Instanz wurde zum oben dokumentierten Meilenstein aktualisiert.

## Sprach-/Projekt-Build persönlich aktiviert (13. September 2026, 23:48 Uhr)

Commit `b40c758` auf `origin/main` gepusht. Build erfolgreich; auf ausdrücklichen
Wunsch des Benutzers bereits während der getrennten Gesamtabnahme aktiviert.
Unveränderliche Kopie: `test-results/operator-speech-projects-20260913-234546`;
persönliches Profil/verschlüsselte Zugangsdaten/Gerätekopplung vorher unter
`test-results/operator-speech-projects-backup-20260913-234546` gesichert.
Aktuelle persönliche ADE-PID 50460, sechs Agenten und sechs Repository-Identitäten
erhalten; fünf davon in Meine ADE Projekte. `2D_rpg_jumpnrun` ausdrücklich aus
dieser Auswahl entfernt, kein Projektordner gelöscht. RhinoSheetMetal bleibt
enthalten. Main-SHA256:
`A1046630B7754CD0CC66FF1D22E90D4C2936ED2273679A60F8C16C2367E69495`.

Sarah (weiblich) über produktive Stimmenwahl gespeichert. Der echte ElevenLabs-
Stimmtest in Settings endet nach 7,523 Sekunden ohne Playerfehler. Main Chef
erhielt das angehängte Originalbild, LayoutTool_FrontendDesigner das neu mit
`image_gen` erzeugte Porträt. Beide Bilder über `ade-photo` geladen; Vergleich
mit Profilbackup bestätigt bei den Agenten ausschließlich Änderungen am Foto.
Die Tablet-HTTPS-Seite liefert HTTP 200 und den passenden Assetnamen
`/assets/index-oE1eKIpN.js`. Browser/Tablet zum Übernehmen neu laden.

Die letzte Auswahlkorrektur erfolgte mit einer zweiten kurzen Aktivierung;
vorher waren nachweislich keine Terminal-Kindprozesse aktiv. Beide Launcher
führen ihre persönlichen Mutationen nur einmal aus. Keine Debugging-Listener.
Lokale Nachweise: `speech-projects-restart.json`, `speech-projects-activation.json`,
`speech-projects-membership-activation.json`, `speech-projects-active.png`.
Gezielte Projekt-CLI-Abnahme: 28 Checks grün. Vollständiger erneuter Lauf unter
`test-results/speech-projects-verify-final.log` am Terminal-Fixture beendet; kein Gesamterfolg
behauptet. Umfang und abschließende Ergebnisse: [VOICE_PROJECTS_RESULTS.md](VOICE_PROJECTS_RESULTS.md).

## ElevenLabs-Hörtest ausgeführt (13. September 2026, 22:43 Uhr)

Persönliche ADE-Instanz aus dem zuletzt dokumentierten Tablet-Build geöffnet
(PID 47088). Separates temporäres Electron-Testfenster „ADE · ElevenLabs-Hörtest“
(PID 31068), noch keine integrierte Sprach-UI. Echter `HarnessCredentialService`
mit persönlichem ADE-userData entschlüsselt den gespeicherten Service-Key;
`GET /v1/voices` und `POST /v1/text-to-speech/{voice_id}` liefern HTTP 200.
Stimme Roger, Modell `eleven_multilingual_v2`, deutscher Testsatz, MP3 114.564 Bytes.
Der Player meldet `ended` nach 7,105 Sekunden; hörbare Ausgabe am Lautsprecher
ist noch vom Benutzer zu bestätigen. Wiedergabe im Testfenster wiederholbar.
Ein erster Versuch mit eigenem Probe-userData konnte den Key nicht entschlüsseln;
mit dem persönlichen Profil erfolgreich. Kein Key in Renderer, Logs oder Bericht.

Lokale Artefakte: `test-results/test-elevenlabs-speech.cjs`,
`test-results/elevenlabs-speech-result.json`, `test-results/elevenlabs-speech-test.mp3`
und `test-results/elevenlabs-speech-player.html`. Keine Produktlogik geändert,
kein erneutes `pnpm verify`, keine Aussage zur Gesamtabnahme. Vorschlag für
den nächsten Schritt: „Stimme testen“ in Einstellungen und gezieltes Vorlesen
von Ergebnissen/Rückfragen mit Stop/Stumm statt sämtlicher Terminalausgaben.

## ElevenLabs-Verbindung geprüft; nächste Session: Sprache (13. September 2026)

Der Benutzer hat `ELEVENLABS_API_KEY` in ADE als verschlüsselten Service-Key
mit Scope `all` gespeichert. Lokaler Electron-Probeprozess mit dem persönlichen
ADE-userData und dem echten `HarnessCredentialService`: Entschlüsselung und
`envFor` für Codex, Claude, Shell, Grok und Custom erfolgreich. ElevenLabs
`GET /v1/voices` liefert HTTP 200 mit 21 Stimmen. `GET /v1/user/subscription`
liefert HTTP 401 / `missing_permissions`; Abo-/Guthabenabfrage mit diesem Key
ist damit nicht freigeschaltet. Kein Schlüsselwert in Logs oder Repository.
Lokaler Nachweis: `test-results/elevenlabs-access-result.json`.

Der Probeprozess bestätigt Credential-Service und API-Zugriff, keinen bereits
laufenden Agent-Prozess. Neue ADE-Sitzungen erhalten den Key beim Start;
laufende Sitzungen müssen dafür neu gestartet werden. Diese externe Codex-
Session hatte den Key nicht in ihrer geerbten Umgebung. Noch keine Sprache
erzeugt oder abgespielt, keine Sprach-UI implementiert. In der nächsten Session
mit dem Benutzer Spracherzeugung/Sprachausgabe testen und den gewünschten
Bedienablauf klären. Das zuvor gemeldete Guthabenproblem bleibt separat offen.

Benutzerauftrag zum Abschluss: aktuellen Arbeitsstand committen und pushen.
Desktop-/Mobile-Build und Start dieser Session erfolgreich; der unten
dokumentierte Gesamtabnahmefehler bleibt offen.
Vor dem Commit erneut bestanden: `pnpm typecheck`, Remote-Commits 29,
Kategorie-Navigation 29, Mobile Access 79 sowie `git diff --cached --check`.

## Build für manuellen Tablet-Test gestartet (13. September 2026, 22:11 Uhr)

`pnpm build` erfolgreich (Desktop und Mobile). Persönliche Instanz PID **54384**
aus `test-results/operator-tablet-manual-test-20260913-221124-abb840da-build`
ersetzt PID 50472. Vorher keine laufenden/queued Aufgaben und keine Terminal-
Kindprozesse festgestellt. Sechs Agenten, fünf Repositories und Gerätekopplung
erhalten; Profilsicherung und Startbeleg: `test-results/tablet-manual-test-restart.json`.
Fenster auf 1600 × 1100 gesetzt. Private HTTPS-Seite liefert 200; ausgelieferte
Mobile-JS/CSS-Dateien stimmen per SHA-256 mit dem neuen Build überein.
Nur Build und Start geprüft, kein erneutes `pnpm verify`. Das vom Benutzer
gemeldete Guthabenproblem bleibt offen; dieser Auftrag ändert keine Produktlogik.
Dieser Start ersetzt die darunter dokumentierten Operatorzustände.

## Tablet-Polish aktiviert (13. September 2026, 21:49 Uhr)

PC-Einzelprojekt-Freigabe, gespeicherte Terminal-Seitenbreiten auf Tablet und
PWA-Startkorrekturen sind in der persönlichen Instanz aktiv. PID **50472**
aus `operator-tablet-polish-20260913-214947-4c343de5-focused` (unter `test-results/`).
Vorige PID 36064 beendet; sechs Agenten, fünf Repositories und Kopplung erhalten.
Fenster wieder 1600 × 1100. Belege: `test-results/tablet-polish-restart.json`,
`test-results/tablet-pwa-operator-validation.json`. Tatsächlicher privater
Startaufruf 200, fremdseitiger API-Aufruf weiterhin 403, neuer Worker ausgeliefert.

Gezielte Prüfungen: Typecheck/Build, Mobile Access 79, Tablet-Layout/Import 13,
Mobile Browser 60 Checks grün. `pnpm verify` endet mit Exit 1 am bekannten Codex-Quota-Fixture
(`7 Tage: 75 % übrig` fehlt). 50 fokussierte Suiten/2.387 Checks,
197 Desktop-Electron-, 60 Mobile-Browser-, 39 Workbench- und 13 neue
Tablet-Layout/Import-Checks bestehen. Remote-Terminal: 141 bestanden, ein
Timeout; nachfolgende verkettete Suiten wurden nicht ausgeführt.
Log: `test-results/tablet-polish-verify.log`. Keine vollständige Gesamtabnahme. Kein Commit/Push durch diese Arbeit. Zwischenzeitlicher
fremder Dokumentationscommit b640c3f bleibt erhalten.

PWA-Update: ADE im Browser neu laden, dann sämtliche ADE-Tabs/PWA-Fenster
schließen und neu öffnen, damit der neue Worker aktiviert wird. Bei getrenntem
App-Speicher direkt in der PWA koppeln. Reale Android-Launcher-Abnahme bleibt
beim Tablet; automatisiert sind Chromium-Navigation mit aktivem Worker und
Anmeldung in neuem Fenster ohne Sitzungscookie geprüft.
[Umfang und Nachweise](TABLET_POLISH_RESULTS.md). Dieser Operatorstand ersetzt
die darunter dokumentierten Starts.

## Mobile Commit-Details aktiviert (13. September 2026, 21:17 Uhr)

Die bisher reine Commit-Liste öffnet jetzt Details, Dateistatistiken und
historische Diffs. 29 Backend-/39 Browserprüfungen, Typecheck und Build bestehen.
Auf Benutzerauftrag wurde PID 7968 beendet. Seit 21:17 Uhr läuft genau eine
persönliche ADE-Instanz, PID **36064**, aus
`test-results/operator-commitdetails-20260913-211701-b75df981-focused`.
Mobile-HTTPS liefert Status 200 und passende JS-/CSS-Hashes. Alle sechs Agenten,
fünf Repository-Projekte, Profilbilder, Reihenfolge und Gerätekopplung sind erhalten.
Fenster wieder 1600 × 1100. Neustartbeleg: `test-results/commitdetails-restart.json`;
Sicherung: `test-results/operator-commitdetails-backup-20260913-211701`.
Die beiden markierten RhinoClaw-Commits bestehen auch mit den echten Workspace-
Daten (13 bzw. 71 Dateien plus geladene Diffs). Gesamtlauf:
`test-results/commit-details-verify.log`, 50 fokussierte Suiten/2.382 Checks,
197 Desktop-Electron- und 39 Workbench-Browser-Checks bestanden. Exit 1 am bereits
bekannten Codex-Quota-Fixture (`7 Tage: 75 % übrig` fehlt), somit weiterhin keine
vollständige Repository-Freigabe. Kein Commit oder Push.
Dieser Operatorstand ersetzt die darunter dokumentierten Starts.
[Umfang und Abnahmestand](MOBILE_COMMIT_DETAILS.md).

## Operator aktualisiert, angeordnet und bebildert (13. September 2026, 20:53 Uhr)

Auf ausdrücklichen Benutzerauftrag wurde die bisherige Instanz 55156 beendet.
Jetzt läuft genau eine persönliche ADE-Instanz, PID **7968**, aus
`test-results/operator-portraits-20260913-205333-f0e8e866-focused` mit dem
aktuellen Arbeitsbaum-Build einschliesslich Anordnen. Dies ist kein neuer Commit.
Der vorübergehende Prüfstart 62784 ist ebenfalls beendet; der endgültige Start
hat keinen Remote-Debugging-Port. Fenster: 1600 × 1100, Spalten 25/55/20 Prozent.

Reihenfolge: **ADE Main → RhinoClaw → RhinoLayoutTools → Agent-Systeme**,
darin Hermes Agent → OpenClaw → GrokBuild. Alle Kategorien sind aufgeklappt.
Vier neue generierte Profilbilder sind gesetzt: Main Chef, RhinoClaw_Agent,
GrokMain und LayoutTool_FrontendDesigner. Die drei bisher bildlosen Kategorien
verwenden das Bild ihres Agents. Bestehende Bilder wurden beibehalten.
[Originale und vollständige Imagegen-Prompts](../output/imagegen/ade-agent-profiles-20260913/PROMPTS.md).

Im realen Renderer wurden sechs geladene Agent-Bilder, sechs Kategorie-Bilder,
die gewünschte Reihenfolge und die ohne Scrollen passende Navigation geprüft.
Nachweise: `test-results/operator-rail-validation.json`,
`test-results/operator-portraits-arranged.png`, `test-results/portraits-restart.json`.
Sechs Agent-Identitäten, fünf Repository-Projekte, Laufzeiteinstellungen und
Gerätekopplung sind erhalten; private HTTPS-Auslieferung Status 200, JS/CSS-Hashes
stimmen mit dem Build überein. Vor der Änderung gab es keine aktiven Aufgaben.
Sicherung vor Profiländerung: `test-results/operator-portraits-backup-20260913-205117`.

Die vollständige Repository-Abnahme bleibt am unten beschriebenen Codex-Quota-
Fixture offen. Dieser aktivierte Operatorstand ersetzt die Hinweise auf eine
noch ausstehende persönliche Aktivierung; kein Commit oder Push dieses Auftrags.

## Linke Navigation: Anordnen implementiert und fokussiert geprüft (13. September 2026)

Arbeitsbaum ergänzt einen Desktop-Anordnen-Modus für Obergruppen, Projekte
und Agents. Speicherung nutzt die bestehenden IPC-Kanäle; keine Migration.
29 Kategorie-Checks, zwölf Anordnen-Electron-Checks, Typecheck und Build bestehen;
der vollständige Desktop-Ablauf besteht mit 197 Checks. Gesamtlauf:
`test-results/rail-ordering-verify.log`, Exit 1 am bereits offenen Codex-Quota-
Fixture (`7 Tage: 75 % übrig` fehlt). Persönliche Instanz und Mobile-Auslieferung
bleiben auf dem darunter dokumentierten Operatorstand. Kein Commit oder Push.
[Bedienung, Abnahme und Grenzen](RAIL_ORDERING_RESULTS.md).

## Operator-Neustart mit Tablet-Zwischenstand (13. September 2026, 20:09 Uhr)

Die ADE-Mobile-Codex-Sitzung wurde um 19:28 Uhr unterbrochen, bevor ihr
angeforderter Commit lief; der gestagte Stand wurde auf dem PC geprüft
(Typecheck, Build, 33 Terminal-, 14 Abo- und 230 IPC-Sicherheitschecks) und als
`5e27bdd` nach `origin/main` gepusht. Seit 20:09 Uhr Europe/Zurich läuft genau
eine persönliche ADE-Instanz, PID **55156**, aus
`test-results/operator-tabletfeatures-20260913-200907-6cc8c202-verified`;
die bisherige Instanz 53592 ist beendet. Sechs Agenten, fünf Projekte und die
Gerätekopplung sind erhalten; die private HTTPS-Auslieferung stimmt per SHA-256
mit dem Build überein. Nachweis: `test-results/tabletfeatures-restart.json`.
Mobile einmal neu laden; dann sind Terminalverlauf, Abo-Nutzung und die
Git-Bedienhilfen aktiv. Das vollständige `pnpm verify` für diesen Stand ist
weiterhin offen; dieser Betrieb ersetzt den darunter beschriebenen Zustand.

## Angeforderter Zwischencommit: Abo, Terminal und Git (13. September 2026)

Benutzer bittet ausdrücklich um zeitnahen Commit und Push. Der lokale Stand
enthält nun auch Abo-Nutzung, weniger wiederholte Terminalaufbereitung und
Git-Bedienhilfen. TypeScript, Build sowie 33 Terminal- und 14 Abo-Checks bestanden.
Die Gesamt-Abnahme ist noch offen; die persönliche Instanz wurde nicht neu
gestartet. [Konkreter Umfang, Grenzen und Fortsetzung](WORKSPACE_IMPROVEMENTS.md).
Dieser Abschnitt ersetzt den darunterstehenden Zwischenstatus der laufenden Prüfung.

## Laufende Abnahme: Terminalverlauf (13. September 2026)

Der lokale Arbeitsstand ergänzt mobilen Verlauf per Knopf/Mausrad/Wischgeste/
Shift+PageUp mit eingefrorener Textansicht und Fokus-Rückgabe. Der gezielte reale
Terminalablauf besteht mit 36 Prüfungen. `pnpm verify` läuft mit Log unter
`test-results/terminal-scroll-verify.log`. Keine persönliche Instanz wurde für
diese Änderung beendet oder neu gestartet; PID 53592 lief bei der Prüfung weiter
mit der unten dokumentierten Releasekopie. Kein Commit/Push dieses Folgeauftrags.
[Abnahme und nächste Schritte](TERMINAL_SCROLL_RESULTS.md).


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

Verwendete unveränderliche Build-Kopie:
`test-results/operator-integration-20260913-124809-01333ede-verified`.
Profil-/Gerätesicherung: `test-results/operator-integration-backup-20260913-124809`.
Neustartnachweis: `test-results/integration-restart.json`; vor dem Stop liefen
keine Aufgaben. Der Listener ist weiterhin nur auf `127.0.0.1:4317` erreichbar;
der vorhandene private HTTPS-Zugang liefert Status 200 und passende JS-/CSS-Hashes.
Die Rhino-Quelle `ade/rhino-grok-layout-b64603` mit ihren lokalen Anweisungen
bleibt erhalten. RhinoLayoutTools/main und origin/main stehen auf `5c4b820`.

## Projekte durchsuchen und Workspace-Zuweisung (12. September 2026)

Projektbrowser und geprüfte Workspace-Zuweisung sind umgesetzt; `pnpm verify`
besteht mit **2.880 Checks**. Seit 14:21 Uhr Europe/Zurich läuft genau eine
persönliche ADE-Instanz, PID **50028**, aus
`test-results/operator-assignment-20260912-142106-cbc4d4d1-verified`.
Der vorherige Prozess 59616 wurde geschlossen. Sechs Agenten, fünf Projekte und
die Gerätekopplung sind erhalten; HTTPS liefert die geprüften Mobile-Dateien.
Mobile neu laden, dann **Terminals → Projekt → Projekte durchsuchen…**.
Es wurde kein persönliches Projekt automatisch neu zugewiesen.
Dieser Start ersetzt die darunter dokumentierten früheren Operatorzustände.
[Umsetzung und Nachweise](WORKSPACE_ASSIGNMENT.md).

## Freie Terminals und Mobile-Terminalansicht (12. September 2026)

Freie native Home-Terminals und der mobile Reiter **Terminals** sind umgesetzt;
`pnpm verify` besteht mit **2.828 Checks**. Genau eine persönliche ADE-Instanz
läuft seit 11:27 Uhr Europe/Zurich, PID **59616**, aus
`test-results/operator-terminal-20260912-112753-efe52dfc-verified`.
Sechs Agenten, fünf Projekte und die gespeicherte Gerätekopplung sind erhalten;
private HTTPS-Auslieferung stimmt bytegenau mit dem geprüften Build überein.
Mobile neu laden und **Terminals → Terminal öffnen** wählen.
[Verträge und abschliessende Evidenz](TERMINAL_WORKSPACE.md).
Dieser Start ersetzt den unten dokumentierten früheren Operatorzustand.

## Tablet-Arbeitsplatz: Windows-Abnahme und Neustart (12. September 2026)

Freigaben, Startwiederholung, native Codex-Rückfragen mit Live-Aktivität sowie
haltbare Ergebnisdateien und Ergebnisseiten sind implementiert. Vollständiges
`pnpm verify`: 2.770 Prüfungen bestanden, zusätzlich 5 reale Codex-Prüfungen.
Die geprüfte ADE-Kopie läuft mit dem persönlichen Profil; private HTTPS-Adresse,
bestehende Samsung-Kopplung, fünf Projekte und sechs Agentenprofile sind geprüft.
Physisches Samsung/DeX und das nicht antwortende Ubuntu bleiben offen.
[Teilziele](TABLET_WORKSPACE_GOALS.md), [Abnahme und Operatorzustand](TABLET_WORKSPACE_RESULTS.md).
Die darunter genannten älteren Gesamtprüfungen gelten für ihre damaligen Stände.

Stand: 12. September 2026. Frühere Zwischenstände bleiben im
[Checkpoint-Archiv](archived/HANDOFF_2026-09-10_CHECKPOINT.md).

## Checkpoint vor dem vom Benutzer geplanten PC-Neustart

Der Benutzer hat jetzt ausdrücklich Speichern, Commit und Push des aktuellen
Tablet-Arbeitsstands beauftragt. Er startet Windows anschliessend selbst neu,
um das hängende WSL wiederherzustellen. Ein separater WSL-Neustart durch ADE
wird deshalb nicht mehr vorgezogen. Die lokale Sicherung des aktuellen
Konfigurations-/Gerätespeichers samt Audit und OS-geschütztem Schlüsselspeicher
ist in `test-results/pre-reboot-state.json` verzeichnet; persönliche Daten und
Schlüssel bleiben ausserhalb des Git-Repositories. Die feste geprüfte Releasekopie
und Ergebnisdateien bleiben auf dem PC erhalten.

Nach dem PC-Neustart hier fortsetzen:

1. `wsl --status` und `wsl -d Ubuntu --exec /bin/true` mit begrenzter Wartezeit
   prüfen. Ein Windows-Neustart ist noch kein Nachweis eines funktionierenden WSL.
2. ADE mit dem vorhandenen persönlichen Profil starten. Die feste geprüfte
   Kopie steht unter `test-results/operator-tablet-20260912-f9372d2e-verified`;
   die Prozessnummern dieser Übergabe gelten nur vor dem Windows-Neustart.
3. Ubuntu-Agenten Hermes General und Sentinel öffnen und deren tatsächliche
   Interaktion prüfen. Native Codex-Arbeit und Fragen sind bereits separat abgenommen.
4. Auf dem Samsung Tailscale einschalten und
   <https://number-cruncher.tailfc0b86.ts.net/> öffnen. Bestehende Kopplung verwenden;
   physische Projekt-/Agent-Auswahl, Tastatur/DeX, Live-Aktivität und Antworten prüfen.
5. A5 und das Gesamtgoal erst nach diesen Nachweisen abschliessen.

Die letzte vollständige Abnahme bleibt gültig: 2.770 Verify-Prüfungen plus
5 echte Codex-Prüfungen; danach wurden keine Anwendungs-/Testsourcen geändert.

## Neuer Folgeauftrag: Live-Runs und Rückfragen

Der Auftrag umfasst PC und Tablet. Native Codex-Rückfragen sind im Arbeitsstand
implementiert; Protokolltests, reale Windows-Inferenz und Electron/Tablet-UI sind
geprüft. Details und Grenzen: [LIVE_RUN_INTERACTION_PLAN](LIVE_RUN_INTERACTION_PLAN.md).
Aktuell hängt WSL bereits bei `wsl --status` und Ubuntu `/bin/true` (je 15 s);
WslService und vmcompute laufen. Der Benutzer plant nun selbst einen PC-Neustart.
Es wurde kein WSL-Dienst oder Ubuntu-Prozess zur Wiederherstellung beendet.

Historische Bestandsaufnahme vom Vorabend: PID 39428 wurde um 22:58:19 lokal aus dem
Repository gestartet; die frühere PID 51956 läuft nicht mehr. Das Main-Log
meldet um 22:58 und 22:59 einen `EADDRINUSE`-Fehler auf `127.0.0.1:4317`.
Bei der späteren Prüfung war kein Listener erreichbar; ein Bind-/Close-Test
bestätigte einen wieder freien Port. Keine aktiven Runs/Tasks und keine
Terminal-Kindprozesse beim Prüfen. Kein Neustart und keine Änderung an
Gerätefreigaben, Tailscale oder Cursor-Einstellungen in dieser Bestandsaufnahme.
Die neue Prüfung und der Neustart sind inzwischen erfolgt; die folgenden
älteren Neustartangaben sind historische Belege vom Morgen.

## Aktuelle persönliche Instanz

PID **23884**, gestartet am 12. September um **02:06:10 Europe/Zurich**, sichtbares
Fenster `ade`. Feste geprüfte Kopie `test-results/operator-tablet-20260912-f9372d2e-verified`.
Private HTTPS-Adresse, bestehende Samsung-Identität und tatsächliche Projekt-/Git-
Ansicht bestanden. Genau `projects:write`, `projectGit:write`, `projectGit:publish`
wurden ergänzt, bisherige Ressourcenauswahl und Schlüssel erhalten. Kein Debug-Port
offen. Vollständige Messungen, Backup und Grenzen: [Tablet-Abnahme](TABLET_WORKSPACE_RESULTS.md).
Samsung ist noch offline; Hermes General und Sentinel benötigen die ausstehende
Ubuntu-Wiederherstellung. Vor einem weiteren Neustart aktive Arbeit erneut prüfen.

## Historischer Onboarding-Auftrag vom 11. September

Der Folgeauftrag „weiter verbessern mit Goals, Commit/Push und Neustart“ ist als
S0–S3 umgesetzt: [Onboarding-Goal](ONBOARDING_GOALS.md). Am PC führt **Einrichtung**
durch Projektordner, native CLI-/Anmeldeprüfung, optionale Tablet-Kopplung und
Freigaben. Ein Agent-Profil ist für den Projekteinstieg nicht erforderlich.
**Projektarbeit auswählen**, **Dateilesen auswählen** und **Push/PR auswählen**
ergänzen nur den Freigabeentwurf; erst explizites Speichern ändert das Gerät.

Mobile **Settings** zeigt zuerst PC-/Browser-Build und **Einrichtung auf diesem
Gerät** mit den genau fehlenden Schaltern. Offline, fehlgeschlagene Antworten und
alte Hosts mit unbekannter Kennung werden nicht als aktueller Erfolg angezeigt.
Eine Build-Abweichung lädt die Seite nicht automatisch neu. CLI-Anmeldung ist
separat zu prüfen. Verträge: [Architektur](ARCHITECTURE.md), [SPEC](SPEC.md).

Der vorherige Projektablauf T0–T7 bleibt erhalten: Stamm → Branch/Checkout → CLI
mit optionalem Profil → Git. Ergebnisdateien liegen unter Graph → Dateien dieses
Runs oder Projekte → Workspace öffnen → Ergebnisse. Dateien kommen aus der
ursprünglichen Aufgaben-Arbeitskopie. Der neue A4-Stand sichert erfasste Dateien
zusätzlich dauerhaft; die Grenzen sind in der aktuellen Tablet-Abnahme beschrieben.
[Projekt-Goal](PROJECT_WORKFLOW_GOALS.md), [aktueller Umfang](STATUS.md).

## Abnahme und Dokumentation

Vollständiges **pnpm verify: 2.651 Checks grün**, Exit 0. Drei TypeScript-Projekte,
41 fokussierte Suiten mit 2.058 Checks, Produktionsbuild und 593 echte Electron-/
Chromium-/Visual-Checks. Log: `test-results/onboarding-verify.log`. Darin 26 neue
fokussierte Setup-Checks und 37 echte Desktop-/Browser-Setup-Checks. Negative
Kontrollen für fehlende Rechte, Build-Abweichung, alten Host, Statusfehler und
Verbindungsverlust enden mit erfolgreicher Wiederherstellung. Danach wurden
keine Anwendungssourcen geändert. Vorherige 2.588 Checks vom 10. September sind
historische Projekt-Abnahme, keine neue Plattformbehauptung.

Der [User-Guide](USER_GUIDE.md) enthält neue echte Bilder 25–27. Quellen und
Fixture-Grenzen: `docs/media/user-guide/capture*.json`. CLI/Tailscale sind
kontrollierte lokale Fixtures; die Browserkopplung und Host-Anfragen sind echt.
Keine Provider-Inferenz und keine physische Samsung-/DeX-Messung durch diese Tests.
[Dokumentationsaudit](DOCUMENTATION_AUDIT.md): 65 Markdown-Dateien unter docs,
222 relative Ziele gültig; keine weitere Archivierung gültiger Verträge nötig.

Task-Commits S0 `58abdfe`, S1 `cb442e5`, S2 `4288a32`; S3 dokumentiert hier Abnahme
und Neustart. Die Task-Commits werden gemeinsam auf `main` ausgeliefert.

## Historische Testinstanz vom 11. September

ADE lief ab **11. September 2026, 06:49:59 Europe/Zurich**, PID **51956**, aus
`test-results/operator-release-4288a32`. Sichtbares Desktop-Fenster `ade`, Listener
nur `127.0.0.1:4317`. Private Adresse `https://number-cruncher.tailfc0b86.ts.net/`
liefert HTTP 200. Mobile-Assets `index-DD_tWgKd.js` / `index-mfBmhnOz.css` wurden
über HTTPS heruntergeladen und stimmen bytegenau mit dem verifizierten Build
überein. Main und Mobile tragen Quellkennung **3147fc1fa3170895ceab** (kein Git-SHA).
Nachweis: `test-results/onboarding-final-restart.json`.

Vor dem Ersetzen der bisherigen PID 65456 aus `operator-release-cb42dbb`: keine
laufenden Runs, queued/running Tasks, aktiven Leases oder Terminal-Kindprozesse.
Kopplungs-/Freigabendatei und Tailscale Serve unverändert. Konfigurationssicherung:
`%APPDATA%/ade/ade/config.json.before-onboarding-final-4288a32`.
Entwicklungsbuilds verändern die feste laufende Kopie nicht. Bei einem weiteren
Neustart aktive Arbeit erneut prüfen. Für die neuen Ansichten Chrome am Tablet
nach dem Sichern etwaiger Entwürfe neu laden; keine neue Kopplung nötig.

Das Samsung besass damals bereits `workspace:read` für Dateiabruf sowie seine bisherigen
Terminal-/Verwaltungsrechte. `projects:write`, `projectGit:write` und
`projectGit:publish` waren damals noch nicht erteilt. Für den vollen Projektablauf am
PC **Einrichtung → Freigaben prüfen → Samsung → Projektarbeit auswählen**, Auswahl
prüfen und **Verwaltungsrechte speichern**. Push/PR separat auswählen, wenn gewünscht.
Es wurden keine persönlichen Rechte automatisch erweitert.

Der ursprüngliche Bild-/Excel-Run ist `0531376b-559a-49f7-8d98-02d14573b109`,
Task `9c816cef-783d-403c-ba1b-a9354e0506b1`, abgeschlossen. Antwortquelle weiterhin
`recovered-cli`. Der genaue Bildmodellname wurde nicht gemeldet; der separat
angefragte API-Aufruf scheiterte am Kontingent. Kein neuer Modelllauf.
Nach diesem Neustart wurden PNG (2.261.193 Bytes), XLSX (5.626 Bytes) und Markdown
(1.611 Bytes) erneut erfolgreich gelesen. Nachweis:
`test-results/onboarding-operator-files-after-restart.log`.

## Getrennte Folgearbeiten

- Physisch Samsung/Chrome: Tastatur, DeX, Drehung und Netzwechsel vollständig messen.
- WSL-Bereitschaft: `/bin/true` am 10. September nach 15 Sekunden weiter ohne Antwort;
  nur der eigene Probeprozess beendet, kein WSL-Neustart. Logs `test-results/t6-wsl-probe.*`.
  Dieser Auftrag hat den WSL-Zustand nicht verändert und keine neue WSL-Abnahme erbracht.
- Dauerhafte Ergebnisdatei-Aufbewahrung, ältere Archive und Pagination ausbauen.
- Live-GitHub-PR, andere Plattformen und ein breiterer Accessibility-/Sprachaudit
  benötigen eigene Ausführungsevidenz. [Priorisierung](ROADMAP.md).
- Die früher automatisch abgelehnte Löschung des temporären Profils
  `ade-terminal-electron-2xyWJu` wurde nicht erneut versucht; es bleibt liegen.

Historische Goal-6-Messungen bleiben unverändert. Tests verwenden isolierte
Repositories und verändern weder die persönlichen Hauptcheckouts noch fremde Dienste.
