# Native Verbindungen für den ADE-Agenten

17. September 2026. Ausführungsbelege dieses Checkouts; keine Gleichsetzung von
CLI-Fähigkeit, ADE-Adapter und fertiger Benutzerfunktion. Alle neuen nativen
Proben liefen unter **Windows nativ**. Linux/WSLg, Windows-UI mit WSL-Backend und
macOS wurden für diese neuen Gesprächsverträge nicht abgenommen.

| Verbindung | Codex 0.154.0 | Claude Code 2.1.274 | Grok |
|---|---|---|---|
| Bestehende interaktive CLI in ADE anzeigen/bedienen | Vorhandener PTY-Weg; neue Navigation mit deterministischen CLI-Prozessen geprüft | Vorhandener PTY-Weg; kein neuer nativer UI-Pilot | Vorhandener Laufzeitresolver; hier kein nativer UI-Pilot |
| Abgeschlossene native Gesprächsantwort | App-Server `turn/completed` nativ geprüft | Print/Stream-JSON `result` nativ geprüft | Nicht geprüft |
| Weitere Nachricht im selben Prozess mit Kontext | Nativ geprüft | Nicht geprüft; bisher neue Print-Prozesse | Nicht geprüft |
| Neuer Prozess, gleiche native Unterhaltung und Kontext | `thread/read` + `thread/resume`, nativ geprüft | Exakte selbst erzeugte UUID mit `--resume`, nativ geprüft | Dokumentierter Weg, hier nicht geprüft |
| ADE prüft gespeicherten Workspace vor Resume | Codex-Adapter implementiert; negative Protokollfixture | Noch kein Gesprächsadapter; CLI sucht IDs auch projektübergreifend | Offen |
| Gesprächsschritt unterbrechen und weitere Nachricht | Protokollfixture bestätigt; keine neue native Abbruchprobe | Offen | Offen |
| Dynamisches ADE-Werkzeug mit korreliertem Ergebnis | Nativ nach Resume geprüft; doppelte/verspätete Ereignisse separat mit Fixture | Offen | Offen |
| Rückfrage/Antwort samt Zustellbestätigung | Vorhandener Codex-Task-Vertrag, 26/0; zentraler Desktop-Dialog mit nativem Protokollpeer geprüft | Offen | Offen |
| Laufenden fremden CLI-Prozess wieder anbinden | Nicht durch Resume belegt | Nicht durch Resume belegt | Offen |
| Native Unteragenten im globalen Graph | Offen | Offen | Offen |
| Zentrale Koordination zweier unabhängiger Umsetzungen | Offen | Offen | Offen |

Die nativen Markerproben verändern kein Nutzerprojekt. Codex verwendet
`gpt-5.6-sol` mit beobachtetem `high` und read-only. Claude verwendet sein natives
Defaultmodell, beobachtet `claude-opus-5[1m]`, mit `plan`, `--safe-mode`,
`--restricted`, leerem `--tools` und leerer strikter MCP-Konfiguration. Ein Modell
wird nicht allein aufgrund des gewünschten Startarguments als beobachtet gemeldet.

Codex-Gesprächsprobe **4/0**, eingeschränkter Koordinatormodus **5/0**,
native Koordinator-Konfiguration **3/0**, Claude-Probe **3/0**; JSON und Logs unter
`test-results/main-agent-planning/`. Beide Driver sind bewusst opt-in und nicht
Teil des kostenfreien `pnpm verify`-Rezepts. Das Modell für den zentralen ADE-
Agenten ist in der Produktkonfiguration weiterhin explizit zu wählen.
Die produktive Gesprächsservice-Anbindung besteht zusätzlich **4/0** mit echter
Codex-CLI: unabhängig erzeugte gespeicherte Übergabe durch ADE-Domänenwerkzeuge
lesen, tatsächliches Modell/Reasoning erfassen, Antwort dauerhaft speichern und
mit neuem Prozess den Benutzerkontext fortsetzen. Der Desktop-Driver **17/0**
nutzt dagegen einen isolierten Protokollpeer; die beiden Belege sind getrennt.
Der eingeschränkte Modus verwendet den gepinnten Vertrag für CLI 0.154.0,
deaktivierte native Ausführungswerkzeuge und read-only ohne Netzwerk. Die
Code-Mode-Werkzeugvermittlung bleibt für ADE-Werkzeuge aktiv. Die negative
Schreibprobe und der danach erfolgreiche ADE-Aufruf ersetzen keine Prüfung
der noch zu implementierenden steuernden Projektwerkzeuge. Die fünf lesenden
Projekt-/Übergabewerkzeuge sind inzwischen angebunden und separat geprüft.

`grok` wurde im aktuellen Windows-PATH nicht gefunden. Die offiziellen
[Headless-Verträge](https://docs.x.ai/build/cli/headless-scripting) nennen benannte
Sitzungen und ACP; das ersetzt keine installierte native Verbindungsprobe.
Der Gesamtpilot kann deshalb derzeit nicht als Codex/Claude/Grok bestanden gelten.

[Implementierung und Prüfstand](MAIN_AGENT_IMPLEMENTATION.md) ·
[Goal- und Abnahmeplan](MAIN_AGENT_GOALS.md) ·
[Codex App Server](https://learn.chatgpt.com/docs/app-server) ·
[Claude CLI-Referenz](https://code.claude.com/docs/en/cli-reference)
