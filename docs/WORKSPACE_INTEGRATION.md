# Ältere Workspace-Änderungen geprüft übernehmen

## Bedienung

Desktop: **Repository synchronisieren → Änderungen übernehmen…**.
Mobile: **Verwalten → Git-Abgleich → Projekt → Änderungen übernehmen…**.

1. Den alten Quell-Workspace wählen und **Änderungen prüfen** anklicken. ADE
   findet erreichbare Git-Worktrees desselben registrierten nativen Projekts,
   auch ausserhalb der Agent-Zuordnungen. Ziel ist der aktuell ausgecheckte
   Branch des Hauptrepositories; Ziel- und Quell-Commit werden angezeigt.
2. Gewünschte Dateien auswählen. **Vergleich** zeigt gemeinsame Basis,
   aktuellen Quellinhalt und Zielinhalt. Identische oder gegenüber der Basis
   unveränderte Dateien sind nicht auswählbar. Anweisungs-/Memory-Dateien wie
   `AGENTS.md` und `CLAUDE.md` bleiben standardmässig abgewählt.
3. **Auswahl sichern und Arbeitskopie vorbereiten** erzeugt eine Sicherung
   ausschliesslich dieser Änderung und einen neuen `ade/integration-…`-Branch
   auf dem Zielstand. Der alte Workspace samt Index und lokalen Dateien bleibt
   erhalten. Eine Drei-Wege-Zusammenführung bewahrt neuere Zieländerungen;
   beidseitige Änderungen können Konflikte verursachen.
4. **Arbeitskopie öffnen** führt zum vorhandenen Projektbereich mit Terminal,
   Datei-Editor und Git. Konflikte dort bearbeiten und als aufgelöst markieren.
   Danach den Bericht unter **Gespeicherte Übernahmen** wieder öffnen.
5. Terminals dieser Arbeitskopie beenden und **Projektprüfungen starten**.
   Ausgabe und Ergebnis jedes Prüfskripts bleiben im Bericht erhalten. Bei
   Node-Projekten nutzt ADE `pnpm run verify`, ersatzweise `pnpm run test`.
   Für RhinoLayoutTools erkennt ADE die vorhandenen Python-/Katalog-/Kit- und
   Werkzeugprüfungen. Fehlende Abhängigkeiten im Terminal installieren und
   Prüfungen erneut starten. Ein nicht erkanntes Projekt benötigt ein
   unterstütztes Prüfskript, bevor ADE die Übernahme freigibt.
6. Fachliche und gegebenenfalls manuelle Prüfungen durchführen. Bei Rhino sind
   Dialog- und Platzierungsprüfungen in Rhino zusätzlich erforderlich; ein
   erfolgreiches Python-Skript beweist keine funktionierende Rhino-Oberfläche.
   Commit-Nachricht eingeben, die Bestätigung aktivieren und
   **Geprüften Stand übernehmen** anklicken.

ADE committet den geprüften Dateibaum und aktualisiert den sauberen Hauptworkspace
per Fast-forward. Der ursprüngliche Workspace und die Sicherung bleiben erhalten.
Veröffentlichung erfolgt anschliessend ausdrücklich im Projektbereich; die
Übernahme selbst pusht nicht. Wenn Quelle, Ziel oder geprüfte Dateien inzwischen
geändert wurden, muss erneut geprüft beziehungsweise eine neue Übernahme
vorbereitet werden. Ein bereits erstellter Review-Commit bleibt bei einer
fehlgeschlagenen Zielaktualisierung zur Prüfung erhalten.

Auf Mobile benötigen Übernahmen Workspace-Leserechte, Git-Verwaltungsrechte
(`repositories:write`) und Zugriff auf alle Projekte. Teststarts benötigen
zusätzlich Terminal-Steuerung. Datei-/Git-Bearbeitung der Arbeitskopie nutzt die
bestehenden separaten Projekt- und Dateifreigaben. Diese Rechte gelten für den
ADE-Rechner und dessen Benutzerkonto.

## Grenzen und Wiederaufnahme

- Höchstens 200 geänderte Dateien, je Datei 2 MiB und insgesamt 16 MiB Quellinhalt.
  Textvergleiche zeigen höchstens 16 KiB je Version. Binärdateien haben keine
  Textvorschau. Links, Submodule und Git-Inhaltsfilter benötigen manuelle Prüfung.
- Vorschauen sind fünf Minuten gültig und an ihren Desktop-/Geräteinhaber
  gebunden. Die Quelle enthält den aktuellen Arbeitsdateiinhalt; eine nur
  vorgemerkte, bereits wieder überschriebene Zwischenversion wird nicht gewählt.
- Laufende verwaltete Aufträge oder Terminals in Quelle/Ziel/Arbeitskopie
  blockieren die zugehörigen Git-Aktionen. Während Projektprüfungen verhindert
  ADE weitere Git-Mutationen; Dateiveränderungen entwerten den Testnachweis.
- Bis zu 50 Übernahmeberichte bleiben im ADE-Profil. Sicherungs-Refs,
  Integrations-Branches und Worktrees werden nicht automatisch gelöscht.
  Unterbrochene Vorbereitungen/Prüfungen werden nach Neustart kenntlich gemacht.
  Ein beschädigter Berichtsspeicher sperrt Übernahmeaktionen und bleibt erhalten.
- Mobile speichert unbestätigte Aktionen gerätegebunden vor dem Senden.
  **Anfrage erneut prüfen** nutzt nach Verbindungsabbruch/Reload denselben
  Idempotenzschlüssel. Ein unterbrochener Main-Befehl wird nicht blind wiederholt.
- Implementierung ist auf native Git-Workspaces begrenzt. Die laufende Abnahme
  verwendet Windows; daraus wird keine Linux-, WSL- oder macOS-Abnahme abgeleitet.

## Vertrag und Abnahme

`IntegrationService` ist die gemeinsame Main-Grenze für Desktop und Mobile.
`IntegrationAnalysis` prüft Identitäten und Inhalte, `IntegrationRecords` hält
begrenzte atomare Metadaten, `IntegrationChecks` enthält feste Prüfrezepte.
Snapshots entstehen mit einem separaten Index auf gemeinsamer Basis; Quell-Index
und Quellhistorie werden nicht umgeschrieben. Nur die ausgewählten Änderungen
erreichen den gesicherten Snapshot, ohne ungewählte Quell-Commit-Inhalte als
Vorfahren zu importieren.

Desktop-Channels `integration:query`/`integration:command` sind als Desktop-only
read/launch klassifiziert und exakt validiert. Mobile benutzt ausschliesslich
`POST /api/v1/integration/query` bzw. `/command` über `AdeApplicationService`,
mit aktuellem Gerätebeweis, Ressourcenprüfung, Befehlsbeleg und Audit.
Die generische Remote-IPC-Allowlist bleibt unverändert. Pfade und Ausgaben werden
vor Wire-Projektion redigiert; Geräte nennen keine absoluten Hostpfade oder argv.
Jeder Test ist an den überprüften Dateistand gebunden. Einzelne Checks sind auf
20 Minuten und 16 MiB Prozessausgabe begrenzt; der Bericht hält maximal 8 KiB
redigierte Ausgabe pro Check. Teststarts liefern sofort einen gespeicherten
Status; Polling ersetzt keine Befehlswiederholung.

Aktive Evidenz liegt im ignorierten `test-results`:
`integration-workflow-focused.log`, `integration-security.log`,
`integration-device-drafts.log`, `integration-ui-typecheck.log`,
`integration-ui-build.log`, `integration-ui-electron.log` und
`remote/integration-*.png`. Der vollständige Abschluss inklusive `pnpm verify`,
Commit/Push und persönlichem Neustart wird in
[INTEGRATION_NAVIGATION_GOALS.md](INTEGRATION_NAVIGATION_GOALS.md) nachgeführt.
