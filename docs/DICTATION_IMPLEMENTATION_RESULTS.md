# Diktat und Promptübergabe: Implementierungsstand

15. September 2026. Fortsetzung nach der CLI-/Latenz-Lieferung. Diese Module
sind an Desktop und Mobile angebunden; die laufende persönliche ADE-Instanz
bietet den neuen Ablauf noch nicht an. [Verbindlicher Auftrag](CLI_WORK_AND_DICTATION_GOALS.md).

## Implementierte Verträge

- PC und Tablet verwenden denselben Recorder und Prompteditor. Aufnahmen
  beginnen ausdrücklich, stoppen spätestens nach 60 Sekunden und werden im
  Browser in ein festes Mono-PCM/WAV-Format mit 16 kHz umgerechnet. Main prüft
  Format und tatsächliche Dauer aus den Bytes. Keine beliebigen URLs/Codecs
  und keine vom Client behauptete Abrechnungsdauer.
- Hostseitig vorbereitete Aufnahme-Tickets verhindern eine neue bezahlte
  Anfrage durch Wiederholung nach Ticketablauf oder Hostneustart. Audio-
  Übernahme ist innerhalb eines Tickets an Versand-ID und Digest gebunden.
  Höchstens 16 Tickets/Transkripte bleiben vorübergehend im Speicher; keine
  Rohaufnahmen auf Platte. Widerruf und Abbruch verwerfen späte Ergebnisse.
- ElevenLabs erhält einen begrenzten Scribe-v2-Auftrag. Antworten und Texte
  sind begrenzt; Anbieterfehler und Terminal-Steuerzeichen gelangen nicht in
  den Entwurf. Persönlicher STT-Zugriff wurde mit dem unten beschriebenen
  begrenzten echten Scribe-v2-Aufruf bestätigt.
- Der Entwurf bleibt an sein Sitzungsziel gebunden. Bis zu 16 lokale Entwürfe
  werden ohne automatische Verdrängung vorhandener Texte gespeichert.
  Aufnahme-Ticket und unbestätigte Übergabe bleiben nach Reload erkennbar.
  Ein Versand benötigt zuvor eine erfolgreiche lokale Speicherung.
- Einfügen und Absenden verwenden getrennte Semantik mit umschlossenem
  mehrzeiligem Paste und genau einem abschliessenden Enter beim Absenden.
  Dieses Enter folgt nach 500 ms, mit erneuter Ziel-/Besitzprüfung und
  gesperrter paralleler Eingabe in derselben PTY. Andere Sitzungen bleiben frei.
  Der Transport benötigt eine geschützte CLI-Invocation und aktuell aktivierte
  Paste-Unterstützung. Eine übrig bleibende Shell ist kein gültiges Promptziel.

Main prüft Eingabebesitz, Prozessende, Workspace-Zuordnung und den tatsächlichen
Paste-Modus. Neu gestartete native Windows-Codex/Claude/Grok-Sitzungen beenden
ihre aufrufende PowerShell mit der CLI. WSL, Custom und Assistenten behalten
ihre bisherigen Startwege und sind keine freigegebenen strukturierten Promptziele.
Desktop-IPC, eigener authentisierter Mobile-Upload und die separate Gerätefreigabe
`dictation:transcribe` sind angebunden. Die tatsächlichen CLI-Eingabezustände
bleiben Verantwortung der CLI: Anmeldung und Projektvertrauen zuerst im Terminal
abschliessen. Aktiviertes Paste-Protokoll beweist keinen offenen Prompteditor.

## Bisherige lokale Nachweise

| Prüfung | Ergebnis |
|---|---|
| `test-dictation.ts` | 35 Checks: PCM-Grenzen, fester Providervertrag, fehlerhafte Antworten, Widerruf, Abbruch, Konkurrenz und positive Schlusskontrolle |
| `test-dictation-jobs.ts` | 18 Checks: Eigentümer, unveränderliche Aufnahme, Replay, Ablauf, Widerruf, späte Antwort, begrenzter Speicher |
| `test-terminal-prompt.ts` | 28 Checks: Einfügen/Absenden, Doppelversand, verlorener Besitz auch zwischen Paste und Enter, unabhängige andere PTY, unklarer Ausgang, echte Windows-Shell beendet sich ohne Ausführen nachlaufender Eingabe |
| `test-microphone-access.ts` | 15 Checks: ausdrückliche Fensterfreigabe, Ablauf, Unterframes, Kamera, fremde Fenster und URLs |
| `test-prompt-drafts.ts` | 16 Checks: getrennte Ziele, Reload, unbestätigte Übergabe, Speicherausfall, Kapazitätsgrenze und beschädigte Originaldaten |
| `test-remote-dictation.ts` | 24 Checks: eigene Freigabe, Geräte-/Leasebindung, einmalige Verarbeitung, private/redigierte Ergebnisse, signierter HTTP-Upload, unveränderte normale Grössenbegrenzung, Übernahme am PC |
| `test-dictation-electron.ts` | 21 Checks: Electron-Mikrofon/MediaRecorder/Audio-Decode, Tablet-Aufnahme in vollständigem Chromium über lokale HTTPS-Verbindung, echtes ConPTY, verlorene Versandantwort, erhaltener Entwurf, Fokus und kleiner Viewport; Provider als begrenztes Fixture |
| `test-terminal-display.ts` | 36 Checks; ergänzt um tatsächlichen Paste-Modus und Ablehnung bei noch nicht verarbeiteter Ausgabe |
| Workspace-CLI-Regression | 73 Checks nach Anpassung an die neue native CLI-Lebensdauer; originale Projekte, Branches, Profile, Work/Overview und Navigation |
| Projektstart-Regression | 28 Checks; der Codex-Start bleibt getrennt vom ausdrücklich geöffneten Shell-Tab für den inerten Dateischreibtest |
| Assistenten-Regression | 58 Checks mit lokalem TUI-Fixture; Hermes-/Sentinel-Aufruf, Dashboard, CLI-Ende, Wiederöffnung und Schliessen bleiben erhalten |
| Vollständige Remote-Terminal-Regression | 204 Checks; zusätzlich Projektverzeichnis, eigene Terminals, Workspace-Zuweisung, Kategorien und Integration |
| `pnpm test` | Alle 64 fokussierten Suiten / 2.786 Checks; Bestandteil der neuen Gesamtprüfung |
| Gepacktes Windows-Programm | 10 Checks: Sandbox, echtes ConPTY, originale Arbeitskopie, Work/Overview und Rückkehr, Entwurfserhalt/Fokus, keine Promptübergabe an eine Shell |

Diese automatisierten Suiten enthalten keine bezahlte Provider-Inferenz und keine
physische Tablet-Aufnahme. Die neue Gesamtprüfung `pnpm verify` ist vollständig
bestanden: **3.735 Checks** = **2.786** in 64 fokussierten Suiten plus **949**
Electron-/Browser-/Visual-Checks. Alle drei TypeScript-Projekte und der
Produktionsbuild bestehen; Prozess-Exit 0. Log:
`test-results/dictation-verify-final.log`. Der erweiterte Paketdriver wurde
zusätzlich mit dem Scripts-TypeScript-Projekt geprüft.

Frühere Gesamtläufe trafen auf überholte Fixture-Annahmen, dass native Coding-
CLIs nach ihrem Ende eine Shell offen lassen. Die Start-/Wiederaufnahmeprüfungen
erwarten nun das tatsächliche Terminalende und öffnen für explizite Shellproben
einen eigenen Tab. Ein Rennen zwischen alter Polling-Fehlermeldung und bewusstem
Terminalwechsel wurde im Mobile-Client korrigiert. Der abschliessende vollständige
Gesamtlauf besteht nach diesen Korrekturen.

Die wiederholte lokale Latenzreihe am 15. September, 02:09 UTC, misst für
100 Einzelzeichen im nativen Raw-Key-CLI-Fixture **p50 93 ms / p95 108 ms**.
Die Shellprobe liegt bei **109 / 140 ms**. Messung: Chromium-Tastaturereignis
über lokales HTTPS bis bestätigte Ausgabe plus zwei Animationsframes; kein
optimistisches Echo und keine Aussage über physisches Tablet oder WAN.

Windows-Paket vom 15. September, 02:00 UTC:
`dist/dictation-20260915/win-unpacked/ADE.exe`, SHA-256
`20178612c4f46f33ea92364b02ace8bd858da12d265aea494819104da4e68544`.
Gebaut mit `electron-builder --win --x64 --dir --publish never` aus dem neuen
Produktionsbuild. Der Smoke-Driver `scripts/test-cli-work-package.ts` verwendet
ein isoliertes Profil und einen temporären Git-Ordner. Persönliche Daten und
laufende Sitzungen werden dabei nicht benutzt. Metadaten enthalten ausdrücklich
`sourceDirty: true`, weil der Sprachstand beim Pakettest noch nicht committet war.
Die persönliche ADE-Instanz wird nicht durch diesen Pakettest aktualisiert.

## Begrenzter echter Anbieteraufruf

Am 15. September um 01:06:30 UTC lieferte der echte ElevenLabs-Endpunkt ein
deutsches Transkript mit `scribe_v2`, Sprache `deu` und 72 Zeichen. Quelle war
ein lokal mit Windows-Sprachausgabe erzeugter Testsatz von **5,98 Sekunden**:
„Bitte antworte nur mit ADE Sprachtest erfolgreich. Ändere keine Dateien.“
Die erwartete Erfolgsformulierung und die Anweisung, keine Dateien zu ändern,
wurden erkannt. Keine echte Benutzeraufnahme und kein Repositoryinhalt wurden
gesendet. Der verschlüsselte persönliche Key wurde nur im Electron-Main-Prozess
gelesen. Zuvor abgebrochene Leseproben hatten den Provider noch nicht kontaktiert.

Die Antwort enthält keinen nachgewiesenen Einzelpreis. Die Probe dokumentiert
ihn als unbekannt; der Produktvertrag leitet daraus keine Kostenzahl ab.
Lokale Metadaten: `test-results/dictation/operator-provider.json`.
Dieser Nachweis bestätigt STT-Zugriff und den Providervertrag; physisches
Tablet-Mikrofon, WAN-Latenz und Anbieterabrechnung benötigen eigene Nachweise.

## Echte native CLI-Übergabe

Separat zur Fixture-Suite wurden die installierten Windows-CLIs in einem jeweils
isolierten temporären Git-Repository durch ADE gestartet. Eingabe war ein kurzer
deutscher Auftrag mit ausdrücklichem Verbot von Tools und Dateiänderungen.
Anschliessend wurden Terminalanzeige und Git-Status geprüft:

| CLI | Beobachtung am 15. September (UTC) |
|---|---|
| Codex 0.154.0 | Nach Projektvertrauen liefert die Übergabe um 01:22:51 `ADE_PROBE_OK` als Antwort; ausgewähltes Modell laut CLI: gpt-6-astra / xhigh |
| Claude Code 2.1.270 | Nach ausdrücklicher Auswahl des vertrauenswürdigen Testordners liefert die Übergabe um 01:26:13 `ADE_PROBE_OK` als Antwort |
| Grok 1.0.13 | Übergabe um 01:24:51 liefert `ADE_PROBE_OK` als Antwort und kehrt zum CLI-Prompt zurück |

Alle drei Test-Repositories blieben sauber. Die CLIs verwendeten ihre bestehende
persönliche Anmeldung; Profil- und Login-Einstellungen wurden vom Test nicht
umgeschrieben. Nur die isolierten Testprozesse wurden anschliessend geschlossen.
Lokale Bildschirm-/Metadatenbelege liegen unter `test-results/dictation/operator-*`.

Ein negativer Codex-Test mit Paste und Enter im selben Schreibvorgang fügte den
Auftrag ein, sandte ihn aber nicht ab. Die Korrektur trennt beide Schritte um
500 ms. Der [Codex-Quellstand 0.154.0](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/tui/src/bottom_pane/paste_burst.rs)
bestätigt ein 120-ms-Fenster, in dem Enter nach schneller Eingabe als Zeilenumbruch
behandelt wird. Die anschliessende positive Probe oben prüft die Korrektur im
echten Programm. Eine weitere Startprobe traf auf den Vertrauensdialog statt auf
den Prompt: Der Editor erläutert deshalb die notwendige Erstfreigabe direkt in
der CLI. ADE beantwortet solche Dialoge nicht automatisch für den Benutzer.

Der [ElevenLabs-Endpunkt](https://elevenlabs.io/docs/api-reference/speech-to-text/convert)
verwendet Multipart-Audio und ein explizites Transkriptionsmodell. Die lokale
Löschung ist getrennt von dessen Aufbewahrung: Die Option `enable_logging=false`
ist laut Anbieter auf Enterprise begrenzt. ADE verspricht deshalb keine
allgemeine Speicherungslosigkeit beim Anbieter.
