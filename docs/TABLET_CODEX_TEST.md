# Erster Codex-Test auf dem Tablet

Der Pilot verbindet den globalen ADE-Dialog mit bestätigten Codex-Aufträgen.
Der Host muss laufen, das Tablet gekoppelt sein und vollständige Projektfreigabe
sowie Schreibrechte haben. Für Diktat braucht es zusätzlich die Diktatfreigabe,
Mikrofonzugriff und den vorhandenen ElevenLabs-Zugang.

## Einsteigen

1. Auf dem Tablet die vorhandene private ADE-Adresse öffnen und neu laden:
   `https://number-cruncher.tailfc0b86.ts.net/`.
2. **ADE-Betreuung → Mit ADE sprechen** öffnen. Ein konfiguriertes natives
   Codex-Profil wählen und **Neues ADE-Gespräch** starten. Alte Gespräche behalten
   ihre damaligen Werkzeuge; sie erhalten die neuen Auftragsrechte nicht nachträglich.
3. Für den ersten Schreibtest ein isoliertes Testprojekt unter ADE-Betreuung auf
   **Koordinieren** stellen. Ein Projekt mit wichtigen offenen Änderungen erst
   später verwenden. Das Gespräch nach Änderungen der betreuten Projekte neu beginnen.

## Drei kleine Versuche

- **Gespräch und Übergabe:** „Bereite für mein Testprojekt eine Übergabe vor:
  Wir testen zuerst den Codex-Ablauf auf dem Tablet. Nächster Schritt ist ein
  kleiner Datei-Test.“ Die Karte **Übergabe prüfen** öffnen und **Übergabe
  speichern** wählen. In einem neuen Gespräch kann ADE die gespeicherte Notiz lesen.
- **Auftrag mit Rückfrage:** „Bereite einen Codex-Auftrag für mein Testprojekt vor:
  Frage mich zuerst, welcher Text in `tablet-test.txt` stehen soll. Warte auf meine
  Antwort, erstelle dann nur diese Datei und melde das Ergebnis. Keine Git-Befehle.“
  **Auftrag starten**, danach **Ergebnis und Rückfragen öffnen**. Die Frage dort
  beantworten. Nach Abschluss sollten Datei und angezeigtes Ergebnis zusammenpassen.
- **Wiederaufnahme:** Während oder nach dem Auftrag die Tablet-Seite neu laden.
  Dasselbe Gespräch und denselben Auftrag öffnen. Es darf kein zweiter Auftrag
  entstehen. Im Graph gehört der Run weiterhin zum richtigen Projekt.

Optional dieselben Nachrichten über **Nachricht diktieren** eingeben. Vorschau
prüfen, in die Nachricht übernehmen und **An ADE senden**. Diktieren alleine
sendet nichts und startet keinen Projektauftrag.

## Was dieser Pilot abdeckt

Text, Diktat, Übergaben, bestätigte Codex-Aufgaben, Rückfragen und Ergebnisse.
Das globale Gespräch hat selbst keinen Shell-/Dateisystemzugriff. Projektarbeit
läuft im vorhandenen ADE-Aufgabenweg; ein fertiger Einzelauftrag bedeutet keine
automatische Git-Integration oder Veröffentlichung. Gespräch schliessen beendet
keinen laufenden Auftrag. Weitere Aufträge brauchen eine neue ausdrückliche
Entscheidung. Andere CLIs, automatische Folgeschritte, Sprachausgabe im globalen
Gespräch und Aktivierung per Zuruf folgen separat.

Die bisherigen Prüfungen laufen unter nativem Windows und automatisiertem
Chromium. Mikrofon, Touch-Bedienung und Wiederaufnahme auf dem physischen Tablet
sind Adis abschliessender Praxistest. [Nachweise und Betriebsstand](TABLET_CODEX_GOAL.md).
