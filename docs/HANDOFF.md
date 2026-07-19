# Handoff — 2026-07-19

`main` und `origin/main` des ADE-Repositories stehen weiterhin auf
`03e6e6d`. Der aktuelle Codex-/Plattform-/UI-/Doku-Abschluss ist lokal
implementiert und vollständig verifiziert, aber bewusst noch nicht committed
oder gepusht. `out/` enthält den zu diesem Arbeitsbaum gehörenden grünen Build.

## Ergebnis dieser Session

- **Goal 6 ist abgeschlossen.** F1-F8 samt Einzelagent-Baselines,
  Sicherheitsfixtures, Reliability-Findings und Go/no-go stehen in
  `docs/goal6/RESULTS.md`.
- Entscheidung: **begrenztes GO für Goal 7** (deaktivierter, loopback-only,
  transportneutraler lokaler Kern/API). Weiterhin **NO-GO für öffentliche
  Remote-Beta** und für die Behauptung, beliebige abhängige Multi-Agent-Pläne
  seien bereits produktionsreif.
- Der aktuelle echte ADE-Pilot-Roster ist **Codex-only**: `Main Chef` =
  `gpt-5.6-sol`, `xhigh`, bypass, Rolle `orchestrator`; die drei
  `Test_Agent_2D_Jump*` = `gpt-5.6-sol`, `high`, bypass, Rollen
  `lead`/`worker`; `RhinoClaw_Agent` ebenfalls Codex/Sol/high/bypass. Es gibt
  keine gespeicherte Claude-Identity mehr. Zwei absichtliche Shell-Utilities
  bleiben Shell-Runtimes.
- Jede gespeicherte Identity besitzt ein von ADE nachgeführtes, rollenbezogenes
  `AGENTS.md`. Managed Tasks erhalten zusätzlich einen read-only Snapshot mit
  Digest/Provenance; Code- und Prompt-Tests decken das ab.
- Native Codex-Tasks transportieren Prompts quote-sicher über stdin, pinnen
  Modell/Reasoning, nutzen bei bypass
  `--dangerously-bypass-approvals-and-sandbox`, liefern native JSONL-Aktivität
  und persistieren `ACTIVITY.jsonl`.
- Der Graph zeigt bei einem ausgewählten fehlgeschlagenen Run jetzt den
  persistierten technischen Task-/Run-Grund direkt als barrierearmes
  `role="alert"`, statt nur „Fehler“ anzuzeigen.

## F8-Abschluss

Finaler Run: `f504c8da-e69a-4c6d-b1e3-268237d42083`,
`F8v6 honest-failure (managed Codex)`.

- vollständig: Planung → zwei Worker → Freigabe → Integration → unabhängige
  Verifikation → completed;
- 18m 18s elapsed, 14m 44s aktiv, 5/5 Tasks, keine Retries/Konflikte;
- 1.397.452 Input- und 34.256 Output-Tokens, kein vom Codex-Adapter gelieferter
  USD-Preis;
- Worker `2be8cc6`: genau `src/ui/WeaponPresentation.test.ts`;
- Integration `6bffe36`: genau ein Commit auf Baseline `81820b9`;
- fokussiert 1/1, gesamte Pilot-Suite 78/78, tsc und Production-Build grün;
- Worker, Integrationsreviewer, Verifier und eine operator-eigene isolierte
  Negativkontrolle entfernten temporär `impact.png`, beobachteten Exit 1 mit
  `impact` und `/assets/weapons/premium/v1/impact.png`, stellten die Datei
  wieder her und liefen anschließend grün. Erwartetes Versagen wurde korrekt
  als `skipped` dokumentiert.

Beweis-Branches im Pilot-Repo:

- `goal6/f8-v6-worker` → `2be8cc605692822db6e50922973c1ae676523f09`
- `goal6/f8-v6-integrated` → `6bffe36dd8c4bc46fcf89a8f4f9cfa9c9e263cb2`

Die historischen F8v2-v5-Versuche und ihre Ausschluss-/Fail-closed-Gründe sind
vollständig in `RESULTS.md` erfasst. F8v5 bewies bereits den korrigierten
Negativkontrollvertrag, scheiterte aber an einer missverständlichen
Integrations-Pfadset-Anweisung; Prompt v2 und F8v6 schließen dieses Finding.

## Verifizierter Qualitätsstand

Windows, zusammenhängender `pnpm verify`-Lauf am 2026-07-19:

- beide TypeScript-Projekte grün;
- **393/393** Assertions in neun fokussierten Unit-/Integrations-/Security-
  Suiten: Memory 27, Dispatch 12, Runtime 29, Orchestration 45,
  Orchestration-Beta 100, Prompts 31, Repository-Scopes 43, Workspace-FS 7,
  Security 99;
- Production-Build grün;
- **46/46** reale Electron/Playwright-Checks grün, einschließlich ConPTY,
  Reload/Restart, Scope-Bindings, Codex-Profil, `AGENTS.md`, Failure-Alert,
  Managed Approval/Integration/Verify und App-Neustart.

Ubuntu 24.04 unter WSL2, nativer ext4-Checkout
`/tmp/ade-wsl-native-20260719-0038` mit Linux-`node_modules`:

- Typecheck und Production-Build grün;
- **392/392** fokussierte Assertions (nur der Windows-`.cmd`-Diagnostiktest ist
  plattformgemäß nicht anwendbar);
- **46/46** Electron/Playwright unter Xvfb, inklusive realem POSIX-PTY und
  Managed Git-Integration;
- nativer Codex-Sol/xhigh/bypass-stdin-Smoke war bereits erfolgreich
  (`ADE_WSL_CODEX_SOL_XHIGH_OK`, Thread
  `019f776c-ad36-7412-a511-db08d3924e96`).

Das beweist einen nativen Linux/WSLg Source-/Developer-Workflow. Es gibt noch
kein Linux-Paket und der Windows-GUI→WSL-Ausführungsbackend ist ein eigenes,
größeres Vorhaben; Details und Exit-Kriterien stehen in
`docs/MULTIPLATFORM_PLAN.md`.

## Sicherer Arbeitszustand

- Keine aktiven Goal-6-Runs oder Leases; alle vier Pilot-Worktrees sind sauber
  auf `81820b90e00cfb3a686f203e04a072919081e406` zurückgesetzt.
- Das Original-Repo `2D_rpg_jumpnrun` und dessen `main` blieben auf
  `81820b9`. Dort liegen Adis fremde lokale Änderungen (unter anderem
  ballistics/AxeAim/CameraTracking/DrillTerrain); **niemals anfassen oder
  bereinigen**.
- Das ADE-Profil wurde vor der Migration gesichert:
  `config.pre-codex-roster.2026-07-18T22-12-47-054Z.json` und
  `config.pre-codex-roster.2026-07-18T22-14-27-150Z.json` unter
  `%APPDATA%\ADE\ade\`.
- Für echte Profil-Läufe immer `ADE_USER_DATA_DIR=%APPDATA%\ADE` verwenden;
  ohne Override nutzt ein unpaketierter Electron-Build ein anderes Profil.

## Nächste Engineering-Schritte

1. Den aktuellen ADE-Diff bewusst reviewen, als zusammenhängenden
   Codex/WSL/Goal6/UX-Abschluss committen und pushen; danach den neuen Ubuntu-
   CI-Job auf GitHub erstmals beobachten. Diese Session hat nicht automatisch
   committed oder gepusht.
2. Die POSIX-Verzeichnis-Rename-Aktion entweder mit einer echten atomaren
   No-clobber-Primitive implementieren oder im Linux-UI nachvollziehbar
   ausblenden/erklären. Aktuell failt sie sicher geschlossen.
3. Die in F3/F4 belegte Architektur-Lücke beheben: abhängige Worker brauchen
   einen kontrollierten Upstream-Codezustand oder klare Datei-/Patch-Ownership,
   statt denselben Base-Commit divergent nachzubauen.
4. Goal 7 nur innerhalb des dokumentierten bounded GO beginnen: API standardmäßig
   aus, loopback-only, versionierte DTOs, Idempotency Keys, Cursor-Reconnect,
   Auth/Audit und keine Roh-IPC-/Terminal-Exposition.
5. Vor größerer Nutzung Run-Historie/Activity aus der monolithischen Config in
   eine indexierte, begrenzte Persistenz überführen; danach Linux-Packaging und
   erst separat den Windows→WSL-Backend planen.

Operator-Helfer:

```powershell
pnpm agents:codex                 # nur Vorschau
pnpm agents:codex -- --apply      # gesicherten Roster anwenden
pnpm verify                       # kompletter Windows-Gate
pnpm goal6:report --run f504c8da-e69a-4c6d-b1e3-268237d42083 --md
```

Die ausführliche Produktmeinung bleibt: ADE hat inzwischen einen ungewöhnlich
starken, fail-closed Orchestrierungs-Kern. Das nächste Niveau entsteht weniger
durch noch mehr sichtbare Features als durch bessere progressive Offenlegung,
präzise Recovery-Zustände, messbare Accessibility/Performance, stabile
plattformübergreifende Distribution und eine klare Trennung zwischen
„einfacher Task“ und „Managed Run mit Beweiskette“.
