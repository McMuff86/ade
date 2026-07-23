# Handoff — 2026-07-23

Dieser Handoff beschreibt den zusammenhängenden Stand aus Goal-6-/Plattform-
Abschluss, Verified Draft-PR Publishing, dem Repository Inspector (`40bc1b2`
auf `origin/main`) und dessen neuem Progressive-Disclosure-Slice: kompakte
`Scope & session`-Offenlegung, CI-Rollups mit On-demand-Einzelchecks,
Run→Publication→PR-Traceability, ausschließlich entscheidungsrelevante
Hervorhebung, visuelle Regressions-Baselines, die explizite Harness-Wahl
pro Run im "Neuer Run"-Dialog samt Repo-Pfad-Import sowie die Settings-Seite
für Harness-Verwaltung: Subscription-Anzeige aus dem CLI-Status, Login-
Terminal pro Harness, verschlüsselte write-only API-Keys und generische
Service-Keys mit Injektions-Scope. Der Slice wird mit synchroner
Produkt-/Architektur-Dokumentation durch den vollständigen Windows-Gate
verifiziert; der Abschlusszustand soll identisches lokales `main`/`origin/main`
und ein sauberer Git-Worktree sein.

## Ergebnis dieser Session

- **Progressive-Disclosure-Slice des Inspectors (neu):**
  - Seltene Scope-Aktionen (`Add repo`, `Pfad…`, `Set agent default`,
    `Remove worktree`) liegen hinter einer kompakten `⋯`-Offenlegung
    (`Scope & session`) mit `aria-expanded`; Identität, Health, Repository-
    Auswahl und `Open new session` bleiben sichtbar. Die Offenlegung übersteht
    den 5-Sekunden-Poll und schließt nur bei Agent-/Session-Wechsel.
  - PR-Zeilen tragen ein **CI-Rollup** (`none/pending/passed/failed` mit
    Zählern), im Main-Prozess konservativ aus `statusCheckRollup` reduziert;
    rohe Provider-Checks erreichen den Renderer im Listen-Read nie.
  - **Traceability Run → Publication → PR:** offene PRs werden gegen die
    durablen `runPublications` gematcht (exakte PR-Nummer zuerst, sonst
    ADE-eigener Head-Branch) und tragen dann ein neutrales `ADE run`-Badge
    mit Run-/Status-Tooltip.
  - **Einzelchecks nur on demand:** Der CI-Chip ist ein Button und öffnet die
    geteilte Detail-Pane; `repository:pullRequestChecks` validiert PR-Nummer
    und URL erneut und liefert höchstens 100 benannte Check-Zustände ohne
    Provider-URLs. Logs bleiben auf GitHub; Escape gibt den Fokus an den Chip
    zurück.
  - **Nur entscheidungsrelevante Zustände** sind farbig: dirty, Divergenz,
    fehlgeschlagene CI, Reviewbedarf, Changes-requested. Clean, up to date,
    draft, approved und passing CI sind bewusst neutral.
  - **Visuelle Regression:** `pnpm test:visual` rendert die Sidebar
    deterministisch (eingefrorene Renderer-Uhr, fixe Git-Daten, Scale 1.0,
    en-US) in Dark/Light × 300/380/540 px plus offener Checks-Pane und
    vergleicht Pixel-Baselines pro Plattform
    (`scripts/fixtures/visual-baselines/`); Hosted-CI erfasst Screenshots und
    Strukturchecks, überspringt aber den Pixel-Diff.
  - Ein priorisiertes UI/UX-Review des Gesamtprodukts (Quick Wins wie der
    Light-Theme-Terminalrahmen, Typografie-/Kontrast-/Sprachbefunde,
    Run-Dialog-Entzerrung, Signatur-Vorschlag „Beweiskette“) steht in
    `docs/DESIGN_REVIEW_2026-07-19.md`.

- **Harness-Wahl pro Run (neu):** Der "Neuer Run"-Dialog bietet für den
  Orchestrator und jeden ausgewählten Teilnehmer eine explizite Harness-
  Auswahl (Agent-Standard plus Claude Code, Codex, OpenCode, Grok Build,
  Gemini CLI). Der Override gilt nur für diesen Run: Er wird auf dem
  RunParticipant gespeichert, verändert den Katalog-Agenten nicht und wird
  über `effectiveParticipantAgent` an jeder Start-/Capability-/Manifest-Naht
  angewendet (Roster, Task-Launch, PTY-Spawn). Ein Override verwirft bewusst
  das agent-eigene `customCommand`; `shell`, `custom` und `ollama` bleiben
  nur als Agent-eigene Runtimes zulässig, und IPC/Service lehnen unbekannte
  Harnesses fail-closed ab. Das gewählte CLI muss installiert und angemeldet
  sein — der Dialog sagt das ausdrücklich; eine Settings-Seite für
  Harness-Anmeldung ist der nächste Schritt.

- **Repo-Pfad-Import im "Neuer Run"-Dialog (neu):** Unter der Repository-
  Auswahl öffnet `Pfad…` eine Zeile für die direkte Pfadeingabe mit bewusster
  Backend-Wahl (Native/WSL-Distribution). Der Import nutzt denselben
  verifizierten `repository:import`-Vertrag wie der Scope-Header, ist
  idempotent und wählt das importierte Repository direkt für den Run aus.

- **Settings-Seite für Harness-Verwaltung (neu):** Der Header besitzt einen
  `Settings`-Dialog, der pro First-Class-Harness (Claude Code, Codex,
  OpenCode, Grok Build, Gemini CLI, Ollama) den echten CLI-Status zeigt
  (Installation/Version/Auth über einen synthetischen, read-only
  Diagnose-Probe pro Harness), das dokumentierte Login-Kommando nennt und
  optional einen API-Key entgegennimmt. Keys sind **write-only**: Sie werden
  mit Electron `safeStorage` (Windows-DPAPI) verschlüsselt in einer eigenen
  Datei neben `config.json` gespeichert, nie wieder angezeigt, nie über IPC
  oder `config:get` herausgegeben und ausschließlich Sessions der passenden
  effektiven Runtime als dokumentierte Umgebungsvariable übergeben
  (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`).
  Fehlende OS-Verschlüsselung schlägt fail-closed fehl statt Klartext zu
  schreiben; unlesbare Records starten die Session ohne Key. Der
  Playwright-Gate beweist die Kette real: Key im UI gespeichert →
  verschlüsselt persistiert (kein Klartext in beiden Dateien) → eine
  Grok-Session sieht ihn als `XAI_API_KEY` → Status überlebt den
  App-Neustart. OAuth-basierte CLIs melden sich weiterhin selbst an; ADE
  führt bewusst keine eigenen OAuth-Flows aus.

- **Settings v2 — Subscription-Anzeige, Login-Terminal, Service-Keys (neu):**
  - Eine bestehende CLI-Anmeldung (z. B. Claude Pro/Max, ChatGPT für Codex)
    wird als **„Angemeldet“ samt Methode** angezeigt; ADE ersetzt sie nicht.
    Das API-Key-Feld ist ausdrücklich als Alternative gekennzeichnet
    (API-Abrechnung), und liegen Anmeldung **und** gespeicherter Key
    gleichzeitig vor, warnt die Seite, dass der Key die Subscription in
    ADE-Sessions überschreiben würde.
  - **„Anmelden im Terminal“** öffnet pro Harness eine Terminal-Session mit
    dem dokumentierten Login-Kommando aus ADEs fester Tabelle (`claude auth
    login`, `codex login`, `opencode auth login`); der OAuth-/Device-Flow
    gehört vollständig dem CLI, die Login-Session erhält bewusst keine
    gespeicherten Keys. Vorerst nativ; WSL-Distros haben eigenen
    Login-Zustand pro Home.
  - **Service-Keys** für Zusatzdienste (z. B. `ELEVENLABS_API_KEY`):
    UPPER_SNAKE_CASE-Namen, reservierte Namen (PATH, NODE_OPTIONS, `ADE_*`,
    Harness-Key-Slots …) werden abgelehnt, Werte verschlüsselt wie
    Harness-Keys, Scope wählbar („alle Sessions“ oder bestimmte Harnesses),
    Injektion in native und WSL-Session-Umgebungen. Der Playwright-Gate
    beweist real: Subscription-Anzeige aus dem CLI-Status, Login-Terminal
    führt das Kommando aus, ein Service-Key erreicht eine Shell-Session als
    Umgebungsvariable, und beides überlebt den App-Neustart verschlüsselt.

- **Design-Review Quick Wins 1-3 (neu):** Der Light-Theme-Terminalrahmen ist
  behoben (xterm.css malte den Viewport `#000` und gewann per
  Bundle-Reihenfolge; ein Drei-Klassen-Selektor in terminal.css/graph.css
  gewinnt jetzt deterministisch, strukturell per Playwright abgesichert).
  Das Scope-Header-Select ellipsiert lange Namen vor dem Dropdown-Pfeil.
  Die bewusste Theme-Wahl („Darstellung“: Dunkel/Hell) lebt in der
  Settings-Seite; im Header bleibt ein Icon-Schnellumschalter (☀/☾).

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

## Historischer verifizierter Qualitätsstand vor dem Linux-Vertragsnachtrag

Windows, zusammenhängender `pnpm verify`-Lauf:

- beide TypeScript-Projekte grün;
- **507/507** fokussierte Unit-/Integrations-/Security-Assertions:
  Memory 27, Dispatch 12, Runtime 32, Execution-Backends 16,
  Orchestration 48, Orchestration-Beta 101, Publication 29, Prompts 31,
  Repository-Scopes 43, Repository-Inspector 27, Harness-Credentials 17,
  Workspace-FS 7, Security 117;
- Production-Build grün;
- **86/86** reale Electron-/Playwright-Checks grün, inklusive Repository-
  Übersicht/PRs/Commit-Diff/Keyboard/Fokus, Scope-&-Session-Offenlegung,
  CI-Rollup-Chip, On-demand-Checks mit Fokusrückgabe, ADE-Run-Provenance des
  veröffentlichten Draft-PR, Harness-Wahl und Repo-Pfad-Import im "Neuer
  Run"-Dialog, Settings-Seite mit Subscription-Anzeige, Login-Terminal,
  verschlüsseltem Harness-Key- und Service-Key-Roundtrip bis in die
  Session-Umgebung sowie disabled-before-confirm, realem isoliertem
  Git-Push, unverändertem Remote-`main`, Draft-PR-Audit und Persistenz nach
  App-Neustart;
- **21/21** visuelle Regressionschecks (Dark/Light × 300/380/540 px plus
  offene Checks-Pane) gegen die committeten `win32`-Baselines.

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
  bewusst ausgeschlossen. Die späteren F3v4-/F4v3-Live-Ergebnisse liegen auf
  separaten Evidence-Branches und wurden nicht nachträglich in diesen
  historischen Kandidaten aggregiert;
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
- Keine aktiven Goal-6-Runs oder Leases. Das Pilot-Originalrepo ist clean;
  `main` und `origin/main` blieben während der Retests unverändert auf
  `ee28d79`. Die vier disponiblen ADE-Pilot-Worktrees sind clean auf der
  gemeinsamen Run-Basis `81820b9`. F3v4/F4v3 bleiben über lokale
  `goal6/f3v4-*`-/`goal6/f4v3-*`-Evidence-Refs erreichbar; der ausgeschlossene
  F4v2-D1 über `goal6/f4v2-a1-worker-d1`.
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

## Nachtrag 2026-07-21 — Dependency-aware Worker-Bases (F3/F4-Fix)

- `dependsOn` überträgt jetzt Git-Zustand statt nur Ergebnisdaten: Vor dem
  Start eines abhängigen repo-gestützten Workers präpariert ADE dessen
  geleasten Worktree mit den validierten Commits seiner Abhängigkeiten
  (erster Parent verbatim per `reset --hard`, weitere Parents als owned
  Deltas in Assignment-Reihenfolge, Diamanten werden übersprungen). Die
  präparierte Basis wird als `preparedBaseSha` auf dem Task persistiert und
  als `workspace.prepared` journaliert; Validierung und Integration zählen
  ausschließlich owned Deltas (`preparedBaseSha..tip`). Konfligierende
  Parent-Deltas schlagen fail-closed VOR dem Worker-Start fehl und stellen
  die Run-Basis wieder her.
- Planner-/Worker-Prompts sprechen die neue Wahrheit (Versionen plan=2,
  work=2): Abhängige Assignments dürfen auf Upstream-Dateien aufbauen und
  sie verändern; Re-Authoring ist ausdrücklich verboten.
- Beweis: `pnpm run test:orchestration-beta` (117 Checks) enthält die
  F3/F4-Klasse als echten Koordinator-Test auf realem Git — 2 parallele
  Producer → 1 abhängiger Consumer inklusive 3-Commit-Integration und
  Verifikation — plus Negativkontrollen (divergentes Re-Authoring,
  konfligierende Parents, dirty/falsche Basis). Voller `pnpm test` grün
  (13 Suiten).
- Live-Reproof abgeschlossen: F3v4 `3a2773cc` führte eine Kette mit drei
  Owned-Commits durch zwei exakt übernommene Prepared-Bases bis zum
  tree-identischen integrierten/verifizierten HEAD `06962ae9`; F4v3
  `9bcd8932` führte zwei Owned-Commits plus read-only Audit analog bis
  `b8a1229d`. Beide Runs: `completed`, null Rollbacks, Integration-Review und
  unabhängige Verifikation grün, alle Leases freigegeben. F4v2 `c3c232c6`
  bleibt wegen eines belegten externen DNS/API-Ausfalls ausgeschlossen (D2
  ohne Partial-Diff, keine Integration). Vollständiges Protokoll und Refs:
  `docs/goal6/F3F4_RETEST.md` und `docs/goal6/RESULTS.md`.

## Nächste Schritte

1. Für neue operator-gesteuerte ADE-Produkt-, Managed-Run- und General-Use-
   Tests RhinoClaw als bevorzugtes reales Repository verwenden. Ausschließlich
   disposable ADE-Worktrees/-Branches nutzen; RhinoClaw-Arbeitsbaum, `main`,
   deployed Skill und laufende Rhino-Installation bleiben ohne separate
   Freigabe unverändert. Deterministische CI-/Electron-Tests behalten ihre
   synthetischen lokalen Fixture-Repositories. Der lokale
   `2D_rpg_jumpnrun`-Kandidat `77cdaff` bleibt historische Goal-6-Evidence und
   wird nicht als laufendes Standard-Testziel weitergeführt oder veröffentlicht.
2. Sprache (DE/EN-Mix) und Typografie (zweite Schriftstimme für Fließtext,
   Typo-Skala als Tokens, eigenes Warn-Token) gemäß
   `docs/DESIGN_REVIEW_2026-07-19.md` vereinheitlichen; die dortigen Quick
   Wins 1-3 sind umgesetzt.
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
pnpm test:visual                  # visuelle Baselines prüfen
pnpm test:visual:update           # Baselines nach gewollter UI-Änderung erneuern
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

## Nachtrag 2026-07-23 — Linux-E2E- und Baseline-Vertrag

- Der aktuelle WSL-Lauf `NODE_ENV=development pnpm verify` ist vollständig
  grün: beide TypeScript-Projekte, **553/553** fokussierte Assertions,
  Production-Build, **96/96** Source-Electron-Checks und **22/22** visuelle
  Struktur-/Baseline-Policy-Checks. Das frisch gebaute unpacked Linux-Paket
  besteht denselben **96/96**-Electron-Vertrag.
- Der Settings-E2E fragt den realen `harness:status` ab. Windows/DPAPI behält
  den positiven verschlüsselten Harness-/Service-Key-Roundtrip bis in die
  Session-Umgebung und über den App-Neustart. Headless Linux ohne Secret
  Service prüft stattdessen den vorgesehenen Fail-closed-Vertrag: sichtbare
  Warnung, deaktivierte Secret-Eingaben, keine Credential-Records und derselbe
  Zustand nach Neustart. Electrons Linux-Backend `basic_text` und unbekannte
  Backends werden trotz `isEncryptionAvailable() === true` abgelehnt; nur
  bekannte OS-Secret-Stores sind zulässig. Produktion fällt weiterhin nie auf
  Klartext zurück. Bereits gespeicherte Records werden bei späterer Storage-
  Unverfügbarkeit weder entschlüsselt noch in neue Session-Umgebungen injiziert.
- Der visuelle Test schreibt auf Plattformen ohne autoritativen Baseline-Satz
  (aktuell Linux) unabhängig von `--update` nur nach `test-results/visual/`
  und ignoriert dort versehentlich vorhandene Repository-Baselines. Auf der
  autoritativen Windows-Plattform schlägt bereits eine fehlende erwartete
  Baseline auch im CI fehl. Repository-Baselines entstehen oder ändern sich
  ausschließlich mit `pnpm test:visual:update`; ein normaler Verify-Lauf
  verschmutzt den Worktree nicht mehr.
- Historische Goal-6-Dokumente und der abgeschlossene Driver bleiben bewusst an
  `2D_rpg_jumpnrun` gebunden. Neue reale ADE-General-Use-Validierung verwendet
  RhinoClaw unter den oben beschriebenen Worktree- und Freigabegrenzen.
