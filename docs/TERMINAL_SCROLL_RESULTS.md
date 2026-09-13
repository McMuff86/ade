# Direkter mobiler Terminalverlauf

Auftrag vom 13. September 2026: Im Codex-Terminal frühere Ausgabe erreichen;
Commit, Push, Merge und Projektabgleich weiterhin über die vorhandenen Git-Flows.

## Umsetzung

- Verlauf direkt über sichtbaren Knopf, Mausrad nach oben, Wischen nach unten
  oder Shift+PageUp. Lesebereich nimmt Fokus; Escape/Live-Knopf gibt ihn zurück.
- Geöffneter Text und Scrollposition bleiben bei neuer Ausgabe unverändert.
  Live-Polling läuft weiter; erneutes Öffnen liest den aktuellen Text.
- Main hält 1.000 statt 200 Scrollback-Zeilen. Die redigierte Textprojektion bleibt
  auf 65.536 UTF-16-Codeeinheiten begrenzt. Keine zusätzlichen Wire-Felder oder
  Berechtigungen; Rohsequenzen, Zugangsdaten und Hostpfade bleiben in Main.
- Der Verlauf ist kein Archiv überschriebener TUI-Bildschirme. Bereits aus dem
  Puffer entfernte Ausgabe wird nicht wiederhergestellt.
- Git-Aktionen bleiben im Projekt-Workspace verfügbar; kein persönliches Projekt
  wurde in diesem Auftrag committet, zusammengeführt oder veröffentlicht.

## Nachweise

- TypeScript und Produktionsbuild bestanden.
- `scripts/test-terminal-display.ts`: 33 Checks bestanden; längerer Verlauf,
  Begrenzung, Redaktion und bestehende Terminalprojektion.
- `pnpm exec tsx scripts/test-remote-terminal-electron.ts --terminal-home-only`:
  36 Checks bestanden, echte Windows-PTYs und Chromium. Mausrad, Fokus, ruhige
  Ausgabe, Tastatur, CDP-Touchgeste sowie bisherige Start-/Layout-/Reload-Flows.
- Screenshot: `test-results/remote/terminal-scroll-history.png`.
- Ein erster Browserlauf scheiterte an einer unvollständigen synthetischen
  Touch-Testeingabe. Der abschliessende Lauf verwendet echte CDP-Touchereignisse
  und besteht. Das war kein erwarteter Negativtest.
- Erster Gesamtlauf nicht bestanden: zwei UI-Prüfungen scheiterten. Der Auftrag
  wurde währenddessen um Abo/Git erweitert; der aktuelle Zwischenstand und die
  noch offene Wiederholung stehen in [WORKSPACE_IMPROVEMENTS](WORKSPACE_IMPROVEMENTS.md).

Physische Samsung-/DeX-Bedienung und echte Codex-Inferenz wurden in diesem
Folgeauftrag nicht geprüft. Desktop-xterm und WSL-Verhalten wurden nicht geändert.

## Operatorzustand

Persönliche ADE-Instanz weiterhin aus der Releasekopie vom 13. September, 12:48
Uhr (bei Prüfung PID 53592). Der neue Verlauf ist dort noch nicht aktiviert.
Vor Aktivierung vollständige Abnahme abschliessen und aktive Sitzungen prüfen.
Der Folgeauftrag ist lokal noch nicht committet oder gepusht.
