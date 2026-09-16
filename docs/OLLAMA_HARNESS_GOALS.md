# Goal 31 — Coding-Harness für Ollama wählen

Auftrag vom 16. September 2026: Für denselben Ollama-Modellstand zwischen Codex
CLI und Qwen Code wählen können. „Ollama“ ist der Modellanbieter; die beiden
Coding-Harnesses liefern Werkzeuge und Ausführung. Ein Arbeits-Goal verfolgt
diese Lieferung bis Tests, Commit, Build und persönlichem Neustart. Neue native
`/goal`-Befehle oder eine automatische Dauerschleife sind kein zusätzlicher
Produktvertrag dieser Änderung.

## Goal 31.1 — Auswahl und Profile

- Agent anlegen/bearbeiten → Runtime **Ollama** → **Coding-Agent** →
  **Coding-Harness**: **Codex CLI · Ollama** oder **Qwen Code · Ollama**.
- Modell separat aus dem bestehenden installierten Ollama-Katalog wählen.
- `ollamaHarness?: 'codex' | 'qwen-code'` ist streng validiert und bleibt in
  Profilen, Vorlagen, Kopien, Export/Import und mobilen Profilkopien erhalten.
- Fehlendes Feld erhält Codex. Abwesender/Chat-Modus erhält `ollama run`.
  Eigene Startbefehle behalten ihren bestehenden Vorrang.
- Tastaturreihenfolge: Verwendung → Harness → Modell. Der Harness erscheint
  nur bei Coding; Einstellungen zeigen den tatsächlichen Startbefehl und die
  benötigte CLI. Fehlende CLI/Modelle werden vor dem PTY-Start abgewiesen.

## Goal 31.2 — Ausführung und Ergebnisse

- Qwen Code **0.23.4** ist auf dem nativen Windows-Host installiert und seine
  dokumentierten CLI-Optionen sind geprüft. Es verbindet sich pro Aufruf mit
  `http://127.0.0.1:11434/v1` in der gewählten Ausführungsumgebung. Abweichende
  Ollama-Endpunkte sind für den neuen Qwen-Pfad nicht konfigurierbar.
- Modell, Authentifizierungsart und der öffentliche Platzhalter `ollama`
  werden ausdrücklich gesetzt; bestehende Cloud-Anmeldungen bleiben bestehen.
- ADE `default` / `accept-edits` / `bypass` werden Qwen `default` / `auto-edit` /
  `yolo`. Diese Zustimmungsmodi sind keine Zusage einer Windows-Sandbox.
- Interaktive native Windows-Sitzungen liefern Identität, aktivierte Erinnerungen
  und gespeicherte Profilanweisungen zusätzlich über `--append-system-prompt`;
  dies gilt auch ohne eigens bearbeitetes Verhaltensprofil. Keine neue QWEN.md
  im Projekt. Externe unveränderliche Snapshots
  und PowerShell-Argumenttransport verhindern Auswertung von Profiltext.
- `ollama-qwen-stream-json-v1` liefert Aufgabentext auf stdin und das JSON-Schema
  als Datei. Nur ein erfolgreicher terminaler CLI-Ergebnisdatensatz mit gültigem
  ADE-Schema wird übernommen. Hauptprozess schreibt die Ergebnisdatei.
- Tokenzahlen kommen aus dem CLI-Ergebnis; Cache-Lesezahlen werden nicht erneut
  addiert. Fehlende Tokenzahlen und Geldkosten bleiben unbekannt. Interaktive
  Ollama-Nutzungsdaten bleiben separat offen.
- Beide Ollama-Adapter bleiben von nativen Codex-/Goal-6-Messungen getrennt.
  Keine neuen Remote-Schreibkanäle oder erweiterten IPC-Freigaben.

## Goal 31.3 — Abnahme und Aktivierung

Aktuell positive Nachweise:

- `test-ollama-coding.ts`: **46 Checks** für Persistenz, IPC, portable Daten,
  Startoptionen/Berechtigungen, Ergebnisvertrag, Telemetrie und Negativfälle.
- `test-profile-launch.ts`: **14 Checks**, darunter tatsächlicher Qwen-Profil-
  Argumenttransport unter PowerShell 5.1 und 7 mit Unicode und Shell-Zeichen.
- `test-ollama-electron.ts`: **28 Checks** mit echten Electron-/IPC-/ConPTY-
  Prozessen und deterministischen CLI-Fixtures für beide Harnesses.
- `test-remote-terminal-electron.ts --ollama-harness-only`: **5 Checks** mit
  gekoppeltem Tablet-Browser, Gerätefreigabe und echten Host-PTY-Starts beider
  gespeicherter Harness-Varianten. Keine automatische Behauptung einer Prüfung
  auf einem physischen Tablet.
- Reale lokale Modellprobe: `pnpm exec tsx scripts/probe-ollama-qwen.ts`.
  Separater temporärer Testordner, unveränderte Testdatei, erwarteter Fehler vor
  der Modelländerung und abschliessender positiver Node-Test. **Bestanden** mit
  Qwen Code **0.23.4** und **qwen3-coder:30b**. Adapterergebnis `succeeded`,
  Test unverändert, Datei geändert, CLI-Telemetrie 123.354 Eingabe- und 595
  Ausgabetokens über alle Aufrufe. Probe mit ausdrücklichem Bypass nur im
  isolierten temporären Testordner; kein Nachweis einer Sandbox-Einrichtung.
  Nachweis: `test-results/qwen/native-proof.json`, vollständiger CLI-Stream:
  `test-results/qwen/native.stdout.jsonl`. Kein allgemeiner Qualitätsvergleich
  zwischen den Harnesses und kein neuer Modell-Download.
- Vollständiges `pnpm verify`: **bestanden**, Exit 0. Drei TypeScript-Projekte,
  **72 Suiten / 3.088 Fachchecks**, Produktionsbuild, alle Electron-/Browser-
  Abläufe und **22 Visualchecks**. Log: `test-results/qwen-verify-final.log`.
  Codecommit, finaler Build und persönliche Aktivierung folgen.

Der erste Gesamtversuch bestand 72 Suiten/3.088 Checks, Build und die ersten
App-Flows, scheiterte dann an der neuen Tablet-Fixture: Sie druckte den ganzen
Profiltext und beendete sich, sodass ihre Startmeldung vor dem Attach aus dem
sichtbaren Terminal verschwand. Die Fixture zeigt nun eine knappe Statuszeile
und bleibt interaktiv offen. Die gezielte positive Wiederholung mit beiden
Harnesses besteht; die vollständige Wiederholung ist mit Exit 0 bestanden. Die gemeinsame
Adapter-/Ereignisverarbeitung besteht zusätzlich **151 Regressionschecks**.

Logs: `test-results/qwen-{final-typecheck,electron,tablet-final,native}.log`,
`test-results/qwen-adapter-regression.log`, `test-results/qwen-verify-final.log`;
Screenshots: `test-results/ollama/settings.png`,
`test-results/remote/ollama-qwen-tablet.png`.
Native Linux/WSLg, Windows mit WSL-Backend und macOS wurden nicht praktisch
abgenommen; plattformspezifische Startbefehle sind fokussiert geprüft. Der
interaktive Profiltransport bleibt ausdrücklich auf natives Windows begrenzt.

## Quellen

- [Qwen Code 0.23.4 CLI-Optionen](https://github.com/QwenLM/qwen-code/blob/v0.23.4/packages/cli/src/config/top-level-options.ts)
- [Qwen Code Headless-Modus](https://qwenlm.github.io/qwen-code-docs/en/users/features/headless/)
- [Qwen Code Authentifizierung](https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth/)
- [OpenAI: lokale Provider](https://learn.chatgpt.com/docs/config-file/config-advanced#oss-mode-local-providers)
