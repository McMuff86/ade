# Freie Terminals und mobile Terminalansicht

Auftrag vom 12. September 2026: Terminals ohne Agent und ohne Projekt öffnen,
auch mobil; eine eigene Terminalansicht mit Sitzungsnavigation und Einstellungen.

## Bedienung

- Desktop: **Terminals → Terminal öffnen**. Der Dialog bietet eine leere Shell
  sowie die in der nativen Umgebung erkannten Codex-/Claude-/Grok-/Hermes-CLIs
  und verfügbare Ollama-Modelle. **Freie Terminals** in der linken Leiste führt
  zurück zu diesen Sitzungen. Plus und die vorhandenen Terminal-Shortcuts funktionieren
  auch ohne ausgewählten Agenten.
- Mobile: eigener Reiter **Terminals** und direkter Knopf **Terminal öffnen**.
  Breite Ansichten zeigen Agents/Sitzungen links, das Terminal in der Mitte und
  einen Kontext-Inspector rechts. Auf dem Telefon öffnet **Agents und Sitzungen**
  die Navigation. Agent- und Projekt-Sitzungen bleiben über dieselbe Liste erreichbar.
- Startort einer freien Sitzung ist das native Benutzerverzeichnis des
  ADE-Rechners. ADE legt kein Agent-Profil, Projekt oder Worktree an und injiziert
  keine Agent-Anweisungen. Die CLI verwendet ihre eigenen Einstellungen.
- Mobile bietet CLI-Auswahl, Sitzungswechsel, neue Sitzung, Beenden mit Bestätigung,
  Eingabeübernahme/-freigabe, Vergrösserung, Schriftgrössen 12–20 px und ein
  gerätelokales helles/dunkles Theme inklusive Terminal. Schriftgrösse und Auswahl
  überstehen den Reload. Bestehende Projekt-/Agent-Startprofile behalten ihre Verträge.
- Bei geöffneter Bildschirmtastatur nutzt die mobile Ansicht die sichtbare Höhe,
  blendet Navigation/Startleisten aus und hält Terminaltasten erreichbar.
  **Bedienung** blendet die Einstellungen ohne Verlust des Eingabefokus wieder ein.
- Das Terminal läuft auf dem Rechner. Mobile benötigt **Interaktive Terminals
  steuern**. Freie Sitzungen benötigen zusätzlich die Ressourcenauswahl **Alle**;
  eine auf bestimmte Projekte/Agents begrenzte Freigabe erlaubt keinen Home-Zugriff.

## Verträge

`MobileTerminalSelection` ergänzt die bisherigen Workspace-Auswahlen um
`{ terminalHome: true }`. Nur `session:options`, `session:launch` und die dedizierten
Remote-Terminal-Endpunkte akzeptieren diese Auswahl. Gemischte Auswahlen,
Agent-Profile im freien Home-Kontext, absolute Pfade, eigene Befehle und Bindings
werden abgewiesen. Dateilesen/-speichern akzeptiert weiter nur Workspace-Auswahlen.
Die generische Remote-Command-Allowlist und die IPC-Kanalprivilegien ändern sich nicht.

Main bestimmt das Benutzerverzeichnis, prüft Link-Komponenten und Ordneridentität
vor Start und Remote-Zugriff. `scopeSource: terminal-home` kennzeichnet echte
agentenfreie PTYs. Auf dem Wire stehen nur opake Terminal-IDs und die Home-Auswahl.
Es gelten dieselben Input-Leases, Idempotenz, Rechteprüfungen vor/nach asynchronen
Schritten, Widerruf, Desktop-Rückübernahme und Ausgabe-Redaktion wie bisher.

## Abnahme

Die fokussierten Tests ergänzen gemischte/ungültige Scope-Auswahlen, Desktop-IPC,
gerätespezifische Rechte und deren Entzug, Replay, Home-Inventar, Schreibreihenfolge
sowie Wiederherstellung von Schriftgrösse/Auswahl und offenen Befehlsquittungen.
`terminalHomeFlow` läuft im bestehenden realen Electron-/Chromium-Terminaltreiber
und gezielt mit `--terminal-home-only`. Der Test verwendet ein isoliertes
Benutzerverzeichnis und kontrollierte CLI-Programme; er prüft keine echte
Provider-Anmeldung oder Inferenz.

Vollständiges `pnpm verify`: **Exit 0, 2.828 bestandene Checks** am 12. September
2026. Drei TypeScript-Projekte, 44 fokussierte Suiten mit 2.187 Checks,
Produktionsbuild und 641 Electron-/Chromium-/Visual-Checks sind erfolgreich.
Der finale Build enthält auch die Breitenbegrenzung im Handy-Tastaturmodus;
danach wurden keine Anwendungssourcen mehr verändert.

| UI-Prüfung | Bestanden |
|---|---:|
| Electron-Grundabläufe | 185 |
| Git-Synchronisierung | 20 |
| Mobiler Browser / Mobile Electron | 57 / 29 |
| Echter Host-Neustart | 12 |
| Remote Workspace / Workbench | 24 / 25 |
| Remote Terminal einschliesslich freier Home-Sitzungen | 149 |
| Run-Ergebnisse / Workspace-CLI / Projekt-Git | 27 / 22 / 20 |
| Veröffentlichungsoberfläche / Einrichtung / visuelle Regression | 12 / 37 / 22 |

Zusätzlich besteht der gezielte `--terminal-home-only`-Durchlauf mit **31 Checks**.
Er prüft echte Shell-Eingabe, CLI-Prozess und Arbeitsverzeichnis, Desktop-Reclaim,
Dialogfokus, wiederhergestellte Auswahl, Schriftgrösse/Theme sowie die responsive
Navigation. Bei simulierter Android-`visualViewport`-Tastatur bleiben mindestens
274 px Terminal, der Bedienknopf innerhalb der Telefonbreite und die Terminaltasten
in der sichtbaren Höhe. Die Abnahme umfasst kontrollierte Codex-/Claude-/Grok-CLIs.
Frühere Zwischenfehler zählen nicht als Abnahme; massgeblich sind die abschliessenden
positiven Durchläufe mit gemeinsam gebauter Desktop-/Mobilversion.

Lokale Nachweise: `test-results/terminal-workspace-verify.log`,
`test-results/terminal-home-electron.log`, `test-results/terminal-home-final-typecheck.log`.
Screenshots: `test-results/remote/terminal-home-tablet.png`,
`terminal-home-phone.png` und `terminal-home-keyboard.png` im selben Ordner.

Native Windows ist die Zielumgebung dieser Abnahme. Die freie Home-Sitzung
wählt die native Umgebung. Windows→WSL-Agent-Sitzungen verwenden weiterhin
ihre vorhandene explizite Auswahl. Neue Linux/WSLg-, WSL-, macOS- oder physische
Samsung/DeX-Abnahme wird hier nicht behauptet.

## Persönliche ADE-Instanz

Finaler Start am **12. September 2026 um 11:27:56 Europe/Zurich**, sichtbares
Fenster `ade`, PID **59616**. Vor diesem Start war keine weitere ADE-Hauptinstanz
mehr vorhanden; nach dem Start wurde genau eine bestätigt. Es liefen keine
queued/running Tasks. Die unabhängige, mit allen gebauten Dateien verglichene Kopie
liegt unter `test-results/operator-terminal-20260912-112753-efe52dfc-verified`.
Main-SHA-256: `EFE52DFCA3EE4431E8A2A64602CB12190442C00BCB07BA061AF76B6864FD58FB`.

Das persönliche Profil wurde weiterverwendet und vorher samt Gerätespeicher unter
`test-results/operator-terminal-backup-20260912-112753` gesichert. Die Identitäten
aller sechs Agenten und fünf Projekte sowie Geräte-IDs, verschlüsselte
Kopplungsschlüssel und Widerrufsstände sind unverändert.
Der Listener gehört zur neuen Instanz und bleibt auf `127.0.0.1:4317`.

Die bestehende private Adresse <https://number-cruncher.tailfc0b86.ts.net/>
antwortet mit HTTP 200. `index-qMyEi7Ig.js` und `index-TquABfHx.css` wurden über
HTTPS heruntergeladen und bytegenau mit dem geprüften Build verglichen.
Die Serve-Konfiguration wurde nicht geändert. Nachweis:
`test-results/terminal-workspace-restart.json`. Mobile neu laden, dann
**Terminals → Terminal öffnen** wählen; die vorhandene Kopplung bleibt verwendbar.
