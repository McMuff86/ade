# Direkter Workspace-Start und Desktop-Terminals

Stand: 14. September 2026. Lokaler Arbeitsstand; vollständig geprüft.

Der globale freie Terminalstarter bietet jetzt eine Workspace-Auswahl. Projekte
werden durch den bestehenden main-eigenen Projektkatalog aufgelöst; der angezeigte
Branch ist Teil des Startauftrags. Codex, Claude Code und Shell sind ohne
Agent-Zuweisung erreichbar. Gespeicherte Profile sind ausdrücklich wählbar.

Projektterminals haben direkte Startknöpfe, mehrere Tastatur-bedienbare Tabs,
eine zusätzliche Sitzung, Wiederverwendung passender laufender Programme und
Neustart beendeter Terminals. Die Auswahl bleibt über Git-/Ansichtswechsel
erhalten. CLI-Lebenszyklus und offenes Terminal werden weiterhin getrennt benannt.

Alle Desktop-Terminals bieten Suche im xterm-Verlauf, Auswahl kopieren, Einfügen,
Anfang/Live-Ausgabe und gespeicherte Schriftgrösse. Suche bleibt auf den
vorhandenen Puffer begrenzt (5.000 Scrollback-Zeilen); Schriftgrösse ist eine
lokale Anzeigepräferenz. Eingabeübernahme bleibt beim bestehenden Lease-Vertrag.

## Prüfungen

- Projektstart-Suite: 50 Checks bestanden, davon neun neue Wiederverwendungsfälle.
- Allgemeine Sitzungsauswahl: 39 Checks bestanden.
- TypeScript und Produktionsbuild bestanden.
- Gezielter nativer Windows-Electron-/Tablet-Ablauf: 54 Checks bestanden,
  davon 26 neue Desktop-Prüfungen. Er umfasst Workspace-Auswahl, separate CLIs,
  explizite Profile, Wiederverwendung, zusätzliche Sitzungen, Tastaturtabs,
  Git-Rückkehr, Suche/Kopieren/Einfügen, Schrift, Verlauf, Reload, Verfügbarkeit,
  Neustart, Abbruch/Bestätigung beim Schliessen und 720-px-Fensterbreite.
- Vollständiges `pnpm verify`: Exit 0. Alle drei TypeScript-Projekte,
  56 fokussierte Suiten mit 2.567 Checks, Produktionsbuild und 903 reale
  Electron-/Browser-/Visual-Checks bestanden (insgesamt 3.470 Checks).
  Log: `test-results/workspace-terminals-verify.log`.
- Der vollständige Remote-Terminal-Ablauf besteht mit 204 Checks, einschliesslich
  Desktop-Eingabefokus nach Tabklick und gesperrter Einfügen-Schaltfläche bei
  Tablet-Eingabebesitz. Die zusätzliche TypeScript-Prüfung nach der abschliessenden
  Fokuskorrektur besteht ebenfalls; die UI-Prüfkette verwendet den finalen Build.

Ausführung: `pnpm exec tsx scripts/test-remote-terminal-electron.ts --workspace-cli-only`.
Dieser Ablauf bleibt Bestandteil von `pnpm verify`.
Bildnachweise: `test-results/remote/desktop-workspace-terminals.png` und
`test-results/remote/desktop-workspace-terminal-narrow.png`.

Die Tests warten auf den tatsächlichen Session-Inventar-/Hydrierungszustand
sowie den debouncten xterm-Resize. Ein angenommener sofortiger Prozessabschluss
nach `pty:kill` wäre bei ConPTY kein gültiger Test des abgeschlossenen Zustands.

Die Electron-Proben verwenden native Windows-PTYs mit lokalen CLI-Fixtures.
Sie belegen Arbeitsverzeichnis, Branch, Profilwahl, Terminalbedienung und
Sitzungsverwaltung; keine neue Provider-Inferenz oder Anmeldung. Native Linux,
WSLg, Windows mit WSL-Backend und macOS erhalten keine neue Plattformfreigabe.

Die persönliche ADE-Instanz wurde nicht neu gestartet; kein Commit oder Push.
