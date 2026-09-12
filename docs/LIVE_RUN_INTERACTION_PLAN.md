# Live-Aktivität und Rückfragen während eines Runs

Stand: 12. September 2026. A3 implementiert; native Windows-Gesamtabnahme und
persönlicher ADE-Neustart bestanden: [Ergebnisse](TABLET_WORKSPACE_RESULTS.md).

Der Benutzer möchte im Graph verfolgen, welche Befehle, Dateien und Werkzeuge
ein Agent verwendet, und dessen Rückfragen während der Arbeit beantworten.
Zieloberflächen sind Desktop und Mobile. Bestehende Profile und Modellwahl bleiben
massgeblich. Laufzeitunterstützung wird pro Adapter nachgewiesen.

## Ausgangspunkt

- Desktop: Graph → Agent auswählen → **Live zuschauen** zeigt den strukturierten
  Feed; im Aufgabenfenster ist zusätzlich die rohe Ausgabe lesbar.
- Mobile: Run/Agent → **Aktivität** zeigt begrenzte Prozessbeobachtungen.
- Codex läuft bisher als `codex exec --json`. ADE kürzt Werkzeugmeldungen und
  kennt keine beantwortbaren Agent-Fragen. Integrationsfreigaben sind separat.
- Der Feed verschluckt Lesefehler und kann beim Übergang von Snapshot zu Live
  Zeilen doppelt zeigen. Werkzeugbeginn und Werkzeugabschluss sind nicht getrennt.

## Abnahme

1. Live-Aktivität zeigt gemeldete Aktionen, Beginn/Ergebnis, Zeit und begrenzte
   Details. Lade-, Leer-, Fehler- und Wiederholungszustände sind unterscheidbar.
   Historie und Live-Übergang verlieren oder duplizieren keine erfassten Aktionen.
2. Neue Codex-Runs können einen bidirektionalen App-Server-Transport verwenden.
   Die bestehende Einmal-Ausführung und historischen Goal-6-Fixtures bleiben
   nachvollziehbar. Modell, Reasoning, Workspace und Berechtigungsmodus werden
   ausdrücklich übernommen; unbekannte Protokollzustände dürfen keinen Erfolg
   vortäuschen.
3. Fragen erscheinen mit Run/Agent-Bezug, Auswahl/Freitext und explizitem Senden.
   Nur eine Antwort erreicht die zugehörige offene Anfrage. Abbruch, verspätete
   Antworten, Prozessverlust und Neustart müssen wahrheitsgemäss dargestellt
   werden. Eine vorbelegte Auswahl ist keine Antwort.
4. Desktop und Mobile verwenden denselben Hauptprozess-Dienst. Remote-Antworten
   brauchen Geräteidentität, Signatur, `runs:write`, Idempotenz und Audit.
   Texte erscheinen nur in gezielten Detailansichten; keine Frage-/Antworttexte
   oder absoluten Hostpfade im allgemeinen Journal/Wire-Summary.
5. Fragen werden mit der Aufgabe archiviert und entfernt. Wiederaufnahme nach
   Prozessverlust wird erst behauptet, wenn sie ausführbar nachgewiesen ist.
6. Fokussierte Protokoll-/Persistenz-/Sicherheitsprüfungen, echte Electron- und
   Browserabläufe, Tastatur/Fokus, schmale Ansichten und vollständiges `pnpm verify`.
   Fixtures ersetzen weder echte Modellinferenz noch die physische Tablet-Abnahme.

## Protokollgrundlage

Die lokal installierte Codex CLI 0.154.0 erzeugt Schemata für
`item/tool/requestUserInput`, `serverRequest/resolved`, Werkzeugereignisse und
Antworten über stdio. `default_mode_request_user_input` ist als experimentelle
Funktion vorhanden. Das belegt die Schnittstelle, noch keinen ADE-Produktablauf.
Lokaler Schema-Snapshot: `test-results/codex-protocol-0154`.
[Offizielle App-Server-Dokumentation](https://learn.chatgpt.com/docs/app-server).

## Einrichtungsbefund

Die am Abend gestartete ADE-Instanz protokollierte `EADDRINUSE` für Port 4317.
Bei der späteren Prüfung war dort kein Listener erreichbar; ein begrenzter
Bind-/Close-Test bestätigte wieder einen freien Port. Keine aktiven Runs/Tasks
oder Terminal-Kindprozesse beim Prüfen. Die dokumentierte Release-Instanz vom
Morgen ist daher historische Evidenz, keine aktuelle Erreichbarkeitsbestätigung.

## Stand

Native Codex-Aufgaben und neue Graph-Runs können `allowQuestions` aktivieren.
ADE verwendet dann einen App-Server-Thread mit stdio, Modell und Reasoning aus
dem Agentenprofil und aktivierter `default_mode_request_user_input`. Die Antwort
wird erst nach `serverRequest/resolved` als beantwortet gespeichert. Unbekannte
Server-Interaktionen, fehlende Bestätigung und Prozessverlust beenden den
Transport kontrolliert. Eine alte Frage startet keinen neuen Prozess.

Desktop zeigt offene Fragen im Run-Bericht und einen direkten Rückfragenknopf
im Graph. Mobile zeigt denselben Fragenbereich im ausgewählten Run. Formulartexte
bleiben im Fenster; ADE speichert einen Antwort-Digest für Wiederholungen. Der
Agent kann eine Antwort in seinem Ergebnis wiedergeben. Blockierende Fragen
pausieren das verbleibende Aufgaben-Zeitbudget. Abbruch und Neustart lassen offene
Fragen ablaufen. Die allgemeine OrchestrationView enthält nur Anzahlen.

Live-Aktivität unterscheidet Werkzeugstart/-abschluss und Exitcode, besitzt
Zeitstempel und Sequenzen. Snapshot und Livestream werden ohne doppelte Sequenzen
zusammengeführt. Mobile zeigt bereinigte Zugriffstypen und relative Dateipfade aus
strukturierten Codex-Metadaten. Rohe Reasoning-Inhalte werden nicht übernommen;
öffentliche Zusammenfassungen und Agentenausgaben bleiben begrenzt. Die
vollständige Abschlussantwort steht im Ergebnisbereich.

Gemessen: 26 deterministische Protokoll-/Domain-Prüfungen; installierte Codex CLI
0.154.0, native Windows, gpt-5.6-sol/high: 5 Prüfungen einschliesslich Rückfrage,
Bestätigung und gespeichertem strukturiertem Ergebnis. `test-mobile-electron`
besteht mit 29 Prüfungen, davon 7 neue Rückfragenabläufe; dieser UI-Test verwendet
einen kontrollierten Codex-Protokollprozess. Logs: `test-results/run-questions.log`,
`native-codex-questions.log`, `tablet-sharing-questions-electron.log`.
WSL-/Linux-/macOS-Rückfragen und physisches Samsung sind damit nicht nachgewiesen.
Vollständiges `pnpm verify` bestanden: 2.770 Prüfungen, Exit 0.
