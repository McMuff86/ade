# ADE — aktuelle Übergabe

## Stimmen-Tab und langsameres Tempo (16. September 2026)

Eigener Tab auf PC/Tablet mit fünf nativen ElevenLabs-Parametern, Vorschau und
Speichern am Host implementiert. Neuer Standard 0.85. Fokussierte Abnahme
bestanden; Gesamtprüfung und Aktivierung folgen. [Vertrag und Nachweise](VOICE_SETTINGS.md).
Die Abnahme erfolgt auf Branch `codex/voice-settings` in einer isolierten
Arbeitskopie, weil parallel die nächste Vorlesefunktion im Hauptcheckout entsteht.

## Computerstimme aktiviert (16. September 2026, 12:59 CEST)

Die vorbereitete Stimmvorschau läuft jetzt persönlich mit Source-ID
`9d2ad0abc6c9b97a1d29`, PID **49568**. Tablet-Bundle, Profile und Kopplung
bestätigt; [Aktivierung, Prüfgrenzen und Testweg](COMPUTER_VOICE_ACTIVATION.md).
Die folgenden Angaben zur ausstehenden Aktivierung beschreiben den früheren Stand.

## Computerstimme Richtung Voyager (16. September 2026)

Auf Operatorwunsch sind gleichmässige Betonung, Tempo 0.95 und die knappe
Antwort „Guten Morgen/Tag/Abend, Adi. Bereit. Bitte nenne deine Anfrage.“
implementiert. Keine Änderung der gewählten Stimme oder des Providerkontos.
55 Sprachverträge, 36 Verbrauchs- und 18 Computer-UI-Prüfungen bestanden.
`pnpm verify` bestand TypeScript, 72 Suiten / 3.132 Fachchecks, Build sowie
Ollama-/Sprach-/Computer-UI. Anschliessend stoppte der allgemeine Diktattest
bei `mobile dialog returns focus to prompt opener` (56/1, Zeile 430 des Drivers).
Die verbleibenden App-Prüfungen wurden dadurch nicht ausgeführt. Kein grüner
Gesamtlauf; Log `test-results/computer-voice-verify.log`. Die Sandbox blockierte
zuvor den ersten Compilerstart mit EPERM; Wiederholung ausserhalb der Sandbox.
Echte Hörprobe: `test-results/computer-voice/computer-voice.mp3`, Sarah,
HTTP 200, 3.30 Sekunden, 50 Zeichen im separaten Vorschaujournal erfasst.
Persönliche Klangbeurteilung und Aktivierung stehen aus. Die nachstehenden
Releases enthalten diese neue Abstimmung noch nicht. [Details](VOICE_COMPANION_PROPOSAL.md).

## Goal 32 — Fünf-Minuten-Diktat abschliessen (16. September 2026)

**Aktueller persönlicher Build: 06cd6ea, aktiviert 11:57 CEST**, Source-ID
**d2260ccf00b102a2e736**, PID **57428** bei Aktivierung. Enthält den Hotfix für
den vom Operator gemeldeten Computer-Erkennungsfehler. Regulärer Neustart und
aktuelles HTTPS-Tablet-Bundle bestätigt. Gesamtabnahme am 16. September um 12:27 CEST
mit Exit 0 abgeschlossen: 72 Suiten / 3’123 Checks, Diktat 64/0 und Computer 18/0.
Die parallele Stimmabstimmung wurde zusätzlich mit aktuellen Typechecks und
55 Sprachverträgen geprüft; sie ist eine separate, hier nicht aktivierte Änderung.
Details und Quellenabgrenzung: [Goal 32](LONG_DICTATION_GOALS.md).
Die folgenden Aktivierungsangaben zu 07e8ae4 dokumentieren die erste Vorschau.

Operator meldet funktionierende Live-Vorschau und fragt nach längeren Aufnahmen.
Die Grenze stammt aus ADE. Live-Pfad für PC und Tablet auf 5 Minuten angehoben;
Batch-Kompatibilität bleibt auf 60 Sekunden. Provider bestätigt Abschnitte schon
nach ungefähr 36 Sekunden automatisch; ADE sammelt diese nun und fordert alle
20 Sekunden eigene Bestätigungen an. Stop wartet auf alle offenen Abschnitte.
Der im Audit gefundene Startfristfehler ist korrigiert: Mikrofonvorbereitung
vor Provideröffnung; 30 Sekunden bis zum ersten Audio, danach feste 305 Sekunden.
79 Live-Vertragschecks bestehen. Die vollständige Prüfung, Commit, Build und
persönliche Aktivierung folgen unter [Goal 32](LONG_DICTATION_GOALS.md).
Der ursprüngliche Audit mit negativer Probe bleibt als historischer Nachweis
erhalten. [Goal 33](VOICE_COMPANION_PROPOSAL.md) beschreibt den gewünschten
ruhigen Sprachdialog auf PC und Tablet. Auf Wunsch des Operators ist zuerst
33.0 implementiert: **Prompt / Diktat → Computer testen → Computer sagen**.
Die ADE-Standardstimme begrüsst Adi ohne Selbstvorstellung. Der erste Live-Test
wird vor der zeitintensiven erneuten Gesamtabnahme aktiviert, sobald die
gezielten PC-/Tablet-Audiotests und der isolierte Release-Start bestehen.
Diese Vorabaktivierung ist ausdrücklich keine abgeschlossene Gesamtabnahme.
Aktivierung erfolgt **11:46 CEST**, Codecommit **07e8ae4**, Source-ID
**e55be38907bc873ec7ba**, persönlicher PID **34628**. Isolierter Start,
6 Profile/4 Projekte/1 Gerät und aktuelles HTTPS-Tablet-Bundle bestätigt.
Desktop-/Tablet-Computer-Test: **16/0**. Tablet-Seite neu laden und im bestehenden
Terminal gegebenenfalls **Eingabe übernehmen**, dann **Computer testen**.
Backup: `C:\Users\Adi.Muff\ADE-Backups\LongDictation-20260916-114614`.
Vollständiges `pnpm verify` läuft über diesen Produktstand weiter.
Der erste physische Tablet-Test fand danach eine zu strenge Abschlussprüfung:
bereits live erkanntes „Computer“ wurde bei geändertem/leerem Schlusstext
verworfen. Korrektur mit reproduzierter Negativkontrolle **5/1** und positiver
PC-/Tablet-Wiederholung **16/0**. Die Gesamtprüfung wurde für diesen Hotfix
unterbrochen und muss danach über den korrigierten Stand laufen.
Die erste Gesamtprüfung deckte zusätzlich eine verlorene Schliessbestätigung
bei laufendem Tablet-Heartbeat auf. Korrektur mit gezielter Negativkontrolle
(58/1) und positiver Wiederholung (59/0) geprüft; finale Gesamtabnahme läuft.

## Ollama-Profillogo (16. September 2026, aktiviert)

Offizielles Ollama-SVG lokal eingebunden, mit weisser Kontur auf dunklem Hintergrund
und quadratischem Bildrahmen für das vollständige Motiv. 17 Desktop- und 24 Tablet-
Profilchecks sowie vollständiges `pnpm verify` bestanden. Die Logo-Lieferung wurde
wegen paralleler Diktat-Arbeit im separaten Checkout von **ea14c18** geprüft.

- Codecommit **ea14c18fe3f9e7c9085615eb93ba3f1e489926fd**, sourceId **7bc2bd085b4f34107413**.
- Startordner `dist/ollama-logo-ea14c18`; ADE PID **15628 → 49556**.
  Startmenüeintrag aktualisiert; Ollama-Logo im persönlichen Profil geladen.
- 6 Profile, 4 Projekte und 1 Gerätekopplung erhalten;
  Tablet-Seite HTTP 200. Tablet-Seite neu laden, um das Logo zu sehen.
- Sicherung: `C:\Users\Adi.Muff\ADE-Backups\OllamaLogo-20260916-092905`.
- [Abnahme und Aktivierungsnachweise](OLLAMA_LOGO_RESULTS.md). Parallele Änderungen
  am Diktat bleiben ein eigener Lieferstand; dieser Release enthält den Logo-Commit.

## Goal 31 — Harness-Auswahl (16. September 2026, aktiviert)

Operator beauftragt die besprochene Auswahl **Codex CLI/Qwen Code** im
Ollama-Coding-Modus mit zugehörigen Goals. Arbeits-Goal und Goal-31-Vertrag
sind angelegt. Auswahl, Profilübernahme, verwalteter Adapter und PC-/Tablet-
Starts sind implementiert; reale lokale Probe mit Qwen Code **0.23.4** und
`qwen3-coder:30b` erfolgreich. Qwen Code 0.23.4 ist nun im vorhandenen
Benutzer-npm-Prefix installiert; keine Änderung globaler Modellanmeldungen.
46 Ollama-Vertrags-, 14 Profiltransport- und 28 Electron-UI-Checks sowie fünf
gezielte Tablet-/Host-Prüfungen sind positiv. Vollständiges `pnpm verify` ist
mit Exit 0 bestanden: 72 Suiten / 3.088 Fachchecks, alle TypeScript-Projekte,
Build, App-/Browserprüfungen und 22 Visualchecks. Zusätzlich 151 Adapterchecks.
Log: `test-results/qwen-verify-final.log`.
Persönliches Ollama-Profil bleibt zunächst beim
vorhandenen Codex-Harness. [Vertrag und Nachweise](OLLAMA_HARNESS_GOALS.md).

Der beauftragte Commit, finale Build und persönliche Neustart sind abgeschlossen:

- Codecommit **3b0bddd8cbe6f151fa448addec466a30d40649cf**; kein Push beauftragt.
- Startordner `dist/ollama-harness-3b0bddd`, sourceId **3db6da463aa4600a0573**.
  22 Startartefakte geprüft; separate isolierte Electron-Startprobe positiv.
- ADE über die vorhandene Tray-Aktion sauber beendet und neu gestartet:
  vorher PID 28356, jetzt **15628**, bestätigt am 16. September um 08:47 Uhr MESZ.
  Die Windows-Tray-Automation benötigte Wiederholungen; die abschliessende
  Aktivierung ist mit `passed` bestätigt. Sechs Profile und vier Projekte stimmen
  mit den Hashes vor dem Neustart überein; ein gekoppeltes Gerät ist erhalten.
- Die drei Runtime-Logos sind geladen. Tablet-Seite HTTP 200; Live-Diktat und
  Harness-Auswahl sind im Release enthalten. Auf dem Tablet die Seite neu laden.
  Der persönliche Mikrofontest auf dem physischen Tablet bleibt offen.
- Startmenüeintrag **ADE** zeigt auf den neuen Startordner. Sicherung:
  `C:\Users\Adi.Muff\ADE-Backups\QwenHarness-20260916-084703`.
  Der vorherige Startordner bleibt als Rückfalloption bestehen.
- Nachweise: `test-results/qwen-final-build.log`, `test-results/qwen-restart.json`,
  `test-results/qwen-release-smoke.json`, `dist/ollama-harness-3b0bddd/activation.json`
  und `dist/ollama-harness-3b0bddd/desktop-active.png`.

Die nachstehenden Aktivierungsdaten beschreiben vorherige Lieferungen.

## Tablet-Live-Diktat und Profilbilder (16. September 2026)

Operator bestätigt, dass der neue Build funktioniert. Erklärung: Ollama Coding
startet `codex --oss --local-provider ollama --model …`; Codex liefert die
Coding-Werkzeuge, Ollama das ausgewählte Modell. `ollama run …` bleibt der
direkte Chat-Modus. Keine Änderung am persönlichen Ollama-Profil erforderlich.

Tablet-Live-Streaming und lokale SVG-Profilbilder für Codex/OpenAI, Claude und
Grok sind implementiert. Eigene Profilfotos bleiben erhalten. 57 durchgehende
Diktatchecks, Remote-/Profilprüfungen und 72 fokussierte Suiten / 3.060 Checks
sind positiv. `pnpm verify` besteht vollständig, einschliesslich aller App- und
Visualprüfungen (`test-results/tablet-live-verify.log`, Exit 0). Der beauftragte
Commit, finale Build und persönliche Neustart sind abgeschlossen:

- Codecommit **441f0ce3b53c3ae958c407c174e52c17a68b33a7**; kein Push beauftragt.
- Neuer Startordner `dist/tablet-live-441f0ce`, sourceId **1a4a914d76bc06f5fd83**.
  22 Startartefakte geprüft; separate isolierte Electron-Startprobe positiv.
- ADE über die vorhandene Tray-Aktion sauber beendet und neu gestartet:
  vorher PID 64460, jetzt **28356**, bestätigt am 16. September um 02:18 Uhr MESZ.
  Alle sechs Profile und vier Projekte stimmen mit dem Stand vor dem Neustart
  überein; ein gekoppeltes Gerät ist erhalten. Die drei Runtime-Logos sind geladen.
- Tablet-Seite antwortet mit HTTP 200; Live-Code ist im ausgelieferten Browser-
  Build enthalten. Auf dem Tablet die Seite einmal neu laden. Ein persönlicher
  Mikrofontest auf dem physischen Tablet bleibt offen.
- Startmenüeintrag **ADE** zeigt auf den neuen Startordner. Sicherung:
  `C:\Users\Adi.Muff\ADE-Backups\TabletLive-20260916-021801`.
  Der vorherige Startordner bleibt als Rückfalloption bestehen.
- Nachweise: `test-results/tablet-live-restart.json`,
  `test-results/tablet-release-smoke.json`, `dist/tablet-live-441f0ce/activation.json`
  und `dist/tablet-live-441f0ce/desktop-active.png`.

[Vertrag und Nachweise](LIVE_DICTATION_RESULTS.md).

Die folgenden Aktivierungsnotizen beschreiben den vorherigen Stand **413c573**.

## Auf main gesichert; persönlicher Neustart vorbereitet (16. September 2026)

Der Operator beauftragt nach der Tablet-Anleitung ausdrücklich die Ausführung
von Sicherung, Synchronisierung und Aktivierung. Der gemeinsam geprüfte Stand
mit Ollama, Terminal-Dock und Desktop-Live-Diktat ist als **413c573** auf
`origin/main` gesichert; der Remote-Commit wurde anschliessend gelesen und
bestätigt. Es gab keinen divergierenden Branch und keinen erforderlichen Merge.

Der Produktionsbuild stimmt mit den aktuellen Build-Eingaben überein:
**sourceId `27bf304cecceca08c100`**. Eine unveränderliche Kopie liegt unter
`dist/live-dictation-413c573`. Dies ist ein Startordner für die vorhandene lokale
Electron-Runtime, kein neuer Windows-Installer. Die separate Electron-Startprobe
mit isoliertem Profil besteht; der neue Live-IPC-Handler weist ein unbekanntes
Aufnahmeticket wie erwartet ab. Nachweis: `test-results/live-release-smoke.json`.
Die vollständige vorherige Abnahme bleibt `test-results/prompt-live-verify.log`.

Der Startmenüeintrag **ADE** zeigt auf diesen geprüften Startordner. Konfiguration,
Gerätekopplung, Credentials/Local State und vorherige Verknüpfung wurden vor der
Umstellung gesichert unter
`C:\Users\Adi.Muff\ADE-Backups\LiveDictation-20260916-011211`.
Sechs Profile und vier Repository-Einträge werden beim Start unverändert geprüft.

Diese Unterhaltung läuft selbst unter der persönlichen ADE **PID 35044**,
Terminalshell **PID 51332**. Deshalb ist der abschliessende Neustart verzögert
vorgesehen; er beendet diese ausdrücklich freigegebene Sitzung. Ein unabhängiger,
unsichtbarer Windows-Helfer wurde im selben Desktop erfolgreich probegestartet.
`test-results/restart-live-release.ps1` prüft vor dem Beenden erneut Prozessidentität,
zusätzliche Sitzungen, aktive Runs, Git-Stand und alle 16 Startartefakte.

**Neustart noch nicht als abgeschlossen ausgeben:** `test-results/live-restart.json`
enthält den tatsächlichen Zustand (`scheduled`, `starting`, `passed` oder `failed`).
Erst `passed` zusammen mit `dist/live-dictation-413c573/activation.json` bestätigt
neuen Prozess, erhaltene Profile/Projekte/Geräte und erreichbare Tablet-Seite.
Bei fehlendem Nachweis diese Dateien und den persönlichen Main-Log prüfen.
Ein Test mit persönlichem Mikrofon/ElevenLabs bleibt offen. Tablet-Diktat bleibt
beim bisherigen Batch-Pfad; nach Wiederverbindung die Tablet-Seite neu laden.

## Terminal-Dock und Live-Diktat (16. September 2026)

Der neue Desktop-Bereich „Prompt und Diktat“ lässt das Terminal sichtbar und
bedienbar. AudioWorklet und main-eigene ElevenLabs-Verbindung liefern bereits
während der Aufnahme Text. Einfügen/Absenden bleibt ausdrücklich manuell.
53 Live-Vertragschecks und 52 kombinierte Electron-/Browserchecks bestanden mit
lokalem Provider-Fixture. `pnpm verify` hat alle 72 fokussierten Suiten mit
3.036 Checks, den Produktionsbuild und sämtliche anschliessenden Electron-,
Browser- und Visualprüfungen bestanden (Exit 0). Der abschliessende fokussierte
Live-Test prüft auch die konkreten Ablehnungsgründe aller Negativkontrollen.
Log: `test-results/prompt-live-verify.log`.
Persönliche ADE-Sitzungen wurden nicht beendet oder neu gestartet. Der neue
Build ist noch nicht in der geöffneten persönlichen Oberfläche aktiviert.
Ein persönlicher Mikrofon-/ElevenLabs-Test ist noch offen.
Details: [LIVE_DICTATION_RESULTS](LIVE_DICTATION_RESULTS.md).

## Ollama nach erfolgreichem Diktat-Test (15. September 2026)

Der Operator bestätigt den eigenen Diktat-Test und beauftragt Ollama samt
Modellübersicht. Die frühere Pause ist damit für diese Arbeit aufgehoben.
Implementierung und begrenzte Nachweise stehen in [OLLAMA_RESULTS](OLLAMA_RESULTS.md).
30 Modell-, 21 Coding-Vertrags- und 18 Electron-/ConPTY-Prüfungen bestanden,
ebenso TypeScript und Build. Gesamtabnahme in zwei Teilläufen: `pnpm verify`
bestand **71 Suiten / 2.980 Checks**, Build und sämtliche nachfolgenden App-/
Browserprüfungen bis zum Einrichtungstest. Dieser erwartete ein unregistriertes
Projekt unter dem inzwischen voreingestellten Filter „Meine ADE Projekte“.
Der Test wählt jetzt ausdrücklich „Alle“ und prüft zusätzlich den Startfilter;
Produktcode blieb für diese Korrektur unverändert. Anschliessend bestanden
**38 Einrichtungschecks**, **22 Visualchecks** und nochmals TypeScript.
Ein einzelner erneut grüner Gesamtlauf wurde nach dieser Testkorrektur nicht
ausgeführt. Logs: `test-results/ollama-verify.log`, `ollama-setup-positive.log`
und `ollama-visual.log`.

**Persönliche Aktivierung abgeschlossen:** Der Operator hat das Beenden der
offenen Codex-Sitzung und den Neustart ausdrücklich freigegeben. Der bisherige
Prozessbaum (ADE 49340, Codex 4800) wurde beendet. Das Skript
`test-results/activate-ollama.cjs --apply` hat über normales IPC das portable
Profil „Ollama“ unter „Coding-Profile“ angelegt: Runtime `ollama`,
`ollamaMode=coding`, Modell `qwen3-coder:30b`, Berechtigungen `default`.
Profil-ID: `5bcaf16c-3f3f-4704-84c7-15a57d901a15`; dauerhaftes `AGENTS.md` vorhanden.
Die fünf bisherigen Agenten und Repository-Einträge sind unverändert.
Die ursprüngliche Konfiguration liegt unter
`C:\Users\Adi.Muff\ADE-Backups\Ollama-BeforeRestart-20260915-231010\config.json`.

ADE läuft wieder interaktiv als Entwicklungsstart `electron.exe .`, PID 35044,
mit dem üblichen Profil unter AppData/Roaming/ade. Die Ollama-Einstellungen sind
geöffnet und zeigen 13 Modelle sowie die Auswahl `qwen3-coder:30b`.
Nachweise: `test-results/ollama/activation.json` und
`test-results/ollama/personal-active-models.png`. Es wurde noch keine persönliche
Ollama-Coding-Sitzung gestartet. Kein neues Paket, Commit oder Push für diese Arbeit.

## Übergabe zum Tablet-Test; danach auf Operatorwunsch pausieren (15. September 2026)

Der Operator verlangt jetzt: diesen Code samt Handoff committen und pushen,
anschliessend einen Windows-Build erstellen, genau eine persönliche ADE-Instanz
für seinen Tablet-Test offen lassen und danach die Arbeit pausieren. Keine
weitere Implementierung oder automatische Testserie bis zu seiner Rückmeldung.
Offene Goals bleiben offen; diese Übergabe ist keine Gesamterledigung von Goal 24.

Dieser Checkpoint ergänzt die erste Projektansicht, mobile Projektnamen und eine
gemeinsame Verbrauchsanzeige unter **Abo-Nutzung → Sitzungsverbrauch** für neue
native Windows-Codex-/Claude-/Grok-Starts. Gemeldete Input-/Output-/Cache-/Reasoning-
Werte, unbekannte Felder und API-Schätzungen bleiben unterscheidbar. ElevenLabs-
STT/TTS schreibt Versuche mit Audiosekunden beziehungsweise Zeichen dauerhaft
vor dem Versand. Diktatwerte erscheinen an der ursprünglichen Sitzung, getrennt
nach bestätigtem, ausstehendem, unbestätigtem oder nicht versendetem Ausgang.
Anbieterkosten/Credits pro Sprachauftrag bleiben ohne eindeutige Quelle unbekannt.

Prüfstand: alle drei TypeScript-Projekte, Produktionsbuild und **2.956 Checks in
70 fokussierten Suiten** bestanden; zusätzlich **32 kombinierte Diktat-/Verbrauchs-
Appchecks**. Der erste Gesamtversuch stoppte im freien Terminal: dessen CLI-
Fixture schrieb ihren Dateinachweis nur ohne Argumente. Sie berücksichtigt jetzt
auch die tatsächlichen Telemetrie-/Sitzungsargumente. Der vollständige betroffene
Electron-/Tablet-Driver besteht danach **204 Checks**, einschliesslich des
tatsächlichen Arbeitsordners aller drei CLIs. Produktcode wurde für diese
Korrektur nicht abgeschwächt. **Ein erneut vollständig grünes `pnpm verify` für
diesen Checkpoint steht aus**; der letzte vollständige Lauf bleibt `128b503`
mit 3.735 Checks. Lokale Logs: `usage-verify-fixture-negative.log`,
`usage-terminal-positive.log`, `usage-typecheck-package.log` unter `test-results`.

**Aktiviert am 15. September, 04:32 UTC:**
`dist/usage-20260915/win-unpacked/ADE.exe`, persönliche Hauptinstanz **PID 22860**,
ein sichtbares ADE-Fenster mit den üblichen Electron-Hilfsprozessen. Der Code-
Checkpoint **406a06c37bbb0e12a74ceb0c76013b74ec47ba31** samt diesem Handoff ist
auf `origin/main` gesichert; danach wurden nur Pakettest und Betriebsnachweis
ergänzt. Der Produktionsbuild wurde nach diesem Commit erstellt.

Das Windows-Paket besteht **13 reale Paketprüfungen**, einschliesslich ConPTY,
Work-/Overview-Rückkehr, Promptentwurf und authentisierter nativer Zahlen-Fixture.
Eine erste Paketprobe öffnete die Nutzungsanzeige zu früh am alten Shell-Tab;
der Driver wartet jetzt ausdrücklich auf die aktive Codex-Sitzung und besteht.
Log: `test-results/usage-package-smoke-positive.log`; Manifest:
`test-results/cli-work-package-smoke.json` (SourceDirty betrifft diese Testkorrektur,
der Produktcode entspricht 406a06c).

- EXE-SHA256: `e8a1fcba5a975268c68908c9e855e555200e45a3db17f181a110e47d412b80bb`
- App-ASAR-SHA256: `e4b448330202cc053695a7832cc55247877bb162af23e3bdb6e5c426a23ad75d`
- Tablet: **https://number-cruncher.tailfc0b86.ts.net/**; HTML-Abruf nach Start
  mit HTTP 200. Die geschützte API lehnt unangemeldete Abfragen weiterhin mit 401 ab.
- Bestehendes Gerät **Samsung Galaxy S10 Ultra** behält seine Kopplung/Rechte
  und erhielt zusätzlich `dictation:transcribe` über den validierenden,
  auditierenden DeviceStore. Terminalfreigabe und bisherige Ressourcenauswahl
  bleiben erhalten. Tabletseite neu laden; keine neue Kopplung erforderlich.
- Die Startmenü-Verknüpfung **ADE** zeigt jetzt auf das neue Programm. Die alte
  Instanz 37308 wurde nach Prüfung ihrer Kindprozesse beendet: keine Coding-CLI
  und kein WSL-Prozess mehr vorhanden, nur Electron-Hilfsprozesse/ConPTY-Host.
  Vorherige Konfiguration, Gerätebestand, Audit und Verknüpfung gesichert unter
  `C:\Users\Adi.Muff\ADE-Backups\UsageActivation-20260915`.
- C: lief beim ersten Paketversuch voll. Zwei unbenutzte erzeugte Buildordner
  (`dist/win-unpacked`, `dist/cli-work-20260915`) wurden vollständig nach
  `D:\ADE-Build-Archive\20260915-usage-checkpoint` verschoben. Keine Original-
  repositorys gelöscht oder verschoben. Letzter freier Platz auf C: rund **1 GB**;
  vor weiterer längerer Arbeit Speicherplatz prüfen. Die aktuelle Version und
  die frühere Workflow-/Diktat-Version sind erhalten.

Alle vier persönlichen Originalprojekte sind weiterhin registriert. Keine
CLI-Testaufträge laufen in der persönlichen Instanz. **ADE offen lassen und
jetzt pausieren**, damit der Operator selbst am Tablet testen kann.

Offen für die nächste ausdrücklich freigegebene Arbeitsphase:

1. `pnpm verify` erneut vollständig ausführen; verbleibende UI-/Latenz-/Visual-
   Driver dieses Checkpoints sind nicht als neu vollständig abgenommen auszugeben.
2. Rückmeldung vom echten Tablet: Browser/OS, Mikrofonfreigabe, Diktat, Wechsel
   zwischen Projekten und Tastaturgefühl. Lokale Chromium-/ConPTY-Messungen sind
   keine Messung der Mobilfunk-/WAN-Verbindung. Die bestehende Gerätefreigabe
   **Diktat mit ElevenLabs** (`dictation:transcribe`) muss für Diktat aktiv sein.
3. Goal 24: Projekt-/Tages-/Monatsansicht, Budgetwarnungen und separate ElevenLabs-
   Kontenansicht. Gelesene Kontensummen nicht als exakte ADE-Einzelpreise oder
   zusätzliche Kopie bereits gezählter Sprachversuche verbuchen.
4. Codex-Zusatzereignis mit unzugeordneter Konversationsidentität klären; bekannte
   Rolloutwerte bleiben korrekt und ausdrücklich unvollständig. Resume/Fork,
   Unteragenten und andere Backends benötigen eigene Nachweise. Claude-Reasoning
   bleibt ohne passend zugeordnetes Quellfeld unbekannt.
5. Weitere Produktideen nur priorisiert angehen: Schnellwechsler, ruhige Hinweise
   auf Prüfbedarf und erkennbare gleichzeitige Schreiber im selben Checkout.

Führende Quellen: [Verbrauchsnachweise](USAGE_SOURCE_RESULTS.md),
[Verbrauchsziele](USAGE_AND_COST_GOALS.md), [CLI-/Diktat-Ziele](CLI_WORK_AND_DICTATION_GOALS.md),
[Dokumentationsaudit](DOCUMENTATION_AUDIT.md).

## Vorheriger Diktatcheckpoint und anschliessender Ausbau (15. September 2026)

Operator bestätigt den sichtbaren Umbau und beauftragt ein aktives Ziel für
CLI-Arbeitsübersicht (Goal 27) und ElevenLabs-Promptübergabe (Goal 23.1 Desktop).
Das Ziel ist in der Zielverwaltung angelegt, ohne Tokenbudget. CLI-Arbeitsliste,
Textentwurf und Diktat auf Desktop/Mobile sind implementiert. Der neue Stand
besteht als Diktatcommit `128b503` `pnpm verify` vollständig mit **3.735 Checks** (64 Suiten / 2.786
fokussierte + 949 UI-Checks). Windows-Paket unter
`dist/dictation-20260915/win-unpacked/ADE.exe` mit zehn Paketprüfungen bestanden.
Ein echter Scribe-v2-Aufruf und die native Promptübergabe an Codex, Claude Code
und Grok sind erfolgreich; physische Tablet-/WAN-Abnahme bleibt gesondert.
Der frühere CLI-Checkpoint `b2e134e` und Paketnachweis `5ea3b3c` sind auf
`origin/main` gesichert. Die persönliche Instanz 37308 bleibt wegen einer
offenen WSL-Shell unverändert; nicht ungeprüft beenden.
Der Diktatcommit **128b503a098b541ada26d3879109028a40bc3099** ist jetzt ebenfalls
gepusht und der Remote-SHA abgeglichen. Die zwei Orientierungsdetails aus Goal
27.2 sind danach implementiert und fokussiert geprüft; neues Gesamtverify/Paket
für diese Folgeänderung noch ausstehend. Die native Verbrauchserfassung ist nun
mit neuen geschützten Windows-CLI-Starts und einer gemeinsamen PC-/Tablet-
Sitzungsanzeige verbunden. 130 native Vertragschecks sowie 32 kombinierte Diktat-/
Verbrauchs-Electronchecks bestehen; alle drei CLI-Quellen im App-Test sind
isolierte Fixtures. Erste echte integrierte Codex-/Claude-/Grok-Proben liegen
inzwischen vor. Codex markiert ein zusätzliches unzugeordnetes Konversations-
ereignis korrekt als unvollständig; dessen Herkunft bleibt zu klären.
ElevenLabs-STT-/TTS-Versuche sind ebenfalls angebunden und mit 36 fokussierten
Checks geprüft. Ihre Audiosekunden/Zeichen und Abschlüsse bleiben separat; ein
unbestätigter Auftrag wird nicht als kostenlos ausgegeben. Projekt-/Monatsansicht,
Kontenansicht, Budgets und Wiederaufnahmefälle sind noch offen.
Führender Befund: [Verbrauchsquellen](USAGE_SOURCE_RESULTS.md).
[Aktueller Diktatstand](DICTATION_IMPLEMENTATION_RESULTS.md). Weitere Produktideen bleiben priorisierte
Vorschläge im [Zielplan](CLI_WORK_AND_DICTATION_GOALS.md).

Anschliessend ausdrücklich beauftragt: den jetzigen Projektstand zeitnah
committen und pushen. Der Sicherungsstand umfasst die zuvor vollständig
geprüften Workspace-Terminaländerungen, Neuordnungsnachweise und Zielplanung.
Persönliche Konfiguration und Dateisicherungen bleiben im lokalen ADE-Backup.
Sicherungscommit **bff299a984ca1ff0c5e243434519b97434f9dc26** wurde auf `main`
erstellt und zu `origin/main` gepusht; Remote-SHA abgeglichen. Neue Produktarbeit
seit diesem Checkpoint: [laufender Abnahmenachweis](CLI_WORK_LATENCY_RESULTS.md).
Zusätzlicher Operatorauftrag: sämtliche führenden Dokumente, Goals und
Architekturaussagen mit dem Code synchronisieren. Umfang und Audit-Abnahme
sind im aktiven Zielplan ergänzt; der vollständige Audit bleibt ausstehend.
Spätere Erweiterung desselben Ziels: mobiles Diktat ist erforderlich, ebenso
die Messung/Optimierung des Tablet-Terminal-Echos (Goal 25). Sofort sichtbarer
lokaler Promptentwurf und echte TUI-Ausgabe bleiben technisch unterscheidbar;
kein unsicheres blindes Zeichen-Echo. Der Zielplan enthält Mess- und Abnahmekriterien.
Weitere verbindliche Erweiterung: Goal 24 Verbrauch/Kosten für Codex, Claude
Code, Grok und ElevenLabs. Native Usage-Daten zuerst, Proxy nur als gezielte
Option; die inzwischen ergänzte erste Zählerimplementierung steht oben. [Umfang](USAGE_AND_COST_GOALS.md).

## Projekt-Neuordnung aktiviert, WSL-Assistenten geprüft (15. September 2026)

Operator akzeptiert: bestehende Arbeit direkt, neue parallele Aufgabe mit eigenem
Branch/Worktree, Profile optional. Gewünschte Projekte: ADE, RhinoLayoutTools,
RhinoClaw, RhinoSheetMetal; Originalordner unter `repos` niemals löschen.
Bereinigung und neutrale Coding-Profile wurden danach ausdrücklich bestätigt.

Konfiguration/Agentdaten/Remote-Daten/verschlüsselte Credentials gesichert unter
`C:\Users\Adi.Muff\ADE-Backups\Neuordnung-20260914-234214`.
Alle sechs alten ADE-Arbeitskopien gesichert: 19.222 reguläre Dateien mit
SHA-256-Abgleich, 1.040 Verknüpfungen als Link-Manifeste, eigener LayoutTools-
Commit zusätzlich als geprüftes inkrementelles Git-Bundle. Fünf Git-Registrierungen
entfernt; ungültiger Main-Chef-Ordner und Reste einer Git-Entfernung zusätzlich
ins Backup verschoben. Alle sechs alten Pfade entfernt. Original-HEADs,
Branch-Referenzen, Status, Diffs und unversionierte Dateien unverändert geprüft.

Persönliche App bei der Änderung gestoppt; Konfiguration validiert, über
`ConfigStore.save` atomar aktiviert und erneut ohne Migration geladen. Vier
Originalprojekte, drei optionale Profile Codex/Claude Code/Grok, keine alten
Bindings oder Workspace-Overrides. 2D_rpg_jumpnrun und Codex Native nur aus
ADE entladen; Originalordner erhalten. Runs/Tasks/Leases waren bereits leer.
Historische Sitzungsdaten und bisherige Assistenten-Identitäten bleiben erhalten.

Hermes General: `wsl:Ubuntu`, `general --tui`; Sentinel auf letzten Operatorwunsch:
`openclaw tui --session agent:main:tui`. Beide direkt aus Overview des gepackten
Windows-Builds bis „ready“ bzw. Gateway-Verbindung getestet, ohne Arbeitsauftrag.
Dashboards öffnen extern: Sentinel `http://127.0.0.1:18789/chat/main`, Hermes
behält seine bestehende HTTPS-Anmeldeseite. Beide HTTP 200. Browseranmeldung und
neue Modellantwort nicht geprüft. TUI- und Browser-Sitzung bei Sentinel bewusst
unterschiedlich (`agent:main:tui` bzw. `/chat/main`). Testterminals geschlossen.
Nachweise: `test-results/reorganization-ui/`, Backup-`activation.json` und
`cleanup.json`. Alte persönliche PID 62964 wurde für die Neuordnung beendet.

Alle vier Projektkarten anschliessend im echten persönlichen Profil über
„Projekt-Workspace öffnen“ geprüft: jeweiliger Originalordner, Branch `main`,
kein Pflichtprofil. Nachweis: `test-results/reorganization-personal/verification.json`.
Windows-Build am 15. September um 00:09 Uhr regulär neu geöffnet, PID **37308**,
reagierendes Fenster, Startansicht Overview. Startnachweis:
`test-results/reorganization-personal-start.json`.

Neue Feststellung: ElevenLabs bietet in ADE bisher Stimmenwahl und TTS-Tests;
Mikrofon/STT und gezielte Desktop-Promptübergabe an CLIs fehlen.
[Aktive Ordnung, Nachweise und nächste Produktschritte](PROJECT_WORKFLOW_REORGANIZATION.md).

## Workflow-Analyse und Windows-Build geöffnet (14. September 2026, 23:20 Uhr)

Auf Wunsch des Operators den Stand `797aba0` einschliesslich der vorhandenen,
uncommitteten Workspace-Terminal-Erweiterungen gebaut und als Windows-x64-App
gepackt: `dist/workflow-review-20260914/win-unpacked/ADE.exe`.
Persönliches Profil `%APPDATA%/ade`, gestartete PID **62964**, App reagiert.
Konfigurationsbackup: `test-results/workflow-review-backup-20260914-232041`;
Startnachweis: `test-results/workflow-review-activation.json`.
Kein Produktcode geändert und kein Commit, Push, Branchwechsel oder Abgleich
in den persönlichen Repositorys ausgeführt.

Build, Packaging, drei TypeScript-Projekte und `pnpm test` grün: 56 Suiten /
2.567 Checks. Vier gezielte Electron-Abläufe zusätzlich grün: Work 20,
Git-Abgleich 20, Workspace/CLI 54, Projekt-Git 22. Gepackte EXE mit separatem
Katalog-Prüfprofil durch alle fünf Ansichten geöffnet; native PTY-Echoausgabe
im Originalprojekt bestätigt. Kein neuer vollständiger `pnpm verify`-Durchlauf
und keine Provider-Inferenz. Screenshots/JSON: `test-results/workflow-review/`.

[Analyse und vorgeschlagener täglicher Ablauf](WORKFLOW_REVIEW_2026-09-14.md)
unterscheiden Hauptcheckout, Task-Worktree, Agent-Binding und mobilen Override.
Konkrete Altstände: LayoutTool-Designer 81 Commits hinter dem Hauptprojekt,
1 eigener Commit und 2 lokale Änderungen; GrokMain dort 15 Commits zurück.
Die gemeinsame Arbeitsliste und eine konsistente Projekt-/Workspace-Navigation
sind Empfehlungen zur Diskussion, keine bereits umgesetzte neue Funktion.

## Workspace-Terminals: lokaler Arbeitsstand (14. September 2026)

Workspace-Auswahl im freien Starter, direkte CLI-Aktionen, optionale Profile,
Projektsitzungs-Tabs und Desktop-Terminalwerkzeuge sind umgesetzt. Vollständiges
`pnpm verify`: Exit 0, 56 Suiten / 2.567 fokussierte und 903 Electron-/Browser-/
Visual-Checks, drei TypeScript-Projekte und Produktionsbuild bestanden.
Bei dieser ursprünglichen Abnahme blieb die persönliche Instanz unverändert;
der neue Windows-Build ist inzwischen geöffnet, siehe aktuellen Eintrag oben.
[Verträge, Bedienung und Abnahme](WORKSPACE_TERMINALS_RESULTS.md).

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
