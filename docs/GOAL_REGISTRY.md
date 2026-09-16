# ADE-Zielregister

Abgleich vom 16. September 2026. Die Nummer bezeichnet einen stabilen
Liefervertrag; ob dieser bereits unterstützt wird, entscheidet der zugehörige
Nachweis mit Plattform und Datum. [STATUS](STATUS.md) und [HANDOFF](HANDOFF.md)
führen den aktuellen Code- beziehungsweise Betriebsstand.

| Nummer | Vertrag | Einordnung |
|---|---|---|
| 1–11 | [Engineering-Tracks](ROADMAP.md#existing-engineering-tracks-and-exit-criteria) | Historische Verträge und deren Nachweise |
| 12–15 | [Remote-Workspace](REMOTE_WORKSPACE_GOALS.md) | Neustart, Bereitstellung, Git-Abgleich, parallele Projekte |
| 16–19 | [Remote-Workbench](REMOTE_WORKBENCH_GOALS.md) | Dateien/Git, Terminal, Textbearbeitung, Profile |
| 20–21 | [Session-Workspace](SESSION_WORKSPACE_GOALS.md) | Geliefert: eigener Ordner ohne Projekt und Startauswahl je Sitzung |
| 22 | Historischer Alias für den SSH-Vorschlag | Fortgeführt als Goal 30; kein eigener aktiver Auftrag |
| 23 | [Sprache](VOICE_USAGE_TERMINAL_PLAN.md) und [Diktat](CLI_WORK_AND_DICTATION_GOALS.md) | Stimmenwahl/Stimmtest geliefert; 23.1 Diktat auf PC und Tablet aktiv |
| 24 | [Verbrauch und Kosten](USAGE_AND_COST_GOALS.md) | Aktiver Implementierungsauftrag; Aboquoten sind ein getrennter Datenvertrag |
| 25 | [Terminal-Latenz](CLI_WORK_AND_DICTATION_GOALS.md#goal-25-reaktive-tablet-terminals) | Aktiv: Messung und Optimierung; tatsächliche Geräte-/Netzabnahme gesondert |
| 26 | [Main-Chef-Koordination](MAIN_CHEF_COORDINATION_PLAN.md) | Profilkontext teilweise geliefert; weitere Delegation separat geplant |
| 27 | [CLI-Arbeitsübersicht](CLI_WORK_AND_DICTATION_GOALS.md) | Aktive Lieferung mit gemeinsamer Work-/Overview-Liste |
| 28–30 | [Multi-Host-Vorschlag](MULTI_HOST_ACCESS_PLAN.md) | Hostwechsel, Gast-/Gerätefreigabe, SSH; separater Vorschlag |
| 31 | [Ollama-Coding-Harness](OLLAMA_HARNESS_GOALS.md) | Abgeschlossen: Auswahl Codex CLI/Qwen Code, persistierte Profile, PC-/Tablet-Starts und verwaltete Aufgaben; vollständige Abnahme bestanden, Commit 3b0bddd gebaut und persönlich aktiviert |
| 32 | [Fünf Minuten Live-Diktat](LONG_DICTATION_GOALS.md) | Abgeschlossen: 5-Minuten-Diktat und Startfrist geprüft; Computer-Hotfix 06cd6ea aktiviert; Gesamtabnahme bestanden |
| 33 | [Persönlicher Sprachdialog](VOICE_COMPANION_PROPOSAL.md) | 33.0: Computer-Aufruf auf PC/Tablet aktiviert; [33.0b Stimmen-Tab](VOICE_SETTINGS.md) implementiert und fokussiert geprüft, Gesamtabnahme läuft; Rückblick und weitere Aktionen als Vorschlag |

Im Multi-Host-Vorschlag vom 13. September waren 20 und 21 erneut vergeben,
obwohl sie bereits zum Session-Workspace gehörten. Die vorgeschlagenen
Multi-Host-Ziele 20/21/22 heissen deshalb jetzt 28/29/30 (einschliesslich
28a/28b für die bisherigen 20a/20b). Historische Nachweise behalten ihre
damaligen Bezeichnungen; nur aktuelle Verweise wurden umgestellt.

T0–T7, S0–S3 und weitere lokale Teilaufgaben in einzelnen Lieferplänen sind
dokumentbezogene Kennungen und keine zusätzlichen globalen Goal-Nummern.
Dokumentationsabgleich, Tests, Commit/Push und Build sind Abnahmeschritte des
aktiven Auftrags, keine unabhängig als fertig zu markierenden Ersatzlieferung.
