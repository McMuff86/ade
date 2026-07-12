# Handoff — 2026-07-13 (Branch `ade/main-chef-25f73f`)

Session „Main Chef" abgeschlossen. Alle Änderungen sind committet und nach
`origin/ade/main-chef-25f73f` gepusht. PR anlegen/mergen:
https://github.com/McMuff86/ade/pull/new/ade/main-chef-25f73f

## So bekommst du die neuen Funktionen in deine laufende App

Die App startest du aus deinem Original-Repo (`C:\Users\Adi.Muff\repos\ai_agent_code_workspace`).
Dort ist der Stand erst da, wenn der Branch gemergt bzw. ausgecheckt ist:

```powershell
cd C:\Users\Adi.Muff\repos\ai_agent_code_workspace
git fetch origin
git merge origin/ade/main-chef-25f73f   # oder: PR auf GitHub mergen und dann git pull
pnpm i
pnpm dev
```

## Was in diesem Branch neu ist

1. **Terminal-Clipboard** — Ctrl+C kopiert die Auswahl (ohne Auswahl weiterhin
   Abbruchsignal), Ctrl+Shift+C/Ctrl+Insert kopieren immer, Ctrl+V /
   Ctrl+Shift+V / Shift+Insert fügen Text ein. Screenshot-Paste in Claude Code
   funktioniert weiter (bild-only Clipboard reicht das rohe ^V durch).
   Technisch: neue IPC-Kanäle `clipboard:readText/writeText`, weil der Renderer
   bewusst alle Browser-Permissions verweigert.
2. **Run löschen im Graph** — Button in der Run-Leiste, zweistufige
   Bestätigung. Löscht nur Orchestrierungs-Datensätze (Run, Tasks, Events,
   Artefakte, Leases …), niemals Dateien/Worktrees/Branches. Laufende
   Managed-Runs müssen zuerst abgebrochen werden.
3. **Worktrees neben dem Repo** — neue Worktrees entstehen unter
   `<Repo-Elternordner>\.ade-worktrees\<repo>\<agent>` statt in
   `%APPDATA%\Roaming`. Override via `settings.worktreeBaseDir` in der
   config.json. Bestehende Bindings behalten ihre Pfade.
4. **„Remove worktree"** im Repository-Scope-Panel — geschützte Bereinigung
   (verweigert bei offener Session, laufenden Tasks, aktiver Lease oder
   uncommitteten Änderungen; unmerged `ade/*`-Branches bleiben erhalten).
   Damit räumst du die alten AppData-Worktrees agentweise ab; beim nächsten
   Einsatz entsteht der Worktree automatisch am neuen Ort.
5. **Branch-Anzeige im Graph** — jede Agent-Karte (auch Orchestrator) zeigt
   `⎇ ade/<agent>` des Worktrees im Repo-Scope des Runs.
6. **Agent-Files-Panel** — leere MEMORY.md/USER.md zeigen jetzt eine Erklärung
   statt einer leeren Fläche. Die Dateien füllen sich, sobald ein Agent
   Notizen speichert (Main Chef hat seine bereits befüllt).
7. **Skill für Agents** — `.claude/skills/ade-orchestration/SKILL.md` erklärt
   jedem Agenten das Worktree-Modell, Spawn-/Lösch-Wege und die harten
   Sicherheitsregeln (Originale in `C:\Users\Adi.Muff\repos` sind tabu).
   `.gitignore` versioniert jetzt `.claude/skills/`, Rest von `.claude/`
   bleibt lokal.
8. **Neuer-Run-Dialog** erklärt die Scope-Wahl (Repo-Worktrees vs. Agent-Homes).

## Verifikation

`pnpm run typecheck`, `pnpm test` (8 Suiten, ~283 Checks) und
`pnpm run build` sind auf diesem Stand grün. Neue Testabdeckung: Run-Löschung,
Scope-Snapshots (Repo/`null`), Worktree-Standort + Override, Cleanup-Guards,
IPC-Validierung der neuen Kanäle.

## Manuell kurz prüfen nach dem Start

- Terminal: Text markieren → Ctrl+C → Ctrl+V fügt ein; Screenshot-Paste in
  Claude Code geht weiterhin.
- Graph: Run auswählen → „Run löschen" (zweimal klicken); Agent-Karten zeigen
  den Branch.
- Rechts: „Remove worktree" bei einem alten AppData-Worktree; neue Session im
  Repo → Worktree liegt unter `repos\.ade-worktrees\...`.

## Offene Punkte / nächste Schritte

- **WSL-Runtime („Hermes")**: Agent mit Custom Command via `wsl.exe` geht
  heute schon; sauberer Ausbau = Runtime-Preset mit Pfad-Übersetzung
  `C:\...` → `/mnt/c/...` für repo-gebundene Tasks.
- **ADE auf WSL/Linux**: Electron + node-pty sind portabel; Hauptarbeit ist
  ein Linux-Build-Target, Pfad-/Kommando-Annahmen prüfen (`resolveTaskLaunchCommand`
  kennt schon win32/posix) und Packaging. Empfehlung: ADE dort betreiben, wo
  die Repos liegen — pro Welt eine Instanz, nicht über die Grenze hinweg.
- UI-Einstellung für `worktreeBaseDir` (derzeit nur config.json).
