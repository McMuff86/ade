# Handoff — 2026-07-18 (Stand: lokal auf `main`, **noch nicht gepusht**)

Diese Session hat den Neuer-Run-Dialog gefixt (`aee2122`), **F2 komplett
gemessen** (beide Arme + Verdikt), den F7-Reject-Pfad geschlossen, einen
HIGH-Telemetrie-Bug gefunden und gefixt (`5d5c678`) und die Operator-Treiber
als festes Skript ins Repo gebracht. Alles lief agentisch über die echte UI
(Playwright gegen den Build, echtes Profil) — Screenshots und Diffs als
Evidenz im Session-Scratchpad.

## Sofort wissen

1. **Nach Pull: `pnpm i` + ADE komplett neu starten** (Main-Prozess-Änderung:
   `claudeStream.ts`-Parser).
2. **App-Start via Playwright/dev IMMER mit
   `ADE_USER_DATA_DIR=%APPDATA%\ADE`.** Ohne Override landet der unpaketierte
   Build in `%APPDATA%\Electron` und sieht ein leeres Profil (diese Session
   passiert und aufgeräumt; echte Config war gesichert und blieb unberührt).
   Vor jeder Profil-Session: `config.json` wegkopieren.
3. **Treiber: `scripts/goal6-drive.ts`** — Modi `managed | approve | reject |
   baseline`, extrahiert den Fixture-Zielblock selbst aus dem Plan, macht
   Screenshots und dumpt den Gate-Diff. Auf F2 (beide Arme + Reject) erprobt.
4. **F5-Blocker GELÖST (18.07. nachmittags, via UI-Driver über die echte
   App):** Es gibt jetzt DREI taugliche Claude-Worker: `Test_Agent_2D_Jump`,
   `Test_Agent_2D_Jump_2`, `Test_Agent_2D_Jump_3` (alle claude/**bypass**,
   Repo-Scope `2D_rpg_jumpnrun`). `ChibiChup` heisst jetzt
   **`RhinoClaw_Agent`** (auf Adis Wunsch umbenannt, dabei auf bypass
   umgestellt; Repo RhinoClaw — weiterhin NICHT Teil der Messreihe). Alle
   vier ade-Worktrees des Pilot-Repos (inkl. der zwei neuen) sauber auf
   `81820b9` verifiziert (Managed-Start verlangt seit `3b6d3b8` dieselbe
   Git-Basis für alle Teilnehmer).
5. **Telemetrie-Checkpoint BESTANDEN (F5, 18.07. nachmittags):** Beide
   F5-Managed-Runs lieferten echte Token-/Kostenzahlen end-to-end (a1 $2.88,
   a2 7.16M in / 180k out, $22.57; per-Task-Usage im Inspector). Baseline-
   Arme bleiben adapter-los — Tokens dort weiterhin aus dem Claude-Session-
   Transkript rekonstruieren (Muster siehe RESULTS.md F2/F5-Baseline).

## Goal 6: Stand der Messreihe

Plan: `docs/goal6/VALIDATION_PLAN.md` · Ergebnisse: `docs/goal6/RESULTS.md`
· Metriken: `pnpm goal6:report --run <id> --md`.

| Fixture | Managed | Baseline | Verdikt |
| --- | --- | --- | --- |
| F1 settings-reduced-shake | ✅ `40fee766` | ✅ `cad775c2` | Einzelagent ~3× schneller bei gleicher Qualität; Managed kauft Nachweis + Kontrolle |
| F2 weapon-presentation-tests | ✅ `759e49db` (a2, Ehrlichkeitsprobe **bestanden**; a1 `37d41c5d` am Gate rejected) | ✅ `8d8e3ffe` | Wie F1 (~3× Zeit, ~3× Tokens) — **plus**: beide Managed-Worker fanden und dokumentierten den latenten `colorToCss`-Bug, die Baseline nicht |
| F7 approval-durability | ✅ Approve + **Reject** (Gate überlebte 4 Neustarts) | — | **pass**, beide Richtungen entscheidend |
| F5 arena-presets | ✅ `da58df3b` (a2; a1 `e10c0b42` scheiterte am 12k-Summary-Bug, gefixt) | ✅ `a9ec5adb` | **Kernfrage beantwortet: Parallelität schlägt den Einzelagenten auf dieser Taskgrösse NICHT** (34m47s vs 7m15s, ~4.8×; Planung allein 19m). Qualität gleich, Managed kauft Integration+Gate+Verifikation+Kosten-Sichtbarkeit ($22.57). 2 neue Findings gefixt (12k-Summary, 2k-Dependency-Cut) |
| F4 rng-stream-split | ❌→**Messergebnis**: `982d8a8e` an Integration gescheitert (Cherry-Pick-Konflikt des dependent D3-Union-Commits; Rollback sauber) | ✅ `599c0b52` (3m 5s, 80/80) | **These bestätigt: Planner zerlegt gekoppelte S-Tasks, obwohl er nicht sollte** — und die gewählte Topologie ist strukturell inkompatibel mit dem Integrationsmodell (Architektur-Finding, Fix nach F8) |
| F3 playtest-export | ❌ `4ced0119` an Integration gescheitert (gleiche Architektur-Lücke wie F4; am Gate aus Blob-Hashes vorhergesagt) | ✅ `dcc0d363` (16m 37s, 88/88) | Managed liefert nichts Integriertes bei 1.4× Baseline-Zeit und $14.59 — aber: der Abstand schrumpft mit Taskgrösse; Dependency-Forwarding-Fix nachweislich wirksam (byte-identische Modul-Reproduktion) |
| F6 balance-overlap | ✅ `15e25b96` (9m 53s, $6.14, 0 Konflikte) | — (nur managed) | **pass** — Worker erkannten die Same-File-Kollision selbst, partitionierten Regionen, Integration konfliktfrei; präzisiert F4-Finding: tödlich sind divergente Duplikate, nicht Datei-Overlap an sich |
| F8 honest-failure | offen | — (nur managed) | **Letzte Fixture der Serie** |

Beweis-Branches im Pilot-Repo: `goal6/f1-*` (5), `goal6/f2-a1-worker`
(`810fed3`), `goal6/f2-a2-worker` (`e4fa6d7`), `goal6/f2-a2-integrated`
(`effc60e`), `goal6/f2-baseline` (`a4bacb3`). Beide ade-Worktrees sauber auf
Baseline `81820b9`. **Das Pilot-Repo selbst hat eigene uncommittete
Änderungen von Adi (ballistics, AxeAim u.a.) — niemals anfassen.**

## F5: erledigt am 18.07. — nächster Schritt ist F4 (wann NICHT zerlegen)

F5 komplett (beide Arme, Verdikt + 2 Findings in RESULTS.md). Für F4/F3/F6/F8
gilt dasselbe Protokoll wie unten für F5 dokumentiert (Treiber-Einzeiler,
Gate-Machine-Check, Evidenz-Branches `goal6/f<N>-...`, Worktree-Reset auf
`81820b9` inkl. `git clean -f -- CLAUDE.md`). Neu seit F5: Managed-Tasks
zeichnen ihre Aktivität als `ACTIVITY.jsonl` im Task-Dir auf („Aktivität
anzeigen" im Inspector) — beim F4-Run erstmals live prüfen.

## Archiv: F5-Protokoll (Referenz für die restlichen Fixtures)

0. ✅ erledigt am 18.07.: drei Worker vorhanden, Worktrees auf `81820b9`
   verifiziert (siehe „Sofort wissen" 4).
1. Managed-Arm starten (Gate-Timeout großzügig, M/L-Fixture):

   ```
   pnpm exec tsx scripts/goal6-drive.ts --mode managed --fixture F5 \
     --name "F5 arena-presets (managed)" --orchestrator "Main Chef" \
     --agents "Test_Agent_2D_Jump,Test_Agent_2D_Jump_2,Test_Agent_2D_Jump_3" \
     --parallel 4 \
     --timeout-min 60
   ```

   Score-Fokus (NICHT ins Ziel!): Wie verteilt der Planner die vier Presets
   und wem gehören Shared-Type + Registry? 2–4 Worker erwartet.
2. Am Gate: pro Worker-Commit-Range Machine-Check
   (`git diff --name-status <base>..<sha>` — nur `src/game/arenas/*`,
   Registry-/Typ-Modul, Tests), Diff-Dump lesen, dann
   `--mode approve --run "F5 arena"`.
3. Metriken ziehen; **Token-Telemetrie prüfen** (Checkpoint oben).
4. Evidenz: `goal6/f5-a1-worker[-n]` + `goal6/f5-a1-integrated`, dann ALLE
   beteiligten Worktrees `reset --hard 81820b9`. Nie bei aktiver Lease.
5. Baseline-Arm:

   ```
   pnpm exec tsx scripts/goal6-drive.ts --mode baseline --fixture F5 \
     --name "F5 arena-presets (baseline)" --agents "Test_Agent_2D_Jump"
   ```

   Danach unabhängig verifizieren (`pnpm test`, `npx tsc --noEmit` im
   Worktree), Evidenz `goal6/f5-baseline` (Operator-Commit), Worktree reset
   **plus `git clean -f -- CLAUDE.md`** (Task-Sessions injizieren das
   Scaffold; blockiert sonst die nächste Managed-Lease).
6. RESULTS.md: Zeilen + F5-Verdikt — die Headline-Frage: schlägt
   Managed-Parallelität den Einzelagenten auf der Wanduhr bei gleicher
   Qualität? Danach in dieser Reihenfolge weiter: **F4** (wann NICHT
   zerlegen), **F3**, **F6** (Overlap-Falle, 2 Worker, nur managed), **F8**
   (Ehrlichkeit, nur managed).

## colorToCss-Bug: Entscheid & vorbereiteter Fix-Run

Beide Managed-Worker haben in `src/ui/WeaponPresentation.ts` dokumentiert
(nicht gefixt, wie die Fixture es verlangte): `colorToCss` liefert für
negative Zahlen `#0000-1`-artige Strings, für Werte > `0xffffff` 7+
Hex-Stellen, für Nicht-Ganzzahlen einen Dezimalpunkt. Latent — mit gültigen
Waffenfarben nie ausgelöst.

**Empfehlung (von Adi am 2026-07-18 angefragt, Umsetzung noch nicht
beauftragt):** Nach Abschluss der Messreihe als echten ADE-One-Shot-Run
fixen lassen; Ergebnis bleibt als Branch (z.B. `fix/color-to-css`) im
Pilot-Repo, den Merge in `main` macht Adi selbst (Safety-Regel: ADE pusht
nie, fasst `main` nie an). So bleibt die Messumgebung bis F8 eingefroren und
der Fix-Run ist ein weiterer Dogfood-Datenpunkt. Fertiger Zieltext:

```text
Fix the out-of-range handling of colorToCss in src/ui/WeaponPresentation.ts:
clamp or mask the numeric input so any finite number yields a valid #rrggbb
string (negative values, values above 0xffffff and non-integer values must
not produce malformed CSS). Keep the output for valid 24-bit colors exactly
as today. Extend src/ui/WeaponPresentation.test.ts with edge-case tests for
negative, overflow and non-integer inputs. Acceptance: pnpm test green,
npx tsc --noEmit green, no files changed outside src/ui/WeaponPresentation.ts
and src/ui/WeaponPresentation.test.ts.
```

## Betriebsregeln (bewährt, unverändert gültig)

- Ziel = **nur der Fenced-Block** der Fixture (der Treiber extrahiert ihn
  selbst — Karten-Metadaten leaken das Messkriterium).
- Vor einem Managed Run keine interaktive Session im selben Repo-Scope.
- Nach jedem Run: Beweis-Branch, dann Worktrees hart auf Baseline; nie bei
  aktiver Lease.
- Pilot-Repo: Arbeitsbaum und `main` niemals anfassen, kein Push ohne
  separate Freigabe.
- Vor Profil-Sessions Config sichern; `%APPDATA%\Electron` gehört nicht uns.

## Verifikation dieses Stands

`pnpm run typecheck`, `pnpm test` (alle 9 Suiten grün, darunter
Orchestration-Beta jetzt 86 Checks mit 3 neuen ConPTY-Reprint-Tests,
Workspace-FS 7) und `pnpm build` sind grün. Der Telemetrie-Fix wurde gegen
ein echtes ConPTY-Transkript verifiziert (Repro-Protokoll im Finding in
RESULTS.md). Die Session-Commits: `aee2122` (Dialog), `5d5c678` (Parser +
F2-a2-Doku), `54c8793` (Baseline-Doku), plus dieser Handoff-Commit.
