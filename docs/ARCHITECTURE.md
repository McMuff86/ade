# ADE — Architecture (binding decisions)

## Interactive assistant access and Overview

`RemoteTerminalDisplay` maintains a headless screen for each interactive PTY.
`RemoteTerminalService` returns a redacted `MobileTerminalFrame` through the
existing device-authorized application service. Raw terminal control sequences
are never forwarded. `mobileDashboard` projects fixed credential-free private
HTTPS links only; dashboard commands remain desktop-only. Catalog changes refresh
Overview; historical records retain identities and detached-context markers.
Successful catalog-mutating IPC handlers emit the existing `catalog:changed`
event through `rendererWindows`. The event contains only a revision; consumers
re-read their authorized projection. Failed mutations emit no success event.
Mobile shell responses inject a fresh style-only CSP nonce. xterm's scoped
document override nonces its generated style elements; script policy stays
`script-src 'self'`, with no unsafe-inline/eval exception.
Transport bounds, keyboard acknowledgement and launch semantics are specified in
`ASSISTANT_ACCESS.md`; measurements are in `ASSISTANT_ACCESS_RESULTS.md`.

## Runtime model catalogs

`harness:models` is a desktop-only audited launch channel with strict runtime/
backend inputs. `RuntimeModelService` runs bounded CLI metadata probes in that
backend's user home and returns validated model IDs and redacted display fields.
Codex uses its app-server model catalog, Grok its models command, Claude its
authenticated initialization catalog and Ollama its installed-model list. No
prompt or model inference is submitted. Stored credentials remain in the main
process/child environment; WSL uses `WSLENV`. The remote allowlist is unchanged.
`claudeModel` now accompanies profile/template/bundle model pins and every Claude
launch path. Full bounds and version-sensitive contracts: `RUNTIME_MODEL_SELECTION.md`.

## Tablet project start and continuation

`TABLET_PROJECT_START.md` defines the new project-start contract. Desktop-only
`projectDefaults:get` / `projectDefaults:save` store a canonical native parent,
its filesystem identity and an optional native Codex profile. Mobile sees only
setup availability and the agent id. Existing project administration creates
named child repositories under a configured parent, refusing links, replaced
roots and collisions. The wizard composes existing independently signed/audited,
idempotent provisioning and terminal commands with durable per-stage retry keys.

The read-only `GET /api/v1/terminal/sessions` adapter calls only
`AdeApplicationService.remoteSessionInventory`. It requires device-signature
proof plus `terminal:control`; the service validates each immutable session scope
and emits at most 32 opaque summaries without raw PTY ids, host paths, output or
lease secrets. This does not add any desktop IPC channel to the remote command
allowlist. Managed tasks and credential-login sessions remain excluded.

The tablet workspace uses a focus-managed full-screen dialog and Chrome visual
viewport measurements. Device-scoped browser records retain drafts, navigation
and pending command keys across reload. Output, files and profile drafts are not
persisted by this store. Disconnect or observed device revocation clears records;
storage failure blocks new command submission. A durable uncertain-input marker
blocks resending after reload until output has been explicitly checked.

## Projectless workspaces and session launch (Goals 20–21)

`MobileWorkspaceSelection.repositoryId` is a required string or explicit `null`.
Null selects the configured agent home (`homeWorkspaceDir`, `homeExecutionBackend`),
independently of the default repository; missing/empty ids do not select a scope.
No synthetic Git binding is persisted. Home overview/tree/file/search reads never
create a directory or invoke Git. Only an explicit terminal open may prepare the
configured home. Git diff requires a catalog project; remote repository tools
retain their native-only boundary. Desktop scope descriptions also preserve an
explicit plain-home session when its agent has a default project.

Home scope versions include directory device/inode identity plus agent, backend
and path. Replaced roots and changed configuration invalidate old file drafts
and remote terminal handles. Session and lease matching checks backend and actual
directory; absent binding ids must never equate unrelated homes. Native reads
retain verified-path discipline (not descriptor-anchored ancestor race protection).
Windows→WSL homes use a fixed Python 3 helper via argv and JSON stdin: no-follow
descriptor traversal from `/`, regular single-link files, bounded actual reads,
bounded tree/search and revision-checked same-directory atomic replacement.
Writes share the workspace operation gate, refuse running sessions/managed leases,
and preserve the existing grant, conflict, redaction and UTF-8/BOM/newline contracts.
The WSL helper has no memory-file fallback and accepts no user program text.

`SessionLaunchChoice` and `SessionLaunchOptions` live in `shared/remote.ts` and are
shared by desktop and tablet. The fixed choices are shell, saved agent profile,
fresh Codex, fresh Hermes and Ollama with a validated model id. Main owns the
launch command. Fresh choices use default permissions and clear foreign command,
model and reasoning settings; the saved-profile choice retains all configured
settings, including wrappers. Saved agent records are unchanged. Effective runtime
controls credential injection and bookend telemetry. Shell starts do not inject
agent memory files. `SessionMeta.launchChoice` preserves the choice across renderer
reload and session restart; an app restart still ends its PTYs.

Desktop-only `session:options` and `session:launch` are exact-validated, audited
`launch` channels.
The desktop launch request may retain an existing `workspaceBindingId` from a
session being restarted, validated against its agent and repository. The remote
request never accepts a caller-owned binding. Remote options use the existing
signed terminal query with `options: true`; they require `terminal:control` and
are reauthorized after probing.
Remote open extends the existing durable command union with fixed modes and an
Ollama-only `model`; current device grants, CSRF, idempotency and audit remain
mandatory. `REMOTE_COMMAND_CHANNELS` is unchanged. Options use bounded fixed CLI
probes (4 seconds; at most 200 models). Windows probes PATH; POSIX/WSL probes use
constant commands in the login shell used for launch. Raw probe output/paths are
not exposed. Availability is installation/model discovery, not an authentication
or model-health promise. Main rechecks the chosen CLI/model before spawning;
the launcher never requests an install or pull. Existing Ollama configuration may
point at a different daemon. A model removed concurrently after that check is
subject to the external CLI's behavior.

The desktop `+` and Ctrl+Shift+T open a focus-trapped scope/launch dialog; shared
fields appear in the tablet terminal. Missing CLI/model, loading, failure and
retry states are explicit. Git and managed task submission require a project;
home files and interactive sessions do not. Validation and platform boundaries:
`SESSION_WORKSPACE_RESULTS.md`; usage: `REMOTE_TERMINAL_GUIDE.md`.

## Remote workspace tools (Goals 16–19)

`POST /api/v1/workspace/query` is a dedicated AdeApplicationService method,
not mirrored desktop IPC. The desktop-granted `workspace:read` capability,
device signature and browser session/CSRF are required. Existing devices do
not gain access to source files automatically. Query operations select an
agent/catalog repository and strictly relative path; read-only discovery never
creates a binding. RemoteWorkbenchService rechecks native root/common-Git
identity and link discipline around bounded reads. Metadata, common credential
files and hardlinks are excluded. Wire text passes through redactForWire;
redacted, binary, unsupported-encoding and oversized previews are not editable.
The mobile workspace opens independently of a terminal and separates index
diffs from working-file changes. Executable evidence for all four goals is in
REMOTE_WORKBENCH_RESULTS.md.

`POST /api/v1/workspace/save` additionally requires `workspace:write`, a durable
idempotency receipt, the opaque binding version and the original content hash.
RemoteWorkbenchService uses the shared WorkspaceOperationGate for atomic
same-directory replacement, rechecks revision/authorization/link discipline
before replacement and refuses active leases or live workspace sessions.
Only existing UTF-8 text files up to 24 KiB are editable; BOM and uniform
LF/CRLF are preserved. Conflicts return a revision without overwriting. This
uses native verified paths, not descriptor-anchored ancestor race protection.
Browser drafts and pending save keys survive dialog/project changes in bounded
memory, are cleared on identity changes and are not restored after page reload.

The dedicated `/api/v1/terminal/{query,command,input}` application methods
require `terminal:control`, a current desktop-granted device identity, signed
requests and browser session/CSRF. Commands use the durable ledger; input uses
a required key plus monotonically ordered sequence within an ephemeral live
lease. It reserves an input receipt synchronously before PTY write and marks
it accepted only after that write returns; duplicate and concurrent requests
cannot type twice. A failed write fences subsequent input until a new lease;
the client checks acceptance without automatically replaying uncertain input.
Old leases are invalid after host
restart, desktop reclaim, scope withdrawal or 30 seconds without a heartbeat.
No input text is logged or persisted in receipts. Only one device owns input;
desktop `terminal:reclaim` is audited and `terminal:control` is read-only. Both
remain desktop IPC. `pty:write` and resize respect ownership; control events use
rendererWindows. Browser clients receive opaque terminal handles, never PTY ids.
Managed task and credential-login sessions are excluded. The configured agent
or shell runs under the host user's authority, not a workspace sandbox.

Terminal bytes stay in main: `@xterm/headless` interprets the bounded replay,
joins wrapped lines and sends only text through redactForWire. The mobile
interface offers text submission and explicit control keys with a polling
snapshot. It does not claim raw ANSI, mouse, colors or unrestricted transcript
fidelity. See REMOTE_TERMINAL_GUIDE.md for activation and reconnect behavior.

`POST /api/v1/profile/query` requires an active signed device with `read`;
`POST /api/v1/profile/update` additionally requires `profiles:write`, a durable
idempotency key and the original profile revision. Only agent name, role and
photo are accepted. Browser image selection is normalized to PNG, at most
256×256 and 32 KiB. Main validates PNG structure, CRCs, bounded inflation and
dimensions before Electron decoding, then normalizes again to remove metadata.
Photo filenames stay in main; queries return bounded PNG bytes. Local stored
images use the same link discipline. Updates refuse identities with active
managed leases and synchronize the durable ADE role block in AGENTS.md while
preserving operator content; linked, hardlinked or oversized instruction files
are refused. Profile updates notify registered desktop
windows through `catalog:changed`; no runtime, permission or general config
fields are exposed. The mobile CSP permits blob images for authenticated
avatars, while script and navigation rules remain unchanged.

All new scopes are granted only in desktop Settings per device; pairing and
existing identities gain none automatically. New wire contracts live in
`shared/remote.ts` and use AdeApplicationService, signatures, browser CSRF,
current device authorization and audit. `REMOTE_COMMAND_CHANNELS` remains
limited to the four existing run/task commands. New runtime evidence is native
Windows only, with disposable Git/Electron fixtures and a configured test
command; it does not certify a model, WSL backend or physical tablet.

Status: v8, updated 2026-08-19 with the read-only Overview home
(`src/main/overview`, `src/renderer/overview`), implemented repository
scopes/reusable agents (`docs/REPOSITORY_SCOPES_PLAN.md`), the read-only
repository inspector (`docs/REPOSITORY_INSPECTOR_PLAN.md`), verified Draft-PR
publishing (`docs/VERIFIED_PUBLISHING_PLAN.md`) and planned remote
control/mobile companion (`docs/REMOTE_CONTROL_PLAN.md`). Terminal,
orchestration, repository-scope and publication implementation details
supersede v5 (`docs/reports/superset.md`, `docs/reports/hermes-memory.md`).
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

## Decision: execution backend is part of repository identity

Platform selection is explicit data, never path inference. Every repository and
workspace binding stores `native` or a validated `wsl:<distribution>` id; new
session/task/run scope snapshots copy that value immutably. Migration assigns
legacy records to `native` and makes a binding inherit its repository backend.

`main/execution/ExecutionBackendService.ts` is the sole process/path boundary.
Native calls retain the existing services. On a Windows host, WSL calls use
argv-only `wsl.exe --distribution <name> [--cd <linux-path>] --exec ...`, with
bounded output/time and no prompt, repository path or distribution interpolated
into a shell string. Backend environment fields (TERM, translated `ADE_*`
paths, stored harness/service keys) never enter that argv: `wslHostEnvironment`
places them in the Windows environment of the `wsl.exe` client and lists them
in `WSLENV` as `NAME/u`, so a credential is visible neither on the long-lived
relay's command line nor in ADE's argv log. Fields may not override `WSLENV`
itself, collide by case, or contain NUL; inherited `WSLENV` entries survive
unless ADE owns the name. `wslpath` is used only for Windows-owned control
files or an OS integration boundary. Linux identity remains case-sensitive.

Backend Git, workspace and filesystem facades guarantee that one binding uses
one platform's Git and filesystem for its entire lifetime. The WSL filesystem
helper receives JSON over stdin, enforces containment/no-symlink traversal and
uses `renameat2(RENAME_NOREPLACE)` for atomic no-clobber rename. A missing
distribution fails closed instead of falling back to Windows execution.

## Decision: mobile is a control adapter, not an execution plane

The desktop remains authoritative for agents, runtime credentials, PTYs, files,
Git worktrees, integration and persisted run state. The planned mobile PWA
submits a deliberately small set of commands and observes authoritative events;
it never executes an agent locally and is not a streamed Electron renderer.

Electron IPC and remote HTTP now share the first transport-neutral ADE
application boundary for sanitized run summaries. The bounded Goal-7 foundation
also projects health and a path-free repository/agent catalog for HTTP. The
remote host must not expose arbitrary IPC names,
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
- Linux distribution: electron-builder unpacked x64, AppImage and Debian
  targets from a Linux-native dependency install. `node-pty` is compiled with
  Python 3, make and g++.
- Git: `simple-git`. Config persistence: hand-rolled atomic JSON store in
  `app.getPath('userData')`.
- Icons: text glyphs or lucide-react sparingly. No emojis anywhere (SPEC).
- Remote transport foundation: a disabled-by-default Node HTTP server fixed to
  `127.0.0.1`, with exact Bearer authorization and read-only versioned JSON for
  health, catalog and runs. Mutating commands, server-sent events, device
  pairing and the separate React/Vite PWA are implemented in Goal 8; measured
  deployment coverage is recorded in `goal8/MOBILE_CONNECT_RESULTS.md`.
  WebSocket is deferred because Goals 7-10 have no bidirectional terminal stream.

## Repo layout (this repo, root = the app)

```
package.json               # the app; one-command: pnpm i && pnpm dev
electron.vite.config.ts
src/
  main/                    # Electron main
    index.ts               # window, app lifecycle (small; no updater/cloud)
    ipc.ts                 # channel registration
    ipcValidation.ts       # exact runtime request validation for every invoke
    overview/              # path-free catalog/run/PTY projection for Overview
    security.ts            # renderer/navigation URL allowlists
    diagnostics/           # read-only CLI/version/auth checks
    notifications.ts       # background native exit/completion notifications
    platform.ts            # host path identity, null device, deterministic shell
    execution/             # native/WSL command, Git, workspace and filesystem boundary
    pty/PtyManager.ts      # node-pty sessions, ring buffers, launch profiles
    git/                   # status/diff/worktree (simple-git)
    config/store.ts        # atomic catalog/run/settings JSON + migration
    application/           # transport-neutral mobile-safe ADE boundary
    remote/                # loopback-only authenticated host API adapter
    orchestration/         # run/task/event service and legacy Graph migration
    publishing/            # verified branch + GitHub Draft-PR boundary
    repositories/          # catalog, bindings, scope resolution + read inspector
    memory/                # MemoryStore.ts port + managed-block injection
    photos.ts              # profile photo import/store (PNG/JPG, alpha kept)
  preload/index.ts         # contextBridge: typed invoke/on wrappers only
  renderer/
    App.tsx                # layout shell (Overview | rail+tabs+terminal | Graph; inspector side optional)
    theme/                 # tokens.css, themes.ts (incl. xterm ITheme), provider
    rail/                  # categories + agents, avatars, presence
    tabs/                  # session tab strip
    terminal/              # TerminalPane (xterm runtime, coalescer, attach)
    diagnostics/           # CLI/auth readiness modal
    keyboard/              # view/session shortcut routing
    overview/              # read-only home over catalog, bindings and runs
    rightpanel/            # catalog Overview + binding-aware Changes/Files
    onboarding/            # first-run + new category/agent modals
    graph/                 # run-scoped control-plane canvas and dispatch
    stores/                # Zustand catalog, session, run, and UI mirrors
  shared/
    types.ts               # catalog, session, run/task/event, runtime contracts
    remote.ts              # mobile-safe health/catalog/run DTOs
    ipc.ts                 # IPC channel names + payload types (contract)
    runtimes.ts            # launch profiles incl. permission-mode flags
docs/                      # SPEC, this file, reports/
mock/  mockup/             # references (kept)
reference/                 # cloned Superset/Hermes — git-ignored
```

Remaining planned additions for Goals 7-10 (names may be refined without
changing the boundaries):

```
src/
  main/
    application/           # add authorized commands/events shared by adapters
    remote/                # add pairing, sessions, audit and SSE
  mobile/                  # responsive PWA; no Electron or Node assumptions
```

## Current core types through the platform backend slice (shared/types.ts)

```ts
type PermissionMode = 'default' | 'accept-edits' | 'bypass';
type RuntimeId = 'claude' | 'codex' | 'opencode' | 'grok' | 'gemini'
               | 'ollama' | 'shell' | 'custom';
type ExecutionBackendId = 'native' | `wsl:${string}`;

interface Repository { id: string; name: string; rootPath: string;
                       commonGitDir: string;
                       executionBackend: ExecutionBackendId;
                       verified: boolean }
interface WorkspaceBinding { id: string; agentId: string; repositoryId: string;
                             workspaceDir: string; branch: string;
                             executionBackend: ExecutionBackendId;
                             status: 'ready' | 'legacy-unverified' | 'invalid' }
interface Category { id: string; name: string; photo?: string;
                     repoPath?: string;                          // compatibility
                     defaultRepositoryId?: string; agents: string[] }
interface Agent    { id: string; categoryId: string; name: string; role?: string;
                     photo?: string; runtime: RuntimeId;
                     permissionMode: PermissionMode;
                     codexModel?: string; codexReasoningEffort?: CodexReasoningEffort;
                     grokModel?: string; grokReasoningEffort?: GrokReasoningEffort;
                     defaultRepositoryId?: string;
                     workspaceDir: string;                       // compatibility alias
                     homeWorkspaceDir?: string;
                     memoryDir: string }
interface SessionMeta { id: string; agentId: string; title: string;
                        kind: 'interactive' | 'task';
                        status: 'running' | 'exited'; createdAt: number;
                        repositoryId?: string; workspaceBindingId?: string;
                        workspaceDir?: string;
                        executionBackend?: ExecutionBackendId;
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
                    workspaceDir?: string; preparedBaseSha?: string }
interface AgentTemplate { id: string; name: string; runtime: RuntimeId;
                          permissionMode: PermissionMode;
                          codexModel?: string;
                          codexReasoningEffort?: CodexReasoningEffort;
                          memorySeed: { memory: string; user: string } }
interface RunEvent { id: string; runId: string; type: RunEventType;
                     taskId?: string; participantId?: string; createdAt: number }
```

Goal 5 migration moves active repository ownership out of `Category.repoPath`
and `Agent.workspaceDir` while retaining both compatibility fields. The
platform migration also persists a backend on repositories/bindings. Repository,
binding and template records persist in the atomic config; sessions, tasks,
runs and leases retain resolved ids/paths/backend so later default changes or
migration cannot rewrite an execution's meaning.

The remote contract will not serialize these storage/domain objects directly.
It uses versioned, mobile-safe projections plus target records such as
`RemoteDevice`, `RemoteSession`, `RemoteAuditEvent` and
`RemoteIdempotencyEntry`. Device/session secrets are stored separately from the
catalog snapshot and are never returned after issuance.

## Config store durability (main/config/store.ts)

`userData/ade/config.json` is the single atomic store for the catalog, the
repository bindings, the run journal, structured results, approvals, leases,
the command log and the publication audit. It is therefore also the only
record whose loss is unrecoverable, so load and write are separate contracts.

Writes are atomic **and durable**: temp file in the same directory →
`fsyncSync` → `renameSync`. Without the fsync a hard power loss can publish a
renamed but truncated file, which the next launch would classify as malformed.

Loading never destroys an existing file:

| Situation | Behavior |
|---|---|
| File missing (`ENOENT`) | First run: seed `DEFAULT_CONFIG` and write it |
| File unreadable | Preserve, then seed — `reason: 'unreadable'` |
| Invalid JSON | Preserve, then seed — `reason: 'malformed'` |
| `normalizeConfig` throws | Preserve, then seed — `reason: 'incompatible'` |
| Preservation itself fails | Keep the original untouched; store turns read-only |

Preservation moves the file to `userData/ade/corrupt/config-<ISO>.json` and
never overwrites an earlier quarantine. Only after that succeeds may defaults
reach disk. When the move fails, `ConfigStore.readOnly` is true and every
`save()` throws before mutating the in-memory snapshot, so a caller that
ignores the error cannot observe a divergent catalog either.

The failure is a first-class product state, not just a log line: `config:health`
returns a `ConfigLoadFailure` whose `detail` has the config path replaced by
placeholders and whose `quarantinedTo` is config-directory-relative. The
renderer shows it as a banner above the shell — blocking and non-dismissible in
the read-only case — because an empty catalog is otherwise indistinguishable
from a fresh install. Focused coverage: `scripts/test-config-store.ts`;
user-visible coverage: the truncated-config restart at the end of the Electron
workflow.

## Launch profiles (shared/runtimes.ts)

Command per runtime × permission mode (adapted from Superset's
builtin-terminal-agents; every profile user-overridable via `customCommand`):

| runtime | default | accept-edits | bypass |
|---|---|---|---|
| claude | `claude` | `claude --permission-mode acceptEdits` | `claude --dangerously-skip-permissions` |
| codex | `codex` | `codex --sandbox workspace-write --ask-for-approval on-request` | `codex --dangerously-bypass-approvals-and-sandbox` |
| opencode | `opencode` | — | — |
| grok | `grok` | `grok --permission-mode acceptEdits` | `grok --always-approve` |
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
records both values. Native Grok Build identities persist the same kind of pin
(`grok-4.6` / `high` by default, `xhigh` for orchestrators). Interactive launch
commands append `--model <id> --reasoning-effort <effort>` and translate ADE
permission modes onto `--permission-mode acceptEdits` or `--always-approve`.
Grok auth diagnostics treat `grok login` (via `grok models`) and a stored
`XAI_API_KEY` as first-class; Settings can open `grok login`. Managed Grok
tasks use the native `grok-json-v1` adapter: `--prompt-file` (never stdin),
`--output-format streaming-json`, the identity's permission/model/reasoning
pins, and `--no-auto-update`. ADE never passes `--worktree`. The CLI's
`--json-schema` flag accepts only inline JSON, which ADE will not interpolate
into a shell; the structured result is taken from streamed `text` / `end`
events (the older single JSON envelope remains readable) and usage/cost
overlay the model-authored fields, fail-closed when absent or partial. The
stream also drives the Graph activity feed (`grok-streaming-json`). Custom
commands deliberately opt out of the native adapter and its reproducibility
guarantees. Model ids accept only a conservative CLI-safe character set.

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
- WSL task sessions translate only the five managed control-plane path fields,
  write the prompt to a bounded Windows scratch file and let the Linux shell
  read that file through its translated `/mnt/...` path. Interactive and task
  PTYs execute with `wsl.exe --exec` in the immutable Linux worktree cwd;
  prompt scratch is removed on exit, launch failure or cancellation.
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
- Repository identity includes its execution backend. Native paths use the
  existing host services; WSL repositories persist canonical absolute Linux
  paths and all Git/worktree/file operations run in the selected distribution.
  WSL worktrees live in a sibling `.ade-worktrees` root rather than reusing a
  Windows worktree-base setting.
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

## Overview home projection

- `overview:get` is a void invoke. Main projects `AdeConfig` plus
  `PtyManager.list()` into a path-free `OverviewSnapshot`. The renderer never
  receives host paths, prompts, mailbox bodies or inspector Git data.
- Live sessions count `status === 'running'` PTYs only. Open runs are
  `status === 'running'` or `phase === 'approval'`. Token and cost rollups
  increment `tasksWith*` / `tasksWithout*` separately; a null token field does
  not become zero in the hero number (`tokens` stays `null` until at least one
  task reported input or output).
- Agent order follows category membership, then leftover identities. Agent
  and project `lastActivityAt` are the max of binding `lastUsedAt`, run
  `updatedAt` and interactive session bookends.
- Work is the 20 newest closed interactive bookends plus runs. Open bookends
  and live PTYs are not listed there. Session rows carry `kind: 'session'`
  and an empty usage rollup.
- Interactive spawn/exit writes `AdeConfig.sessionBookends` (FIFO 100,
  path-free). Task PTYs do not. On PtyManager construct, open bookends whose
  session is gone close as `interrupted`.
- The view is event-driven (`orchestration:changed`, `pty:exit`,
  `pty:removed`). It does not poll `repository:overview`. Clicks set existing
  selection/run/session stores and switch to Terminals or Graph.

## Repository inspector read boundary

- The scope selector and the active session are intentionally different
  identities. `Overview` resolves the selected catalog repository;
  `Changes`/`Files` continue to resolve the immutable active session binding.
  Only a user-initiated selection moves the tab to Overview.
- `RepositoryInspectorService` accepts an exact catalog id, reloads the record
  and re-proves root/common-Git identity before every read. Renderer paths,
  remotes, refs and commands are never accepted.
- Local overview uses bounded argv-only Git calls for branch, upstream,
  ahead/behind, dirty counts and at most 12 commits. It never fetches. A commit
  detail additionally requires a full lowercase SHA that resolves as a commit;
  diff bytes and file counts are capped before reaching the renderer.
- Optional PR discovery parses one unambiguous GitHub origin and invokes `gh pr
  list` with an explicit `github.com/owner/repo`, timeout and output ceiling in
  the repository's persisted native/WSL backend. Provider failure is returned
  as a separate redacted state, so local history stays available.
- Main and renderer independently constrain PR URLs to the same HTTPS GitHub
  repository and numeric PR. The inspector's read endpoints expose no Git or
  PR mutations. Its **Git-Abgleich** action opens the separate explicit workflow
  below; ordinary refresh still never fetches.
- The three views are semantic roving tabs. One shared resizable detail pane
  stays mounted with the list, preserving scroll/data state; Escape closes a
  commit patch and restores focus to its trigger.

## Explicit repository Git updates

`RepositorySyncService` owns `repository:syncOverview`, `repository:fetch`,
`repository:syncPreview` and `repository:syncApply`. All four are desktop-only;
fetch/apply are audited mutations, overview/preview are reads. Strict DTOs in
`shared/gitSync.ts` contain ids, refs, SHAs and counts, never host paths or commands.
The complete contract is `REPOSITORY_SYNC_PLAN.md`.

The service compares main and existing agent worktrees with an enumerated local
or origin branch. Explicit fetch refreshes only remote-tracking branches and
records session-local freshness. A bounded, expiring, single-use preview pins
one target's from/to SHA; apply revalidates identity, branch, cleanliness, Git
operation markers, live PTYs and active leases before an exact-SHA fast-forward.
It never stashes, resets, creates merge commits, pushes or overwrites ignored files.
Failed target reads are unknown/blocked, not zero/clean.

`WorkspaceOperationGate` excludes these mutations from ADE's asynchronous scope
resolution/removal, PTY/login creation and managed-run start. Launch refusal
still reaches the task lifecycle sink. This is an in-process gate, not a lock
against external Git commands. Git's own locking and fast-forward guards apply.
New worktree creation and managed-run basis selection retain their existing
main-HEAD/orchestrator-HEAD contracts. No host API allowlist is widened.

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
- The renderer receives the authoritative **view** through
  `orchestration:changed`; Graph transient state is limited to layout, selection,
  and pause controls. Real task status replaces the old completion timer.

### Renderer view, run report and history retention (Thema 3 / Thema 5)

- **Two projections of one journal.** `OrchestrationService.snapshot()` is the
  full-fidelity internal state for main (coordinator, publication, host API).
  `view()` (`OrchestrationView` in `src/shared/types.ts`) is what renderers
  get from `run:get` and `orchestration:changed`: identical runs, participants,
  events, results, approvals, leases, publications and usage, but tasks carry
  `promptDigest`/`promptChars` plus their parsed `provenance` instead of the
  prompt, artifacts carry `contentChars` instead of `content`, and mailbox
  messages carry `textChars` instead of `text`. Prompts, artifact bodies and
  message texts never reach a renderer window. `onChange` carries no payload;
  `ipc.ts` coalesces broadcasts to one `view()` per event-loop tick, so a save
  burst costs one projection, not one per save.
- **`run:report({runId})`** returns a `RunReport`: per task the complete
  `filesChanged`, every test with status and bounded output (16 KiB each,
  redacted), risks, commit SHA, participant name/role, timing and error; per
  run the failure (terminal detail plus the failed test commands of this run),
  integration range (`commitCount`, `fromSha`, `toSha`), verification
  attestation, approvals and publication. Text is bounded, not teased (4 KiB
  summaries/errors). Desktop-only `read` channel until the host adapter routes
  it through `redactForWire`.
- **`integration.applied`** journals `{commitCount, fromSha, toSha}`: the
  coordinator inspects the integrator worktree HEAD before and after
  `integrateCommits`, so a post-integration failure leaves a pointer to the
  composed, unverified state. Both SHAs are validated as Git object ids.
- **Approval notice.** `beginApprovalPhase` triggers a native notification
  (`runApprovalNotice`: run name, worker-task and validated-commit counts, no
  prompt or path) so the human gate that holds exclusive leases is visible
  outside the Graph. It follows the same foreground suppression as
  session-exit notices.
- **History retention (`applyRetention`).** Terminal runs beyond the newest
  `HISTORY_RETENTION.keepTerminalRuns` (40) that are also older than
  `keepTerminalDays` (30) are archived and pruned; if the serialized config
  would still exceed `maxConfigBytes` (4 MiB), the oldest remaining terminal
  runs go too. Never touched: open runs, runs with a publication audit, runs
  holding an active lease. Each `RunArchive` (`ade-run-archive` v1: run,
  participants, tasks, events, artifacts, results, approvals, leases,
  messages) is written by `RunArchiveStore` to
  `userData/ade/archive/runs/<runId>.json` (UUID-checked name, atomic
  temp+rename) **before** the single save that removes the records; without an
  archive port retention refuses to prune. `AdeConfig.journalRetention =
  {prunedSeq, archivedRuns, lastPrunedAt}` records the floor: `nextSeq()` and
  `journalCursor()` never fall below `prunedSeq`, so SSE and `run:events`
  cursors stay monotonic across pruning and `deleteRun`. Retention runs at
  startup and hourly (`ipc.ts`); the config itself is now serialized compact
  (`JSON.stringify(config)`), roughly halving the bytes stringified, hashed,
  written and fsynced on every save.
- **Main log.** `MainLogSink` (`src/main/logging/mainLog.ts`) tees
  `console.log/info/warn/error` into `userData/ade/logs/main.log` (2 MiB per
  file, 5 files, 8 KiB per line), one timestamped, levelled line per call,
  every line through the credential redactor with secret-named object fields
  replaced by `[credential]`. A sink that cannot write disables itself once
  instead of throwing into the caller. Installed first thing in `index.ts`.
- **Graph readability and keyboard path.** The run selector groups open and
  finished runs with their status; selecting a finished run older than the two
  newest pins it onto the canvas (`buildClusters(..., pinnedRunId)`) instead of
  leaving an empty canvas. The failure alert lists the failed test commands
  and opens the report. Cards, cluster bars and team bars are `role="button"`
  with `tabIndex`, `aria-pressed`/`aria-label`, Enter/Space to select, Enter
  on a selected card to activate, Escape to clear the selection or close the
  report; `.gteam-actions` also appears on `:focus-within`. The inspector
  renders `ResultDetails` (full summary, files, tests with expandable output,
  risks, SHA) instead of a 220-character teaser. `RunReportPanel` is a
  `role="dialog"` that takes focus on open, closes on Escape and returns focus
  to its opener or, when the opener unmounted, to the toolbar report button.

### Managed-run coordinator

- `RunCoordinator` owns the state machine: planning → working → approval →
  integrating → verifying → terminal. Only the coordinator creates managed
  tasks; direct Graph dispatch remains available for manual runs.
- A planner may assign each non-orchestrator participant at most once. ADE
  validates participant ids and an acyclic dependency graph, then starts only
  the worker tasks whose dependencies are complete and whose run concurrency
  slot is available. The global four-PTY queue remains an independent ceiling.
- A dependency transfers Git state, not just result/context data. All
  repo-backed leases share one Git common directory and base HEAD, so upstream
  ADE-authored commits are already reachable objects in every linked worktree
  and preparation only moves refs. Before a dependent work task launches, ADE
  prepares its leased worktree from the run base: the first contributing
  dependency is adopted verbatim (`reset --hard`, identical SHAs) and every
  further dependency replays only its owned delta in work-task creation order
  (the plan's assignment order), skipping already-reachable commits so diamond
  graphs never duplicate work. The resulting HEAD is persisted on the task as
  `preparedBaseSha` and journaled as a `workspace.prepared` event. A
  dependency without a commit contributes information only. Conflicting
  dependency deltas abort the replay, restore the run base and fail the run
  closed with the Git reason journaled before the dependent ever launches —
  ADE never merge-guesses a base.
- Repeatable run loop over the same worktrees. Integration cherry-picks worker
  deltas onto the orchestrator worktree's HEAD, so after a completed run the
  orchestrator carries the result while every worker worktree still sits on its
  own validated tip. `start()` therefore treats the orchestrator HEAD as the
  run base. Without an opt-in a divergent repo-backed worktree fails the start
  closed before any lease or task exists, and the error names each divergent
  worktree with its short SHA. With `Run.workspacePrepare = 'reset-to-base'` —
  set only from an explicit confirmation in the "Neuer Run" dialog and
  persisted on the run — the coordinator first pins each divergent tip under
  `refs/ade/archive/<runId>/<participantId>` (`update-ref` with a zero
  old-value, so an existing archive slot is never overwritten), then
  `reset --hard`s the clean, branch-attached worktree onto the base and
  journals one `workspace.rebased` event (`fromSha`, `toSha`, `archiveRef`).
  `WorkspacePort.resetToBase` refuses non-repo, dirty or detached worktrees and
  bases that share no history with the current HEAD; the coordinator refuses
  worktrees still leased by another active run. The reset runs after the clean
  check and before lease acquisition; leases and the manifest then record the
  aligned base. The orchestrator worktree is never reset by this path.
- A managed task result that arrives after its run already ended (a sibling
  failed, or the operator cancelled, while this process was still exiting) is
  recorded as `cancelled` with that reason. It never creates an ADE commit in
  a worktree the run no longer owns and never advances the phase machine; it
  only drains the run so `releaseIfDrained` can release every lease.
- `RunBudget.maxTaskMinutes` is the run's wall-clock limit per managed task
  (`null` = none; 1–1440). The coordinator arms one timer per running managed
  task and disarms it on any finish/launch-failure path. When the limit passes
  it journals `budget.exhausted` (`kind: 'task minutes'`) and fails the run
  closed with the task title and limit in the reason, which cancels the task
  through the normal PTY cancellation path. A hanging CLI therefore cannot hold
  one of the four global slots past the budget. The timer seam is injectable
  (`TaskTimerPort`) so the contract is tested without waiting.
- Patch ownership follows from inheritance: a work task's owned delta is
  `preparedBaseSha..tip` (run base when no preparation happened). A dependent
  worker may modify files its dependencies changed — those are ordinary
  descendant edits, which removes the Goal 6 F3/F4 re-author/union failure
  mode — while parallel siblings keep the transactional cherry-pick contract
  for overlapping paths. Validation and integration operate exclusively on
  owned deltas, so an inherited upstream range is never counted against the
  50/200 commit caps twice and never integrated twice.
- Every managed task must produce `StructuredTaskResult` version 1. The schema
  includes outcome, summary, worker assignments, changed files, real test
  command/status/output entries, commit SHA, risks and nullable usage. For
  repo-backed work, the runtime returns `commitSha=null`; ADE fills the SHA only
  after validating and committing the exact reported diff. Process exit 0
  without a valid result is a task failure.
- `runtimeAdapters.ts` is the adapter boundary. The native Codex adapter uses
  `codex exec --json --output-schema --output-last-message` and reads token
  usage from `turn.completed`; its JSONL also powers the live/persisted activity
  feed. The native Grok adapter (`grok-json-v1`) launches
  `grok --prompt-file --output-format streaming-json`, renders the Graph
  activity feed, and reads the structured result plus token/cost from `text` /
  `end` events. `file-mailbox-v1` injects
  result/schema/inbox/outbox paths for other non-shell runtimes and requires the
  result file before process exit.
- `MailboxService` journals each delivery and mirrors JSONL under
  `<memoryDir>/mailbox/<runId>/`. Task schema/result files live under
  `<memoryDir>/orchestration/<runId>/<taskId>/`; Codex receives that directory
  through `--add-dir`. Linked-worktree Git metadata remains outside normal
  adapter writable roots; an explicitly selected bypass process is trusted and
  is not constrained by that sandbox boundary.
- Every identity owns a durable, fenced `AGENTS.md` role contract below its
  memory directory. Identity create/update/template flows synchronize it while
  preserving user-authored content. Managed tasks copy a read-only, role-aware
  `AGENTS.md` into their task directory, explicitly instruct the runtime to read
  it, and journal its SHA-256/size in `TASK_CONTEXT.json`. They do not mutate
  repository instruction files after leasing, preserving tracked instructions
  and a clean worktree. Interactive/manual sessions retain normal memory
  injection plus the durable role contract.
- The Codex roster audit verifies the actual memory-directory `AGENTS.md`
  rather than the workspace-preferred pinned-file UI projection. During an
  inactive `--apply`, it may archive a stale provider `CLAUDE.md` only when the
  entire regular file consists of well-formed ADE memory/role fences. Symlinks,
  oversized/malformed files and any user text are preserved; each removal has
  a hash-verified recovery copy below the ADE profile.
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
  range from the task's owned base (its prepared dependency base, or the
  leased run base) before requesting durable integration approval. Approval
  triggers one cherry-pick sequencer transaction in the orchestrator worktree,
  replaying owned deltas in work-task creation order so dependencies precede
  their dependents; any conflict aborts the full range. An integration-review
  task may add a similarly ADE-validated commit, followed by a read-only
  verification task.
- Concurrency and approval limits are always enforceable. Token/cost limits are
  accepted only for adapters advertising that telemetry, and missing values
  fail closed. Exact usage is enforced at task-completion boundaries because
  current CLI telemetry is final-turn data, not a live provider spend cap. ADE
  never derives USD from a guessed model price.

### Verified publication boundary

- A repository-backed final verification does not merely mark the run green.
  `RunCoordinator` stores the candidate HEAD on the verification task before
  launch, requires a clean identical HEAD after it exits, and commits that exact
  HEAD, verification-task id and time atomically with run completion and lease
  release. A clean new commit is drift, not success. Migration never fabricates
  this attestation for older runs.
- `publishing/PublicationService.ts` is a post-run Electron-main boundary. Its
  IPC accepts only a run id plus the exact previewed head SHA/generated branch;
  it accepts no path, remote, arbitrary ref, PR URL, Git command or merge
  instruction from the renderer. Preview is read-only. Mutation requires the
  Graph dialog's separate confirmation and repeats preflight immediately.
- Eligibility requires a completed managed run, approved integration, a
  successful final verification result with recorded tests, the released
  orchestrator lease, same repository/backend/common Git dir, clean worktree
  at the attested HEAD, a GitHub `origin`, and an unchanged remote-default HEAD
  equal to the leased base. A non-descendant/empty candidate fails closed.
- ADE generates a bounded `ade/run-*` ref. Git creates it with an empty-remote
  force-with-lease expectation and repository hooks disabled; a different
  existing ref is never overwritten.
  An exact pre-existing ref is retryable after a partial failure. `gh` creates
  only a Draft PR and ADE re-reads its open/draft/base/head/head-SHA/repository
  identity before recording success. There is no direct-default-branch push,
  branch update/delete, ready-for-review, merge or auto-merge operation.
- `origin` must have exactly one URL. An explicit `origin.pushurl` is accepted
  only when it resolves to the same GitHub repository; multiple or different
  push URLs fail closed. Git's local/
  global URL-rewrite configuration remains part of the trusted operator Git
  environment and is not a protection against a malicious bypass process.
- Git and `gh` execute in the repository's immutable native/WSL backend. A WSL
  repository therefore needs Git, `gh` and authentication inside that distro;
  Windows tools or credentials are not used as a fallback. Errors and PR-body
  evidence are bounded and credential/path-redacted. Requested/completed/
  failed state is journaled, and restart converts `publishing` to retryable
  failure rather than inferring success.
- Every `gh` repository selector includes the explicit `github.com` host, so an
  ambient `GH_HOST` cannot retarget it. Disabling push hooks is deliberate
  publisher isolation; hook/Git-LFS-dependent publication is a first-release
  limitation.
- ADE does not inject GitHub credentials or expose publication IPC to a worker
  task. However, a user-selected bypass agent is deliberately an unrestricted,
  trusted OS process and may independently reach ambient credentials or run
  Git commands. The publication gate secures ADE's own product workflow; it is
  not a sandbox against a malicious bypass agent. Stronger isolation requires
  a non-bypass runtime/container/credential boundary.
- This local trusted-desktop operation is deliberately absent from the planned
  Goal 7 remote contract. Repository CI/branch protection and human review are
  authoritative after the Draft PR exists.

### Transport-neutral application boundary (Goal 7)

- `AdeApplicationService` (`main/application`) is the transport-neutral
  facade. `ipc.ts` composes it once with the same `OrchestrationService`,
  `RunCoordinator` and `PtyManager` the Electron handlers use; the host API
  adapter (`main/remote/HostApiServer.ts`) calls the facade and never an
  orchestration service directly.
- Remote authorization is evaluated inside the facade, before the command
  port is called: the channel policy names the required scope, proof and
  idempotency rule, and the facade refuses a principal that does not meet all
  three. Domain invariants (leases, budgets, phase transitions, result
  validation, approval gates) remain inside orchestration services, so an
  adapter cannot bypass them.
- Every remote mutation carries a caller identity (principal), request id and
  idempotency key. The key is bound to one channel and payload digest through
  `commandId = remote:<key>:<sha256(channel+payload)>`, so the coordinator's
  existing command log returns the stored outcome for an exact retry, and a
  retry with another body or another command is rejected
  (`idempotency_key_reused`). Concurrent duplicates coalesce on one in-flight
  promise; a retry can never start a second run or a second planner launch.
- Journal records (`RunEvent`, `RunMessage`) carry the monotonic `seq` the
  orchestration service already assigns; `OrchestrationService.journalCursor()`
  exposes the top of the journal and `eventsSince()` pages strictly after a
  cursor. A `JournalChangeHub` notifies the desktop broadcast and the remote
  streams from one publication point.
- `RunCoordinator.submitSingleTask` is the first-class bounded single-task
  command (`runTask:submit`, `POST /api/v1/tasks`). It takes only an explicit
  `agentId`, `repositoryId`, `prompt` and optional `name`; the caller never
  names a run, participant, workspace binding or PTY.
  `OrchestrationService.createSingleTaskRun` persists the wrapping manual run,
  one worker participant (a one-member team named after the agent), the queued
  task and — when a `commandId` is present — the idempotency record in **one
  atomic save**, with journal `seq` in logical order (`run.created` with
  `kind: 'single-task'`, `participant.added`, `task.queued`). The recorded
  command result is the compact `{runId, taskId}` pair, resolved against the
  journal on replay, so a long prompt can never overflow the command-log bound.
  The coordinator then launches the one-shot task session through the same
  `TaskLauncher` managed tasks use (`PtyManager.create` with the task id, so
  agent/repository/binding checks and the global FIFO of four apply) **without
  awaiting the queue**: the reply carries the persisted run and task, and
  `task.started` / terminal transitions reach callers through the journal. A
  launcher rejection that the PTY layer could not report itself is journaled as
  `task.failed` by the coordinator, so a submission never leaves a task queued
  forever. Cancellation reuses `run:cancel`: for a manual run (single-task or
  desktop-created) the coordinator cancels the queued and running tasks and the
  run status follows from its tasks; a manual draft without work is rejected,
  and managed runs keep their phase-machine cancel. A single-task run cannot be
  started as a managed orchestration (direct tasks already exist).

## ADE host API (Goal 7 and Goal 8 device inventory) and mobile PWA (Goals 8-10)

The host is disabled by default and binds IPv4 loopback only. Desktop Settings
can enable the mobile controller, which discovers the native host's Tailscale
DNS name and configures `tailscale serve --bg --https=443 http://127.0.0.1:4317`.
`ADE_MOBILE_PORT` optionally selects another bounded loopback port. The opt-in
and ownership of the Serve route persist in the host-local device state. Setup
starts/validates the listener and public build before configuring ingress,
refuses conflicting HTTPS routes and Funnel, and never resets other Serve
configuration. A 15-second monitor stops the listener when the route becomes
unsafe/unavailable and restores it when the expected private route returns.
Serve's `Tailscale-Funnel-Request` marker is also rejected per request.

The earlier developer API mode remains separate: `ADE_HOST_API_ENABLED=1`
plus `ADE_HOST_API_TOKEN` and optional `ADE_HOST_API_PORT`. It refuses browser
Origins and requires bearer plus device proof. It cannot run concurrently with
the mobile controller. Browsers never receive that shared listener token.

Endpoints are allowlisted operations, not generic RPC. Implemented today:

- `GET /api/v1/health` - API version, readiness, bounded queue summary and
  whether commands are enabled on this host;
- `GET /api/v1/catalog` - sanitized repositories, agents and runtime readiness;
- `GET /api/v1/runs` - mobile-safe run projection (`RunSummary` incl. `seqCursor`);
- `GET /api/v1/events` - resumable server-sent events over the journal `seq`;
- `POST /api/v1/runs` - create a managed run from explicit `repositoryId`,
  `agentIds`, `name`, `goal` (desktop-only fields such as
  `resetWorktreeToBase` are refused, not ignored);
- `POST /api/v1/runs/{id}/start` and `/cancel` - run lifecycle (`start` is
  managed-only; `cancel` also ends a single-task run's work);
- `POST /api/v1/tasks` - submit one bounded task for an explicit `agentId` and
  `repositoryId` with a `prompt` (≤ 8000 characters, control-character free)
  and optional `name`. The reply is the wrapping run summary plus `taskId`;
  automatic prompt-derived task titles and run names are replaced with neutral
  labels in summaries; explicit independent names remain visible. There is
  no task listing and no per-task action path: progress arrives over
  `/events`, cancellation goes through the run. Plain-workspace (no
  repository) submission is deliberately not offered.

Still planned: Goal 9 approval resolution after step-up authentication and
evidence review. Category, agent and config mutation, interactive PTY methods
(write, resize, attach), filesystem reads, arbitrary IPC and deletion stay
absent. The API never returns absolute paths, prompts, custom command text,
environment values or credentials.

#### Authentication and authorization

Two layers, deliberately separate (`main/remote/authorization.ts`):

- The listener bearer token is an outer authentication gate. In the production
  composition it grants no data by itself: reads, SSE and commands all require
  an active identity from `RemoteDeviceStore`. The earlier bearer-only read
  mode remains available solely to isolated protocol fixtures.
- Every production request additionally requires a **device signature**: `X-ADE-Device`,
  `X-ADE-Timestamp` (Unix ms, ±5 minutes skew) and `X-ADE-Signature`
  (`v1=<hex HMAC-SHA256>` over `ADE-HTTP-V1\n<METHOD>\n<path>\n<timestamp>\n<Idempotency-Key>\n<sha256(body)>`)
  using the device secret. A valid signature yields a `device` principal with
  `read` and `runs:write`. Unknown device, wrong secret, altered path, body,
  key or timestamp all fail closed with distinct, path-free error codes.
- GET signs the exact request target including any `?cursor=...`, with an empty
  idempotency-key field and SHA-256 of the empty body. The signature headers
  must be supplied again on SSE reconnect. POST signing is unchanged.
- `ADE_HOST_API_COMMAND_DEVICE=<id>:<secret>` is now a **one-time migration**
  into the host-local store (secret 32-128 URL-safe chars, distinct from the
  listener token). Both credential variables are consumed before child launch.
  A persisted `bootstrapImported` marker prevents later environment changes or
  a stale credential from recreating a revoked identity. Startup without that
  variable uses persisted devices. A new empty profile has no authorized devices.
  The desktop single-use pairing flow below provisions new browser identities.

#### Browser pairing, sessions and mobile host (Goal 8.2–8.4)

Desktop-only `mobileAccess:status/setEnabled/pair/cancelPair` channels have exact
IPC schemas and policy classification; none are remote command channels.
Status distinguishes `listening` (loopback listener plus matching Serve route)
from `https: pending/verified/unreachable`. An abortable, bounded 20-second
native HTTPS GET verifies the certificate/hostname and public shell without
credentials or redirects. Setup and the connection monitor retry it; initial
Tailscale DNS/ACME provisioning can leave a configured route unconfirmed.
Pairing generates 256 bits of random one-use material, held as a hash in main
for five minutes. A new challenge, explicit cancellation, Settings close or
host restart invalidates it. The QR/manual URL carries it only in the fragment;
the PWA immediately removes that fragment from history. `/api/v1/pair` accepts
only challenge, deviceId, printable name and signing secret, consumes the
challenge before enrollment, and persists a separate encrypted device identity.
The browser creates the key, imports it as non-exportable WebCrypto HMAC and
persists only its `CryptoKey` plus id in IndexedDB before enrollment. A lost
pairing reply can recover by proving that key; no shared bearer is distributed.

For the exact configured `https://<host>.<tailnet>.ts.net` origin, reads, streams
and commands require a device signature **and** a host-only 30-minute session
cookie (`__Host-ade-session`, Secure, HttpOnly, SameSite=Strict, Path=/). Cookie
tokens are random; main holds hashes only, bounded to one session per device
and 100 total. Signed `GET /api/v1/session` retrieves CSRF/session metadata;
signed `POST /api/v1/session` authenticates/rotates it. Rotation, logout, expiry,
revocation and shutdown close its streams. No session survives host restart;
remembered device proof can authenticate again. `POST /api/v1/logout` also
requires session CSRF. Device keys remain revocable in desktop Settings.

Every browser POST requires the exact Origin; a supplied Origin on GET must
also match. Cross-site fetch metadata is refused. Commands additionally require
the session's CSRF header and the existing signed Idempotency-Key. No CORS
wildcards, IPC proxy, remote setup/configuration or additional command scope is
introduced. Admission is bounded to 600 routed browser API requests/minute,
including at most 30 pairing/session authentication attempts. Audit records
pairing/device changes and authentication before effects; payloads, QR material,
device names, signing keys, cookies and CSRF values are excluded.

`src/mobile` builds independently into `out/mobile` through `vite.mobile.config.ts`.
Main loads a bounded exact-path asset allowlist (8 MiB total, 2 MiB/file, at most
100 files, no links). Only the public shell is unauthenticated. Its CSP permits
only same-origin scripts/styles/requests/worker/manifest, plus blob images for
authenticated profile previews (Goal 19); API CSP remains
deny-all. The worker caches an explicit versioned shell list, never API requests,
prompts or results. File/profile drafts and fetched content stay in page memory;
task/terminal drafts and pending work keys use the bounded device store described
above. Commands are never queued for automatic offline execution; an uncertain
reply can be explicitly retried with its original key after reload. Revocation/logout clears pending
commands and private state; an identity generation fences late responses from
the previous device. Run cancellation preserves unrelated composer drafts and
returns keyboard focus to the updated run detail. Reload/background/network recovery
reads authoritative snapshots and resumes signed fetch-based SSE. A 45-second
heartbeat deadline detects silently stalled connections. Detailed reports,
remote approval, push and runtime configuration remain desktop-only. The narrow
Goal 19 name/role/photo API is the documented profile exception.

The mobile shell imports the same `renderer/theme/tokens.css`, pure Avatar and
runtime visual helpers as the desktop. It does not import renderer stores,
preload, the terminal UI or desktop application services. Its Overview, Work
and Graph views consume the health/catalog/run-summary contract; workspace
tools use the dedicated Goal 16–19 contracts described above.
`useMobileHost` owns one connection across all three views; selecting a view,
node or theme never remounts authentication/SSE. Only appearance and the active
view are persisted in localStorage. Drafts, filters, selection and run data
remain in memory; revocation/disconnect clears private state.

Overview reports queue activity as task slots, not terminal sessions. The
current summary DTO cannot establish token-reporting completeness or distinguish
unreported zero usage; zero is displayed as no report. Graph edges describe
participant/team membership and roles; dependency edges are not invented.
Tablet inspectors are complementary panels; phone inspectors and composers are
native modal dialogs with explicit keyboard focus cycling and opener/fallback
restoration. Starting a draft follows the domain contract: fresh task-free
drafts become managed on start, even though their stored pre-start mode is manual.

Mobile build assets are still loaded into main once. Building changed assets
does not disrupt an existing host or its device sessions, and does not update
that host's in-memory asset map. Activating a new build requires a normal host
restart and browser reload. Existing IndexedDB identities and the wire/session
protocol remain compatible; a paired browser can reauthenticate after restart.
See `goal8/MOBILE_DESKTOP_PARITY_PLAN.md` for continuity and UI acceptance goals.

`OrchestrationService.summarize()` replaces automatically derived prompt-prefix
run/task labels with `Single task`/`Task`, including existing persisted records.
Explicit independent labels remain visible. Prompts cannot escape through the
former 80-character title shortcut; source records are preserved unchanged.

With mobile access enabled, closing the desktop window hides it only after a
tray icon is available. The tray can reopen ADE or explicitly quit, which stops
listeners and PTYs. If the tray is unavailable, closing retains normal app exit
behavior. Login autostart, sleep prevention and pre-login execution are not
implemented. The host is the native UI process even when tasks use WSL.

#### Desktop device inventory and durable audit (Goal 8, step 1)

`main/remote/RemoteDeviceStore.ts` stores `userData/ade/remote/devices.json`
separately from `AdeConfig`, renderer snapshots, run archives and workspace
bundles. Device names (1-80 printable characters), creation/revocation times and
ids are desktop metadata; secrets are encrypted with Electron `safeStorage`.
Linux accepts the same OS-backed Secret Service/KWallet providers as harness
credentials, never `basic_text`. Device snapshots use same-directory exclusive
temporary files, fsync and atomic rename; POSIX additionally syncs the directory.
Reads are capped at 256 KiB and 100 records and reject links in path components.
Malformed, unreadable or undecryptable state is preserved and disables device
authorization rather than reseeding identities.

Settings → **Verbundene Geräte** lists active and revoked identities, saves names
and revokes access through three exact, desktop-only IPC channels. Revocation
persists a tombstone and removes encrypted key material before returning success.
It immediately destroys that device's active HTTP responses/SSE connections;
new commands and reads re-resolve the store and fail authorization. Already
accepted domain work is not rolled back or cancelled; its run remains locally
controllable. Rename preserves connections. The UI has loading/error/empty states,
keyboard form submission, wrapped narrow layouts and explicit focus recovery to
the name field after saving or the refresh button after revocation.

`userData/ade/remote/audit.jsonl` is a separate append-only, fsynced journal, not
run history or a rotating diagnostic log. A projected entry contains timestamp,
principal id/kind, request id, channel, target, outcome and optional redacted reason.
It excludes device names, secrets, signatures and request bodies. Device changes
record `requested` before the atomic state write and `executed` afterwards; remote
commands record admission before domain effects and a final result or denial.
A crash between these records leaves an unresolved request, never invented success.
Transport denials (including invalid bearer/proof/body) are recorded too; unverified
callers are marked anonymous, never attributed from an untrusted device header.
Successful signed reads record authentication. All text uses `redactForWire`.

The audit has an 8 MiB hard cap. A torn append, external size change, full journal
or failed append disables authorization and closes active device connections.
There is no automatic deletion, rotation, viewer or recovery UI yet; an operator
must preserve and investigate the local files before offline maintenance.
This journal is deliberately independent of `RunArchive` and run retention.
General desktop IPC diagnostics still go to the rotating main log.

#### Request discipline (fail closed)

Legacy requests: exact `Host` match against the bound loopback address, no
browser `Origin`, `Authorization: Bearer` with a constant-time compare. The
browser path instead uses the exact Tailscale host/session contract above. Both
receive one
`X-ADE-Request-Id` per response, defensive headers (`no-store`, deny-all
CSP, `nosniff`, `DENY`), JSON replies bounded to 512 KiB. Commands add:
`Content-Length` required (`411` for chunked or missing), body ≤ 64 KiB
(`413` before parsing), `Content-Type: application/json` (`415`), JSON object
with only the allowed fields, plain identifiers (`invalid_payload` without
echoing the offending value), `Idempotency-Key` of 8-64 URL-safe characters
(`idempotency_key_required` / `_invalid`). Application rejections
(unknown repository or agent, illegal phase transition) are returned as
`422 command_rejected` with a message that passed `redactForWire`; a missing
device proof is `401 device_proof_required`, a principal without the scope or
a host without command devices is `403 scope_not_granted`, and key reuse
with another payload is `409 idempotency_key_reused`.

#### Event stream contract

`GET /api/v1/events` requires `Accept: text/event-stream` and at most one
cursor, either `Last-Event-ID` (EventSource reconnect) or `?cursor=`; both
present must agree. Without a usable cursor (absent, `0`, beyond the
journal top or behind `journalRetention.prunedSeq`) the stream first sends one bundled `snapshot` event whose `id`
is the current journal cursor; every following `journal` event carries
`events` and `messages` strictly after the previous `id`, in ascending
`seq`, at most 200 records per frame, with `id` = highest `seq` in the frame.
Reconnecting with the last id therefore receives exactly the records it has
not seen, without a snapshot and without duplicates; the union of the
connections equals the journal exactly once. The server sends `retry: 2000`
and a `: ping` comment every 15 s. Streams are bounded: eight concurrent
clients per host (`503 too_many_streams`, `Retry-After`), and a client whose
unsent bytes exceed 256 KiB is disconnected instead of buffering — the
journal is durable, so it resumes from its last id. Stopping the host API
ends every open stream promptly.

Wire projections (`shared/remote.ts`, built in `AdeApplicationService`)
whitelist journal `data` keys (`WIRE_EVENT_DATA_KEYS`); `workspaceDir`,
PTY `sessionId`, mailbox bodies and other host detail never leave main, and
free-text details pass `redactForWire` (credential funnel plus host-path
redaction, bounded to 300 characters).

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
login operation is a Goal 10 user-session feature. Close-to-tray is implemented;
login startup remains planned. There is no pre-login service.

## Electron IPC contract (shared/ipc.ts) — stable, build agents code against it

This contract is an internal trusted-renderer adapter. It is not the planned
network protocol and must never be forwarded by channel name over HTTP.

Invoke (renderer → main, `ipcRenderer.invoke`):
- `config:get` → full config; `config:save({settings:{theme}})` → saved config
- `remoteDevices:list()` → bounded device inventory and availability/error state;
  `remoteDevices:rename({deviceId,name})` / `remoteDevices:revoke({deviceId})` →
  refreshed inventory. Desktop-only; no credential output or remote administration.
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
- `harness:status()` → boolean-only stored-API-key status per keyed harness
  plus safeStorage availability; plaintext never crosses IPC
- `harness:setKey({runtime, apiKey})` / `harness:clearKey({runtime})` →
  write-only encrypted key storage (OS safeStorage, own file next to
  config.json; refuses to store when OS encryption is unavailable). On Linux,
  only known OS-backed Secret Service/KWallet backends are accepted;
  Electron's `basic_text` and `unknown` backends fail closed. Stored keys are
  injected main-side as the harness's documented environment variable only
  while secure storage remains available and only into sessions whose
  effective runtime matches
- `harness:setServiceKey({name, value, scope})` / `harness:clearServiceKey({name})`
  → write-only encrypted generic service keys (e.g. ELEVENLABS_API_KEY) with
  an injection scope of 'all' or a runtime list; reserved names (PATH,
  NODE_OPTIONS, ADE_*, the harness API-key slots, …) are refused. Scoped
  keys are injected main-side into matching native and WSL session
  environments only while secure storage remains available; explicit
  task/launch env always wins
- `harness:login({agentId, runtime})` → terminal session running the
  harness's documented sign-in command from ADE's fixed table (never from
  renderer input); the CLI owns the whole OAuth/subscription flow and the
  session receives no stored credentials. Subscription sign-ins therefore
  stay with the CLI and keep applying to ADE sessions automatically
- `harness:diagnose()` → harness-level readiness via one synthetic probe
  identity per first-class CLI (same safe version/auth commands); an
  authenticated CLI is surfaced as signed in, including its auth method
- `run:get`, `run:create`, `run:delete` → persisted orchestration snapshots/runs;
  a `run:create` participant may carry an optional per-run harness override
  (`runtime`, limited to MANAGED_HARNESS_OVERRIDES). The override is
  snapshotted on the RunParticipant and applied through
  `effectiveParticipantAgent` at every launch/capability/manifest seam; the
  catalog agent is never mutated and its customCommand does not leak into an
  overridden harness
- `run:start`, `run:cancel`, `runApproval:resolve` → managed state machine and
  its durable human integration gate
- `run:publicationPreview({runId})` → read-only verified publication candidate
- `run:publish({runId, expectedHeadSha, expectedHeadBranch, commandId?})` →
  explicit new `ade/**` branch plus GitHub Draft PR; no merge/default update
- `run:get` → `OrchestrationView` (no prompts, artifact bodies or mailbox texts)
- `run:report({runId})` → `RunReport`: files, tests with output, risks, SHAs,
  failure with failed test commands, integration range (desktop-only read)
- `runTask:create`, `runTask:fail`, `runArtifact:create` → journal-backed entities
- `git:status({agentId})` → branch, ahead/behind, files [{path,+,-,state}]
- `git:diff({agentId, path})` → unified diff text
- `fs:tree({agentId})` → workspace file tree (depth-limited, lazy children)
- `fs:read({agentId, path})` → text (size-capped)

Events (main → renderer, `webContents.send`):
- `pty:data` `{sessionId, dataBase64, sequence}` (coalesced renderer-side)
- `pty:exit` `{sessionId, exitCode, reason}`
- `pty:removed` `{sessionId}`; `pty:taskQueue` `{active,queued,maxActive}`
- `orchestration:changed` → authoritative `OrchestrationView`: runs/
  participants/tasks (prompt digest and length, parsed provenance)/events,
  artifacts (content length only), results, approvals, workspace leases,
  publications, messages (text length only), run usage and `seqCursor`;
  coalesced to one broadcast per event-loop tick
- `git:changed` `{agentId}` (debounced watcher, v1 optional: poll on focus)

Every invoke passes through one wrapper (`handle()` in `main/ipc.ts`) that
applies four checks/steps in order:

1. **Sender.** The sender is the main frame of a *registered* ADE renderer
   window (`main/rendererWindows.ts`) at the exact configured Vite URL
   (development) or packaged renderer file (production). Dashboard windows
   are never registered, so they cannot invoke ADE IPC regardless of URL.
2. **Payload.** The payload has only the channel's allowed fields, runtime
   enum values and bounded strings/arrays/base64/dimensions. Compile-time
   TypeScript types are not treated as a security boundary.
3. **Privilege policy.** `main/ipcPolicy.ts` holds
   `CHANNEL_POLICY: Record<InvokeChannel, {effect, surface, audit, armsShell?, remote?}>`,
   exhaustive by type: an unclassified channel does not compile, a
   misclassified one throws at registration. `effect` is the highest
   privilege the handler exercises (`read` < `mutate` < `host` < `launch` <
   `shell`); `shell` — operator command text through a shell — is confined to
   `SHELL_CHANNELS` (`agent:openDashboard` only). `surface: 'shared'` marks
   the operations the host API may also expose; every shared channel must
   carry a `remote` requirement `{scope, idempotency, proof}` that the
   application facade enforces before the handler runs. Channels whose
   payload stores a `dashboardCommand` carry `armsShell`. Audited channels
   (launch/shell/host, remote commands, never `pty:write`/`pty:resize`) log
   one line per call.

   *Why the `shared ⇒ read` invariant became `shared ⇒ read unless
   allowlisted`.* Until Goal 7 the only remote principal was the listener
   bearer token, so any shared mutation would have been reachable with one
   secret; the invariant was the lock. Deleting it would make a single policy
   line enough to expose a mutation. Instead the invariant is lifted per
   channel and only under the strongest requirement: a shared channel whose
   effect is not `read` must be listed in `REMOTE_COMMAND_CHANNELS`
   (`run:create`, `run:start`, `run:cancel`, `runTask:submit`), demand `scope: 'runs:write'`,
   `idempotency: 'required'`, `proof: 'device-signature'` and `audit: true`;
   shared `read` channels demand `scope: 'read'` without idempotency; `host`
   and `shell` effects can never be shared; desktop channels carry no remote
   requirement. `channelPolicyViolations()` reports every deviation and
   `handle()` throws on the first one at registration, so a misclassified
   line never reaches a renderer or the host API. The security suite pins the
   allowlist and each negative control (`test-security.ts`, "channel
   privilege policy").
4. **Redaction funnel.** A handler error is logged main-side (redacted, with
   stack) and rebuilt for the reply through `main/errors.ts`
   (`toIpcError`): URL credentials, vendor key shapes, `NAME=value` secret
   assignments, bearer/authorization headers and control characters are
   removed and the message is bounded to 2000 characters. The same module
   redacts backend stderr inside `ExecutionBackendService.checked`, the
   `pty:create` argv log and publication text. Text that leaves the host
   over the network additionally passes `redactForWire` /
   `redactedWireMessage`: the credential funnel plus `redactHostPaths`
   (Windows drive paths, UNC/`\\wsl$` paths, multi-segment POSIX absolute
   paths and `~/` paths become `[path]`; relative repository paths and URLs
   stay readable), bounded to 300 characters.

Main → renderer events use `broadcastToRenderers`; nothing iterates
`BrowserWindow.getAllWindows()` for ADE payloads, dialogs or notification
targets.

## Terminal beta security and UX

- Renderer process sandboxing, context isolation and disabled Node integration
  and webviews are mandatory. The preload exposes only allowlisted `invoke`
  and `on` wrappers.
- CSP defaults to `none`, permits self-hosted scripts/styles/fonts plus the
  `ade-photo:` image scheme, and denies objects, frames, forms and base URLs.
- Main-frame navigation stays on the ADE renderer; only credential-free HTTP(S)
  links may be handed to the system browser. Web permissions default to deny.
- Agent dashboards (`main/dashboard/DashboardWindows.ts`) open in a separate,
  unregistered BrowserWindow per agent with its own `persist:` partition,
  deny-all permissions, no preload and a fixed title. `will-navigate` and
  `will-redirect` share one origin guard: anything off the dashboard origin —
  a server 302 included — is blocked and, when it is a plain http(s) URL,
  handed to the system browser. Session cookies are rewritten with a bounded
  expiry only when they belong to the dashboard origin
  (`cookieBelongsToOrigin`, applied on top of Electron's URL filter); a login
  hop through a foreign identity provider earns no persistence. Deleting the
  agent closes the window and clears the partition's storage and cache.
- Workspace reads (`fs:tree`, `fs:read`, `fs:pathInfo`, `fs:agentFiles`) apply
  the same link discipline as mutations and the WSL helper: every component
  from the workspace root to the leaf is `lstat`-checked, a link or junction
  anywhere fails closed, the real path must stay inside the real root, and
  listings never follow links (a linked directory is shown as a plain entry).
- Diagnostics execute fixed version/auth probes for known runtimes. Custom
  command strings are neither executed nor echoed. Claude/Codex expose stable
  auth probes; Ollama checks its local service; other runtimes report unknown
  auth explicitly when no stable probe exists.
- Keyboard: Ctrl+Shift+T/W create/close, Ctrl+PageUp/PageDown cycle sessions,
  Alt+1..9 selects a session, Ctrl+1/2/3 changes top-level view (Terminals /
  Graph / Overview). Tab lists also implement roving focus and
  arrow/Home/End navigation.
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

## How the evidence is kept honest (tsconfig.scripts.json, scripts/run-suites.ts)

The suites are the project's proof; two guards keep them from proving less
than they appear to.

- **The drivers are typechecked.** `tsconfig.scripts.json` covers `scripts/**`
  and joins `pnpm typecheck` as a third `tsc --noEmit`. Before it existed,
  `tsx` transpiled the drivers without checking them, so compile-time guards
  written *inside* a driver never ran. `scripts/test-security.ts` declares its
  fixture map as `Record<InvokeChannel, unknown>` precisely so a new IPC
  channel without a fixture is a type error — the runtime loop cannot catch it,
  because a missing key reads as `undefined` and passes every void request.
  That guard first fired when it was switched on, and found `wsl:list`.
  (A channel with no *validation* was already caught: `ipcValidation.ts` ends
  in `const exhaustive: never = channel`. The uncovered case was a validated
  channel with no security fixture.)
  The project is standalone rather than a reference: the drivers pull
  main-process modules in transitively, and `composite` would require every one
  of them to be listed here too.
- **Each suite has a floor.** `scripts/run-suites.ts` is what `pnpm test` runs.
  It executes every suite (a failure no longer stops the rest, as the old `&&`
  chain did), reads each `<n> passed, <m> failed` summary and fails when a
  suite reports fewer checks than its recorded floor. A driver that silently
  stops emitting checks — an early return, a skipped branch, a fixture that no
  longer builds — otherwise prints a green summary and exits 0. Floors are per
  platform because several drivers gate checks on `process.platform`; only
  platforms whose counts were actually observed are enforced, and the runner
  names any platform it has no measurement for instead of guessing. A suite
  that grows past its floor is reported so the floor gets raised.
  `pnpm test -- --record` prints a paste-ready manifest.

## CI and packaging

- `.github/workflows/ci.yml` runs typecheck, focused scripts and production
  build on Windows and Ubuntu. Windows additionally runs the real
  Electron/ConPTY workflow plus an unpacked package; Ubuntu builds Linux-native
  `node-pty` and runs the same Electron/Playwright workflow against both source
  and the unpacked Linux executable under Xvfb.
- `.github/workflows/package-windows.yml` repeats verification, creates the
  x64 NSIS installer and uploads it. `WIN_CSC_LINK` and
  `WIN_CSC_KEY_PASSWORD` opt into Authenticode signing; local artifacts are
  expected to be unsigned.
- `.github/workflows/package-linux.yml` repeats the native Ubuntu gate, builds
  AppImage and Debian artifacts, runs the 47-check Electron workflow against
  unpacked, AppImage and installed `.deb` executables, writes SHA-256 checksums
  and uploads the unsigned artifacts.
- `scripts/test-electron-workflow.ts` uses platform-specific shell commands,
  seeds only a temporary ADE profile and
  verifies sandbox/preload boundaries, IPC rejection, real terminal I/O,
  multi-tab shortcuts, renderer reload replay, non-zero failure/restart,
  diagnostics, worker-specific managed planning, approval, integration and
  verification. Its current source workflow also drives publication preview,
  explicit confirmation, an exact push to a real isolated bare remote, a
  deterministic fake GitHub Draft PR and restart-persisted audit. The same
  script can target `ADE_E2E_EXECUTABLE`. It also proves catalog selection,
  local repository health, independent PR rendering, tab keyboard behavior,
  lazy commit diff, Escape focus restoration and manual refresh.
- The current 2026-07-19 development gate passes 465 focused Windows
  assertions and 64 source Electron/Playwright assertions. The previous hosted
  platform-closing gates passed 410 focused Windows assertions, 409 native
  Ubuntu assertions (the Windows `.cmd` probe is inapplicable), production
  builds and 47 Electron assertions on each native platform/artifact. The extended
  Windows-GUI→WSL gate adds 31 backend checks and 67 Electron assertions,
  including a full managed run and app restart. The first hosted cross-platform
  CI and Linux package workflows passed on `d32faa9`, including installation
  and execution of the Debian package. Versioned release publication remains a
  separate release gate.
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

No emojis or status-bar path. Sessions are terminal windows: the tab strip has
tabs + `+`; `+` opens the per-session scope/runtime/model selection from Goal 21.
Inspector:
repository-scope header plus Overview / Changes / Files tabs, collapsible,
resizable and progressively disclosed through one shared detail pane.
Default order is rail | terminal | inspector; Settings may put the inspector
on the left. Rail resizable. Onboarding modals per mockup, plus photo upload.

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
## Remote workspace administration (Goals 12–15, 2026-09-08)

The new operator-requested administration surface goes through
`AdeApplicationService`, separately from mirrored IPC channels.
`REMOTE_COMMAND_CHANNELS` remains the four bounded run/task commands; no host,
config, filesystem, PTY or shell IPC is promoted to `shared`. Administration
uses explicit typed application methods and path-free DTOs in `shared/remote`.

Device records optionally carry desktop-granted `host:restart`, `catalog:write`
and `repositories:write` capabilities. Missing grants mean no administration;
bootstrap and pairing never inherit them. The new desktop-only audited invoke
`remoteDevices:setAdminScopes` validates exact keys, supported scopes and unique
values. Grant changes close sessions/streams; subsequent requests must prove
the device again and use current grants. Secrets never leave the local vault.

Signed `GET /api/v1/host` returns an opaque process-instance ID, app version,
restart availability and bounded blocker descriptions. `POST /api/v1/host/restart`
requires `{instanceId}`, a current device grant, an idempotency key and the
existing browser session/CSRF gate. `RemoteCommandLedger` binds the hashed
device/key to operation/payload, fsyncs a reservation and records the outcome
before scheduling relaunch. Same-key requests coalesce/replay across restart;
interrupted reservations never rerun. Storage is link-checked, bounded to
500 receipts/1 MiB and unavailable on corruption/write failure.

`HostOperationGate` counts desktop mutations and remote run commands, refuses
restart during in-flight operations and fences new mutations once accepted.
Existing PTYs, task queue, running runs and workspace operations are blockers.
Desktop revocation/grant withdrawal remains available through the fence; the
controller rechecks the grant before relaunch. Electron retains its executable,
app argv, cwd and profile environment and quits gracefully after allowing the
receipt response to flush. No remote executable, argv or host path is accepted.
The PWA confirms completion only after an authenticated different instance ID.
The implementation is measured on native Windows source production launches;
platform/package claims must follow `REMOTE_WORKSPACE_RESULTS.md`.

`POST /api/v1/admin/commands` dispatches a closed discriminated application
union: `agent-create`, `project-create`, `workspace-prepare` need `catalog:write`;
`git-fetch` and `git-apply` need `repositories:write`. These are not invoke
channel names and cannot call IPC handlers. Every effect uses the same signed
device/CSRF/audit/receipt admission and host-operation fence. Agent creation
accepts a bounded name and host catalog/profile identity, copies only configured
runtime settings and creates fresh home/memory/instructions. Project creation
accepts a name only and creates a named child of the desktop-configured project
parent. Without that setting, legacy administration creates a UUID directory
below `userData/ade/projects`. Both initialize native Git with an initial empty
main commit and disabled hooks; configured roots also have their saved directory
identity rechecked. See `TABLET_PROJECT_START.md`.
There is no clone URL, path, executable, secret or free-form config field.

Workspace preparation resolves the existing agent/repository binding through
`RepositoryScopeService`. Native scope creation and reads now check link/junction
components before inspecting/materializing worktrees, including configured
worktree roots. Existing leases and live sessions (including legacy path-only
records) refuse remote preparation. Interrupted provisioning may leave files
for inspection but never automatically repeats under the same receipt key.

`POST /api/v1/admin/git` is a bounded signed read/preview query. Overviews need
read scope; previews additionally need the Git grant. It uses the existing
`RepositorySyncService` with an explicit wire redaction projection. Preview IDs
are device-owned, capped at 20 and expire with the underlying five-minute
preview. Apply rechecks ownership and target/source/binding drift, then consumes
the preview; retry replays the durable outcome. Queries/commands currently
accept native catalog repositories only. Main/agent branches, counts and measured
fetch freshness are visible, absolute host paths and Git argv are not.

Run summary participants add optional `agentId` for compatibility with older
hosts and stable remote filtering. Work/Graph filter by repository and agent
identity; the global task-slot counter remains global. Project/mode drafts and
pending task keys survive reload in device-scoped storage; general management
dialog keys remain in page memory. Both clear on identity revocation/disconnect.
A late task reply clears only the matching
submitted draft; it cannot erase another project's or subsequently edited text.
