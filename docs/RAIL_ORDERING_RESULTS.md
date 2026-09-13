# Linke Navigation anordnen (13. September 2026)

Im Desktop öffnet **Anordnen** sichtbare Hoch-/Runter-Knöpfe für Obergruppen,
Projekte/Kategorien und Agents. Obergruppen bewegen sich mit allen Mitgliedern
zwischen freien Projekten; Projekte innerhalb ihrer Obergruppe und Agents
innerhalb ihres Projekts. Die vorhandene Drag-and-drop-Bedienung bleibt verfügbar,
einschliesslich Agent-Wechsel zwischen Projekten. Die Einfügemarkierung an
Projektköpfen folgt nun der tatsächlichen DOM-Struktur.

Jede Änderung wird sofort über die vorhandenen `category:reorder`-/`agent:move`-
Kanäle gespeichert. Währenddessen sind weitere Verschiebungen gesperrt. Bei
Fehlern zeigt die Navigation eine Meldung und der Store lädt den gespeicherten
Katalog erneut. Die Pfeile bleiben für die Tastatur fokussierbar, auch an einer
Grenze; Enter/Leertaste verschieben, Escape beendet Anordnen und fokussiert den
Anordnen-Knopf. Bei aktiver Suche sind Verschiebungen gesperrt, damit unsichtbare
Einträge nicht versehentlich übersprungen werden. Leere Kategorien bleiben sichtbar.

## Abnahme

- Fokussierte Kategorie-Navigation: 29 Checks bestanden, einschliesslich ganzer
  Obergruppen, verstreuter Gruppenmitglieder, Grenzen und unveränderter Identitäten.
- Alle drei TypeScript-Projekte bestanden auch nach den letzten Testergänzungen
  (`test-results/rail-ordering-typecheck.log`).
- Electron/Playwright-Ablauf in `scripts/helpers/railOrderingFlow.ts`: **12 Checks
  bestanden** mit `pnpm exec tsx scripts/test-electron-workflow.ts --rail-ordering-only`.
  Log: `test-results/rail-ordering-electron.log`, Screenshot der schmalen Leiste:
  `test-results/rail-ordering/narrow.png`. Er prüft
  Tastatur, Fokus, Gruppen-/Projekt-/Agent-Reihenfolge, Reload, Suche,
  Drag-and-drop sowie schmale Darstellung und läuft in `pnpm verify` mit.
- Gesamtlauf: `test-results/rail-ordering-verify.log`; 49 fokussierte Suiten mit
  2.352 Checks bestanden. Der danach ergänzte Neustart-Check besteht separat
  (Kategorie-Navigation jetzt 29 statt 28). Alle Produktionsbuilds bestehen.
- Vollständiger Desktop-Electron-Ablauf: 197 Checks bestanden, inklusive der
  zwölf Anordnen-Checks. Git-Sync: 20, Mobile-Browser: 57, Mobile-Electron: 36,
  Remote-Neustart: 12, Remote-Workspace-Browser: 24, Remote-Workbench-Browser: 25.
- **`pnpm verify` nicht bestanden:** Der nachfolgende Remote-Terminal-Lauf
  endet mit 141 bestandenen Checks und einem Timeout in
  `scripts/helpers/terminalHomeFlow.ts`: Die Codex-Quota-Anzeige
  `7 Tage: 75 % übrig` erscheint nicht. Damit ist der bereits in der
  Benutzerübergabe offene Quota-Fixture-Browserlauf weiterhin offen. Die
  nachfolgenden Teilabläufe (Run-Inspection, Workspace-CLI, Projekt-Git,
  Project-Publish, Setup und visuelle Regression) wurden wegen der verketteten
  Abbruchbedingung in diesem Gesamtlauf nicht mehr ausgeführt. Kein vollständiges
  Freigabesignal für den Repository-Stand.

## Operatorzustand

Auf den anschliessenden ausdrücklichen Benutzerauftrag wurde die persönliche
Instanz am 13. September um 20:53 Uhr aktualisiert (PID 7968). Die Reihenfolge ist
eingerichtet, fehlende Agent- und Kategorie-Bilder sind ergänzt. Sechs Agenten,
fünf Repository-Projekte und die Gerätekopplung sind erhalten; die private Mobile-
Auslieferung stimmt mit dem aktuellen Build überein. [Aktueller Operatorstand](HANDOFF.md).
Mobile erhält mit dieser Änderung keine eigenen Anordnen-Knöpfe. Kein Commit oder Push.
