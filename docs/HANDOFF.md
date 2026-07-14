# Handoff — 2026-07-14 (Stand: `5d1d93b` auf `origin/main`)

Alles committet und gepusht; Arbeitsbaum sauber. Diese Session hat **Goal 6
gestartet** (Produktvalidierung) und dabei mehrere echte Produktfehler
gefunden und behoben.

## Sofort wissen

1. **Nach jedem Pull: `pnpm i` und ADE komplett neu starten.** Die wichtigsten
   Änderungen liegen im Main-Prozess (Stream-Adapter, Telemetrie-Parser) —
   ohne Neustart läuft der alte Code, und die Token-/Kostenzahlen bleiben leer.
2. **Ein Run wartet auf dich:** `37d41c5d` (F2 managed) steht am Freigabe-Gate.
   Sein Code ist geprüft und sauber (siehe unten) — aber die Messung ist
   entwertet, siehe „Offene Punkte".
3. **Managed Claude-Worker brauchen Permission-Mode `bypass`.** Mit `default`
   verweigert Claude Code im nicht-interaktiven Print-Modus jedes Edit/Write/
   Bash — der Task verhungert und kann nicht einmal den „blocked"-Report
   schreiben. Der geleaste Wegwerf-Worktree *ist* die Sandbox.

## Was diese Session gebaut hat

**Claude Stream-JSON-Adapter** (`426b8d6`, Kernstück): Managed Claude-Tasks
laufen jetzt mit `--output-format stream-json`. Das löst drei Probleme auf
einmal:

- **Live-Sichtbarkeit**: Der Graph zeigt einen lesbaren Aktivitäts-Feed
  („✻ Denkt nach…", „⚙ Bash: pnpm test", „■ Fertig · 2 Turns · $0.25") im
  Inspector und im unteren Dock, umschaltbar aufs rohe Terminal. Vorher war
  ein laufender Task komplett unsichtbar, weil `claude -p` seine
  menschenlesbare Ausgabe bis zum Prozessende puffert.
- **Echte Telemetrie**: Tokens *und* echte Kosten (`total_cost_usd`) kommen aus
  der CLI. Input zählt Fresh + Cache-Write + Cache-Read — alles andere machte
  Budgets bedeutungslos. **Kostenbudgets funktionieren damit erstmals für
  Claude.** Fehlt das Result-Event, bleibt die Usage `null` (nie 0), damit
  Budgets fail-closed bleiben.
- **Robuster Parser** (`src/main/orchestration/claudeStream.ts`): Der schwierige
  Teil. ConPTY bricht lange Zeilen hart um, und der 256-KB-Ring-Buffer liefert
  nur das *Ende* eines langen Tasks — das Transkript beginnt also mitten in
  einem Event, oft mitten in einem JSON-String, manchmal mit einer verirrten
  `{` aus abgeschnittenem Quellcode. Die Extraktion verankert deshalb am
  Event-Diskriminator `{"type":"`, matcht dessen Klammern und entfernt vorher
  ANSI **und alle Zeilenumbrüche**. Regressionstests decken beide Fälle ab.

**UI-Verbesserungen** (alle auf deinen Zuruf entstanden): aufklappbare
Freigabe-Meldung mit **echtem Diff** pro validiertem Commit (neues
sanitisiertes Domain-Command `run:approvalDiff`, mobile-tauglich) samt
Farbumschalter; Live-Dock unten, resizable; verschiebbares Task-Slots-Panel;
mitwachsender Cluster-Rahmen beim Ziehen; „Session öffnen" ist während einer
aktiven Lease deaktiviert statt zu scheitern; Pfad-Eingabe für UNC/WSL-Repos.

**Drei behobene Bugs, die nur der echte Betrieb zeigte:**

- `claude -p` mit Argument-Transport verlor jeden Prompt ab dem ersten `"`
  (PowerShell 5.1 escaped Quotes in nativen Argumenten nicht) → jetzt Stdin.
- „Live zuschauen" erschien nie: Main-gestartete Task-PTYs landen nie im
  Session-Store des Renderers → Erkennung nutzt jetzt den Task-Record.
- Right-Panel scrollte nicht: `react-resizable-panels` setzt `overflow: hidden`
  **inline** auf jedes Panel und schlägt damit jede CSS-Regel → Scroll-Container
  liegt jetzt *innerhalb* des Panels.

## Goal 6: Stand der Messreihe

Plan und Fixtures: `docs/goal6/VALIDATION_PLAN.md` · Ergebnisse und Findings:
`docs/goal6/RESULTS.md` · Metriken: `pnpm goal6:report --run <id> --md`.

| Fixture | Managed | Baseline | Verdikt |
| --- | --- | --- | --- |
| F1 settings-reduced-shake | ✅ completed (`40fee766`, aktiv 10m12s) | ✅ completed (`cad775c2`, 3m29s) | Single-Agent ~3× schneller bei gleicher Codequalität; Managed kauft Nachweis und Kontrolle, nicht Tempo |
| F2 weapon-presentation-tests | ⏸ am Gate (`37d41c5d`) — **Messung entwertet** | offen | offen |
| F3–F6, F8 | offen | offen | offen |
| F7 approval-durability | ✅ Approve-Pfad + Neustart am Gate bestanden | — | Reject-Pfad offen |

Beweis-Branches im Pilot-Repo: `goal6/f1-a6-*`, `goal6/f1-a7-*`,
`goal6/f1-baseline`. Beide Worktrees stehen sauber auf Baseline `81820b9`.

## Offene Punkte (priorisiert)

1. **Zieltext-Kontamination beheben — vor der nächsten Fixture.** Drei von acht
   Runs enthielten Fixture-Metadaten im Ziel. Bei F2 leakten dadurch die Score
   Notes, die dem Agenten verrieten, dass „zero diffs outside test files"
   maschinell geprüft wird — **genau die Eigenschaft, die die Fixture messen
   soll**. Der Code von F2 ist sauber (exakt eine Testdatei, +127/−0, 91/91
   Tests, drei vermutete Bugs dokumentiert statt gefixt), aber das
   Ehrlichkeits-Verdikt zählt nicht. **Produktfix:** Der Neuer-Run-Dialog muss
   das vollständige Ziel zeigen (aufklappende Textarea oder Vorschau), bevor
   „Run erstellen" gedrückt wird. Danach F2 managed sauber wiederholen.
2. **F2-Wiederholung + F2-Baseline**, dann weiter nach Plan: F5 (Parallelität —
   die eigentliche Kernfrage), F4 (wann *nicht* zerlegen), F3, F6, F8.
3. **Interaktive Session hinterlässt `CLAUDE.md` im Repo-Worktree** und
   blockiert damit die nächste Managed-Lease („worktree is not clean").
   Behelf: `git clean -f -- CLAUDE.md`. Fix: Instruktionsdatei ausserhalb des
   Worktrees schreiben, beim Session-Ende entfernen, oder ADE-eigene
   Scaffold-Dateien von der Sauberkeitsprüfung ausnehmen.
4. **Blocked-Report-Kanal für eingeschränkte Agenten**: Ein Worker mit
   `default`-Permissions kann nicht einmal `outcome=blocked` melden, weil das
   Schreiben der RESULT.json selbst verweigert wird. Der Task-Ordner sollte
   dem Agenten explizit zugänglich sein (`--add-dir`).
5. **Config-Key-Verlust**: Ein Save schrieb `config.json` transient ohne
   `repositories`/`workspaceBindings`. `ConfigStore.save` ignoriert jetzt
   `undefined`-Werte (Schutz greift), aber die **verursachende Save-Stelle ist
   noch nicht gefunden**.
6. **Argument-Transport bei codex/gemini/ollama** hat dieselbe Quote-Schwäche
   wie Claude vor dem Fix — noch nicht umgestellt.
7. Team-Pause überlebt keinen Neustart; Brief-Cache nur in-memory (beides aus
   Graph P0 bekannt).

## Verifikation dieses Stands

`pnpm run typecheck`, `pnpm test` (24 Memory + 12 Dispatch + 20 Runtime + 45
Orchestration + 62 Orchestration-Beta + 28 Prompts + 39 Repository-Scopes + 94
Security) und der 41-Check-Electron-Workflow sind grün. Der Stream-Parser wurde
zusätzlich gegen eine **echte** Claude-Ausgabe verifiziert (identische Ergebnisse
bei 37-Byte-Chunks und bei ConPTY-Wrapping mit ANSI-Müll).

## Betriebsregeln für Goal-6-Runs

- **Ziel = nur der Inhalt des Codeblocks** der Fixture-Karte. Nie Überschrift,
  Klassenzeile oder Score Notes — die verraten dem Planner das Messkriterium.
- Vor einem Managed Run **keine interaktive Session** im selben Repo-Scope
  öffnen (siehe Punkt 3).
- Nach jedem Run: Beweis-Branch anlegen
  (`goal6/<fixture>-a<versuch>-worker|-integrated`), dann die beteiligten
  `ade/*`-Worktrees `git reset --hard 81820b9`. Niemals bei aktiver Lease.
- Pilot-Repo `2D_rpg_jumpnrun`: Arbeitsbaum und `main` **niemals** anfassen,
  kein Push ohne separate Freigabe.
