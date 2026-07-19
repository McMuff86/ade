# Handoff — 2026-07-19

Dieser Handoff beschreibt den zusammenhängenden Stand aus Goal-6-/Plattform-
Abschluss, Verified Draft-PR Publishing und dem neuen Repository Inspector. Der
vorherige dokumentierte Stand (`9349ab5`) liegt auf `origin/main`. Der Inspector
wird mit synchroner Produkt-/Architektur-Dokumentation durch den vollständigen
Windows-Gate verifiziert und anschließend auf ADE-`main` veröffentlicht; der
Abschlusszustand soll identisches lokales `main`/`origin/main` und ein sauberer
Git-Worktree sein.

## Ergebnis dieser Session

- Die rechte Sidebar besitzt jetzt ein bewusst getrenntes **Overview** für das
  im Katalog ausgewählte Repository. **Changes** und **Files** bleiben ehrlich
  auf dem unveränderlichen Workspace der aktiven Session.
- Overview zeigt lokalen Branch-/Dirty-/Upstream-/Backend-Zustand, die letzten
  12 Commits und einen erst auf Klick geladenen, begrenzten Commit-Patch. Bis zu
  20 offene GitHub-PRs kommen optional über das repo-eigene native/WSL-`gh`;
  Offline/Auth/Provider-Fehler verdecken lokale Daten nicht.
- Der Main-Prozess akzeptiert nur Repository-ID und exakte Full-SHA, prüft die
  Repository-Identität erneut und validiert GitHub-PR-URLs doppelt. Es gibt
  keinen Fetch, Checkout, Push, Merge oder PR-Schreibbefehl im Inspector.
- Semantische Tabs unterstützen Pfeil/Home/End; die stabile Split-Pane erhält
  Daten und Scrollzustand, und `Escape` gibt den Fokus an den Commit zurück.
  Provider-Netzwerkreads hängen ausdrücklich nicht am 5-Sekunden-Lokalpolling.

- ADE besitzt jetzt einen **lokalen, expliziten Verified-Publishing-Flow**:
  erfolgreicher Managed Run → unveränderliches HEAD-/Verify-Attest → read-only
  Preview → separate Checkbox-Bestätigung → neuer `ade/run-*`-Branch → GitHub
  Draft PR. Es gibt keinen ADE-Befehl für direkten `main`-Push, Merge,
  Auto-Merge, Ref-Überschreiben oder Branch-Löschung.
- Der Main-Prozess prüft vor der Mutation erneut Repository/Backend, freigegebene
  Lease, sauberes identisches HEAD, approved Integration, finale Testevidenz,
  unveränderte Remote-Default-Base, GitHub-`origin`, Ref-Kollision und `gh`-
  Zugriff. Ein unterbrochener/teilweiser Versuch wird dauerhaft als Fehler
  protokolliert und kann nur gegen exakt denselben Branch/HEAD wiederholt werden.
- Native und WSL-Repositories verwenden Git und `gh` ausschließlich in ihrem
  gespeicherten Backend. Für WSL muss `gh` in der Distro installiert und
  authentifiziert sein. Der zukünftige mobile Host erhält absichtlich keinen
  Publish-Endpunkt.
- Diese Garantie schützt ADEs eigenen Produktpfad. Der gewünschte Codex-
  Bypass-Modus ist ein bewusst voll vertrauter OS-Prozess und kann unabhängig
  auf vorhandene Git-Credentials zugreifen; echte Isolation erfordert einen
  Nicht-Bypass-/Container-/Credential-Boundary.

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
  verschmutzen. Der Roster-Enforcer erkennt außerdem vollständig ADE-eigene
  Legacy-`CLAUDE.md`-Scaffolds, archiviert sie im Apply-Lauf und verweigert die
  Löschung, sobald fremder Inhalt oder fehlerhafte Marker vorhanden sind.
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
- **465/465** fokussierte Unit-/Integrations-/Security-Assertions:
  Memory 27, Dispatch 12, Runtime 29, Execution-Backends 16,
  Orchestration 46, Orchestration-Beta 101, Publication 29, Prompts 31,
  Repository-Scopes 43, Repository-Inspector 16, Workspace-FS 7, Security 108;
- Production-Build grün;
- **64/64** reale Electron-/Playwright-Checks grün, inklusive Repository-
  Übersicht/PRs/Commit-Diff/Keyboard/Fokus sowie disabled-before-
  confirm, realem isoliertem Git-Push, unverändertem Remote-`main`, Draft-PR-
  Audit und Persistenz nach App-Neustart.

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

Goal-6-Quality-Kandidat für `2D_rpg_jumpnrun`:

- lokaler, nicht veröffentlichter Branch `ade/goal6-quality-candidate` im
  separaten Worktree
  `C:\Users\Adi.Muff\repos\.ade-quality-worktrees\2d-rpg-goal6-quality`,
  finaler HEAD `77cdaff` auf unveränderter Basis `81820b9`;
- ausschließlich die erfolgreich integrierten/verifizierten Managed-Ergebnisse
  F1, F2, F5, F6 und F8; F3/F4 sowie Drafts, Abbrüche und Baseline-Arme bleiben
  bewusst ausgeschlossen;
- eine frische Frozen-Installation deckte beim kombinierten F2/F8-Test einen
  zuvor ambient erfüllten Node-Typvertrag auf. Der Kandidat deklariert deshalb
  `@types/node@22.18.0` explizit und reproduzierbar im Lockfile;
- finaler HEAD: **130/130** Vitest-Tests, **5/5** Server-Tests, TypeScript und
  Production-Build grün; die F8-Negativkontrolle nannte bei entferntem
  `impact.png` exakt Waffe und Asset-Pfad und stellte die Datei wieder her;
- der echte Headless-Chrome-Smoke lief vor und nach dem finalen Dokumentations-
  commit grün und prüfte Gameplay, alle zwölf Waffen, Audio, Kamera/Pause,
  Arena-Größen, Workshop/Arsenal, Team-Editor und 5v5-Setup. Die ignorierten
  Screenshots liegen im Kandidaten-Worktree unter `artifacts/`;
- vollständige Evidence und Grenzen stehen in
  `docs/ade-goal6-quality-candidate.md` auf dem Kandidatenbranch.

## Sicherer Arbeitszustand

- Die erweiterten WSL-Tests hinterließen keine Test-Repositories, Worktrees,
  Prompt-Scratchpads oder ADE-Testprozesse.
- Auch der Publishing-/Playwright-Gate hinterließ keine temporären Repositories
  oder Test-App-Prozesse. Die bereits laufende echte ADE-Instanz mit dem normalen
  `%APPDATA%\ade`-Profil wurde erkannt und bewusst nicht beendet.
- Keine aktiven Goal-6-Runs oder Leases; das Pilot-Originalrepo und sein
  `main` sowie `origin/main` bleiben unverändert auf `81820b9`. Seine drei
  modifizierten und sechs unversionierten, fremden Gameplay-Dateien sind
  unverändert; niemals anfassen oder bereinigen. Nur der oben dokumentierte
  Quality-Worktree und sein lokaler Kandidatenbranch kamen hinzu.
- Das ADE-Pilotprofil bleibt unter `%APPDATA%\ADE`; echte Profil-Läufe brauchen
  weiterhin `ADE_USER_DATA_DIR=%APPDATA%\ADE`.
- `out/` gehört zum geprüften Windows-Quellstand. `dist/linux-x64` ist bewusst
  Git-ignoriert und enthält die auslieferbaren lokalen Linux-Pakete.
- Der abschließende Codex-Apply hat drei vollständig ADE-eigene Alt-Scaffolds
  (RhinoClaw Home + Binding, Main-Chef-Binding) hash-verifiziert nach
  `%APPDATA%\ADE\ade\legacy-instruction-backups\2026-07-19T06-46-58-123Z`
  archiviert. Beide betroffenen Git-Worktrees sind clean; der anschließende
  Dry-Run bestätigt fünf Codex-Identitäten und fünf echte Memory-`AGENTS.md`.

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
- Verified Publishing unterstützt zuerst nur GitHub über `origin`. Es verlangt
  eine exakt unveränderte Remote-Base und führt keinen Rebase/Branch-Update aus.
  Alte abgeschlossene Runs ohne neues Verification-Attest müssen neu laufen.
  Der neue Slice ist lokal auf Windows verifiziert und muss im nächsten Hosted-
  /Native-Linux-Lauf in die dortige Evidenz aufgenommen werden. Push-Hooks sind
  absichtlich deaktiviert; Git-LFS-/Hook-abhängige Repositories brauchen vorerst
  einen manuellen Publish oder einen späteren expliziten Provider-Vertrag.

## Nächste Schritte

1. Den Inspector als nächste progressive Ebene um CI-Check-Rollups und die
   eindeutige Traceability Managed Run → Publication → PR ergänzen; Logs und
   Einzelchecks bleiben dabei on demand statt permanentem Sidebar-Rauschen.
2. Den lokalen `2D_rpg_jumpnrun`-Kandidaten `77cdaff` fachlich reviewen und die
   F6-Balanceänderung menschlich spielen. Erst nach expliziter Operator-
   Freigabe einen Remote-Branch/Draft-PR anlegen. Die historische Aggregation
   trägt bewusst kein frisches ADE-Run-Attest: Für ADE-eigenes Verified
   Publishing muss der Inhalt einen neuen Managed Run durchlaufen; alternativ
   braucht der manuelle Push/PR eine separat freigegebene, wahrheitsgemäß als
   manuell aggregiert bezeichnete Publication.
3. Eine Version/Tag-basierte Linux-Release-Runde erst nach expliziter Lizenz-
   und Release-Policy veröffentlichen.
4. Einen geführten WSL-Prerequisite-Check mit klaren Reparaturaktionen in das
   Onboarding integrieren.
5. Goal 7 ausschließlich im bereits dokumentierten bounded GO fortsetzen:
   deaktiviert, loopback-only, versionierte DTOs, Auth/Audit, Idempotency und
   keine Roh-PTY-/Filesystem-Exposition.
6. Danach Persistenz/Retention, Accessibility-/Performance-Budgets und erst
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
