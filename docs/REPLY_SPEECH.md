# Antworten auf PC und Tablet vorlesen

Stand 16. September 2026: implementiert; TypeScript, 28 Text-/Dienstprüfungen,
20 Remote-Vertragsprüfungen und 23 echte Electron-/Chromium-Bedienprüfungen
bestanden. Gesamtabnahme und persönliche Aktivierung folgen.

## Bedienung

1. In einer interaktiven Terminalsitzung **Antwort anhören** wählen. Auf dem
   Tablet steht der Button oben links in der Terminalanzeige, auch im **Verlauf**.
2. Eine vorhandene Textmarkierung wird übernommen, sonst der sichtbare Ausschnitt
   beziehungsweise der geöffnete Verlauf. Das ist keine automatische Erkennung
   der letzten Agentenantwort: Eingaben und Statusmeldungen können enthalten sein.
3. Unter **Text zum Vorlesen** nur die gewünschte Antwort behalten. Nach einer
   Änderung **Sprechtext prüfen** wählen. Die Terminalsitzung bleibt unverändert.
4. Den bereinigten **Sprechtext** prüfen, dann **Anhören**. Erst dieser Klick
   löst eine Sprachanfrage aus. **Stoppen** beendet Vorbereitung oder Wiedergabe.
   **Erneut abspielen** verwendet das bereits erzeugte Audio.

**Alles vorlesen** ist vorausgewählt. **Kurz vorlesen** übernimmt höchstens vier
vollständige Anfangssätze bis 900 Zeichen, keine KI-Zusammenfassung. Formatierung,
ANSI, bekannte Zugangsdaten, Hostpfade und umzäunte Codeblöcke werden entfernt.
Maximal 12.000 Quellzeichen und 6.000 gesprochene Zeichen; zu lange Texte werden
mit einer bearbeitbaren Fehlermeldung zurückgewiesen. Eine lange erste Aussage
wird nicht mitten im Satz gekürzt. Der Dialog zeigt den tatsächlich gesendeten Text.

Die Sitzung verwendet die wirksame Agent-/Projekt-/Standardstimme und die global
gespeicherten ElevenLabs-Parameter aus **Einstellungen → Stimme**. Das Standardtempo
bleibt 0.85. Die bestehende Sprachkonfiguration genügt. Der Verbrauch erscheint
getrennt als Antwort-Vorlesen; Preise bleiben ohne hinterlegte Daten unbekannt.

## Grenzen und Lebenszyklus

- Gemeinsamer nativer Dialog auf Desktop und Web: Überschrift erhält Fokus,
  Tab bleibt im Dialog, Escape schliesst ihn und stellt den Auslöser wieder her.
  Ein darunter geöffneter Tablet-Verlauf und Projektdialog bleiben erhalten.
- Schliessen, verstecktes Dokument, verlorene Verbindung oder Sitzungswechsel
  stoppen lokale Wiedergabe und verwerfen den Dialog. Kein Mikrofon erforderlich.
- Vorbereitung ist lokal auf dem Host. Maximal acht offene Antworten, zehn Minuten
  Gültigkeit, maximal 2 MiB MP3 pro Antwort. Text und Audio bleiben im Arbeitsspeicher;
  Browser-Speicher und dauerhafte Befehlsbelege erhalten beides nicht.
- Pro vorbereiteter Antwort gibt es genau einen Syntheseversuch. Wiederholte
  Anfragen verwenden dessen Ergebnis, auch bei Fehlern. Für einen neuen Versuch
  nach einem Providerfehler den Dialog neu öffnen. Ein Abbruch nach Versand kann
  beim Anbieter bereits Verbrauch ausgelöst haben; ADE zählt ihn als unbestätigt.
- Stoppen während der Vorbereitung verwirft deren Beleg und ermöglicht erneutes
  Prüfen. Der Host bricht laufende Anfragen ab und wartet beim Beenden auf ihre
  Verbrauchsbuchung, auch wenn der Dialog zuvor geschlossen wurde.

## Verträge

`src/shared/terminalSpeech.ts` definiert strikte `prepare/speak/read/cancel`-DTOs.
Desktop: `speech:reply`, als desktop-only Host-Effekt klassifiziert. Das Fenster
und die ausgewählte interaktive Sitzung werden vor Vorbereitung und Ausgabe
geprüft; verwaltete oder gesperrte Sitzungen sind ausgeschlossen.

Tablet: `POST /api/v1/terminal/speech` über `AdeApplicationService.terminalSpeech`.
Jede Operation benötigt Gerätesignatur, aktive `speech:control`- und
`terminal:control`-Freigaben und Zugriff auf die konkrete Workspace-Sitzung.
Vorlesen benötigt keinen Tastatureingabe-Lease. `prepare/speak/cancel` laufen über
den bestehenden Befehlsledger mit einem an Kanal und Payload gebundenen
Idempotency-Key und Audit. `read` ist ein autorisierter Lesezugriff ohne
Mutationsschlüssel. Belege enthalten nur IDs; Text/Audio kommen im expliziten
Leseergebnis. Die generische Remote-Kanalliste bleibt unverändert.

`ReplySpeechService` bindet Antworten an Fenster beziehungsweise Gerät und
erneuert keine abgelaufenen Belege. Fremde Reads/Synthesen schlagen fehl; fremde
Abbrüche ändern nichts. Widerruf, beendete Remote-Sitzung und geänderte Auswahlrechte
werden erneut geprüft. Alle Wire-Fehler durchlaufen die vorhandene Redaktion.

## Nachweise

- `pnpm test:reply-speech`: 28 Dienst-/Textprüfungen, 20 Remote-Prüfungen.
- `pnpm test:reply-speech-electron`: 23 Prüfungen mit echter nativer Windows-PTY,
  Electron-Renderer, gekoppeltem Chromium-Browser und signierter HTTPS-Kommunikation.
- Audio-Decodierung, Vorschau ohne Synthese, gespeichertes Tempo, Wiederholung,
  Abbruch, Providerfehler, Code-only-Fehler, Fokus, Verlaufmarkierung, Telefonlayout,
  Berechtigungen und speicherfreie Text-/Audio-Belege werden ausgeführt.
- Lokale Testantworten und MP3-Fixture ersetzen CLI-Modell und ElevenLabs. Keine
  bezahlten Provideranfragen. Physischer Tablet-Lautsprecher und persönlicher
  Stimmklang benötigen den anschliessenden Live-Test durch den Operator.
- Nachweise: `test-results/reply-speech/results.json`, Desktop-/Tablet-/Phone-PNGs
  und `test-results/reply-{focused,remote,ui,typecheck}.log` im isolierten Checkout.

Der globale Einstieg **Sprachsteuerung** ist als nächster eigenständiger Ablauf
beschrieben in [Sprachdialog-Vorschlag](VOICE_COMPANION_PROPOSAL.md).
