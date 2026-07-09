# Handoff — MVP worker distribution (shipped) → next steps

Status: 2026-07-09. Follows `docs/HANDOFF-graph-worker-distribution.md`, which
laid out the two simulated pieces (worker distribution + agent-to-agent comms).
**Feature 1 (worker distribution) is now real in its minimal-viable form.**
This doc records what shipped, how it was verified, and what's still open.

## What shipped (Feature 1 — MVP, no LLM planning)

The "same task fanned out to every worker" version from the original handoff's
*Minimal viable version* section.

- **`graphActions.ts`**
  - New `DispatchOpts { toWorkers?: boolean }`.
  - `dispatchTeam(teamId, task, opts)`: when `opts.toWorkers`, each worker gets
    its **own real pty session** with the same task via
    `useSessions.getState().createSession(worker.id, text)` — the exact path the
    lead already uses (pty spawn + memory injection). Without the flag, workers
    keep the old transient `working → done` animation.
  - **Cost guard:** worker sessions are spawned **sequentially** (`await` per
    worker) — never N ptys at once. `busy` is driven off the real spawn result
    (`done` on success, `clearBusy` on failure), not a fixed timer.
  - `dispatchAll(task, opts)` forwards `opts` to every active team.
- **`GraphView.tsx`**
  - `ComposerTarget` carries `workerCount` (team = its workers; all =
    `activeWorkerCount(model)`, i.e. workers across non-idle teams).
  - Composer gained a **"auch an Worker verteilen"** toggle (disabled at 0
    workers) + a **warning line** stating how many extra sessions will start.
  - Toast reports the worker count on send.
- **`graph.css`** — styles for `.gcomposer-dist` (toggle) and `.gcomposer-warn`
  (warning, in `--accent`).

## How it was verified

- **`pnpm test:dispatch`** (`scripts/test-worker-dispatch.ts`) — drives the
  **real** `dispatchTeam` against a stubbed `window.ade`, asserting:
  no-fanout → only the lead spawns; `toWorkers:true` → lead + every worker each
  spawn one session carrying the task; idle team / empty task → nothing. 9/9.
  This is the headless renderer-stub technique from the original handoff's
  "Verifying headlessly" gotcha (the stub records `pty:create` payloads).
- **`pnpm run typecheck`** + **`pnpm run build`** — clean.
- **`pnpm dev`** — Electron boots, window created, no runtime errors. The
  GUI click-through (spawn team → "Task ans Team verteilen" → toggle → send)
  was **not** automated — no browser/GUI-automation tooling is available here,
  and it's an Electron desktop window, not a browser. Left for manual QA.

## Environment note (bit us once)

pnpm skipped **electron**'s postinstall on `pnpm install`, so the Electron
binary was missing (`Error: Electron uninstall` on `pnpm dev`). Fixed by running
`node install.js` in the electron package, and by adding
`pnpm.onlyBuiltDependencies: [electron, esbuild, node-pty]` to `package.json` so
future installs run those build scripts. If a fresh clone hits "Electron
uninstall", run `pnpm rebuild electron` (or the package's `install.js`).

## Still open (unchanged from the original handoff)

1. **Report-back is still fake.** Workers spawn real sessions now, but `done`
   fires on *session-created*, not on the worker actually finishing. There is no
   signal from a worker back to its lead. Real completion needs Feature 2.
2. **Fuller worker distribution — lead plans the split.** Today every worker
   gets the *same* task. The `TASKS.json` convention (lead writes
   `{ worker?, task }[]` into its `workspaceDir`, main watches it, renderer
   spawns one session per entry) is still unbuilt. See the original handoff
   §"Fuller version" + "Touch points".
3. **Feature 2 — agent-to-agent communication (mailboxes).** Entirely unbuilt.
   The recommended Option A (file-based INBOX/OUTBOX under `memoryDir`, fs.watch
   routing in main, `mailbox:*` IPC) is fully specced in the original handoff
   §"Feature 2". This is the next real milestone: it's what makes report-back
   and lead→worker delegation genuine instead of animated.

## Suggested next step

Feature 2, Option A, in the order the original handoff gives: mailbox storage +
IPC + injection first (verify a lead can write a subtask file), then main-side
routing + a `mailbox:changed` event that drives the graph's `busy`/report-back
edges — replacing the remaining `setTimeout` animation in `dispatchTeam` (the
non-`toWorkers` branch) and wiring worker `done` to a real report.

## Touch points for the current change (for review/rollback)

- `src/renderer/graph/graphActions.ts` — `DispatchOpts`, `dispatchTeam`, `dispatchAll`
- `src/renderer/graph/GraphView.tsx` — `ComposerTarget`, `activeWorkerCount`, Composer toggle
- `src/renderer/graph/graph.css` — `.gcomposer-dist`, `.gcomposer-warn`
- `scripts/test-worker-dispatch.ts` — headless verification (`pnpm test:dispatch`)
- `package.json` — `test:dispatch` script, `pnpm.onlyBuiltDependencies`
