# Commit-Details auf Tablet und Smartphone

Im Agent-Workspace unter **Git-Änderungen → Letzte Commits** öffnet ein Tippen
auf einen Commit seine vollständige Nachricht, Autor, Verfassungs- und Commit-
Zeitpunkt, vollständige ID und Vergleichsbasis. Die Zeitpunkte erscheinen in der
lokalen Zeitzone des Browsers. Eine Statistik nennt Dateien, hinzugefügte und
entfernte Textzeilen sowie Binärdateien ohne erfundene Zeilenzahlen.

Die Dateiliste zeigt Status und Zeilenzahlen pro Datei. Ein Tippen öffnet den
historischen Diff mit Kontext, grünen Ergänzungen und roten Löschungen. Diese
Ansicht ist unabhängig von aktuellen, uncommitteten Workspace-Änderungen.
Merge-Commits werden ausdrücklich gegen ihren ersten Eltern-Commit verglichen,
erste Commits gegen einen leeren Baum. Umbenennungen erscheinen als Löschung
und Hinzufügung; es gibt keine heuristische Rename-Zuordnung.

Tablet: Liste und Details nebeneinander. Smartphone: Details ersetzen die Liste.
Enter/Leertaste öffnen die Commit-Knöpfe; die Überschrift erhält Fokus. Zurück
oder Escape führt zur Liste und fokussiert den Auslöser, ersatzweise den
Workspace-Aktualisieren-Knopf. Nach dem Öffnen einer Datei erhält ihre Überschrift
Fokus. Ladezustände, Fehler mit erneutem Versuch, Binärdateien und leere Commits
haben eigene Hinweise. Projektwechsel verwerfen bisherige Details.

## Vertrag und Grenzen

Die bestehenden signierten, nur lesenden `POST /api/v1/workspace/query`-Anfragen
erhalten `operation: commit` mit vollständiger `sha` oder `operation: commit-file`
mit `sha` und portablem relativem `path`. Die vorhandene Workspace-Auswahl ist
weiter verpflichtend. `AdeApplicationService.queryWorkspace` prüft weiterhin
Geräteprinzipal, `workspace:read` und Ressourcenzugriff vor und nach der Abfrage.
Kein neuer Invoke-Kanal, keine Command-Allowlist-Erweiterung und keine Git-Mutation.
Wire-DTOs stehen in `src/shared/remote.ts`.

Erlaubt sind nur vollständige Hex-Objekt-IDs und Commits im Verlauf des aktuell
ausgewählten Workspace-HEAD. Git-Replacements sind abgeschaltet. Vergleich und
Patch verwenden feste argv, keine externen Diff-Treiber/Textconv und keine
Rename-Heuristik. Workspace/Git-Metadaten werden vor und nach der Abfrage mit
der vorhandenen Linkdisziplin geprüft. Historische Symlinks/Submodule und aktuell
verknüpfte, geschützte oder unzulässige Pfade sind nicht zugänglich. Auch direkte
Patch-Anfragen müssen in der erlaubten Dateiliste dieses Commits stehen.

Nachrichten: 8.000 Zeichen, Dateiliste: 500, Diff: 64 Ki Zeichen. Git-Ausgabe bleibt
zusätzlich auf 256 KiB pro Prozess und 15 Sekunden begrenzt. Bei ausgelassenen
Dateien gelten Summen ausdrücklich nur für angezeigte Einträge. Bei gekürzten
Diffs gelten die Zeilenzahlen weiterhin für die vollständige sichtbare Datei.
Nachrichten, Autor und Diff laufen durch `redactForWire`; keine absoluten
Host-Pfade oder Zugangsdaten auf dem Wire. Große Git-Abfragen können mit einem
Fehler abbrechen; die Metadaten bleiben beim getrennten Dateiabruf sichtbar.

Diese Änderung erweitert den bestehenden nativen Git-Workspace-Pfad. Ausführbare
Nachweise unten stammen von Windows mit Chromium; kein neuer WSL-/macOS-Support
wird dadurch zugesagt.

## Abnahme und Operator

- `scripts/test-remote-commits.ts`: 29 Checks bestanden, darunter Root/Merge,
  Löschungen, binäre Dateien, Grenzen, Wire-Redaktion, verknüpfte/geschützte Pfade,
  fremde Branch-Historie und entzogene Berechtigungen mit abschließendem Positivtest.
- `scripts/test-remote-workbench-browser.ts`: 39 Checks bestanden, darunter 14
  neue Commit-Prüfungen für Touch/Tastatur, Fokus, Metadaten, Diff, Binärhinweis,
  Fehlerbehebung, Smartphone-Layout und verworfene verspätete Antworten nach
  einem Tabwechsel. Nachweise: `test-results/commit-details-browser.log`,
  `test-results/remote/commit-details-tablet.png`, `test-results/remote/commit-details-phone.png`.
- `pnpm verify`: 50 fokussierte Suiten mit 2.382 Checks bestanden; Desktop-
  Electron 197, Git-Sync 20, Mobile-Browser 57, Mobile-Electron 36, Remote-Neustart
  12, Remote-Workspace-Browser 24 und Remote-Workbench-Browser 39 Checks bestanden.
  Der Remote-Terminal-Lauf endet mit 141 bestandenen Checks und dem bereits
  bekannten Codex-Quota-Fixture-Timeout: `7 Tage: 75 % übrig` erscheint nicht.
  Gesamtlauf daher **Exit 1**, nachfolgende Run-Inspection-/Workspace-CLI-/Projekt-
  Git-/Project-Publish-/Setup-/Visual-Suiten wurden nicht mehr ausgeführt.
  Log: `test-results/commit-details-verify.log`. Keine vollständige Repository-Freigabe.
- Typecheck aller drei Projekte und vollständiger Produktionsbuild bestehen.
- Persönliche Aktivierung am 13. September 2026 um 21:17 Uhr: PID 36064 ersetzt
  PID 7968. Release: `test-results/operator-commitdetails-20260913-211701-b75df981-focused`.
  Private HTTPS-Auslieferung Status 200, ausgelieferte JS-/CSS-Hashes stimmen mit
  dem neuen Build überein. Sechs Agenten, fünf Repository-Projekte, Bilder,
  Reihenfolge und Gerätekopplung sind erhalten. Beleg: `test-results/commitdetails-restart.json`.
- Die zwei im Benutzerscreenshot markierten echten RhinoClaw-Commits wurden
  zusätzlich nur lesend geprüft: `fd4f7008` hat 13 Dateien, +513/−294 Zeilen;
  `d3d37295` hat 71 Dateien, +2553/−390 Zeilen. Datum und ein Datei-Diff sind für
  beide verfügbar. Beleg: `test-results/operator-commit-details-validation.json`.
- Kein Commit/Push dieses Auftrags.
