# Goal 34.2 — Sitzungsfähigkeiten und erster Plattformschritt

Stand: 30. September 2026. Goal 34.2 wird um geschützte native Linux-Prompts,
gespeicherte Profile und einen zusätzlichen Tablet-Ablauf ergänzt. Aktuelle
Nachweise unten; frühere Betriebsstände bleiben als datierte Evidenz erhalten.
Persönliche Aktivierung und reale HTTPS-Probe: [HANDOFF](HANDOFF.md).
Die vollständige Windows-/Linux- und physische Tablet-Abnahme bleibt offen.
Produktziel: [Goal 34](AGENT_SESSION_PRODUCT_GOALS.md). ADE verwaltet seine eigenen
Sitzungen; andere Agentenverwaltungen sind keine Voraussetzung.

### Native Linux-Profile und geschützte Prompts (30. September, spätabends)

Neue feste native Codex-/Claude-/Grok-Starts lesen ein privates Bash-Skript ohne
Login-/Startdateien. Das PTY endet mit der CLI und ihrem Exitcode. Dadurch kann
auch ein verspäteter Prompt nach CLI-Ende keinen Shellbefehl ausführen. Eigene
Startbefehle, Shells und Windows-UI mit WSL-Backend behalten ihre bisherigen
Verträge. Bestehende Sitzungen werden nicht umgebaut oder neu gestartet.

Gespeicherte Codex-/Claude-/Qwen-Profile werden unter Linux aus unveränderlichen
Snapshots ausserhalb der Projekte übergeben, unabhängig vom Memory-Schalter.
Unicode, Shellzeichen und abschliessende Zeilenumbrüche bleiben Daten. Vor
Codex-Start wird die wirksame zusätzliche Anleitung über `config/read` gelesen
und erhalten; ein unbekannter Zustand blockiert den Start. Referenz:
[Codex-Konfiguration](https://learn.chatgpt.com/docs/config-file/config-reference),
[App-Server config/read](https://learn.chatgpt.com/docs/app-server).
Keine Projekt-AGENTS.md/CLAUDE.md wird dafür verändert. Das frühere Profil und
seine Revision bleiben in der laufenden Sitzung sichtbar, wenn das gespeicherte
Profil später geändert wird. Native Linux-Nutzungsinterception ist hier nicht
freigegeben; CLI-/Modellnachweise bleiben je Adapter getrennt.

Fokussierte Nachweise: Promptvertrag **28/0**, Linux-Profilargumente **12/0**,
Codex-Konfigurationsprobe **12/0**, native Sitzungsprozesse **30/0**,
Electron-Profilablauf **39/0**. Der Sitzungskern umfasst drei feste CLI-Fixtures,
exakte mehrzeilige Übergabe, idempotente Wiederholung, Entzug des Eingaberechts
vor verzögertem Enter, CLI-Exit während der Übergabe und eine erfolgreiche
positive Kontrolle danach. Der Konfigurationstest beendet auch einen verwaisten
Kindprozess der eigenen Linux-Probe. Die reale installierte Codex-Konfiguration
wurde ohne Modellauftrag erfolgreich gelesen, ohne ihren Inhalt auszugeben.

Zusätzlicher Browser-Treiber: `linux-agent-tablet` in `pnpm verify`, Implementierung
`test-session-navigation-electron.ts --agent-tablet`. Eigene Geräteverwaltung,
signierte HTTP-Anfragen, native PTYs und echtes Git; Tailscale/TLS und Agent-CLI
werden für den reproduzierbaren Ablauf ersetzt. Physische Android-, weitere
reale CLI-/Modell- sowie neue Windows-Abnahmen werden daraus nicht abgeleitet.
Der zusätzliche Browserlauf besteht **29/0**: drei native Profilprozesse in zwei
Projekten (zwei im selben Checkout), zielgenaue mehrzeilige Prompts, getrennte
Entwürfe, Orientierung/Offline, verlorene Antwort nach tatsächlicher Zustellung,
Neuladen ohne Doppelzustellung, explizite Wiederaufnahme, vierter Profilstart vom
Tablet, echtes Git-Diff und schreibgeschützter Dateiinhalt bei 390 px. Anschliessend
Desktop- und Tablet-Rückfragen samt Ergebnis und Neuladen ohne Doppelauftrag.
Alle Testprozesse werden beendet; fremde Port-443-Freigabe bleibt erhalten.

**Echte interaktive Codex-Probe bestanden um 22:59 CEST:** Codex **0.159.0**,
**gpt-5.6-sol / high**, native ADE-PTY mit gespeichertem Profil, Memory aus,
geschützte mehrzeilige Übergabe und eine kurze Modellantwort. Die zufällige
Prüfphrase stand ausschliesslich im Profil und erschien in der Antwort. Die
Bestätigungswiederholung war als Replay gekennzeichnet; kein neuer Prompt.
Der leere Test-Checkout blieb unverändert, CLI und PTY endeten regulär und
Promptfähigkeit wurde deaktiviert. `scripts/probe-linux-codex-prompt.ts` ist eine
separate Opt-in-Probe, kein bezahlter Bestandteil von `pnpm verify`.

Zwei vorbereitende Versuche stiessen auf den Codex-Ordnervertrauensdialog;
sie belegen keine Modellantwort. Der endgültige Treiber benutzt eine private,
nachher gelöschte Kopie der Codex-Konfiguration/Anmeldung mit Vertrauen nur für
seinen temporären Checkout. Der erste tatsächliche Modellversuch bewies bereits
die Profilphrase, aber seine Prüfbedingungen verglichen fälschlich Erstbeleg
und Replay bytegleich und warteten zu kurz auf Shutdown. Diese Treiberfehler
wurden korrigiert; der abschliessende vollständige positive Lauf ist grün.
Keine Änderungen an der persönlichen Codex-Konfiguration. Lokaler Beleg:
`test-results/linux-codex-prompt-probe.json`. Das beweist weder Mikrofon/
ElevenLabs-Audio noch Bildanhänge, Resume alter Threads oder andere reale Modelle.

Vollständiges `pnpm verify` am **30. September 2026 um 23:02:15 CEST**:
**27 bestanden / 0 Fehler / 16 nicht gemessen**, **102 Suiten / 4.325 Checks**,
drei Typechecks, beide isolierten Builds, Browser-/Electron-Abläufe und
Linux-Aktivierung **15/0**. Archiv: `test-results/goal34-linux-profiles-20260930/`
mit Vollbericht, Schrittlogs, positiver nativer Codex-Probe und Tablet-Bildern.
Die 16 nicht gemessenen Schritte besitzen explizite Plattformgründe. Kein
vollständiger Windows- oder physischer Android-Nachweis wird daraus abgeleitet.

### Ergänzung: benannte Terminal-Weblinks (30. September, Abend)

Der physische Android-Screenshot `Screenshot_20260930_210628_Chrome.jpg` zeigte
eine laufende Codex-Sitzung und den nicht bedienbaren OSC-8-Link „Knuckles Pi
öffnen“. Der korrigierte portable Desktop-/Tablet-Treiber besteht unter Linux
**87/0** (zuvor 78): tatsächliche Shellausgabe mit OSC-8, Touch auf Beschriftung,
vollständiges Ziel vor Navigation, Kopieren der Adresse, neuer Tab mit genauem
HTTPS-Port ohne Opener/Referrer, Fokus, Verlauf per Tastatur, schmale Ansicht und
lokale Adresse ohne Öffnen. Clipboard/Datei-OSC bleiben entfernt. Keine echte
Modellantwort nötig, TLS und externes Linkziel im Browserlauf sind Fixtures.

Die Parser-Suite prüft daneben reale xterm-Zellen, byteweise geteiltes OSC/UTF-8,
Zeilenumbrüche mit breiten/kombinierten Zeichen, reine Zieländerungen,
Überschreiben/Löschen, Alternate-Buffer, Scrollback, redigierte Zeilen,
kodierte Geheimnisse/Hostpfade und die Metadatengrenzen. Der eigene Linux-/Windows-
Vertrag bleibt identisch; neue native Windows- und physische Android-Abnahme der
Korrektur offen. Parser-Suite **77/0**, vollständiges Linux-Verify am Abend
**25 bestanden / 0 Fehler / 17 nicht gemessen**, **102 Suiten / 4.304 Checks**.
Archiv: `test-results/terminal-hyperlinks-20260930/`. Persönliche Aktivierung
zunächst von laufender Knuckles-Pi-Sitzung blockiert; nach deren regulärem Ende
durch den Benutzer um **21:29 CEST aktiviert**, reale HTTPS-/Assetprüfung bestanden,
Kopplung erhalten. [HANDOFF](HANDOFF.md).

Der Benutzer bestätigt nach Aktivierung am Tablet eine „deutliche Verbesserung“.
Diese persönliche Rückmeldung ergänzt die automatisierten Nachweise; sie ersetzt
keine vollständige Geräteabnahme mit Tastatur, Orientierung und Mobilfunk.

## Fähigkeiten: vorhandener Code und tatsächliche Grenzen

Eine CLI im PATH beweist nur ihre Auffindbarkeit. Eine Shell, eine interaktive
Agent-Sitzung, eine verwaltete Aufgabe und das zentrale ADE-Gespräch sind
verschiedene Start-/Steuerungswege. Diese Matrix trennt sie; die neue native
Codex-Probe deckt verwaltete Aufgaben und das ADE-Gespräch ab. Interaktive
Die interaktive native Codex-Probe ist oben ergänzt; weitere Adapter- und
Windows-Proben bleiben getrennt offen.

| Fähigkeit / Sitzungsart | Linux nativ (Omarchy) | Windows nativ | Nachweis / nächste Arbeit |
|---|---|---|---|
| Mehrere interaktive Shells, exakter Projekt-/Sitzungswechsel | **78 Prüfungen bestanden** im portablen Electron-/Tablet-Treiber mit vier nativen Shells | Bestehender Windows-Ablauf; neuer Treiber noch nicht ausgeführt | `sessionNavigationFlow.ts`, neuer `test-session-navigation-electron.ts` |
| Mehrere native Prozesse im ADE-Sitzungskern | **30 Prüfungen bestanden** mit echtem `PtyManager`, vier PTYs und deterministischen CLI-Fixtures | Derselbe Testpfad angelegt, noch nicht ausgeführt | `test-session-processes.ts`; kein Ersatz für Desktop-/Tablet- oder native Modellabnahme |
| Feste Codex-/Claude-/Grok-CLI | Codex 0.159.0 mit Profil und geschütztem Prompt real geprüft; Claude/Grok nur neue Transport-Fixtures | Frühere Windows-Terminalnachweise; keine neue Messung | `SessionLaunchService`, `PtyManager`; je CLI separater nativer Test erforderlich |
| Hermes, eigene Startbefehle, Ollama/Qwen | Startoptionen im Code; keine pauschale Linux-Freigabe | Frühere adapterbezogene Nachweise gelten nur im dokumentierten Umfang | Auffindbarkeit, Shellstart und Modellantwort getrennt prüfen |
| Gespeichertes Profil mit ADE-Verhaltensanweisungen im interaktiven CLI | **Implementiert**: Codex-/Claude-Electron-Fixture 39/0, Codex-/Claude-/Qwen-Argumenttransport 12/0 | Transport für Codex/Claude/Qwen vorgesehen; Grok/eigene Befehle nicht gleichsetzen | `PtyManager.ts`, `profileLaunch.ts`, `CodexProfileConfig.ts`; reale Adapterabnahme getrennt |
| Direkte Terminaleingabe und Desktop/Tablet-Besitzwechsel | Prozessgenaue Zustellung, Lease-Ablauf, explizite Freigabe und Desktop-Rückübernahme im neuen UI-Treiber bestanden | Bestehende Terminalverträge | `RemoteTerminalService`; Lease, Eingabesequenz und Widerruf beibehalten |
| Strukturierter Prompt/Diktat an geschützten interaktiven CLI | **Implementiert** für neue feste native Starts: Promptvertrag 28/0 und echte PTY-Negativkontrollen | Geschützter Startpfad implementiert | `promptProtected` in `PtyManager`; Ende-/Nachlauf-/Rechteverlustnachweise vorhanden |
| Rückfragen in verwalteten Aufgaben | Nativer Codex-App-Server-Pfad; Linux-UI-Fixture und echte Codex-Modellprobe **16/0** dokumentiert | Codex-Nachweise vorhanden; keine allgemeine Claude-/Grok-Rückfragenzusage | `RunQuestionService`, `CodexAppServerProcess`, `LIVE_RUN_INTERACTION_PLAN.md`, aktueller STATUS |
| Zentrales ADE-Gespräch | POSIX-Start und echte Codex-Browserprobe **16/0**: Vorschlag, Bestätigung, Worker-Rückfrage und Ergebnis | Bestehender Windows-Koordinator | Beweist nicht automatisch Fortsetzung beliebiger interaktiver CLI-Sitzungen |
| Abbruch, Unterbrechen, Fortsetzen | Rohes Terminal und Managed-Task-Abbruch vorhanden; kein universeller Pause-/Resume-Vertrag | Gleiche fachliche Unterscheidung | Fähigkeiten je Adapter, Sitzungstyp und Prozesszustand nachweisen |
| Oberfläche schliessen / ADE beenden | Tray bei aktivem Mobile-Host; vollständiges Beenden stoppt PTYs | Entsprechender Lebenszyklus | Unabhängiger Host bleibt Goal 34.6; Prozessverlust ist keine laufende Sitzung |

Native Windows, natives Linux, Linux unter WSLg und Windows-UI mit WSL-Backend
werden separat abgenommen. Ein Linux-Fixturelauf beweist keine Windows-ConPTY-
Ausführung. Keine neue macOS-Aussage.

## Implementierter Prüfpfad

`scripts/test-session-navigation-electron.ts` übernimmt den vorhandenen
Desktop-/Tablet-Ablauf als eigenständiger Treiber. Er braucht kein kompiliertes
Windows-CLI-Double und startet keine kostenpflichtigen Agent-Aufträge.
Das temporäre Profil nutzt echte ADE-Geräteverwaltung, HTTP-Autorisierung,
native Shell-PTYs und die Produktionsoberflächen. Nur Tailscale wird ersetzt;
die lokale HTTPS-Fixture ist kein Nachweis einer echten Tailnet-/TLS-Einrichtung.

Der bestehende Verify-Schritt `remote-terminal-electron:session-navigation`
verwendet jetzt diesen Treiber für Linux und Windows. macOS bleibt ausdrücklich
nicht gemessen. Die übrigen Windows-Terminaltreiber bleiben unverändert begrenzt.

Der gemeinsame Ablauf wurde erweitert um vier prozessbezogene Marker in drei
Projekten, darunter zwei Shells im selben Checkout. Tablet-Eingaben schreiben
einen eindeutigen Beleg aus dem Zustand der ausgewählten Shell; ein falscher
Geschwisterprozess muss dadurch scheitern. Andere Projekte bleiben unberührt.
Desktop-Eingabe wird während Tablet-Besitz mit dem konkreten Besitzfehler
abgelehnt; die abschliessende positive Kontrolle übernimmt am Desktop und
schreibt über genau denselben Prozess. Bestehende Prüfungen für Entwürfe,
Wiederverbinden, Fokus, kleine Ansichten und Projektbetreuung bleiben enthalten.

**Der neue Linux-Lauf besteht 78 Prüfungen ohne Fehler**, einschliesslich
Desktop-/Tablet-Wechsel, Entwürfen, Lease-Ablauf, expliziter Freigabe,
Desktop-Rückübernahme, prozessgenauer Eingabe, Fokus, schmalen Ansichten,
Neuladen und Projektbetreuung. Er beweist vorhandenes Verhalten mit Shells,
keine Modellantworten oder physische Android-Abnahme. Der zusätzliche Portvertrag ist unten beschrieben.

Zusätzlich ist `scripts/test-session-processes.ts` als fokussierte Suite in
`run-suites.ts` und damit im vollständigen Verify-Lauf registriert. Sie startet
den echten ADE-`PtyManager` mit Electrons Node-Laufzeit und damit der passenden
node-pty-ABI. Es werden weder Browserfenster noch Netzwerklistener benötigt;
keine Sandboxeinstellung wird geändert. Temporäre Profile und drei eigene
Arbeitsordner enthalten vier deterministische interaktive CLI-Prozesse.

Dieser Kernablauf besteht unter Linux **17/0**: vier verschiedene Kind-PIDs,
zwei Sitzungen im selben Ordner, zwei Runden gezielter Eingaben ohne Übergriff,
Wiederanhängen bei unveränderten Sitzungsidentitäten, CLI-Exit 7 getrennt von der
verbleibenden Custom-Shell, fehlende geschützte Promptfähigkeit für Custom-Starts,
gezieltes Sitzungsende und weitere Eingabe an den ursprünglichen Geschwisterprozess.
Nach `disposeAll` sind sowohl Inventar als auch alle Fixture-Kindprozesse beendet.
Dies beweist native Prozessverwaltung, noch keine Browser- oder Agent-Modellfunktion.

## Zusätzliche Portkorrektur (Goal 34.1)

Nach dem realen Tablet-Versuch wurde eine Portwahl im Desktop ergänzt:
443, 8443 oder 10000, dauerhaft im Geräte-Vault. Legacy-Profile bleiben auf 443.
Der bestehende Desktop-IPC-Kanal validiert den optionalen Port strikt; Remote-
Geräte erhalten keine Konfigurationsberechtigung. Aktiver Portwechsel wird
abgewiesen. Konfiguration, Status, Probe, Pairing, Restore, Monitor und Disable
verwenden dieselbe vollständige HTTPS-Origin. Main-Stacktraces bleiben im Log.

Der kombinierte Electron-Treiber startet mit fremder Foreground-Route auf 443,
prüft Konfliktmeldung und deaktivierte Kopplung, wählt 8443 und koppelt den
Browser. Anschliessend läuft der vollständige Mehrsitzungsablauf. Abschalten
entfernt nur den eigenen Port; die fremde Route bleibt erhalten. Tailscale
und TLS werden dabei weiterhin durch lokale Fixtures ersetzt.

`pty:kill` bestätigt die Signalauslösung vor dem tatsächlichen Exit. Ein voller
Lauf deckte eine Race in der sofortigen Schlussbehauptung des neuen Treibers
auf (71/1). Der Treiber wartet jetzt begrenzt auf das bestätigte Ende im Inventar;
der letzte fokussierte Gesamtablauf besteht 78/0.

## Ausgeführte Prüfungen und Grenzen

Die ursprüngliche Sandbox verweigerte lokale Sockets/Electron. Mit gezielt
freigegebener Ausführung sind diese Prüfungen inzwischen möglich. Keine
Produkt-Sandboxeinstellung wurde verändert. Persönlicher Betriebsstand: [HANDOFF](HANDOFF.md).

| Prüfung | Ergebnis |
|---|---|
| `test-session-navigation.ts` | 14/0 |
| `test-session-launch.ts` | 47/0 |
| `test-session-processes.ts` | 17/0, echte Linux-PTYs und CLI-Fixtures |
| `test-mobile-access.ts` | 108/0 nach Portkorrektur, inklusive exakter Origin und Wiederherstellung |
| TypeScript node/web/scripts und beide isolierten Builds | Im letzten fokussierten Verify-Lauf bestanden |
| Neuer Electron-/Tablet-/Port-Treiber | 78/0 |
| Bestehender `mobile-electron` | 37/0 |
| Linux-Aktivierungstreiber | 15/0: Update, aktive Shell blockiert, explizites und automatisches Rollback, erhaltene Kopplung |
| Native Codex-Rückfrage (separater Modelllauf) | 5/0, Codex 0.159.0, gpt-5.6-sol/high |
| Native Codex-Tablet-Browserprobe (separater Modelllauf) | 16/0, Codex 0.159.0, gpt-5.6-sol/high |
| Vollständige Verify-Läufe | 25 bestanden, 0 Fehler, 17 Windows-Schritte ausdrücklich nicht gemessen; 102 Suiten / 4283 Checks |

Der erste freigegebene volle Lauf scheiterte an einem defekten mise-pnpm-Shim
im privaten Test-HOME. Mit installiertem pnpm im Prozess-PATH besteht die
Integrationssuite 53/0; der nächste volle Suitenlauf bestand 102 Suiten mit
4263 Checks (noch vor den zusätzlichen Portprüfungen). Der letzte volle Lauf
scheiterte allein an der oben beschriebenen Test-Race. Fehler sind keine
bestandenen Negativkontrollen. Historie: `test-results/verify/history.jsonl`.
`test-results/goal34-full-20260930/` bewahrt die neuen Vollberichte;
`test-results/verify/report.json` enthält jeweils den letzten Lauf, auch Aktivierungsgates.

## Native Codex-Probe und sichere Linux-Aktivierung

`test-tablet-codex-native.ts --run-native` nutzt jetzt unter Linux das installierte
CLI direkt und prüft die gültige Mindestversion statt einer veralteten festen
0.154.0-Annahme. Windows behält seinen nativen PowerShell-Start. Der Einstieg
folgt der aktuellen Auswahl Gespräche → Projektbetreuung → Mit ADE sprechen.
Der erste Lauf fand einen veralteten Testselektor; der korrigierte positive Lauf
besteht **16/0**. Es wurden echte Codex-Prozesse und Modellantworten verwendet;
Tailscale/TLS bleiben in diesem isolierten Browserlauf Fixtures.

Gemessen: Vorschlag startet noch nichts; verlorene Bestätigung und Neuladen
starten genau einen Auftrag; der native Worker arbeitet in seinem geleasten
Checkout, erhält AGENTS.md unverändert und wartet auf die Rückfrageantwort.
Offline/Online erhält dieselbe offene Frage. Die Antwort erzeugt die exakte
Ergebnisdatei, ohne Änderung der Git-Metadaten oder des Quell-Checkouts. Graph,
schmale Ansicht, Host-Neustart und erhaltene Kopplung bestehen ebenfalls.
Beleg: `test-results/tablet-codex-native/result.json` (Linux, Codex 0.159.0,
gpt-5.6-sol, high, Build-Quellkennung `263a19e147d35c453dbb`) sowie
`test-results/goal34-tablet-codex-native.log`. Separater Protokollnachweis:
`test-results/goal34-codex-questions-native.log`, **5/0**.

Der registrierte `activation-linux`-Treiber prüft einen echten Electron-Host mit
Wegwerfprofil. Die negative Shell-Kontrolle verweigert sowohl den Treiber als auch
den direkten geschützten Quit; dieselbe Shell schreibt danach einen Dateibeleg.
Ein defekter Start führt automatisch zum vorherigen Build zurück. Der gekoppelte
Browser verbindet sich nach Update und Rollback ohne erneute Kopplung. Gatefehler
und zurückgelassene Staging-Dateien erhalten den laufenden Zustand. **15/0**.
Der persönliche Einsatz verwendet ausschliesslich `pnpm activate`, Profilbackup,
`out.prev` und reguläres Beenden; laufende Arbeit wird niemals erzwungen beendet.

## Persönlicher Omarchy-HTTPS-Nachweis

Am 30.09.2026 um 17:13 CEST regulär über `pnpm activate` aktiviert, PID 1511026.
ADEs private Adresse ist **https://omarchy.tailfc0b86.ts.net:8443**. Der lokale
Listener gehört dieser ADE-Instanz und bindet ausschliesslich 127.0.0.1:4317.
Nach dem letzten Neustart liefern die Seite und sechs JS-/CSS-Dateien HTTP 200
mit normaler Zertifikatsprüfung und stimmen bytegleich mit dem aktivierten Build
überein. Die fremde Foreground-Freigabe auf 443 ist unverändert, OpenClaw weiter
HTTPS 200. Reale Browserkopplung, Neuladen und Widerruf: **6/0**; Prüfgerät danach
widerrufen. Keine physische Android-Abnahme daraus ableiten.
Belege und Backup-/Rollback-Pfade: [HANDOFF](HANDOFF.md),
`test-results/goal34-personal/https-browser-result.json` und
`test-results/goal34-personal/final-https-result.json`.

## Fortsetzung

Persönliche Aktivierung, Adresse und aktuelle TLS-Nachweise stehen oben in
[HANDOFF](HANDOFF.md). Der reale Android-Test bleibt eigenständig: Tailscale,
Kopplung, Gerätefreigaben, Bildschirmtastatur, Hoch-/Querformat und Mobilfunk.
Windows-Nachweis des portablen Treibers sowie weitere reale native CLIs bleiben
offen. Linux-Profiltransport und geschützte Promptübergabe sind oben ergänzt. Goal 34.2 ist damit
weitergeführt, als vollständiges Linux-/Windows-Produktteilziel noch nicht abgenommen.
