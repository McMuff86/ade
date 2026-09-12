# Tablet-Arbeitsplatz: Abnahme vom 12. September 2026

Die Implementierung und native Windows-Abnahme A0–A4/A6 sind abgeschlossen.
ADE wurde mit dem persönlichen Profil neu gestartet. A5 bleibt hinsichtlich
physischem Samsung/DeX und Wiederherstellung des nicht antwortenden Ubuntu offen.
Auftrag und Teilziele: [Tablet-Goals](TABLET_WORKSPACE_GOALS.md).

## Verhalten

- Geräte können alle oder ausdrücklich ausgewählte Projekte/Agenten erhalten.
  Aktuelle Freigaben gelten auch für bestehende Sitzungen, Vorschauen und
  wiederholte Befehle. Projektzugriff und Git-Aktionsrechte sind getrennt.
- Native Codex-Runs mit aktivierter Option **Rückfragen während des Runs erlauben** zeigen
  Werkzeugaktivität und beantwortbare Fragen auf Desktop und Mobile. Antworten
  gelten erst nach Bestätigung durch Codex als beantwortet. Die verbleibende
  Aufgabenzeit pausiert während einer blockierenden Frage. Abbruch/Neustart
  beendet offene Fragen kontrolliert; ein alter Antwortversuch startet nichts.
- Projekt → CLI → Diff → ausgewählte Dateien committen → Merge/Push/PR ist auf
  Desktop und Mobile geprüft. Git-Aktionen brauchen weiterhin ihre explizite
  Vorschau und Ausführung. Es wurden keine persönlichen Projektänderungen
  committet, gemergt, gepusht oder als PR veröffentlicht.
- Neu erfasste Ergebnisdateien bleiben nach Änderungen/Löschen der ursprünglichen
  Arbeitskopie lesbar. Grenzen: 16 MiB je Datei, 100 Dateien je Aufgabe, 2 GiB
  Gesamtspeicher; unvollständige Erfassung wird ausgewiesen. Bestehende Runs ohne
  Sicherung verwenden weiterhin die vorhandene Arbeitskopie. Ergebnisseiten
  enthalten je 20 im Journal aufbewahrte Runs. Kalte JSON-Archive werden nicht
  automatisch in diese Seiten importiert.

## Ausführbare Evidenz

`pnpm verify` beendet sich mit Exit 0: **2.770 Prüfungen**. Drei TypeScript-Projekte,
44 fokussierte Suiten mit 2.158 Prüfungen, Produktionsbuild und 612
Electron-/Chromium-/Visual-Prüfungen. Vollständiges Log:
`test-results/tablet-verify-final.log`. Nach dieser Prüfung wurden keine
Anwendungssourcen mehr geändert; Dokumentation und lokale Operatornachweise
wurden ergänzt.

| UI-Prüfung | Bestanden |
|---|---:|
| Electron-Grundabläufe | 185 |
| Git-Synchronisierung | 20 |
| Mobiler Browser | 57 |
| Mobile Electron einschliesslich Rückfragen | 29 |
| Echter Host-Neustart | 12 |
| Remote Workspace / Workbench | 24 / 25 |
| Remote Terminal / Projektstart / Netzwerk | 120 |
| Run-Ergebnisse und Seiten | 27 |
| Workspace-CLI | 22 |
| Projekt-Git | 20 |
| Push-/PR-Oberfläche | 12 |
| Einrichtung | 37 |
| Visuelle Regression | 22 |

Zusätzlich: **5 Prüfungen mit realer Codex-Inferenz**, installierte CLI 0.154.0,
native Windows, `gpt-5.6-sol`/`high`; Rückfrage, Antwortbestätigung und gespeichertes
strukturiertes Ergebnis. Log: `test-results/native-codex-questions.log`.
Die 26 deterministischen Rückfragenprüfungen und 20 Speicher-/Seitenprüfungen
sind bereits in den 2.158 enthalten. Browser-Protokolltests verwenden kontrollierte
CLI-Prozesse; die gesamte UI-Suite ist keine Inferenzabnahme aller Anbieter.

Zwei anfängliche Testfehler wurden konkret eingegrenzt: Die Worktree-Recovery-
Kontrolle widerruft Rechte nun nach dem tatsächlichen Anlegen des Worktrees;
die verlorene Eingabebestätigung betrifft gezielt `INPUT_ACK_CONTROL` und nicht
ein vorangehendes Resize. Die jeweiligen Positivkontrollen und der abschliessende
vollständige Lauf bestehen. Diese anfänglichen Fehlläufe zählen nicht als Abnahme.

## Persönliche ADE-Instanz

Finaler Start: **12. September 2026, 02:06:10 Europe/Zurich**, PID **23884**.
Sichtbares Fenster `ade`; profilbezogener Zweitstart aktiviert dieselbe Instanz
und beendet den zusätzlichen Prozess. Feste Kopie:
`test-results/operator-tablet-20260912-f9372d2e-verified`.
Main-SHA-256:
`F9372D2EE60E58B89082D2C68098A4FD850BE0F05844CDBB460B31F83B10FA2D`.
Quellbasis `cb308ae7f1ceb87793f4648fc2e9ddd1e1765bf5` plus uncommittierte Änderungen.
Die Kopie wird durch weitere Entwicklungsbuilds nicht verändert.

Vor beiden Neustarts: keine queued/running Tasks und keine offenen
Terminal-Sitzungen. Konfiguration und Gerätespeicher wurden vorher unter dem
in `test-results/tablet-release.json` genannten Backup-Pfad gesichert.
Listener nur `127.0.0.1:4317`; kein verbleibender Debug-Port 9239.

Private Adresse: <https://number-cruncher.tailfc0b86.ts.net/>. HTTP 200 mit normaler
TLS-Prüfung. JavaScript `index-DwTllHEp.js` und CSS `index-BDgXr6D6.css` stimmen
bytegenau mit dem geprüften Build überein. Tailscale Serve ist unverändert.
Samsung-Geräte-ID und verschlüsselter Kopplungsschlüssel sind erhalten.
Ergänzt wurden ausschliesslich die beauftragten Aktionsrechte `projects:write`,
`projectGit:write`, `projectGit:publish`; die bisherige Ressourcenauswahl bleibt
`all`. Für eine begrenzte Auswahl am PC die Gerätefreigabe auf **Nur ausgewählte Projekte und Agenten**
stellen und die gewünschten Einträge speichern.

Ein frischer Chromium-Kontext hat über die echte private HTTPS-Adresse die
bestehende Samsung-Identität verwendet: Anmeldung, fünf Projektöffnungen mit
Git-Status/CLI-Auswahl, sechs Agentenprofile, sichtbare Projektknöpfe und tatsächliche
Git-Oberfläche des ADE-Repositories bestanden. Hoch-/Querformat und erneute
Verbindung nach Browser-Netzwechsel/Reload bestanden. Keine Schlüssel in Logs;
der geschützte Schlüssel wurde nur im lokalen Prüfprozess entschlüsselt.
Nachweise: `test-results/operator-tablet-restart.json`,
`operator-tablet-browser.json`, `operator-tablet-projects.png`,
`operator-tablet-portrait.png`, `operator-tablet-git.png`.

Erreichbare Projekte: RhinoClaw, ai_agent_code_workspace, 2D_rpg_jumpnrun,
RhinoLayoutTools und Codex Native. Sichtbare Agenten: RhinoClaw_Agent, Main Chef,
Hermes General, Sentinel, GrokMain und LayoutTool_FrontendDesigner.
CLI-Auswahl ist kein Nachweis einer funktionierenden Anmeldung bei jedem Anbieter.
GitHub CLI ist angemeldet; Veröffentlichung wurde ausschliesslich in isolierten
Git-/Provider-Fixtures geprüft.

## Verbleibende Operatorpunkte

- Das physische Samsung ist in Tailscale offline (zuletzt gesehen am
  11. September um 17:20 UTC). Dort Tailscale einschalten und die private Adresse
  öffnen beziehungsweise nach Sicherung offener Entwürfe neu laden. Eine echte
  Samsung-Touch-/DeX-/Hardwaretastaturmessung ist noch nicht erfolgt.
- WSL hängt bereits bei `wsl --status` und Ubuntu `/bin/true` (je 15 Sekunden
  Timeout), obwohl WslService/vmcompute laufen. Hermes General und Sentinel
  verwenden `wsl:Ubuntu` und sind daher nicht als arbeitsbereit abgenommen.
  Der Benutzer plant inzwischen selbst einen Windows-Neustart nach dem gewünschten
  Commit/Push; danach WSL erneut prüfen. Kein fremder WSL-Prozess und kein
  WSL-Dienst wurde beendet. Native Codex-Arbeit wurde separat geprüft.
- Die weissen Punkte im ursprünglichen Terminalbild lassen sich anhand des
  Screenshots allein keiner bestätigten Ursache zuordnen. Keine Änderung an
  Cursor-/Terminal-Grafikeinstellungen wurde vorgenommen.
