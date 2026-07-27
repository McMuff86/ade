# ADE Professionalisierungs-Review — 2026-07-26

Grundlage: eine Multi-Agent-Analyse des gesamten Quellstands auf `6ccc7b5`
(sechs parallele Subsystem-Reader über Orchestrierung, PTY/Execution-Backends,
Renderer, Persistenz, Security/Publishing und Tests/CI), anschließende
adversarielle Gegenprüfung der kritisch eingestuften Befunde, plus manuelle
Nachprüfung der drei wichtigsten am Code. Ziel der Fragestellung: Was blockiert
den **täglichen professionellen Einsatz** und was blockiert die
**langfristige Wartbarkeit**?

Dieses Dokument bewertet und priorisiert. Umgesetzte Teile sind unten explizit
als erledigt markiert; alles andere ändert es selbst nicht.

**Belegstufen** in diesem Dokument:

- **verifiziert** — am Code nachgeprüft, entweder adversariell (Default:
  widerlegen) oder manuell beim Verfassen dieses Dokuments;
- **Hinweis** — aus der Analyse übernommen, nicht gegengeprüft. Als Spur
  behandeln, nicht als Tatsache.

## Was heute trägt

Fünf Eigenschaften sind besser als in vergleichbaren Produkten und dürfen von
keinem Punkt unten beschädigt werden:

- **Fail-closed Git-Ownership** (`src/main/orchestration/WorkspaceService.ts`):
  unveränderter HEAD, exakter Abgleich von gemeldetem und beobachtetem
  Pfad-Set, exaktes Staged-Set, Hooks/Signing deaktiviert; ein Konflikt bricht
  die gesamte Cherry-Pick-Sequenz ab.
- **Ein Phasenübergang = ein `store.save()`**
  (`src/main/orchestration/OrchestrationService.ts`). Für einen Single-File-
  Store ist das die richtige Bauart; jede Storage-Änderung muss diese
  Invariante erhalten.
- **Publikations-Attest**: `completeRun` verlangt genau ein erfolgreiches
  `verify`-Ergebnis mit HEAD-Gleichheit, `beginPublication` prüft erneut, und
  der Push nutzt `--force-with-lease=refs/heads/<branch>:` — strukturell nur
  Ref-Neuanlage möglich.
- **Der IPC-Vertrag**: der `never`-Exhaustiveness-Default in
  `src/main/ipcValidation.ts` macht einen unvalidierten Channel zum
  Compile-Fehler; `ExecutionBackendService` ist eine echte argv-only-Grenze.
- **Test-Tooling**: ~3 Minuten für die fokussierten Suiten, Electron-Workflow
  gegen Source *und* gepacktes Binary, AppImage und installiertes `.deb`,
  deterministische visuelle Baselines (eingefrorene Uhr, feste Daten, Scale,
  reduzierte Bewegung).

Die handgeschriebenen `tsx`-Driver sind **keine** Schwäche: Sie fahren echtes
Git, echte Bare-Remotes und ein Fake-`gh` und finden Integrationsfehler, die
eine gemockte Suite nicht findet. Ihr Problem ist ausschließlich, dass sie
nicht typgeprüft werden (Thema 4).

## Thema 1 — Überlebensfähiger State

> **Status: umgesetzt am 2026-07-26.** Kontrakt und Tabelle stehen in
> `ARCHITECTURE.md` („Config store durability"), Nachweis in
> `scripts/test-config-store.ts` (12 Checks) und im Electron-Workflow
> (truncated-config Restart).

**Befund (verifiziert).** `ConfigStore.load()` umschloss `readFileSync`,
`JSON.parse` und `normalizeConfig` mit einem einzigen `catch {}` und schrieb
danach `DEFAULT_CONFIG` **über die einzige Kopie**. Eine gesperrte Datei, ein
korruptes Byte oder ein ungewöhnlicher Record in einer Migration ersetzte damit
Agent-Katalog, Repository-Bindings, das vollständige Run-Journal und das
Publication-Audit — ohne Log, ohne Backup, ohne Fehler im UI. Kein Test fasste
diesen Pfad an, weil `store.ts` `app` auf Modulebene importierte.

Widerlegt wurde die Nebenbehauptung, ein abgebrochener Schreibvorgang könne den
Pfad auslösen: `persist()` war bereits tmp+rename und damit atomar. Die echte
Restlücke war das fehlende `fsync` vor dem Rename.

**Umgesetzt.** Nur `ENOENT` seeded. Jeder andere Fall wird zuerst nach
`userData/ade/corrupt/config-<ISO>.json` verschoben; erst danach dürfen
Defaults auf Platte. Scheitert die Sicherung selbst, bleibt das Original
unangetastet, der Store wird read-only und jedes `save()` wirft, bevor es den
In-Memory-Snapshot verändert. `config:health` liefert den Zustand an den
Renderer, der ihn als Banner über der Shell zeigt — im read-only-Fall
blockierend und nicht wegklickbar, weil ein leerer Katalog sonst wie eine
Neuinstallation aussieht.

**Offen aus diesem Thema:**

- `app.requestSingleInstanceLock()` in `src/main/index.ts` — zwei Instanzen
  schreiben je ihre eigene In-Memory-Kopie über die Datei und können beide ein
  „exklusives" Workspace-Lease vergeben (*Hinweis*).
- `version: number` auf `AdeConfig`: eine ältere Installation soll eine neuere
  Konfiguration nicht laden **und nicht überschreiben** (*Hinweis*).
- `normalizeConfig` an vier Stellen total statt fatal machen
  (`migrate.ts:87` `task.prompt.slice`, `:268-269` `resolve(undefined)`,
  `:301` `category.agents` nicht iterierbar) — heute fallen sie in die
  Quarantäne statt den Datensatz zu reparieren (*Hinweis*).
- `HarnessCredentialService.read()` liefert bei *jedem* Fehler einen leeren
  Store, und `set()` schreibt read-modify-write darüber: ein transienter
  Lesefehler löscht beim nächsten Key-Speichern die übrigen Keys
  (*Hinweis*).

## Thema 2 — Wiederholbare Run-Schleife

**Befund (verifiziert).** `RunCoordinator.start()` verlangt für alle
repo-gestützten Teilnehmer denselben `headSha`
(`src/main/orchestration/RunCoordinator.ts:231-234`), aber **nichts** re-based
je ein bestehendes Agent-Worktree: Bindings entstehen einmal und werden
wiederverwendet, weder `completeRun` noch `failRunCore` setzen sie zurück. Ein
`reset --hard` existiert in `src/main` ausschließlich in der
Dependency-Base-Vorbereitung. Das eigene Operator-Protokoll bestätigt es:
`scripts/goal6-drive.ts:28-29` verlangt manuelles Zurücksetzen nach jedem Run.

Präzisierung der Gegenprüfung: Es ist nicht strikt „der zweite Run". Worktrees
werden bei Binding-Erstellung vom damaligen Repo-HEAD geschnitten, also ist
auch ein *erster* Run blockiert, wenn die Bindings zu unterschiedlichen
Zeitpunkten entstanden. In-App-Workaround ist heute `workspace:removeBinding`
im Scope-Header — N Entfernungen pro Run plus wachsende, nie gemergte
`ade/<slug>-N`-Branches.

**Vorschlag.** `resetToBase(workspaceDir, baseSha)` in `WorkspaceService` und
`BackendWorkspaceService`, Vertrag analog `prepareDependencyBase`: Repo, clean,
auf einem Branch, `merge-base --is-ancestor`-Guard — und **vor jeder
Ref-Bewegung** ein dauerhafter Archiv-Ref `refs/ade/archive/<runId>/<agent>`,
denn ein blankes `reset --hard` lässt die Commits des Vorlaufs nur noch über
das Reflog erreichbar. Aufruf in `start()` zwischen Clean-Prüfung und
Basis-Gleichheit, ausschließlich wenn ein neues Feld `workspacePrepare` aus
einer expliziten Bestätigung im „Neuer Run"-Dialog gesetzt ist. Je Worktree
ein `workspace.rebased`-Event. Ohne Flag bleibt der Fail-closed-Fehler, nennt
aber die abweichenden Worktrees.

**Weitere Befunde in diesem Thema (Hinweise):**

- `RunCoordinator.ts:479`: Der Erfolgszweig prüft weder `isTerminalRun` noch
  `releaseIfDrained`. Ein Worker, der nach einem gescheiterten Geschwister
  fertig wird, hinterlässt dauerhaft `active`-Leases, die anschließend
  `deleteRun`, `removeBinding` und jeden weiteren Run auf diesem Worktree
  blockieren.
- `RunBudget` (`src/shared/types.ts:295`) hat keine Zeitdimension und
  `PtyManager` keinen Task-Timer: eine CLI, die auf einen interaktiven Prompt
  wartet, hält einen der vier globalen Slots unbegrenzt, ohne Benachrichtigung.
- `PtyManager.forceStop` eskaliert den Kill nie (node-pty sendet ein SIGHUP an
  die Shell-PID) und `removeSession` disposed die PTY-Listener nicht.
- Task-PTYs laufen auf festen 120×32, weshalb ConPTY genau das JSONL hart
  umbricht, aus dem die Budget-Telemetrie gelesen wird; die Reparatur-Regex in
  `runtimeEventStream.ts` existiert nur deshalb. `cols: 4096` für
  `task`-Spawns entfernt eine Klasse falscher „usage fehlt → fail closed"-
  Abbrüche.
- `RunTask.attempt` wird durch das Modell geführt und als „Versuch N"
  gerendert, aber keine Aufrufstelle übergibt je > 1: ein transienter
  CLI-Fehler verwirft einen 40-Minuten-Run.

**Exit-Kriterium.** In `scripts/test-orchestration-beta.ts` neben
`dependentTopologyCoordinatorChecks`: ein Roster läuft plan→verify durch, die
Teilnehmer-HEADs unterscheiden sich danach, und ein **zweiter** Run über
dieselben Bindings (a) scheitert ohne Flag weiterhin fail-closed und legt weder
Lease noch Task an, (b) setzt mit Flag jedes Worktree auf die Basis zurück,
während `refs/ade/archive/*` weiterhin auf die Tips des ersten Runs zeigt, und
erreicht seinen Planning-Task, (c) bricht bei einem dirty Worktree ab, bevor
ein Ref bewegt wird. Kein manuelles `git` mehr im Operator-Protokoll.

**Bezug zur Roadmap.** Parallel zu Goal 7, muss dessen Exit-Kriterium aber
vorausgehen: Goal 7 verspricht „local API integration tests can drive and
reconnect to a full managed run" — eine Loopback-API über eine Schleife, die
nur einmal funktioniert, erbt den Defekt und macht ihn remote.

## Thema 3 — Beendete und gescheiterte Runs lesbar machen

Alles, was ein Run erzeugt, ist persistiert; fast nichts davon ist am Tag 30
im UI erreichbar (*alle Punkte Hinweise*):

- `graphModel.ts:236` rendert nur die zwei jüngsten terminalen Runs, während
  `GraphView.tsx:1084` **alle** Runs im Selector listet: Auswahl eines älteren
  Runs ergibt leere Canvas, null-Inspector, keine Dock und keine Erklärung
  (`.gempty` greift nur bei `runs.length === 0`).
- Ergebnisse persistieren `filesChanged`, `tests[{command,status,output}]`,
  `risks` und eine Zusammenfassung; der Inspector zeigt davon eine Zahl,
  „N ok · M fehlgeschlagen" und 220 Zeichen. Scheitert ein Run an
  „verification reported one or more failed tests", kann das Produkt nicht
  sagen, welcher Test.
- Kein Signal außerhalb des Graphen, wenn ein Run in `approval` geht
  (`notificationPolicy.ts` kennt nur Session-Exits) — das tragende menschliche
  Gate wartet unbegrenzt und hält dabei exklusive Leases.
- `integration.applied` journaliert nur `{ commitCount }`. Nach einem
  Post-Integration-Fehler besitzt der Nutzer ein zusammengesetztes, nicht
  verifiziertes Worktree ohne Zeiger darauf — kritisch, sobald Thema 2 dieses
  Worktree zurücksetzen kann.
- 24 `console.error//warn` in `src/main` gehen im gepackten NSIS-Build ins
  Leere; es fehlt eine rotierende `userData/ade/logs/main.log`.
- **Accessibility**, die `AGENTS.md` bereits verlangt: Der Graph-Modus hat
  keinen Tastaturpfad. Karten sind blanke `<div onClick>`,
  `useSessionShortcuts` kehrt außerhalb des Terminals-Modus früh zurück, und
  `.gteam-actions` ist `opacity: 0` ohne `:focus-within`.

**Bezug zur Roadmap.** Parallel zu Goal 7 und billige Vorleistung für Goal 9:
dessen mobile Approval-Ansicht braucht exakt „changed-file set, tests, risks,
commit SHAs" — wer diese Projektion zuerst für den Desktop-Inspector baut,
schenkt Goal 9 die DTO-Form.

## Thema 4 — Evidenz echt machen

> **Status: die ersten zwei Punkte umgesetzt am 2026-07-27.** Kontrakt in
> `ARCHITECTURE.md` („How the evidence is kept honest"), Guards in
> `tsconfig.scripts.json` und `scripts/run-suites.ts`.

- **Verifiziert, umgesetzt:** `tsconfig.node.json` und `tsconfig.web.json`
  schlossen `scripts/**` nicht ein, `tsx` transpilierte ungeprüft. Damit lief
  der Vollständigkeits-Guard der IPC-Oberfläche ins Leere:
  `scripts/test-security.ts` deklariert `Record<InvokeChannel, unknown>`
  genau deshalb, damit ein neuer Channel ohne Fixture ein Typfehler ist — die
  Laufzeitschleife kann das nicht ersetzen, weil ein fehlender Key als
  `undefined` durch jeden void-Request rutscht. Gefundene Lücke: `wsl:list`.

  `tsconfig.scripts.json` ist jetzt der dritte `tsc --noEmit` in
  `pnpm typecheck`. Das Einschalten förderte **16 echte Typfehler** in den
  Drivern zutage, überwiegend Fixtures, die eine Form konstruierten, die die
  Produktionstypen nicht zulassen: `Repository`/`WorkspaceBinding` ohne
  `executionBackend` (3×), `RunTask` ohne `title`/`phase`/`managed`/
  `dependsOn`/`attempt` (2×, darunter der Fake für `runTask:create`, der damit
  eine Antwort lieferte, die der echte Handler nie erzeugt), ein Cast in
  `test-electron-workflow.ts`, dessen äußerer Typ ein Feld behauptete, das die
  innere Auswahl nicht deklarierte, ein toter Parameter in `fake-gh.ts` und
  ein `check(…)`-Aufruf in `test-prompts.ts`, dessen drittes Argument die
  Signatur gar nicht kannte.

  **Gegenprobe:** ein testweise ergänzter Channel `probe:guard` erzeugt
  `scripts/test-security.ts(36,7): TS2741 … Property '"probe:guard"' is
  missing`. Zur Einordnung: ein Channel *ohne Validierung* war nie ungeschützt
  — `ipcValidation.ts` endet in `const exhaustive: never = channel` und fängt
  das im bestehenden Typecheck. Ungedeckt war der validierte Channel ohne
  Security-Fixture.
- **Verifiziert, umgesetzt:** Die 13-gliedrige `&&`-Kette in `package.json`
  brach beim ersten Fehler ab und kannte keine Mindest-Check-Zahl je Driver;
  ein halbierter Lauf las sich grün. `pnpm test` ruft jetzt
  `scripts/run-suites.ts`: alle Suiten laufen (eine kaputte verdeckt die
  übrigen nicht mehr), und jede hat einen gemessenen Boden.

  **Gegenprobe:** wird ein einzelner Check aus `test-workspace-fs.ts`
  entfernt, meldet die Suite selbst `6 passed, 0 failed` und beendet sich mit
  0 — also grün — und der Runner lehnt sie ab:
  `workspace-fs: only 6 checks, floor for win32 is 7`.

  Böden sind plattformabhängig, weil vier Driver Checks an `process.platform`
  binden. Gemessen und erzwungen ist bisher nur `win32`; der Runner benennt
  jede Plattform ohne Messung ausdrücklich, statt eine Zahl zu erfinden. Für
  Linux fehlt die Messung noch — sie braucht einen grünen Lauf auf einer
  Linux-Installation (`pnpm test -- --record`), nicht eine Herleitung am
  Schreibtisch.
- `scripts/test-visual-regression.ts` überspringt den Pixelvergleich, sobald
  `CI` gesetzt ist, und beide `ci.yml`-Jobs setzen `CI: '1'`: die Baselines
  werden ausschließlich lokal verglichen (*Hinweis*).
- Der WSL-Pfad — der tägliche Ausführungspfad des Betreibers — skippt still
  als PASSED (*Hinweis*).
- Kein Lint, kein Format, keine Hooks; `noUncheckedIndexedAccess` kostet
  gemessen 18 Korrekturen (*Hinweis*).
- **Release-Identität:** `version` steht seit 97 Commits auf `0.1.0`,
  `git tag -l` ist leer, beide Packaging-Workflows triggern auf `v*`-Tags, die
  nie entstehen, und `app.getVersion()` kommt in `src/` nicht vor (*Hinweis*).

## Thema 5 — Kosten der Historie begrenzen

Noch nicht blockierend, aber jede Messung zeigt eine Gerade in die Wand
(*Hinweise*): `JSON.stringify(cfg, null, 2)` für eine Datei, die kein Mensch
liest, bei ~50 Vollschreibungen pro Managed Run — 4.9 ms bei 0.42 MB, 54 ms
bei 9.5 MB, 226 ms bei 38 MB, auf demselben Main-Thread, der jeden PTY-Chunk
pumpt. Dazu klont `OrchestrationService.emit()` das gesamte Journal inklusive
Prompts und Artefakt-Inhalten und broadcastet es bei jedem Save an jedes
Fenster, während der Renderer jede Slice ersetzt und es kein `React.memo` gibt.
Die Cursor-Deltas (`run:events`) existieren bereits und haben null
Renderer-Aufrufstellen — dieselbe Mechanik, auf der Goal 7s resumable SSE
spezifiziert ist. Retention existiert nur für `commandLog`, und `deleteRun`
verweigert genau die erfolgreichen Runs, die der Alltag erzeugt.

## Thema 6 — Die Grenze härten, die Goal 7 erbt

Goal 7s Exit-Kriterien sind Sicherheitsaussagen; drei davon sind mit der
heutigen Struktur nicht konstruktiv erzwingbar (*Hinweise*, sofern nicht
anders markiert):

- **Channel-Privilegien-Klassifikation.** `agent:update` nimmt ein beliebiges
  `dashboardCommand` (validiert nur als ≤4096-Zeichen-String) entgegen, das
  `agent:openDashboard` durch `/bin/bash -lic` bzw. `powershell -Command`
  ausführt — die eine bewusste Ausnahme von der argv-only-Grenze. Autorisierung
  ist ausschließlich das binäre `assertTrustedSender`. Ein exhaustives
  `CHANNEL_POLICY: Record<InvokeChannel, {effect, surface}>` macht Goal 7s
  „share authorization" zu einem Typ statt zu einer Review-Konvention.
- **Redaktions-Trichter.** `handle()` gibt Handler-Fehler wörtlich zurück,
  `ExecutionBackendService.checked` bettet bis zu 2000 Zeichen rohes
  Backend-stderr ein, und der einzige Redaktor liegt in `PublicationService`.
  Hochziehen nach `src/main/errors.ts` und um `handle()` legen.
- **Credentials in argv und Log** (*teilweise verifiziert, Schwere auf
  medium korrigiert*): Gespeicherte Keys erreichen bei WSL-Sessions die argv
  von `wsl.exe` und ein Dev-Log. Die behauptete Linux-`ps aux`-Exposition
  existiert nicht — `/usr/bin/env` execve()t sofort. Die dauerhafte Exposition
  ist die Windows-seitige Kommandozeile des langlebigen `wsl.exe`-Relays.
  Zwei unabhängige Fixes: Redaktion im `args`-Log (Einzeiler, zuerst) und
  `WSLENV=NAME/u:…` statt positionaler `env`-Liste.
- **Dashboard-Fenster.** `will-navigate` ist gehookt, `will-redirect` nicht —
  ein 302 landet eine fremde Origin in einem ADE-gebrandeten Fenster.
  `persistSessionCookies` ruft `cookies.get({})` ohne URL-Filter und gibt damit
  *jeder* Origin 30 Tage Persistenz; ein `clearStorageData`-Pfad fehlt.
- **Broadcast-Ziel.** `ipc.ts` und `PtyManager.broadcast` iterieren
  `BrowserWindow.getAllWindows()`, was Dashboard-Fenster mit beliebigen
  https-Origins einschließt. Inert ist das nur, weil diese Fenster kein Preload
  haben — ein Zufall, keine Grenze.
- **Symlink-Parität im Lesepfad.** `workspaceFs.safeResolve` ist rein
  lexikalisch, während Mutationspfade und das gesamte WSL-Backend `O_NOFOLLOW`
  plus `lstat` je Komponente erzwingen.

## Reihenfolge

1. **Thema 1** — erledigt bis auf Single-Instance, Config-Version und die vier
   `normalizeConfig`-Stellen.
2. **Thema 4, erste zwei Punkte** (`tsconfig.scripts.json`, Suite-Runner mit
   Check-Untergrenze) — Stunden, und sie sichern alles Folgende ab.
3. **Thema 2** — beseitigt die tägliche Handarbeit.
4. **Thema 6** — vor dem nächsten Goal-7-Slice.
5. **Thema 3**, dann **Thema 5**.

## Ausdrücklich nicht jetzt

**Keine Migration auf indizierten Storage (SQLite o. ä.).** Die Messwerte
tragen sie nicht (4.9 ms pro Save bei realen 435 KB), und sie würde die
stärkste Korrektheitseigenschaft des Codebase — ein Phasenübergang als ein
`store.save()` — zusammen mit atomarem Rename und bewährter idempotenter
Migration aufs Spiel setzen, um ein Problem zu lösen, das Thema 5 zum
Bruchteil der Kosten erledigt. Neu bewerten, wenn ein reales Journal mit
aktiver Retention ~10 MB überschreitet.

**Die tsx-Driver nicht durch vitest ersetzen.** Ihr Wert sind die echten
Git-/`gh`-Fixtures. Typprüfen statt neuschreiben.
