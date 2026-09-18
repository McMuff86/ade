# Eleven v3 und Aussprache von Adi

Beauftragt am 18. September 2026: aktuelle Stimme/Modell benennen, auf Eleven v3
über Text to Dialogue WebSocket umstellen, Adi kurz mit kurzem A aussprechen.

## Provider und Umsetzung

Persönlicher Katalog am 18. September: Standardstimme
`EXAVITQu4vr4xnSDxMaL` = **Sarah – Mature, Reassuring, Confident**.
Das bisherige Modell war `eleven_multilingual_v2` über HTTP Text to Speech.
Die Stimmenwahl und mögliche Projekt-/Agent-Overrides bleiben erhalten.

Neu: festes `eleven_v3`, Sprache `de`, `mp3_44100_128`, Endpunkt
`wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input`.
Authentifizierung und Registrierung der Stimme erfolgen ausschliesslich in main
mit dem ersten Frame; der Schlüssel steht weder in URL noch Renderer oder Logs.
Ein `inputs`-Frame trägt den geprüften Text, `close_socket` fordert Abschluss und
Rest-Audio an. Erst `is_final` bestätigt vollständiges Audio. Turn-Ende allein
genügt wegen des MP3-Encoderpuffers nicht. Fehler, Abbruch, Zeitlimit und vorzeitiger
Verbindungsabschluss erzeugen keine automatische erneute kostenpflichtige Anfrage.
Audio bleibt auf 2 MiB und die Anfrage auf 30 Sekunden begrenzt.

Der Provider liefert Audiostücke; ADE sammelt diese vor der bestehenden
MP3-Wiedergabe. Dieser Schritt führt kein Streaming-Protokoll zum Tablet ein.
Bestehende Vorschau, explizites Vorlesen, Geräteberechtigungen, Rechnungseinheiten
und wiederherstellbare Aktionsbelege gelten weiter. Nutzungsbelege nennen v3 und
die tatsächliche Länge des an den Provider übergebenen Textes; Kosten bleiben
unbekannt, solange keine Abrechnungsdaten vorliegen.

Die WebSocket-Definition unterstützt bei v3 nur `stability`. Die Oberfläche
zeigt deshalb diesen Regler. Alte Tempo-/Ähnlichkeits-/Stil-/Boost-Werte bleiben
aus Kompatibilitätsgründen gespeichert, werden aber nicht an v3 gesendet und
nicht als wirksame Regler angeboten. Diktat bleibt Scribe v2/Realtime Scribe.

Nur im Providertext wird das vollständige Wort `Adi` durch die native
IPA-Schreibweise `"/ˈadi/"` ersetzt: kurzes `a`, ohne Längenzeichen `ː`.
Vorschau, Begrüssungstext und CLI-Entwurf behalten `Adi`. Andere Wörter werden
nicht teilweise umgeschrieben. Dies ist eine Aussprachevorgabe, keine Garantie
für identische Betonung jeder Generation. Adis Hörabnahme bleibt erforderlich.

## Nachweise

Vorab echter Anbietertest mit der persönlichen Sarah-Stimme:
`test-results/eleven-v3-probe.json`, 13 Audiostücke, 76.113 Bytes, bestätigtes
`is_final`; Hörprobe `test-results/eleven-v3-adi.mp3`. Ein kurzer bezahlter
Syntheseversuch. Kein API-Schlüssel in den Belegen. Produktionsabnahme folgt.

Auch der echte `SpeechService` mit `SpeechUsageService` in einem isolierten
Electron-Profil besteht gegen den Anbieter: Sarah, `eleven_v3`, **126**
Providerzeichen, Nutzungszustand **complete**, **115.819 Bytes** MP3. Die
ursprüngliche Schreibweise Adi bleibt im Ergebnistext erhalten. Chromium dekodiert
die Probe zu **7,236 Sekunden** Audio mit 44,1 kHz und messbarem Signal, ohne
Wiedergabe zu starten. Belege: `eleven-v3-service-probe.json`,
`eleven-v3-service-decode.json`, Hörprobe `eleven-v3-service.mp3` in `test-results`.
Zusammen mit der vorigen Protokollprobe sind das zwei kurze echte Synthesen;
die gezählten Nutzungseinheiten sind keine erfundenen Preis- oder Kreditangaben.

Fokussiert bestanden: Protokoll/Abbruch/Grössenlimits **32/0**, Sprachservice
**56/0**, Präferenzen **65/0**, Nutzung **36/0**, Antworten **28/0**, signierte
Remote-Antworten **20/0**. Alle drei TypeScript-Projekte und Produktionsbuild
bestanden. Reale Electron-/Chromium-Bedienung mit lokalem Providerpeer:
Stimmenoberfläche **22/0**, Tablet-Stimmen **37/0**, Antworten **35/0**,
Computer-Aufruf auf Desktop und Tablet **21/0**. Zwei alte Testannahmen (v2-Tempo
nach Reload und unveränderter Providertext bei Adi) wurden an den neuen Vertrag
angepasst; anschliessend bestehen die vollständigen jeweiligen Driver.
Belege: `test-results/eleven-v3-*.log`.

Der erste Gesamtlauf besteht 90 Suiten / 3.709 Prüfungen, Build sowie die
Sprach-, Diktat- und weiteren Bedienungstests, scheitert aber mit **207/1** im
allgemeinen Terminaldriver. Der native PTY-Mitschnitt bestätigt: Der Befehl wurde
überhaupt nicht übergeben. Ein deterministischer Negativtest hält die leere
Heartbeat-Anfrage offen und löst den bereits begonnenen Form-Submit aus:
**5/1**, genau die erwartete verlorene Übergabe. Ursache war `transmit` mit
sofortigem `busy`-Rückgabewert vor dem React-Update des deaktivierten Buttons.

Explizites Senden wartet nun maximal fünf Sekunden vor der Übergabe auf den
lokalen Lock und die Tastaturwarteschlange. Sitzung, Lease und Verbindung werden
erneut geprüft; Fehler oder unbekannte Quittungen werden nicht wiederholt.
Nachträgliche Entwurfsänderungen werden nicht durch die alte Quittung gelöscht.
Sondertasten verwenden dieselbe begrenzte Warteschlange wie die direkte Tastatur.
Der positive native Driver besteht **10/0**, einschliesslich genau einer Übergabe,
erhaltenem Folgeentwurf, Abbruch bei Offline ohne Replay und bewusstem erneutem
Senden. Belege: `terminal-input-race-negative.log`, `terminal-input-race-positive.log`
und `eleven-v3-terminal-failure-replay.txt`. Der neue Driver gehört zu `pnpm verify`.

Der zweite Gesamtlauf (`eleven-v3-verify-final.log`) besteht ebenfalls alle
90 Suiten / 3.709 Prüfungen und Build, findet aber dieselbe Überschneidung beim
Button „Eingabe freigeben“. Der gezielte Negativtest gegen diesen Build bestätigt
**11/1**: Der Klick wird ohne Request verworfen. Lifecycle-Aktionen reservieren
deshalb ebenfalls die Übergabe und warten vor dem Senden höchstens fünf Sekunden.
Neue Heartbeats überholen die wartende Aktion nicht. Wechsel von Verbindung,
Sitzung oder aktivem Workspace brechen das Warten ab; kein automatisches Replay.
Auch der Profilstart wartet vor seiner Query/Open-Transaktion auf laufende Eingabe.
Belege: `terminal-lifecycle-race-negative.log` und
`terminal-lifecycle-race-positive.log`.
Der erweiterte positive Driver besteht **15/0** inklusive doppeltem Klick,
genau einer Freigabe, anschliessender Übernahme, Offline-Abbruch und bewusstem
erneutem Freigeben. Alle TypeScript-Projekte und der Produktionsbuild bestehen.

Beide fehlgeschlagenen Gesamtläufe sind ausdrücklich keine erfolgreiche
Gesamtabnahme. Die vollständige Wiederholung wird als
`test-results/eleven-v3-verify-release.log` dokumentiert.

Diese abschliessende Wiederholung besteht vollständig: **Exit 0**, am
18. September 2026 von **02:52 bis 03:21 CEST**. Drei TypeScript-Projekte,
90 Suiten / 3.709 Prüfungen, Produktionsbuild und sämtliche Electron-/Chromium-
und Darstellungstests sind erfolgreich. Darunter allgemeines Terminal **208/0**,
Workspace-CLI **79/0**, Projekt-Git **31/0**, Cursor/IME/Wiederaufnahme **29/0**
und Eingabe-/Lifecycle-Überschneidungen **15/0**. Abschlussbeleg:
`test-results/eleven-v3-verify-release-exit.json`.

Quellen: [TTD-WebSocket samt Schema](https://elevenlabs.io/docs/api-reference/text-to-dialogue/ttd-websocket),
[offizieller Streaming-Ablauf](https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/realtime-tdd),
[native IPA-Vorgaben](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices).

## Betrieb

Vollständig geprüft und persönlich aktiviert am **18. September 2026, 03:25 CEST**.
Source **`5f58bdaefddb8640de7b`**, Release
`dist/eleven-v3-5f58bdaefddb8640de7b`, PID **15008** ersetzt regulär beendeten
PID 45844. Der isolierte Start ist ebenfalls bestanden. Die Startmenü-Verknüpfung
zeigt auf den neuen Release. Sicherung:
`C:\Users\Adi.Muff\ADE-Backups\ElevenV3-20260918-032513`.

Alle sechs Profile, sechs Projekte und die bestehende Tablet-Kopplung sind
erhalten. Die private HTTPS-Adresse liefert Status 200 und bytegleich das neue
Tablet-Bundle. Die persönliche Rhino-Git-Abfrage liefert fünf echte Commits.
Nachweise: `test-results/eleven-v3-isolated-proof.json`,
`test-results/eleven-v3-restart.json` und `activation.json` im Release.

Die einmalige produktive Probe über `speech:test` bestätigt **Sarah**, Modell
**eleven_v3**, **126** Providerzeichen, Nutzungsbeleg **complete** und
**114.565 Bytes** MP3. Chromium dekodiert die Datei zu **7,158 Sekunden** Audio
bei 44,1 kHz mit messbarem Signal. Hörprobe: `adi-v3-production.mp3` im Release;
Dekodierbeleg: `test-results/eleven-v3-production-decode.json`. Zusammen mit den
beiden Vorproben wurden drei kurze echte Synthesen erzeugt. Normale ADE-Starts
erzeugen keine automatische Sprachprobe; ein dauerhafter Versuchsmarker verhindert
auch eine Wiederholung der Aktivierungsprobe nach unklarer Quittung.

Die ersten Neustartversuche blieben vor dem Beenden am Windows-Tray stehen.
Der Helfer wählt jetzt sichtbare Button-/Menüelemente; sein UTF-8-BOM stellt die
deutschen Namen unter Windows PowerShell 5 korrekt dar. Anschliessend wurde der
vorhandene ADE-Beenden-Befehl erfolgreich verwendet. Kein erzwungenes Prozessende.
Die physische Samsung-Prüfung und Adis Hörabnahme der kurzen Aussprache bleiben offen.
