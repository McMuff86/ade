# Projekte durchsuchen und Workspace zuweisen

Auftrag vom 12. September 2026: Mobile zeigte nur registrierte Projekte und
bezeichnete bereits zugeordnete Arbeitskopien missverständlich als „Workspace frei“.

## Bedienung

Die Agentenansicht trennt **Zuordnung** und **Belegung**. **Nicht belegt** bedeutet,
dass im gewählten Workspace beim Aktualisieren kein Terminal oder Auftrag läuft.
Es bedeutet nicht, dass kein Workspace existiert.

Neben **Workspace aktualisieren** steht **Workspace-Zuweisung prüfen**. Der Dialog
zeigt die vorhandene ADE-Arbeitskopie und Git-Worktrees des aktuellen Projekts.
**Projekte durchsuchen** findet zusätzlich Git-Projekte aus dem am PC in Settings
festgelegten Projekt-Stammordner. Dieselbe Suche ist in **Terminals → Projekt →
Projekte durchsuchen…** und als Knopf neben der Auswahl erreichbar. Die Suche
umfasst den konfigurierten Stammordner und den ADE-Katalog, nicht alle Laufwerke.
Ordner ohne Git und nicht erreichbare/verknüpfte Ordner werden entsprechend angezeigt.

**Projekt prüfen** bzw. **Workspace prüfen** prüft Erreichbarkeit, Linkdisziplin,
Git-Hauptworkspace, Repository-Identität, Branch, lokale Änderungen und Belegung.
Die Vorschau verändert keine Dateien oder Konfiguration. Erst **Workspace zuweisen**
registriert einen gegebenenfalls neuen Projektordner und speichert die Zuordnung.
Lokale Änderungen bleiben erhalten. Ein zwischenzeitlich geänderter Git-Stand,
eine neue Sitzung oder entzogene Rechte blockieren die Bestätigung.

Die gespeicherte Auswahl gilt für Dateien und Terminals der mobilen Agentenansicht
und des mobilen Terminal-Reiters. Sie übersteht Dialogwechsel und Reload.
Verwaltete Aufgaben verwenden weiterhin ihre unveränderten ADE-Arbeitskopien;
historische Run-/Task-/Lease-Bindings werden nicht umgeschrieben. Im Dialog kann
die eigene ADE-Arbeitskopie wieder ausgewählt und nach Prüfung bestätigt werden.

## Vertrag

- `workspaceAssignments` speichert je Agent/Projekt eine Referenz auf einen
  geprüften `ProjectWorkspace`. Ältere Konfigurationen erhalten eine leere Liste.
  Agentenlöschung entfernt dessen Zuordnungen; Konfigurationsimporte können diese
  betrieblichen Referenzen nicht beliebig ersetzen.
- Die dedizierten Endpunkte `/api/v1/workspace/assignment/query` und `/command`
  rufen ausschliesslich `AdeApplicationService` auf. Es gibt keine neue generische
  Remote-Command-Freigabe und keinen neuen IPC-Invoke-Kanal.
- Übersicht benötigt `workspace:read` oder `terminal:control`. Prüfung und
  Bestätigung benötigen `workspace:read` und `catalog:write`, jeweils mit aktueller
  Agent-/Projektfreigabe. Ein unregistriertes Projekt benötigt Ressourcenauswahl
  `all`. Die existierende Verzeichnisübersicht filtert begrenzt freigegebene Geräte.
- Auf dem Wire stehen nur opake Kandidaten-/Workspace-IDs und begrenzte,
  redigierte Anzeigenamen. Absolute Hostpfade und freie Shell-Befehle sind verboten.
  Vorschaunachweise sind zwei Minuten gültig, auf Gerät und Auswahl gebunden und
  in Main begrenzt. Bestätigung verwendet den exklusiven Workspace-Gate und prüft
  Identität, Git-Stand, Belegung und Rechte erneut.
- Mutationen benötigen signierten Gerätebeweis, Idempotency-Key und Audit.
  Ein verlorenes Ergebnis bleibt gerätelokal mit seinem ursprünglichen Schlüssel
  wiederherstellbar. Wiederholung führt die Zuweisung nicht nochmals aus.
- Die zugewiesenen Dateien und Terminals verwenden den bestehenden expliziten
  `projectWorkspaceId`-Vertrag mit Dateirevisionen, Eingabe-Leases und CLI-Profilwahl.
  Das Agent-Profil wird beim Terminalstart vorausgewählt, sofern für die native
  Umgebung verfügbar; Repository-Anweisungen werden nicht überschrieben.

## Abnahme

Native Windows ist die Zielumgebung. Neue WSL-, Linux/WSLg- oder macOS-Zuweisungen
sowie physisches Samsung/DeX sind mit dieser Änderung nicht abgenommen.
Fokussierte Suite: `scripts/test-workspace-assignment.ts`; realer Electron-/Chromium-
Ablauf: `scripts/helpers/workspaceAssignmentFlow.ts`, eingebunden in den bestehenden
Terminaltreiber und gezielt mit `--workspace-assignment-only` ausführbar.
Die gezielte Zuweisungssuite besteht mit 33 Checks, der vollständige Geräteentwurf-
Treiber mit 41 und der gezielte Electron-/Chromium-Ablauf mit 18 Checks. Letzterer
prüft die reale Dateibearbeitung und das Arbeitsverzeichnis eines kontrollierten
Codex-CLI-Prozesses, keine Provider-Anmeldung oder Inferenz. Die allgemeine mobile
Browserprüfung besteht nach Ergänzung des neuen Lese-Endpunkts mit 57 Checks.
Lokale Logs: `test-results/workspace-assignment-focused.log`,
`workspace-assignment-drafts.log`, `workspace-assignment-electron.log` und
`workspace-assignment-mobile-browser.log` im selben Ordner. Screenshots liegen
unter `test-results/remote/workspace-assignment-tablet.png` und
`test-results/remote/workspace-assignment-phone.png`.

Vollständiges `pnpm verify` am 12. September 2026: **2.880 Checks bestanden**,
Exitcode 0. Beide Desktop-TypeScript-Projekte und das mobile TypeScript-Projekt,
45 fokussierte Suiten mit 2.223 Checks, Produktionsbuild sowie 657 echte
Electron-/Chromium-Checks sind grün. Der vollständige Terminaltreiber enthält
165 Checks einschliesslich der neuen Zuweisung. Die erste Gesamtabnahme stoppte
an einer veralteten Test-Allowlist für Lese-Endpunkte; nach Ergänzung des neuen
Query-Endpunkts bestand die erneute Gesamtabnahme vollständig.
Nachweis: `test-results/workspace-assignment-verify.log`.

## Operatorzustand nach Neustart

Am 12. September 2026 um 14:21 Uhr Europe/Zurich wurde der bisherige ADE-Prozess
59616 geschlossen und genau eine sichtbare Instanz gestartet, PID **50028**.
Sie verwendet das persönliche Profil `%APPDATA%/ade` und die unveränderliche,
gegen alle gebauten Dateien geprüfte Kopie
`test-results/operator-assignment-20260912-142106-cbc4d4d1-verified`.
Main-SHA256: `cbc4d4d180f53baa8161bac90d98a332621e9fdaa23abfbbccea00eda70d4e8d`.

Konfiguration und Kopplungsdaten wurden zuvor unter
`test-results/operator-assignment-backup-20260912-142106` gesichert. Sechs
Agenten, fünf Projekte und alle gespeicherten Gerätekopplungen sind erhalten;
vor dem Neustart liefen keine verwalteten Aufgaben. Es wurde keine persönliche
Workspace-Zuweisung vorgenommen.

Der neue Prozess besitzt den Loopback-Listener `127.0.0.1:4317`.
`https://number-cruncher.tailfc0b86.ts.net/` antwortet mit HTTP 200; die ausgelieferten
Dateien `index-DU8i34bZ.js` und `index-BXwzbyep.css` stimmen per SHA256 mit der
geprüften Kopie überein. Bericht: `test-results/workspace-assignment-restart.json`.
Auf dem Tablet die Seite neu laden, um den neuen Projektbrowser zu verwenden.
