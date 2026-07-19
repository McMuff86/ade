# ADE — Architecture (binding decisions)

Status: v5, updated 2026-07-12 with implemented repository scopes/reusable
agents (`docs/REPOSITORY_SCOPES_PLAN.md`) and planned remote control/mobile
companion (`docs/REMOTE_CONTROL_PLAN.md`). Terminal, orchestration and
repository-scope implementation details supersede v4
(`docs/reports/superset.md`, `docs/reports/hermes-memory.md`).
Product requirements live in `docs/SPEC.md`. When this doc and SPEC conflict,
SPEC wins.

## Decision: fresh app, Superset patterns copied selectively

We do NOT fork Superset (Elastic-2.0 monorepo with two parallel terminal
generations + cloud/auth woven through the entry path). We build a fresh
Electron app and port the load-bearing pieces:

- xterm setup + write-coalescer + attach/replay patterns
  (`reference/superset/apps/desktop/src/renderer/lib/terminal/*`)
- xterm theming (`…/stores/theme/utils/terminal-theme.ts`, `src/shared/themes/**`)
- git diff/status engine patterns (`…/src/lib/trpc/routers/changes/**`)
- worktree lifecycle (`…/routers/workspaces/utils/{worktree,git}.ts`)
- agent launch commands (`packages/shared/src/builtin-terminal-agents.ts`,
  `agent-command.ts`, renderer `agent-launch-command.ts`/`argv.ts`)
- pty-daemon's session model (ring buffer, detach/replay) — but NOT its
  POSIX-only process (fd-handoff/stty). We are Windows-first: node-pty with
  ConPTY lives in the Electron main process.

Hermes memory design is ported per `docs/reports/hermes-memory.md`.

## Decision: identity, repository and execution scope are separate

Category-owned `repoPath` and a fixed agent `workspaceDir` are compatibility
storage, not the active ownership model. Goal 5 introduced first-class
`Repository` records, optional agent defaults and one `WorkspaceBinding` per
agent/repository pair. A session, task or run snapshots an immutable execution
scope resolved from an explicit repository, the agent default or its plain home
workspace.

Categories remain presentation/organization. A portable agent can use multiple
repositories without sharing a worktree between them. A live PTY cannot change
scope; selecting a different repository creates a new session. A repo-backed
managed run chooses one repository and leases one exclusive binding per
participant, preserving Goal 4's common-Git-dir and integration guarantees.

`AgentTemplate` is immutable spawn configuration. Spawning creates a normal
agent with independent identity, memory and workspace bindings; templates and
sibling instances never share mutable state. Existing category paths and agent
workspaces migrate non-destructively. Full rules live in
`docs/REPOSITORY_SCOPES_PLAN.md`.

## Decision: mobile is a control adapter, not an execution plane

The desktop remains authoritative for agents, runtime credentials, PTYs, files,
Git worktrees, integration and persisted run state. The planned mobile PWA
submits a deliberately small set of commands and observes authoritative events;
it never executes an agent locally and is not a streamed Electron renderer.

Electron IPC and remote HTTP will be adapters around one transport-neutral ADE
application boundary. The remote host must not expose arbitrary IPC names,
`AdeConfig`, raw PTY methods or desktop filesystem methods. This keeps the
existing sender-validated IPC boundary intact while giving both clients the
same command semantics.

The personal alpha uses a loopback-only host behind Tailscale Serve. Tailscale
is the private ingress and outer identity boundary; ADE still owns per-device
pairing, endpoint authorization, sessions, audit and revocation. Public ingress,
accounts and hosted relays are deferred until after personal-alpha validation.

## Toolchain

- pnpm, TypeScript strict, Electron (latest stable), electron-vite, React 19.
- State: Zustand. Styling: plain CSS with design tokens (custom properties)
  taken from `mockup/index.html` — no Tailwind.
- Panels: `react-resizable-panels` (rail / center / right panel).
- Terminal: `@xterm/xterm` + `@xterm/addon-fit` (+ unicode11; webgl optional
  behind a capability check).
- Workflow verification: Playwright launches both the compiled Electron entry
  and the packaged executable against an isolated user-data directory.
- Windows distribution: electron-builder + assisted x64 NSIS. The node-pty
  Node-API prebuild is retained rather than rebuilt with a machine toolchain.
- Git: `simple-git`. Config persistence: hand-rolled atomic JSON store in
  `app.getPath('userData')`.
- Icons: text glyphs or lucide-react sparingly. No emojis anywhere (SPEC).
- Planned remote transport: a small Node HTTP server bound to loopback, JSON
  commands plus server-sent events, and a separate React/Vite PWA. WebSocket is
  deferred because Goals 7-10 have no bidirectional terminal stream.

## Repo layout (this repo, root = the app)

```
package.json               # the app; one-command: pnpm i && pnpm dev
electron.vite.config.ts
src/
  main/                    # Electron main
    index.ts               # window, app lifecycle (small; no updater/cloud)
    ipc.ts                 # channel registration
    ipcValidation.ts       # exact runtime request validation for every invoke
    security.ts            # renderer/navigation URL allowlists
    diagnostics/           # read-only CLI/version/auth checks
    notifications.ts       # background native exit/completion notifications
    platform.ts            # host path identity, null device, deterministic shell
    pty/PtyManager.ts      # node-pty sessions, ring buffers, launch profiles
    git/                   # status/diff/worktree (simple-git)
    config/store.ts        # atomic catalog/run/settings JSON + migration
    orchestration/         # run/task/event service and legacy Graph migration
    repositories/          # repository catalog, bindings and scope resolution
    memory/                # MemoryStore.ts port + managed-block injection
    photos.ts              # profile photo import/store (PNG/JPG, alpha kept)
  preload/index.ts         # contextBridge: typed invoke/on wrappers only
  renderer/
    App.tsx                # layout shell (rail | tabs+terminal | right panel)
    theme/                 # tokens.css, themes.ts (incl. xterm ITheme), provider
    rail/                  # categories + agents, avatars, presence
    tabs/                  # session tab strip
    terminal/              # TerminalPane (xterm runtime, coalescer, attach)
    diagnostics/           # CLI/auth readiness modal
    keyboard/              # view/session shortcut routing
    rightpanel/            # binding-aware scope header + Files/Changes
    onboarding/            # first-run + new category/agent modals
    graph/                 # run-scoped control-plane canvas and dispatch
    stores/                # Zustand catalog, session, run, and UI mirrors
  shared/
    types.ts               # catalog, session, run/task/event, runtime contracts
    ipc.ts                 # IPC channel names + payload types (contract)
    runtimes.ts            # launch profiles incl. permission-mode flags
docs/                      # SPEC, this file, reports/
mock/  mockup/             # references (kept)
reference/                 # cloned Superset/Hermes — git-ignored
```

Planned additions for Goals 7-10 (names may be refined without changing the
boundaries):

```
src/
  main/
    core/                  # ADE application commands/events shared by adapters
    remote/                # loopback HTTP host, pairing, sessions, audit
  mobile/                  # responsive PWA; no Electron or Node assumptions
  shared/
    remote.ts              # versioned mobile DTOs and runtime schemas
```

## Current core types through Goal 5 (shared/types.ts)

```ts
type PermissionMode = 'default' | 'accept-edits' | 'bypass';
type RuntimeId = 'claude' | 'codex' | 'opencode' | 'grok' | 'gemini'
               | 'ollama' | 'shell' | 'custom';

interface Repository { id: string; name: string; rootPath: string;
                       commonGitDir: string; verified: boolean }
interface WorkspaceBinding { id: string; agentId: string; repositoryId: string;
                             workspaceDir: string; branch: string;
                             status: 'ready' | 'legacy-unverified' | 'invalid' }
interface Category { id: string; name: string; photo?: string;
                     repoPath?: string;                          // compatibility
                     defaultRepositoryId?: string; agents: string[] }
interface Agent    { id: string; categoryId: string; name: string; role?: string;
                     photo?: string; runtime: RuntimeId;
                     permissionMode: PermissionMode;
                     defaultRepositoryId?: string;
                     workspaceDir: string;                       // compatibility alias
                     homeWorkspaceDir?: string;
                     memoryDir: string }
interface SessionMeta { id: string; agentId: string; title: string;
                        kind: 'interactive' | 'task';
                        status: 'running' | 'exited'; createdAt: number;
                        repositoryId?: string; workspaceBindingId?: string;
                        workspaceDir?: string;
                        scopeSource?: 'explicit' | 'agent-default' | 'plain-home' }
interface Run { id: string; name: string; goal: string; status: RunStatus;
                mode: 'manual' | 'managed'; phase: RunPhase;
                repositoryId?: string | null; budget: RunBudget }
interface RunParticipant { id: string; runId: string; agentId: string;
                           agentName: string; runtime: RuntimeId;
                           role: 'orchestrator' | 'lead' | 'worker';
                           teamId?: string; teamName?: string;
                           repositoryId?: string | null }
interface RunTask { id: string; runId: string; participantId: string;
                    title: string; prompt: string; phase: RunTaskPhase;
                    managed: boolean; dependsOn: string[];
                    status: RunTaskStatus; sessionId?: string;
                    repositoryId?: string | null; workspaceBindingId?: string;
                    workspaceDir?: string }
interface AgentTemplate { id: string; name: string; runtime: RuntimeId;
                          permissionMode: PermissionMode;
                          codexModel?: string;
                          codexReasoningEffort?: CodexReasoningEffort;
                          memorySeed: { memory: string; user: string } }
interface RunEvent { id: string; runId: string; type: RunEventType;
                     taskId?: string; participantId?: string; createdAt: number }
```

Goal 5 migration moves active repository ownership out of `Category.repoPath`
and `Agent.workspaceDir` while retaining both compatibility fields. Repository,
binding and template records persist in the atomic config; sessions, tasks,
runs and leases retain resolved ids/paths so later default changes or migration
cannot rewrite an execution's meaning.

The remote contract will not serialize these storage/domain objects directly.
It uses versioned, mobile-safe projections plus target records such as
`RemoteDevice`, `RemoteSession`, `RemoteAuditEvent` and
`RemoteIdempotencyEntry`. Device/session secrets are stored separately from the
catalog snapshot and are never returned after issuance.

## Launch profiles (shared/runtimes.ts)

Command per runtime × permission mode (adapted from Superset's
builtin-terminal-agents; every profile user-overridable via `customCommand`):

| runtime | default | accept-edits | bypass |
|---|---|---|---|
| claude | `claude` | `claude --permission-mode acceptEdits` | `claude --dangerously-skip-permissions` |
| codex | `codex` | `codex --sandbox workspace-write --ask-for-approval on-request` | `codex --dangerously-bypass-approvals-and-sandbox` |
| opencode | `opencode` | — | — |
| grok | `grok` | — | — (flags configurable; CLI naming varies) |
| gemini | `gemini` | `gemini --approval-mode=auto_edit` | `gemini --yolo` |
| ollama | `ollama run <model>` | — | — |
| shell | user's default shell (PowerShell on Windows) | — | — |

Interactive sessions spawn a shell in a main-resolved execution scope and type
the configured CLI command, so leaving the CLI returns to a usable shell. Task
sessions use a one-shot non-interactive command and exit with the CLI. Launch
callers pass a repository/binding selector; main snapshots the resolved working
directory before spawn. Renderer-provided absolute paths and later default
changes never retarget a process.

Native Codex identities additionally persist a validated model id and reasoning
effort. ADE defaults them to `gpt-5.6-sol` and `high`; the saved role policy can
raise the main orchestrator to `xhigh`. Interactive and managed launch commands
append `--model <id> -c model_reasoning_effort=<effort>`, and task provenance
records both values. Model ids accept only a conservative CLI-safe character
set; custom commands deliberately opt out of the native adapter and its
reproducibility guarantees.

## PTY layer (main/pty/PtyManager.ts)

- `node-pty` spawn with ConPTY on Windows (`useConpty: true` default), shell
  fallback for POSIX.
- `main/platform.ts` centralizes host semantics: Windows path keys fold case,
  POSIX keys preserve it, null-device selection is explicit, and desktop
  POSIX launches choose an executable absolute `$SHELL` or a standard
  `/bin/*` fallback instead of assuming a terminal-inherited PATH.
- Per session: 256 KB ring buffer of raw output for replay on (re)attach —
  Superset pty-daemon pattern. Output events carry a sequence number so replay
  and the live stream meet without a race.
- Main owns sessions across renderer reloads. `pty:list` reconstructs renderer
  tabs; full app quit still stops all PTYs.
- Interactive sessions spawn immediately. One-shot task sessions acquire a
  FIFO lease with a global limit of four active task CLIs. The lease is held
  until exit/cancellation, not merely until process spawn.
- Task prompts are passed through `ADE_TASK_PROMPT` over stdin into supported
  non-interactive CLI forms (`claude -p`, `codex exec … -`, etc.), never typed
  after a fixed delay or expanded as a native PowerShell argument. This keeps
  quote-laden multiline prompts byte-stable under Windows PowerShell 5.1 and
  POSIX shells.
- Claude stream-json and Codex JSONL are parsed incrementally into the same
  bounded, sanitized activity model. Raw output retains its byte-exact replay;
  human-readable activity is also appended to task-local `ACTIVITY.jsonl` and
  survives session teardown.
- Tab close and identity deletion stop and remove owned PTYs. Naturally exited
  sessions keep replay for 30 minutes and are then reaped.
- Task sessions carry a `runTaskId`; normal shutdown journals cancellation and
  the next startup fails any work left active by an unclean exit.
- Exit reason lives on retained session metadata. Renderer hydration buffers
  exit/removal events while `pty:list` is in flight, so an event cannot be
  overwritten by an older list snapshot.
- Exited output remains attachable until close/reap. Interactive sessions may
  be restarted explicitly; run tasks are never silently re-run.

## Repository scope layer (implemented Goal 5)

- `RepositoryScopeService` owns repository import/deduplication, agent defaults,
  binding/worktree resolution and non-destructive legacy migration.
- Repository identity is validated from normalized real paths plus Git common
  directory. Importing a repo through another casing, separator or linked
  worktree cannot create a second root record.
- Resolution order is explicit repository → optional agent default → plain home
  workspace. The result is stored on the new session/task/run before launch.
- Each agent/repository pair has a distinct binding and worktree. A binding is
  immutable while a PTY is live and exclusively leased while a managed run
  owns it. Defaults affect future resolution only.
- A repo-backed run stores one repository scope and gives each participant its
  own binding under the same Git common directory. Multi-repository integration
  inside one run stays unsupported.
- Files/Changes receives the selected execution's binding id and resolves it in
  main. Its new scope header shows repo, source, branch/worktree and lease state;
  choosing another repo opens a new session instead of retargeting a process.
- Portable agent memory remains explicitly global. A binding-local overlay is
  reserved for repository-specific context, and repository content is never
  silently promoted into global memory.
- Templates store spawn defaults and a memory seed only. Spawned agents receive
  independent ids, memory directories and bindings.
- Migration deduplicates category `repoPath` entries, assigns corresponding
  agent defaults and adopts only provably matching existing worktrees. Ambiguous
  paths remain usable legacy plain workspaces and are reported for repair.
- Default changes, detach and catalog cleanup never move/delete a worktree,
  branch or user file implicitly. Active references block destructive cleanup.

## Run and task control plane (main/orchestration/)

- Categories and agents are the persistent catalog. A `RunParticipant`
  references a catalog agent and snapshots display/runtime fields so history
  remains readable if that agent is later removed.
- Orchestrator/lead/worker roles and team ids belong to a run. Creating a run
  never creates a category, agent, workspace, or worktree.
- Every task transition appends a normalized event. Cached task/run status is
  convenient for storage inspection, but renderer snapshots reconstruct status
  from the journal so stale cached values cannot change history.
- Pre-run Graph topology is imported once into `legacy-graph-run-v1`; legacy
  categories and agents remain untouched.
- The renderer receives authoritative snapshots through
  `orchestration:changed`; Graph transient state is limited to layout, selection,
  and pause controls. Real task status replaces the old completion timer.

### Managed-run coordinator

- `RunCoordinator` owns the state machine: planning → working → approval →
  integrating → verifying → terminal. Only the coordinator creates managed
  tasks; direct Graph dispatch remains available for manual runs.
- A planner may assign each non-orchestrator participant at most once. ADE
  validates participant ids and an acyclic dependency graph, then starts only
  the worker tasks whose dependencies are complete and whose run concurrency
  slot is available. The global four-PTY queue remains an independent ceiling.
- A dependency currently forwards validated result/context data only; it does
  not rebase the dependent participant's isolated worktree onto an upstream
  worker commit. All participants retain the common leased base. Goal 6 F3/F4
  proved that dependent code tasks which duplicate upstream files can produce
  structurally valid but non-integrable add/add or union commits. Until a
  controlled worker-base/patch-ownership design ships, safe plans keep changing
  tasks independent or assign the dependent vertical slice to one owner.
- Every managed task must produce `StructuredTaskResult` version 1. The schema
  includes outcome, summary, worker assignments, changed files, real test
  command/status/output entries, commit SHA, risks and nullable usage. For
  repo-backed work, the runtime returns `commitSha=null`; ADE fills the SHA only
  after validating and committing the exact reported diff. Process exit 0
  without a valid result is a task failure.
- `runtimeAdapters.ts` is the adapter boundary. The native Codex adapter uses
  `codex exec --json --output-schema --output-last-message` and reads token
  usage from `turn.completed`; its JSONL also powers the live/persisted activity
  feed. `file-mailbox-v1` injects result/schema/inbox/
  outbox paths for other non-shell runtimes and requires the result file before
  process exit.
- `MailboxService` journals each delivery and mirrors JSONL under
  `<memoryDir>/mailbox/<runId>/`. Task schema/result files live under
  `<memoryDir>/orchestration/<runId>/<taskId>/`; Codex receives that directory
  through `--add-dir`. Linked-worktree Git metadata remains outside every
  runtime's writable roots.
- Every identity owns a durable, fenced `AGENTS.md` role contract below its
  memory directory. Identity create/update/template flows synchronize it while
  preserving user-authored content. Managed tasks copy a read-only, role-aware
  `AGENTS.md` into their task directory, explicitly instruct the runtime to read
  it, and journal its SHA-256/size in `TASK_CONTEXT.json`. They do not mutate
  repository instruction files after leasing, preserving tracked instructions
  and a clean worktree. Interactive/manual sessions retain normal memory
  injection plus the durable role contract.
- Before planning, every participant workspace is inspected and leased. Dirty
  git worktrees are rejected, duplicate or cross-run paths conflict, and all
  repo-backed participants must share one git common directory and base HEAD.
  Immediately after lease acquisition, ADE re-inspects repository identity,
  cleanliness, branch and HEAD before writing the run manifest or creating a
  task; any drift fails the run and releases its leases. This narrows but does
  not eliminate the TOCTOU window: external Git processes cannot be atomically
  excluded without an OS/Git lock and may still mutate a worktree after the
  stability check. Recovery fails interrupted managed work, rejects pending
  approvals and releases orphaned leases; the safe exception is an idle pending
  approval, which retains its leases and can be approved after restart.
- A successful worker reports the exact repository-relative paths it changed
  and must leave Git history untouched. ADE compares that set to tracked plus
  untracked Git changes, rejects omissions/additions/conflicts, stages with a
  NUL-delimited pathspec, disables repository hooks/signing, and creates the
  task commit itself. It then validates the clean worktree and complete linear
  range from the leased base before requesting durable integration approval.
  Approval triggers one cherry-pick sequencer transaction in the orchestrator
  worktree; any conflict aborts the full range. An integration-review task may
  add a similarly ADE-validated commit, followed by a read-only verification
  task.
- Concurrency and approval limits are always enforceable. Token/cost limits are
  accepted only for adapters advertising that telemetry, and missing values
  fail closed. Exact usage is enforced at task-completion boundaries because
  current CLI telemetry is final-turn data, not a live provider spend cap. ADE
  never derives USD from a guessed model price.

### Transport-neutral application boundary (Goal 7 target)

- A composition root owns `OrchestrationService`, `RunCoordinator`,
  `PtyManager` and the command/event facade. `ipc.ts` registers Electron
  handlers against that facade instead of constructing a second behavior path.
- Remote authorization is evaluated before a facade command. Domain invariants
  remain inside orchestration services, so an adapter cannot bypass leases,
  budgets, result validation or approval gates.
- `submitSingleTask` is a first-class bounded command rather than a sequence the
  mobile client assembles from `runTask:create` and `pty:create` calls.
- Every mutation accepts a caller identity, request id and idempotency key. The
  stored outcome is returned for an exact retry; key reuse with a different
  payload is rejected.
- Application events receive a monotonic cursor in addition to domain ids.
  Desktop IPC may continue publishing snapshots, while remote SSE resumes from
  a cursor and refreshes a mobile projection after retention gaps.

## Planned ADE host API and mobile PWA (Goals 7-10)

The host is disabled by default and listens on an ephemeral/configured
loopback port. Personal-alpha setup configures Tailscale Serve to terminate
HTTPS and proxy to that port. ADE validates the proxy host/origin and does not
fall back to a direct LAN bind. Funnel and public port forwarding are rejected
by product policy, not offered as convenience toggles.

Initial endpoints are allowlisted operations, not generic RPC:

- `GET /api/v1/health` - version, readiness and queue summary;
- `GET /api/v1/catalog` - sanitized repositories, agents and runtime readiness;
- `GET /api/v1/runs` - mobile-safe run projection;
- `POST /api/v1/tasks` - one bounded task with independent agent/repo ids;
- `POST /api/v1/runs` and `/runs/{id}/start|cancel` - managed-run control with
  one explicit repository scope; and
- `GET /api/v1/events` - resumable server-sent events.

Goal 9 adds approval resolution only after step-up authentication and evidence
review. Category/agent/config mutation, interactive PTY methods, filesystem
reads, arbitrary IPC and deletion stay absent. The API never returns absolute
paths, custom command text, environment values or credentials.

Pairing begins in the trusted desktop UI with a short-lived single-use QR
challenge. The device completes possession proof over HTTPS and receives its
own revocable identity. Sessions use cookies with `Secure`, `HttpOnly` and
`SameSite=Strict`, plus exact Origin checks and CSRF protection. Every endpoint
performs local authorization; mutations are rate-limited, size-bounded and
appended to an audit journal.
Approval also requires recent passkey/device reauthentication.

The PWA service worker caches versioned static application assets only. API
responses, run evidence, patches and credentials use `no-store`. Offline UI may
report last contact time but cannot enqueue commands for later automatic
execution. The host must be powered on, logged in and running; tray/start-at-
login operation is a Goal 10 user-session feature, not a pre-login service.

## Electron IPC contract (shared/ipc.ts) — stable, build agents code against it

This contract is an internal trusted-renderer adapter. It is not the planned
network protocol and must never be forwarded by channel name over HTTP.

Invoke (renderer → main, `ipcRenderer.invoke`):
- `config:get` → full config; `config:save({settings:{theme}})` → saved config
- `photo:import(bytesBase64, mime)` → stored filename
- `agent:create(input)` / `agent:delete(id)` / `category:create(input)` …
  (creates workspaceDir, memory scaffold, worktree if repo-backed)
- `pty:create({agentId, task?, dispatchId?, runTaskId?})` → SessionMeta (interactive when
  task is absent; bounded one-shot task otherwise; injects memory first)
- `pty:write({sessionId, dataBase64})`, `pty:resize({sessionId, cols, rows})`,
  `pty:kill({sessionId})`, `pty:attach({sessionId})` → replay + sequence
- `pty:list()` → live/exited retained sessions + task queue status
- `pty:cancelTasks({agentIds?, runTaskIds?})` → active/queued cancellation counts
- `runtime:diagnose({agentId?})` → CLI/version/auth/task-transport readiness
- `run:get`, `run:create`, `run:delete` → persisted orchestration snapshots/runs
- `run:start`, `run:cancel`, `runApproval:resolve` → managed state machine and
  its durable human integration gate
- `runTask:create`, `runTask:fail`, `runArtifact:create` → journal-backed entities
- `git:status({agentId})` → branch, ahead/behind, files [{path,+,-,state}]
- `git:diff({agentId, path})` → unified diff text
- `fs:tree({agentId})` → workspace file tree (depth-limited, lazy children)
- `fs:read({agentId, path})` → text (size-capped)

Events (main → renderer, `webContents.send`):
- `pty:data` `{sessionId, dataBase64, sequence}` (coalesced renderer-side)
- `pty:exit` `{sessionId, exitCode, reason}`
- `pty:removed` `{sessionId}`; `pty:taskQueue` `{active,queued,maxActive}`
- `orchestration:changed` → authoritative runs/participants/tasks/events,
  artifacts, results, approvals, workspace leases, messages and run usage
- `git:changed` `{agentId}` (debounced watcher, v1 optional: poll on focus)

Every invoke passes two checks before its handler runs:

1. The sender is the main frame of an ADE-owned BrowserWindow at the exact
   configured Vite URL (development) or packaged renderer file (production).
2. The payload has only the channel's allowed fields, runtime enum values and
   bounded strings/arrays/base64/dimensions. Compile-time TypeScript types are
   not treated as a security boundary.

## Terminal beta security and UX

- Renderer process sandboxing, context isolation and disabled Node integration
  and webviews are mandatory. The preload exposes only allowlisted `invoke`
  and `on` wrappers.
- CSP defaults to `none`, permits self-hosted scripts/styles/fonts plus the
  `ade-photo:` image scheme, and denies objects, frames, forms and base URLs.
- Main-frame navigation stays on the ADE renderer; only credential-free HTTP(S)
  links may be handed to the system browser. Web permissions default to deny.
- Diagnostics execute fixed version/auth probes for known runtimes. Custom
  command strings are neither executed nor echoed. Claude/Codex expose stable
  auth probes; Ollama checks its local service; other runtimes report unknown
  auth explicitly when no stable probe exists.
- Keyboard: Ctrl+Shift+T/W create/close, Ctrl+PageUp/PageDown cycle sessions,
  Alt+1..9 selects a session, Ctrl+1/2 changes top-level view. Tab lists also
  implement roving focus and arrow/Home/End navigation.
- Native notifications fire only while ADE is in the background, for task
  completion/failure and abnormal interactive exits. Cancellation and clean
  interactive exits remain quiet.
- The Graph resolves a failed selected run's newest persisted task error first,
  then its `run.failed` journal detail, and renders the result directly as an
  accessible alert. Legacy failures without either source show an explicit
  missing-detail message instead of a silent generic status.

The planned remote renderer has a separate trust boundary. It receives no
preload bridge and no Electron privileges. HTTPS, ADE device authentication,
per-endpoint authorization, exact Host/Origin/content validation, CSRF defense,
idempotency, revocation and audit are cumulative requirements; private-network
reachability alone is not authorization. Its restrictive CSP permits only the
same-origin host and standards-based Web Push endpoints when notifications are
explicitly enabled.

## CI and packaging

- `.github/workflows/ci.yml` runs typecheck, focused scripts and production
  build on Windows and Ubuntu. Windows additionally runs the real
  Electron/ConPTY workflow plus an unpacked package; Ubuntu builds Linux-native
  `node-pty` and runs the same Electron/Playwright workflow under Xvfb.
- `.github/workflows/package-windows.yml` repeats verification, creates the
  x64 NSIS installer and uploads it. `WIN_CSC_LINK` and
  `WIN_CSC_KEY_PASSWORD` opt into Authenticode signing; local artifacts are
  expected to be unsigned.
- `scripts/test-electron-workflow.ts` uses platform-specific shell commands,
  seeds only a temporary ADE profile and
  verifies sandbox/preload boundaries, IPC rejection, real terminal I/O,
  multi-tab shortcuts, renderer reload replay, non-zero failure/restart,
  diagnostics, worker-specific managed planning, approval, integration and
  verification. The same script can target `ADE_E2E_EXECUTABLE`.
- The 2026-07-19 Windows gate passed 393 focused assertions, the production
  build and all 46 Electron assertions. A native Ubuntu/WSL2 proof of the same
  source passed 392 focused assertions (the Windows `.cmd` probe is
  inapplicable), the production build and all 46 Electron assertions. This
  validates the source path; Linux packaging and a remotely observed hosted-CI
  result remain separate release gates.
- Goal 7 adds host contract tests for malformed/unauthorized/replayed requests,
  event reconnection and mobile projections. Goal 8 adds pairing, revocation,
  CSRF, mutation-audit and browser workflows through an isolated loopback
  proxy; CI must not require a real personal tailnet. Goal 9 adds step-up
  approval, evidence and notification tests. These join `pnpm verify` before
  their respective goal completes.

## Theming

- `theme/tokens.css`: all colors as custom properties on `:root[data-theme]`.
- Two themes v1: `dark` (mockup palette: bg #0E0F12, panel #15171C, raised
  #1B1E24, line #262A31, text #D7DBE1, muted #7C838E, accent copper #E09A4A,
  add #4EC98A, del #E0645C) and `light` (same hue family on paper ground —
  design it properly, not naive inversion).
- Each theme carries an **xterm ITheme** (bg/fg/cursor/selection + 16 ANSI
  colors). Theme switch calls `terminal.options.theme = …` on every live
  terminal — the terminal itself changes, not just chrome (SPEC #8).
- Background architected as a dedicated layer token (`--app-bg-layer`) so a
  gradient or user PNG-with-alpha can slot in later without refactor
  (SPEC #9 — architecture only, no UI now).

## Memory (main/memory/) — per docs/reports/hermes-memory.md

- Per agent: `<memoryDir>/MEMORY.md` + `USER.md`, entries joined `\n§\n`,
  caps 2,200/1,375 chars. `MemoryStore.ts` ports add/replace/remove/batch,
  dedup, drift guard (.bak + refuse destructive ops), atomic writes.
- On every `pty:create`, regenerate the managed block
  (`<!-- ADE:MEMORY:start/end -->`, rendered with the `═` headers + usage %)
  inside `CLAUDE.md` (claude) / `AGENTS.md` (codex & others) in the agent's
  workspaceDir, plus the WHEN/SKIP save-instructions and the rule that the
  agent edits the memory files directly (paths given in the block).
- v1 write path = direct file edits by the CLI agent + drift guard on load.
  v1.1 = MCP `memory` tool (schema text already in the report).
- Goal 5 labels existing `memoryDir` content as agent-global and reserves a
  binding-local overlay for repository context. Template seeds are copied on
  spawn; no two agents/templates/bindings share a writable memory directory.

## Photos

- Import via file picker (renderer) → bytes to main → stored under
  `userData/photos/<id>.<ext>`; PNG alpha preserved; renderer loads via
  custom `ade-photo://` protocol (registered in main) to avoid file:// CSP
  issues. Fallback avatar: initials on hue gradient (from mockup).

## UI rules distilled from feedback (see SPEC)

No emojis. No model picker. No Open/Run buttons. No status-bar path.
Sessions are terminal windows: tab strip has only tabs + `+`. Right panel:
repository-scope header plus Files / Changes toggle, collapsible, resizable.
Rail resizable. Onboarding modals per mockup, plus photo upload.

## Build phases & ownership (agents)

The phase list below is the historical 2026-07-07 build plan. Current work is
tracked in `ROADMAP.md`; factual capability status lives in `STATUS.md`.

- **A. Scaffold** (one agent): toolchain boots, window opens, tokens +
  theme provider, IPC skeleton with typed contract, config store, empty
  panes with resizable layout. `pnpm dev` verified on Windows.
- **B1. PTY/terminal** (agent, after A): PtyManager + TerminalPane +
  launch profiles + attach/replay + exit handling. Owns `src/main/pty`,
  `src/renderer/terminal`, `src/shared/runtimes.ts`.
- **B2. Rail/tabs/onboarding/photos** (agent, parallel to B1): owns
  `src/renderer/{rail,tabs,onboarding}`, `src/main/photos.ts`, stores.
- **C. Workspace/git** (agent): owns `src/main/git`, `src/renderer/rightpanel`.
- **D. Memory** (agent): owns `src/main/memory`.
- **E. Integration + verify** (agent + architect): real CLI smoke test
  (launch claude/codex in a session), theme switch incl. xterm, resize,
  onboarding round-trip.

Phase agents must not touch files owned by a parallel phase; shared files
(`shared/*`, `App.tsx`, `ipc.ts`) change only via the contract above.
