# Erster Codex-Test auf dem Tablet

Der Pilot verbindet den globalen ADE-Dialog mit bestätigten Codex-Aufträgen.
Der Host muss laufen, das Tablet gekoppelt sein und vollständige Projektfreigabe
sowie Schreibrechte haben. Für Diktat braucht es zusätzlich die Diktatfreigabe,
Mikrofonzugriff und den vorhandenen ElevenLabs-Zugang.

Der erste Codex-Pilot wurde am 17. September 2026, 22:20 CEST aktiviert.
Der jeweils aktuelle Build-/Neustartnachweis steht in [HANDOFF](HANDOFF.md).
Ein zusammenhängender automatisierter Durchlauf mit echter Codex-CLI besteht
seit 18. September **16/0**, einschliesslich Rückfrage, Verbindungswechsel,
Dateiergebnis und Wiederaufnahme nach abgeschlossenem Auftrag und Host-Neustart.
[Umfang und Grenzen](TABLET_CODEX_NATIVE_RESULTS.md). Der folgende Ablauf ist
weiterhin für die zusätzliche Bedienabnahme auf dem physischen Samsung gedacht.
**ADE-Tablet-Test**, der Modus **Koordinieren** und ein frisches Gespräch mit dem
vorhandenen Codex-Profil sind bereits vorbereitet.

## Einsteigen

Vor dem nächsten Codex-Auftrag zuerst den korrigierten Shell-Alltag prüfen:
Projekt `rhino-compute-platform` öffnen, Shell starten und `git status` langsam
tippen. Text und Cursor müssen bereits vor Enter zusammenpassen. Mit offener
Tastatur „Workspace-Info“ öffnen/schliessen und „Shell beenden“ zunächst abbrechen,
danach bestätigen. Dieser Gerätedurchlauf ist noch kein automatisierter Nachweis.

Danach die neue Sprachausgabe kurz probehören: In Einstellungen → Stimme steht
Sarah mit Eleven v3. „Stimme testen“ prüft die Aussprache von Adi mit kurzem A
(eine bewusste neue Synthese verwendet Guthaben). Die bereits erzeugte Probe
`dist/eleven-v3-5f58bdaefddb8640de7b/adi-v3-production.mp3` kann am PC ohne
weiteren Provideraufruf abgespielt werden. Gewünschte Betonung noch offen;
[technische Abnahme und Betriebsstand](ELEVEN_V3_RESULTS.md).

1. Auf dem Tablet die vorhandene private ADE-Adresse öffnen und neu laden:
   `https://number-cruncher.tailfc0b86.ts.net/`.
2. **ADE-Betreuung → Mit ADE sprechen** öffnen und das vorbereitete Codex-Gespräch
   wählen. Alternativ mit dem Codex-Profil **Neues ADE-Gespräch** starten.
   Alte Gespräche behalten ihre damaligen Werkzeuge.
3. In den ersten Aufträgen ausdrücklich **ADE-Tablet-Test** nennen. Das Projekt
   ist bereits auf **Koordinieren** gestellt. Bei späteren Änderungen der betreuten
   Projekte ein neues Gespräch beginnen.

## Drei kleine Versuche

- **Gespräch und Übergabe:** „Bereite für ADE-Tablet-Test eine Übergabe vor:
  Wir testen zuerst den Codex-Ablauf auf dem Tablet. Nächster Schritt ist ein
  kleiner Datei-Test.“ Die Karte **Übergabe prüfen** öffnen und **Übergabe
  speichern** wählen. In einem neuen Gespräch kann ADE die gespeicherte Notiz lesen.
- **Auftrag mit Rückfrage:** „Bereite einen Codex-Auftrag für ADE-Tablet-Test vor:
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
