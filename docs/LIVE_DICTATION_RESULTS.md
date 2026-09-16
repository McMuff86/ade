# Terminal sichtbar halten und Live-Diktat

Stand: 16. September 2026.

## Verhalten

- Desktop: „Prompt und Diktat“ öffnet im Terminalbereich rechts, bei höchstens
  760 px Bereichsbreite darunter. Es gibt keine Abdunklung und keine Fokusfalle.
  Das Terminal behält seinen Zustand und passt seine Spalten/Zeilen an.
- Fokus geht beim Öffnen in den Entwurf. „Zum Terminal“ kehrt in die Terminal-
  Eingabe zurück; Escape im Prompt schliesst und stellt den Fokus wieder her.
  Navigation zu anderen Sitzungen übernimmt den Fokus selbst.
- Während des Diktierens erscheinen ersetzbare Zwischenstände direkt im
  Textfeld. Nach Stoppen wird das bestätigte Transkript einmal angehängt und
  wieder bearbeitbar. Kein automatischer Versand an eine CLI.
- Bei einer unterbrochenen Verbindung bleibt der zuletzt gelesene Zwischenstand
  mit einem Hinweis auf mögliche Unvollständigkeit erhalten. Expliziter Abbruch
  verwirft die laufende Aufnahme und behält den vorherigen Entwurf.
- Tablet verwendet denselben Live-Pfad im bestehenden Prompt-/Diktat-Dialog.
  Zwischenstände erscheinen vor Stoppen; bestätigter Text bleibt vor dem Versand
  prüfbar. Nach Verbindungsverlust wird der letzte Zwischenstand gesichert.

## Umsetzung und Grenzen

AudioWorklet erzeugt mono PCM16 bei 16 kHz, Pakete alle 256 ms. Browser und Main
begrenzen auf 60 Sekunden; die Warteschlange und einzelne Pakete sind begrenzt.
Der Worklet wird als eigene lokale Datei unter der unveränderten CSP geladen.
Main holt ein einzelnes ElevenLabs-Token und öffnet eine WebSocket-Verbindung
für `scribe_v2_realtime`. Weder Token noch API-Key verlassen Main. Authentisierte
IPC-Aufrufe binden Start, geordnete Audiopakete und Stoppen an das vorbereitete
Aufnahmeticket. Vorschautext wird privat abgefragt und weder protokolliert noch
an Orchestrierungsansichten oder den Eventjournal weitergegeben.

Das Tablet überträgt signierte `stream-start`/`stream-chunk`/`stream-finish`-
Anfragen über `/api/v1/dictation/command`. Diktat- und Terminalfreigabe sowie
Gerät, Ziel und Eingabebesitz werden bei jedem Schritt geprüft. Paket-Schlüssel
sind an Ticket und Sequenz gebunden; identische Wiederholungen werden ohne
erneuten Audioversand quittiert. Nur Hashes bleiben befristet im Speicher.
235 reguläre Audiopakete füllen deshalb nicht den dauerhaften Aktionsspeicher.
Zwischenstände durchlaufen dieselbe Wire-Redaktion wie fertige Transkripte.

Manuelles Commit beim Stoppen bestätigt den letzten Text. Es gibt weder
automatische Wiederverbindung noch erneute Übertragung als vollständige
Batch-Aufnahme. Die angezeigte Latenz hängt von Netzwerk und Anbieter ab; es
wird kein bestimmter Echtzeitwert zugesichert. Referenzen:
[ElevenLabs-Protokoll](https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime),
[Zwischenstände und bestätigte Abschnitte](https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/event-reference).

Der Verbrauchsversuch wird vor dem Verbindungsaufbau dauerhaft erfasst. Die
anfänglich unbekannte Audiodauer wird beim Abschluss in demselben Datensatz
ergänzt. Unbekannte Dauer ist in der Oberfläche ausdrücklich unbekannt. Die
PCM-Dauer ist keine Aussage über Anbieterabrechnung, Verbindungslaufzeit,
Credits oder Preis. Abstürze behalten einen offenen Versuch mit unbekannter
Dauer; Transkripte und Audio werden nicht im Verbrauchsjournal gespeichert.

## Tablet-Erweiterung und Profilbilder (16. September 2026)

- `test-remote-dictation.ts`: 46 Prüfungen positiv, einschliesslich Live-Start/
  Stop, Paketwiederholung, falscher Reihenfolge, fremdem Gerät, entzogenen
  Freigaben, begrenztem Speicher und privaten Zwischenständen.
- Codex/OpenAI-, Claude- und Grok-Profilbilder sind lokal gebündelte SVGs.
  Eigene Fotos bleiben vorrangig. Desktop-Einstellungen, Profilkarten und
  Tablet-Vergrösserung sind geprüft: 15 Electron- und 21 Browserchecks positiv.
  Tablet-Bilder wurden mit zweifacher Pixeldichte aufgenommen und visuell geprüft.
  Nachweise: `test-results/profile-logos/` und `profile-logos-*.log`.
- `test-dictation-electron.ts`: 57 Prüfungen positiv, einschliesslich Live-Text
  vor Stoppen, genau einer Transkription, ausbleibendem automatischem
  CLI-Versand, Verbindungsabbruch mit erhaltenem Zwischenstand, erneutem
  Diktieren, Schliessen einer aktiven Aufnahme und positiver Schlussaufnahme.
  Nachweis: `test-results/tablet-live-dictation.log`, `dictation/tablet-live.png`.
- `test-dictation-jobs.ts`: 21 Prüfungen positiv. Abbruch wartet auf den
  Abschluss des Anbieterstreams, bevor eine neue Aufnahme vorbereitet wird.
- `pnpm verify` vollständig positiv (Exit 0): alle drei TypeScript-Projekte,
  72 fokussierte Suiten / 3.060 Checks, Produktionsbuild und alle folgenden
  Electron-/Browserprüfungen bis zu den 22 abschliessenden Visualchecks.
  Protokoll: `test-results/tablet-live-verify.log`. Die neuen Test-Mindestzahlen
  sind im Suite-Runner auf 46 Remote-Diktat- und 21 Diktat-Jobchecks angehoben.
- Physisches Tablet, persönliches Mikrofon und bezahlte Anbieterantworten sind
  damit nicht geprüft. Chromium-Tests verwenden echte Browseraufnahme mit
  simuliertem Mikrofon und kontrollierten ElevenLabs-Antworten.

## Aktivierte Lieferung

Codecommit **441f0ce**, danach erneut gebaut. Der neue Startordner
`dist/tablet-live-441f0ce` hat sourceId **1a4a914d76bc06f5fd83** und besteht eine
isolierte Electron-Startprobe. Am 16. September um 02:18 Uhr MESZ wurde die
persönliche Instanz über ihre Tray-Aktion sauber beendet und als PID **28356**
neu gestartet. Die Startprüfung bestätigt erhaltene sechs Profile, vier Projekte,
ein gekoppeltes Gerät, geladene Codex-/Claude-/Grok-Logos und HTTP 200 für die
Tablet-Seite. Startmenüeintrag aktualisiert; vorheriger Startordner und Backup
bleiben erhalten. Belege: `test-results/tablet-live-restart.json` und
`dist/tablet-live-441f0ce/activation.json`. Kein neuer Installer und kein Push.

## Vorherige Desktop-Nachweise (413c573)

- `test-live-dictation.ts`: 53 Vertragschecks bestanden, einschliesslich der
  unbekannten Live-Dauer in der Sitzungsansicht. Abschliessend erneut positiv
  mit Prüfung der konkreten Ablehnungsgründe und positiver Schlusskontrolle.
- `test-dictation-electron.ts`: 52 Checks bestanden. Echte Electron-Oberfläche,
  Chromium-Mikrofon und AudioWorklet, Promptvorschau vor Stoppen, bestätigter
  Text, ConPTY-Übergabe, Fokus/Tab/Escape, offene Terminalwerkzeuge und beide
  Dock-Anordnungen. Sitzungswechsel, Entwurfstrennung und Mikrofonfreigabe beim
  Schliessen während einer Aufnahme sind geprüft. Bestehender Tablet-Batch-Pfad
  ebenfalls positiv.
- Providerantworten sind deterministische lokale Fixtures. Keine bezahlte
  Inferenz, keine Messung mit dem persönlichen Mikrofon oder echten Konto.
- `pnpm verify` vollständig bestanden (Exit 0): alle drei TypeScript-Projekte,
  72 fokussierte Suiten / 3.036 Checks, Produktionsbuild und sämtliche folgenden
  Electron-/Browserprüfungen bis zu den 22 abschliessenden Visualchecks.
  TypeScript wurde nach den letzten Implementierungsänderungen zusätzlich
  erfolgreich ausgeführt. Protokoll: `test-results/prompt-live-verify.log`.
- Bilder: `test-results/dictation/desktop-dock-wide.png`, `desktop-live.png`
  und `desktop.png`.

Die Implementierungsphase hat persönliche Terminals unverändert gelassen.
Anschliessend beauftragte der Operator Sicherung und Aktivierung: gemeinsamer
Codecommit **413c573** auf `origin/main`, geprüfter Startordner
`dist/live-dictation-413c573`, sourceId `27bf304cecceca08c100`. Eine zusätzliche
isolierte Electron-Startprobe bestätigt Oberfläche und Registrierung des neuen
Live-Handlers (`test-results/live-release-smoke.json`). Kein neuer Installer.
Die neue Oberfläche benötigt auch einen Main-Neustart. Der persönliche Neustart
ist wegen der darin laufenden Unterhaltung als verzögerter letzter Schritt
vorbereitet; tatsächlichen Erfolg ausschliesslich anhand der Aktivierungsbelege
im [Handoff](HANDOFF.md) bestätigen. Ein Test mit persönlichem Mikrofon und echtem
ElevenLabs-Konto ist noch offen.
