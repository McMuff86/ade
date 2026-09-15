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
- Tablet verwendet weiterhin den bestehenden Batch-Pfad. Die neue Desktop-
  Funktion behauptet keine Live-Unterstützung auf Tablet, Linux oder macOS.

## Umsetzung und Grenzen

AudioWorklet erzeugt mono PCM16 bei 16 kHz, Pakete alle 256 ms. Browser und Main
begrenzen auf 60 Sekunden; die Warteschlange und einzelne Pakete sind begrenzt.
Der Worklet wird als eigene lokale Datei unter der unveränderten CSP geladen.
Main holt ein einzelnes ElevenLabs-Token und öffnet eine WebSocket-Verbindung
für `scribe_v2_realtime`. Weder Token noch API-Key verlassen Main. Authentisierte
IPC-Aufrufe binden Start, geordnete Audiopakete und Stoppen an das vorbereitete
Aufnahmeticket. Vorschautext wird privat abgefragt und weder protokolliert noch
an Orchestrierungsansichten oder den Eventjournal weitergegeben.

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

## Nachweise

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

Kein Paket, Commit, Push oder Neustart der persönlichen ADE-Instanz. Die neue
Oberfläche benötigt einen Neustart mit dem neuen Build, weil auch Main neue
IPC-Handler bereitstellt; offene Terminals wurden für die Implementierung
nicht beendet. Ein Test mit persönlichem Mikrofon und echtem ElevenLabs-Konto
ist noch offen.
