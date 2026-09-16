# Persönliches Antwort-Vorlesen aktiviert — 16. September 2026

## Aktiver Release

Der Operator autorisierte Commit, Build, Neustart und Push sowie das Beenden
der Tablet-Sitzung. Um 17:36 CEST wurde der persönliche ADE-Prozess
über die reguläre Tray-Aktion beendet und der geprüfte Release gestartet.

- Code-Commit: `e9e032dbbf9f2d0921f9baf9bb86be79441dffba` auf `codex/reply-speech`.
- Source-ID: `e876a22034d56525fe7b`.
- Release: `dist/reply-speech-e9e032d`.
- Persönlicher Prozess: PID **33884**, vorher **35028**.
- Startup-Beleg bestanden: 6 unveränderte Profile, 5 unveränderte
  Projekte, gewählte Stimme und 1 Gerätekopplung(en) erhalten.
- PC und ausgeliefertes Tablet-Bundle enthalten **Antwort anhören**,
  Stimmparameter mit Standardtempo **0.85**, Computer-Test, fünf Minuten
  Live-Diktat, Ollama-Auswahl/Logo und passive WSL-Erkennung.
- Die private HTTPS-Adresse lieferte HTTP 200 und das bytegleiche
  Release-Bundle: <https://number-cruncher.tailfc0b86.ts.net>.
- Der Windows-Startmenüeintrag ADE zeigt auf diesen Release.
- Sicherung: `C:\Users\Adi.Muff\ADE-Backups\ReplySpeech-20260916-173633`.

Der erste normale Neustart ersetzte PID 52412 durch PID 35028. Sein zusätzlicher
Startcheck erwartete ein sichtbares Ollama-Profilbild, obwohl die gespeicherte
Ansicht **Projekte** keine Profilbilder rendert. Der Startprüfer lädt und decodiert
jetzt das tatsächlich gebaute Logo unabhängig von der Ansicht. Nur der lokale
Startprüfer wurde korrigiert; die Produktionsbundles blieben bytegleich.
Der anschliessende normale Neustart und sämtliche Startprüfungen bestanden.
Erster Beleg: `test-results/reply-speech-restart-logo-failure.json`;
erste Sicherung: `C:\Users\Adi.Muff\ADE-Backups\ReplySpeech-20260916-173418`.

## Abnahme

Alle Prüfungen des `pnpm verify`-Rezepts bestanden am 16. September 2026 (17:08–17:33 CEST):
drei TypeScript-Projekte, 74 Suiten / 3.232 Fachprüfungen, Produktionsbuild
und sämtliche Electron-/Browser-/Layoutdriver. Die Vorlesefunktion besitzt
28 Text-/Dienstchecks, 20 Remote-Vertragschecks und 34 echte
Electron-/Chromium-Bedienprüfungen. Die zuvor fehlgeschlagenen Fokus- und
Touch-Abläufe sind korrigiert und in den positiven Prüfungen enthalten.
[Verträge, Grenzen und frühere Fehlernachweise](REPLY_SPEECH.md).

Der Sammelaufruf `pnpm verify` endete nach **Remote terminal Electron: 208/0**
beim nächsten Windows-Aufruf mit „Das System kann den angegebenen Pfad nicht
finden“ und Exit 1. Das ist kein grüner Einzelaufruf. Die sieben verbleibenden
Driver wurden danach exakt aus dem Paket-Rezept einzeln über `pnpm exec tsx`
ausgeführt und bestanden. Git-Commit und Source-ID blieben dabei unverändert;
der Produktionsbuild wurde zwischen den Abschnitten nicht neu erzeugt.

Belege im isolierten Checkout: `test-results/reply-verify.log`,
`reply-verify-exit.json`, `reply-verify-continuation.log/.json`,
`reply-source.json` und `reply-speech/results.json`.
Aktivierungsbelege im Hauptcheckout: `test-results/reply-speech-restart.json`,
`reply-speech-release-smoke.json` und
`dist/reply-speech-e9e032d/activation.json`.

Die Tests verwenden lokale CLI-/MP3-/Provider-Fixtures. Beim Deploy wurde
keine bezahlte ElevenLabs-Anfrage ausgelöst. Der physische Tablet-Lautsprecher
und persönliche Stimmklang werden anschliessend vom Operator live getestet.

## Parallele Arbeit und Hermes

Der Release stammt aus dem isolierten Branch. Die automatische Rückübernahme
in den Hauptcheckout wurde wegen paralleler Änderungen an
`src/mobile/RemoteTerminalPane.tsx` gestoppt; dessen Arbeitsstand wird nicht
überschrieben. Der veröffentlichte Feature-Branch enthält die vollständige
Implementierung. Vor dem Neustart waren keine aktiven
verwalteten ADE-Runs eingetragen. Der Neustart verwendet keine erzwungene
Prozessbeendigung und beendet keine fremden WSL-Prozesse.

Der Hermes-Gateway behielt PID 348, seinen Start um 14:03:38 CEST und
`NRestarts=0`; Vorher-/Nachherbelege liegen in
`test-results/reply-hermes-{before,after}.json`. Der bestehende temporäre
Ubuntu-Keepalive bleibt unverändert; kein neuer dauerhafter Autostart.

## Direkt testen

Tablet-Seite neu laden, interaktive Sitzung öffnen, neben **Prompt / Diktat**
auf **Antwort anhören** gehen. Unter **Text zum Vorlesen** die gewünschte
Antwort behalten, gegebenenfalls **Sprechtext prüfen**, dann **Anhören**.
Eine Markierung wird bevorzugt; ohne Markierung wird sichtbarer Text oder
der geöffnete Verlauf übernommen. ADE erkennt dabei nicht automatisch die
letzte Agentenantwort.

Der sitzungsunabhängige globale **Sprachsteuerung**-Button ist noch nicht
implementiert. [Vorschlag für den nächsten Ausbau](VOICE_COMPANION_PROPOSAL.md).
