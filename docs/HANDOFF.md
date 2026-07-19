# Handoff — 2026-07-19

Dieser Handoff beschreibt den zusammenhängenden Stand des aktuellen
Plattformabschlusses. Der vorherige Codex-/Goal-6-Abschluss (`7902b96`), die
Linux-/WSL-Implementierung (`3762b00`) und die auf dem ersten Hosted-Run
entdeckte E2E-Wartebedingung (`d32faa9`) sind auf `origin/main` veröffentlicht.
Der Abschlusszustand verlangt identisches lokales `main`/`origin/main` und
einen sauberen Git-Worktree.

## Ergebnis dieser Session

- **Goal 6 bleibt abgeschlossen**; F1-F8, Einzelagent-Arme, Negativkontrollen
  und das begrenzte GO für Goal 7 stehen vollständig in
  `docs/goal6/RESULTS.md`.
- Der reale Pilot-Roster bleibt **Codex-only**: `Main Chef` nutzt
  `gpt-5.6-sol`, `xhigh` und bypass als Orchestrator; Leads/Worker nutzen
  `gpt-5.6-sol`, `high` und bypass. Absichtliche Shell-Helfer bleiben Shell.
  Es gibt keine gespeicherte Claude-Identity im Pilotprofil.
- Jede gespeicherte Identity besitzt ihr von ADE nachgeführtes Rollen-
  `AGENTS.md`. Managed Orchestrator-/Lead-/Worker-Tasks erhalten zusätzlich
  einen read-only Snapshot mit Digest und Provenance, ohne ihr Worktree zu
  verschmutzen.
- Der native Linux-/WSLg-Pfad ist nicht mehr nur ein Source-Smoke: ADE baut
  jetzt reproduzierbar als unpacked x64, AppImage und Debian-Paket.
- Die Windows-GUI besitzt einen eigenständigen, expliziten
  `wsl:<Distribution>`-Ausführungsbackend. Repositorypfad, Linux-Git,
  Worktrees, Filesystem, Diagnostik, PTY, Codex/Custom-Runtime, Managed-
  Taskdateien, Approval, Integration und Verifikation bleiben durchgehend in
  derselben Distribution.

## Windows-GUI → WSL-Vertrag

- Backendwahl wird auf Repository, Binding und Session-Snapshot persistiert;
  Legacy-Daten migrieren idempotent zu `native`.
- `wsl.exe` wird ausschließlich argv-basiert mit validierter Distribution und
  Linux-cwd gestartet. Prompts oder Pfade werden nicht in den Aufruf
  interpoliert.
- Windows-eigene Task-/Result-/Mailbox-/`AGENTS.md`-Artefakte werden gezielt
  über `wslpath` übersetzt. Linux-Git und Windows-Git werden niemals gegen
  dasselbe Binding gemischt.
- WSL-Dateioperationen prüfen Containment und Symlink-Komponenten, lesen mit
  no-follow, benennen Dateien/Ordner atomar ohne Überschreiben um und rollen
  eine fehlgeschlagene Trash-Quarantäne zurück.
- Eine fehlende Distribution fällt geschlossen aus und wird nicht zu
  „Verzeichnis fehlt“ oder einem nativen Windows-Fallback herabgestuft.
- Der UI-Import entdeckt Distributionen, verlangt eine bewusste Backendwahl,
  zeigt Native Windows/Native Linux korrekt an und beschriftet jeden WSL-Scope.
  Diagnostik verwendet bei einem konkreten Terminal dessen unveränderlichen
  Session-Backend-Snapshot.

## Linux-Paket

Implementiert:

- `pnpm package:linux:dir` → `dist/linux-unpacked/ade`;
- `pnpm package:linux` → `ADE-<version>-x86_64.AppImage` und
  `ADE-<version>-amd64.deb`;
- Desktop-/Icon-/Maintainer-/Homepage-Metadaten, Debian-Section `devel`;
- GitHub-Workflow für Source-Gate, unpacked, AppImage, installiertes Debian-
  Paket, SHA-256 und Artifact-Upload.

Lokal greifbare, Git-ignorierte Artefakte:

- `dist/linux-x64/ADE-0.1.0-x86_64.AppImage`
  (`5de4a7824476efd7ad7b617e719f41f17da4f1a9407e24bc1434bb73772268fe`);
- `dist/linux-x64/ADE-0.1.0-amd64.deb`
  (`bf1394d66a2ada1272af68ce91d38b230a721ffde6dd73b0357578d83d81fce3`);
- `dist/linux-x64/SHA256SUMS.txt`.

Der native Linux-Build-/Evidence-Checkout liegt unter
`/tmp/ade-linux-package-goal-20260719`. Er enthält ausschließlich generierte
Test-/Paketartefakte und kann später vollständig entfernt werden; der
Windows-Ordner oben behält die beiden fertigen Pakete.

## Verifizierter Qualitätsstand

Windows, zusammenhängender `pnpm verify`-Lauf:

- beide TypeScript-Projekte grün;
- **410/410** fokussierte Unit-/Integrations-/Security-Assertions:
  Memory 27, Dispatch 12, Runtime 29, Execution-Backends 16,
  Orchestration 45, Orchestration-Beta 100, Prompts 31,
  Repository-Scopes 43, Workspace-FS 7, Security 100;
- Production-Build grün;
- **47/47** reale Electron-/Playwright-Checks grün.

Realer Windows-GUI→Ubuntu-Backend:

- **31/31** Backend-Contracts/Integrationschecks, inklusive fehlender Distro,
  Unicode/Leerzeichen, POSIX-Case, Symlink-Abwehr, atomarem Rename, Linux-Git,
  ADE-owned Commit, PTY und Cleanup;
- **67/67** erweiterte Electron-/Playwright-Checks: UI-Import, WSL-Scope,
  Session-Diagnostik, echter Managed Run mit Approval/Integration/Verify,
  Windows-eigene Kontrollartefakte, vollständiger App-Neustart, Reopen,
  erneute Terminaleingabe und Entfernung aller vier Worktrees.

Ubuntu 24.04/WSL2, nativer ext4-Checkout mit Linux-`node_modules`:

- Typecheck, Production-Build und **409/409** fokussierte Assertions grün
  (nur der Windows-`.cmd`-Diagnostiktest entfällt);
- Source-App **47/47** unter Xvfb;
- unpacked Linux-Binary **47/47**;
- AppImage **47/47** mit `APPIMAGE_EXTRACT_AND_RUN=1`;
- aus dem `.deb` extrahierter `/opt/ADE/ade`-Payload **47/47**;
- `.deb`-Metadaten `amd64`, `devel`, Maintainer und Homepage korrekt;
- der isolierte native Codex-Sol/xhigh/bypass-Smoke bleibt grün.

GitHub Actions auf `d32faa9`:

- [Main-CI](https://github.com/McMuff86/ade/actions/runs/29676483968)
  vollständig grün: Ubuntu Source + unpacked und Windows Source + unpacked;
- [Package Linux](https://github.com/McMuff86/ade/actions/runs/29676490871)
  vollständig grün: 409 fokussierte Assertions sowie je 47/47 für Source,
  unpacked, AppImage und das wirklich installierte `/opt/ADE/ade`; SHA-256 und
  unsigned AppImage-/Debian-Artefakte wurden hochgeladen;
- der erste Lauf fand eine reine Test-Harness-Race: Der Dialog war sichtbar,
  bevor sein asynchrones Diagnoseergebnis gerendert war. `d32faa9` wartet auf
  die unverändert strenge Inhaltsassertion; lokal 47/47 und beide Hosted-Runs
  bestätigen den Fix.

## Sicherer Arbeitszustand

- Die erweiterten WSL-Tests hinterließen keine Test-Repositories, Worktrees,
  Prompt-Scratchpads oder ADE-Testprozesse.
- Keine aktiven Goal-6-Runs oder Leases; das Pilot-Originalrepo und sein
  `main` bleiben unverändert auf `81820b9`. Fremde lokale Änderungen dort
  niemals anfassen oder bereinigen.
- Das ADE-Pilotprofil bleibt unter `%APPDATA%\ADE`; echte Profil-Läufe brauchen
  weiterhin `ADE_USER_DATA_DIR=%APPDATA%\ADE`.
- `out/` gehört zum geprüften Windows-Quellstand. `dist/linux-x64` ist bewusst
  Git-ignoriert und enthält die auslieferbaren lokalen Linux-Pakete.

## Bewusste Grenzen

- Vor einer öffentlichen stabilen Linux-Veröffentlichung muss die
  Projektlizenz bewusst festgelegt werden. Auto-update, Linux-Signierung und
  Release-Feed fehlen noch.
- Der Hybridbackend ist Windows-only und benötigt WSL2 sowie `/bin/bash`, Git,
  Python 3, `gio` und die ausgewählten Agent-CLIs samt Login in der Distro.
- Der Windows-Ordnerpicker browsed keine Linux-Pfade; WSL-Repositories werden
  als absolute Linux-Pfade eingegeben. WSL-Worktrees liegen bewusst im
  benachbarten `.ade-worktrees` statt im Windows-globalen Worktree-Verzeichnis.
- Managed WSL-Tasks erhalten ihr Rollen-`AGENTS.md`. Interaktive WSL-Sessions
  lesen Repository-Anweisungen normal, aber ADE injiziert den Windows-eigenen
  Memory-Block noch nicht in ein Linux-Worktree.
- macOS bleibt vorbereitet, aber ungeprüft und ungepackt.

## Nächste Schritte

1. Eine Version/Tag-basierte Linux-Release-Runde erst nach expliziter Lizenz-
   und Release-Policy veröffentlichen.
2. Einen geführten WSL-Prerequisite-Check mit klaren Reparaturaktionen in das
   Onboarding integrieren.
3. Goal 7 ausschließlich im bereits dokumentierten bounded GO fortsetzen:
   deaktiviert, loopback-only, versionierte DTOs, Auth/Audit, Idempotency und
   keine Roh-PTY-/Filesystem-Exposition.
4. Danach Persistenz/Retention, Accessibility-/Performance-Budgets und erst
   dann macOS/Updater als eigene Release-Tracks angehen.

Operator-Kommandos:

```powershell
pnpm verify
pnpm test:wsl-backend
$env:ADE_WSL_BACKEND_E2E='1'; pnpm exec tsx scripts/test-electron-workflow.ts
pnpm agents:codex                 # Audit/Vorschau
pnpm agents:codex -- --apply      # gesicherten Codex-only Roster anwenden
```

Produktmeinung: ADE besitzt inzwischen einen ungewöhnlich belastbaren,
fail-closed Orchestrierungs- und Plattformkern. Das nächste Qualitätsniveau
entsteht nicht durch möglichst viele neue Schalter, sondern durch geführtes
Onboarding, progressive Offenlegung, hervorragende Recovery-Zustände,
messbare Accessibility/Performance und wenige, sehr gut gestaltete
End-to-End-Flows für „schnelle Aufgabe“ versus „Managed Run mit Beweiskette“.
