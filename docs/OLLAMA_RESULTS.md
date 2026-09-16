# Ollama in ADE (15. September 2026)

Erweiterung vom 16. September: [Goal 31](OLLAMA_HARNESS_GOALS.md) ergänzt
Qwen Code als auswählbaren Coding-Harness. Die folgenden Nachweise beschreiben
die ursprüngliche Codex-Anbindung; aktuelle Abnahme und Aktivierung stehen im
Goal-31-Dokument und im [Handoff](HANDOFF.md).

Der Operator hat das Diktat erfolgreich selbst getestet und einen zusätzlichen
Ollama-Agenten samt Modellübersicht beauftragt.

## Bedienung und Vertrag

- Agent anlegen/bearbeiten → Runtime **Ollama** → **Ollama verwenden als**.
- **Coding-Agent · Codex CLI mit Ollama** verwendet das gewählte Ollama-Modell
  mit `codex --oss --local-provider ollama --model <id>` und dem gewählten
  Berechtigungsmodus. Die Codex CLI stellt Datei-/Kommando-Werkzeuge bereit.
- **Direkter Modellchat · Ollama** erhält `ollama run <id>`. Vorhandene Profile
  ohne `ollamaMode` bleiben in diesem Modus. Neue Ollama-Profile schlagen Coding vor.
- Der Selektor liest `ollama list` in der gewählten Ausführungsumgebung und lässt
  sich aktualisieren. Leere Liste, nicht erreichbarer Dienst und ein nicht mehr
  bestätigtes gespeichertes Modell bleiben unterscheidbar. Keine Modellinstallation
  oder Inferenz durch die Listenabfrage. Werkzeugfähigkeit ist keine Zusage für
  jedes aufgeführte Modell, beispielsweise ein Embedding-Modell.
- `ollamaMode: 'chat' | 'coding'` überlebt Profil, Vorlage, Kopie, Export/Import.
  Bestehende streng validierte IPC-Kanäle werden verwendet. Coding prüft vor dem
  Start die Codex-Installation und das gewählte Modell erneut im Backend.
- Der verwaltete Adapter `ollama-codex-jsonl-v1` verwendet das vorhandene
  strukturierte Codex-Protokoll samt Ergebnisdatei und Schema. Seine Identität
  bleibt von `codex-jsonl-v1` getrennt; Goal 6 bleibt Codex-only.
- PC-/Tablet-Projektstart mit **Gespeichertes Agent-Profil** verwendet die
  gespeicherte Ollama-Einstellung. Der direkte Starttyp **Ollama** bleibt Modellchat.

## Verbrauch und Reverse Proxy

Für neue native Windows-Sitzungen von Codex, Claude Code und Grok ist bereits
eine Sitzungserfassung implementiert: ein authentisierter lokaler OTel-Empfänger
und exakt zugeordnete lokale CLI-Ereignisse/Dateien. **Kein Reverse Proxy** für
Modellanfragen; Inferenz-Endpunkte und globale Anbieter-Anmeldungen werden nicht
umgestellt. Details und Grenzen: [Nutzungsquellen](USAGE_SOURCE_RESULTS.md).

Die neue interaktive Ollama-Anbindung hat noch keinen Sitzungskollektor.
Sie wird nicht als OpenAI-Aboverbrauch verbucht. Verwaltete Aufgaben lesen die
vom CLI gemeldeten Tokenzähler; Geldkosten bleiben unbekannt. Modelllokalität,
Stromkosten und Cloud-Abrechnung werden nicht aus dem Modellnamen geraten.

## Bisherige Nachweise

- `test-runtime-models.ts`: 30 Checks, einschliesslich leerem Ollama-Katalog,
  Dienstfehler und erfolgreicher Aktualisierung nach Wiederherstellung.
- `test-ollama-coding.ts`: 21 Checks für Start/IPC/Persistenz/Export/Adapter und
  fehlende CLI/Modelle; positiver Startcheck nach den negativen Fällen.
- `test-ollama-electron.ts`: 18 reale Electron/IPC/ConPTY-Checks mit lokalen
  CLI-Fixtures: Anlegen, Speichern, Tastatur/Fokus, Aktualisieren, Fehler, Vorlagen,
  gewähltes Modell im echten Prozess und Startverweigerung bei entferntem Modell.
- TypeScript für alle drei Projekte und Produktionsbuild bestanden.
- ADEs echter `RuntimeModelService` hat am nativen Ollama-Dienst 13 Modelle
  bestätigt, einschliesslich `qwen3-coder:30b`; lokaler Nachweis:
  `test-results/ollama/native-catalog.json`.
- Echte native Windows-Probe mit Ollama **0.34.0**, Codex CLI und vorhandenem
  **qwen3-coder:30b**: `sum.cjs` von Subtraktion auf Addition geändert; eigener
  Node-Test des Agenten liefert `5` für `sum(2, 3)`.
  Der erste Versuch mit einer frischen isolierten Codex-Konfiguration und
  `workspace-write` wurde von der Windows-Sandbox blockiert. Die positive Probe
  verwendet Bypass in einem eigenen temporären Testordner. Das ist kein Nachweis
  für die Sandbox-Einrichtung auf dieser Maschine. Die CLI meldet für Qwen
  fehlende Modellmetadaten und fällt auf Standardmetadaten zurück; ein zunächst
  unpassender `apply_patch`-Aufruf wurde vom Modell durch einen Shell-Edit ersetzt.
  Diese begrenzte Probe ist keine allgemeine Qualitätszusage für grosse Aufgaben.
- Native Linux/WSLg, Windows mit WSL-Backend und macOS wurden für dieses Coding-
  Profil nicht praktisch abgenommen. Die Backend-Auswahl ist fokussiert geprüft.

Die vollständige Prüfkette ist in zwei Teilläufen abgedeckt: `pnpm verify`
bestand 71 Suiten mit 2.980 Fachchecks, Build und die nachfolgenden App-/Browser-
Driver bis zum Einrichtungstest. Dessen veraltete Annahme über den Projektfilter
wurde ausschliesslich im Test korrigiert: er wählt vor dem ersten Öffnen „Alle“
und prüft den voreingestellten persönlichen Filter. Danach bestanden seine
38 Checks, die verbleibenden 22 Visualchecks und nochmals TypeScript.
Ein einzelner erneut grüner `pnpm verify` wurde danach nicht ausgeführt.
Temporäre Probe-Ordner: `ade-ollama-proof-jEFM77` (Sandbox blockiert),
`ade-ollama-proof-YGmBlL` (Datei geändert und getestet), jeweils im Windows-Temp.
Screenshot: `test-results/ollama/settings.png`.

## Persönliche Aktivierung

Nach ausdrücklicher Freigabe wurde die offene Codex-Sitzung beendet und ADE
neu gestartet. Das portable Profil **Ollama** unter **Coding-Profile** verwendet
`ollamaMode=coding`, `qwen3-coder:30b` und Berechtigungen `default`.
Anlage über normales IPC; dauerhaftes `AGENTS.md` und unveränderte bisherige
Agenten/Repositories geprüft. Die ursprüngliche Konfiguration ist gesichert.
Die persönliche ADE läuft wieder; der geöffnete Einstellungsdialog zeigt die
13 Modelle des lokalen Dienstes. Keine persönliche Coding-Sitzung gestartet.
Nachweise: `test-results/ollama/activation.json`,
`test-results/ollama/personal-active-models.png`; Sicherungspfad im [Handoff](HANDOFF.md).

## Quellen

[Ollama: Codex CLI](https://docs.ollama.com/integrations/codex) und
[OpenAI: lokale Provider](https://learn.chatgpt.com/docs/config-file/config-advanced#oss-mode-local-providers).
Die installierte CLI bestätigt `--oss` und `--local-provider ollama` in ihrer Hilfe.
