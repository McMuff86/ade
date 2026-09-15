# CLI-Arbeit und Terminal-Latenz: Windows-Abnahme

Stand: 15. September 2026. Arbeitsstand nach Sicherungscommit `bff299a`.
Die vollständige Code-Abnahme und der Windows-Pakettest sind bestanden.
Persönliche Aktivierung steht wegen einer offenen WSL-Sitzung aus.
Aktives [Gesamtziel](CLI_WORK_AND_DICTATION_GOALS.md).
Der spätere Sprachstand besitzt einen [eigenen Abnahmebericht](DICTATION_IMPLEMENTATION_RESULTS.md);
die Zahlen in diesem Dokument gehören zur vorherigen CLI-/Latenz-Lieferung.

## Implementiert

Desktop Work und Overview zeigen dieselben echten interaktiven PTYs, mit
Originalordner/Worktree, Startbranch, CLI/Backend, optionalem Startprofil und
bekanntem Startmodell. Benennen, Suchen, Filtern, neue Ausgabe und direkter
Wechsel ohne Doppelstart. CLI-/Shell-/Terminalzustände bleiben getrennt.
Original-Projektkarten öffnen direkt den vorhandenen Workspace.

Native Projekt-Terminal-I/O prüft die gespeicherte Ordner-/Git-Topologie und
HEAD direkt statt Git-Unterprozesse pro Taste zu starten. Ungewöhnliche
Layouts bleiben auf der vollständigen Prüfung. Neue Starts und Datei-/Git-
Aktionen behalten ihre volle Git-Auflösung; WSL-Homes und Agent-Bindings ihre
eigenen Prüfpfade. Keine zeitbasierte Berechtigungscache. Unveränderte sichere
Bild-/Verlaufsdaten werden anhand einer Revision nicht erneut übertragen;
aktueller Besitz/Status wird weiterhin geprüft und übertragen. Serielle
Abfragen beschleunigen sich kurz während des Tippens. Gleiche Terminalgrössen
lösen keinen erneuten PTY-Resize aus. Kein lokales Terminal-Echo.

## Bisherige fokussierte Nachweise

- `test-cli-work.ts`: 25 Checks; Identität, Status, Modelle, Filter, ungelesene
  Ausgabe, stabile Reihenfolge, unabhängige Originalworkspace-Karten.
- `test-remote-terminal-electron.ts --workspace-cli-only`: 73 Checks insgesamt,
  einschliesslich der vorhandenen Workspace-/Tablet-Abläufe; Work/Overview-
  Sitzungswechsel, Benennen/Reload, Fokus, Filter und schmale Ansicht.
- `test-work-electron.ts`: 20 Checks für die bestehende Run-Oberfläche.
- `test-terminal-workspace-identity.ts`: 16 Checks mit realen Git-Arbeitskopien;
  Branchwechsel, packed refs, detached HEAD, Pointer-/Backlink-/commondir-Wechsel,
  zu grosse/umgeleitete HEAD, ersetzte Ordner, unbestätigte Projekte,
  Fallback bei symbolischen HEAD-Ketten und positive Abschlusskontrollen.
- `test-remote-terminal.ts`: 71 Checks, einschliesslich bedingter Ausgabe,
  geänderter Revision, ungültiger Abfragen sowie Widerruf und Scope-Wechsel
  während eines Display-Reads. Schlusskontrolle öffnet dasselbe Terminal.
- `test-project-workspaces.ts`: 48 bestehende Checks weiter bestanden.

Vollständiges `pnpm verify` bestanden: **3.543 Checks** = 58 fokussierte Suiten
mit **2.615 Checks** plus **928 Electron-/Browser-/Visual-Checks**. Alle drei
TypeScript-Projekte und der Produktionsbuild bestehen. Log:
`test-results/cli-work-latency-verify-final.log`, Prozess-Exit 0.
Der erste Gesamtlauf traf auf einen mehrdeutigen älteren Profilselektor;
der Test wählt jetzt den exakten zugänglichen Profilnamen. Der anschliessende
Gesamtlauf ist vollständig grün. Neue Diktatmodule werden separat integriert
und sind nicht durch diese CLI-/Latenz-Abnahme als Produktfunktion freigegeben.

## Lokale Messreihe

Echte native Windows-PowerShell-PTY, Chromium mit Tastaturereignissen und
1024×768-Viewport über lokalen HTTPS-Reverse-Proxy. Pro Stand 20 Einzelzeichen
und 20 Vierzeichen-Bursts. Gemessen im Browser ab erstem Keydown bis passender
echter Terminalausgabe plus zwei Animationsframes. Keine Provideranfrage.

| Stand | Einzelzeichen p50 / p95 | Bursts p50 / p95 |
|---|---|---|
| Ausgangspfad | 1371 / 1607 ms | 1390 / 2239 ms |
| Parallele Git-Proben, eine redundante Display-Prüfung entfernt | 554 / 655 ms | 553 / 817 ms |
| Direkte Topologieprüfung für bestehende Projekt-PTYs | 122 / 239 ms | 240 / 256 ms |
| Bedingte Frames, aktives Abfrageintervall, keine identischen Resizes | 123 / 126 ms | 122 / 126 ms |
| Abschliessender Gesamtlauf mit 8-ms-Eingabepuffer (Shell) | 106 / 155 ms | 108 / 140 ms |
| Abschliessender Gesamtlauf, Raw-Key-CLI (100 Zeichen / 20 Bursts) | 92 / 123 ms | 119 / 157 ms |

Das direkte Einzelzeichen-Ziel p50 ≤ 100 ms / p95 ≤ 200 ms ist in der letzten
lokalen Raw-Key-CLI-Reihe erreicht. Die Shell und Bursts bleiben beim Median
knapp über 100 ms. Es wurden während der Raw-Key-Eingabereihe keine Git-Prozesse
gestartet. Das ist keine physische Tablet-, WLAN-, Tailscale- oder WAN-Abnahme
und kein Nachweis einer echten Codex/Claude/Grok-TUI. WSL und tatsächliche
Bildschirmtastatur/IME sind separat zu prüfen.

Reproduzierbar nach `pnpm build` mit
`pnpm exec tsx scripts/test-remote-terminal-electron.ts --terminal-latency-only`.
Lokale Rohdaten liegen in `test-results/terminal-latency-{baseline,parallel,identity}.json`
und `test-results/remote/terminal-latency.json`, Logs daneben; Testartefakte
bleiben ignoriert. Sie enthalten Messzahlen und Fixture-Daten, keine Nutzereingaben.

## Noch offen

Gebündelte persönliche Aktivierung; weitere Latenz- und
Gerätetests; gespeicherte Projektauswahl als Standardeinstieg aus Goal 27.2;
sichere CLI-Promptübergabe,
PC-/Mobile-ElevenLabs-Diktat, Verbrauchs-/Kostenjournal (Goal 24) und der
vollständige Dokumentationsaudit. Die persönliche laufende Instanz bleibt
während dieser Implementierung erhalten.

## Sicherung und Windows-Paket

Produktcommit **b2e134e4113f81715a174598193287ee339e3d25** liegt auf `main`
und `origin/main`; die Remote-SHA wurde separat abgeglichen.
Das neu gebaute Programm liegt unter
`dist/cli-work-20260915/win-unpacked/ADE.exe`.
SHA-256 der EXE:
`cc4a7eed939d21b21801f34ba55ec5e8eced80980e5e0e820fbf5794daaa5706`.

Sieben Prüfungen am echten Paket bestanden: Sandboxing/Context Isolation,
Originalworkspace ohne Profil, echte ConPTY-Ausgabe, Work-Liste, Rückkehr ohne
Doppelstart, gleiche Sitzung in Overview und isolierte Konfiguration ohne
Agentbindung. Reproduzierbarer Treiber:
`pnpm exec tsx scripts/test-cli-work-package.ts dist/cli-work-20260915/win-unpacked/ADE.exe`.
Nachweis: `test-results/cli-work-package-smoke.json`, Log und Screenshot daneben.

Die persönliche Instanz PID 37308 bleibt auf dem zuvor aktivierten Paket.
Eine noch offene WSL-Shell im Assistenten-Arbeitsordner wurde erkannt und bleibt
erhalten. Der Pakettest verwendet ausschliesslich eine eigene temporäre
Konfiguration und ein Testrepository; er aktiviert keinen persönlichen Host.
