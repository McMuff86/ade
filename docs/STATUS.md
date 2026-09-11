# ADE implementation status

Status date: 2026-09-11. Current behavior is below; chronological intermediate
notes are in the [checkpoint archive](archived/STATUS_2026-09-10_CHECKPOINT.md).
Contracts: [Architecture](ARCHITECTURE.md), [Spec](SPEC.md).
User entry: [illustrated guide](USER_GUIDE.md).

## Guided setup follow-up

S0–S3 are delivered for native Windows/Chromium: desktop Einrichtung, profile-free
first entry, explicit device permission presets and Mobile build/setup status.
The complete **pnpm verify passed with 2,651 checks**: three TypeScript projects,
41 focused suites/2,058 checks, production build and 593 real Electron/Chromium/
visual checks (including the new setup flow's 37). No application changes followed
this passing run. Log: `test-results/onboarding-verify.log`, exit 0.
Build/permission negative controls recover with a final positive control; the
26-check focused setup suite enforces its measured native Windows floor.
The verified release `4288a32` is running since September 11, 06:49:59 local;
HTTPS 200 and exact served asset hashes checked. Pairing and Serve unchanged.
Operator details and remaining physical/WSL acceptance are in HANDOFF.
Task record: [ONBOARDING_GOALS](ONBOARDING_GOALS.md).

## Previous project workflow delivery and evidence (September 10)

T0–T7 are delivered for native Windows. The final `pnpm verify` passed with
**2,588 checks**: three TypeScript projects, 40 focused suites/2,032 checks,
production build and 556 real Electron/Chromium/visual checks. The historical
2,148-check September 9 run is baseline evidence, not verification of these changes.

Final UI checks: desktop 185, repository sync 20, Mobile browser 57, Mobile
Electron 15, restart 10, workspace browser 24, workbench browser 25, terminals
120, run files 24, project CLI 22, project Git 20, publication 12, visual 22.
Focused file/API checks: 57; security: 225; orchestration: 82. The measured suite
floors were raised to protect these counts; no application changes followed
that passing run before its delivery. Earlier measurements are recorded per task in
[PROJECT_WORKFLOW_GOALS](PROJECT_WORKFLOW_GOALS.md).
Final log: `test-results/project-goal-verify.log` (exit 0). Earlier failed attempts
remain separate `project-goal-verify-first.log` / `project-goal-verify-second.log`;
their failures were corrected and the final positive controls passed.

The extra Windows→WSL lifecycle recheck still times out before launching any CLI:
wsl.exe -d Ubuntu --exec /bin/true did not finish in 15 seconds on September 10.
Only that probe process was stopped. No WSL restart or new WSL release claim.
Prior Linux/WSLg package evidence and prior WSL feature evidence remain historical;
they do not validate this new independent-project/native-file slice.

The user reports improved Samsung/Chrome behavior. Full physical keyboard, DeX,
rotation and network-transition acceptance remains separate from Chromium tests.
GitHub integration uses real local Git and deterministic gh/provider fixtures;
a live GitHub PR roundtrip is not claimed.

| Capability | State | Current behavior |
|---|---|---|
| Interactive terminals | Real, backend-aware | Main-owned node-pty sessions, ConPTY/native POSIX or explicit Windows→WSL launch, xterm UI, resize, replay, theme, exit state and restart action |
| Interactive CLI lifecycle | Native Windows focused PTY evidence | Original foreground call tracked separately from the surviving shell; explicit unknown state, real exit code, desktop reload reconciliation and mobile reopening. Managed tasks/login transport unchanged; manually launched shell commands are not tracked. Final T6 evidence is recorded above |
| Mobile workspace tools | Native Windows and Windows→WSL homes verified | Explicit project or own home; separate read/write grants, bounded tree/search/text preview and revision-checked atomic saves. Git diffs remain native-project-only; live sessions/managed leases block edits; drafts live only in page memory |
| Mobile interactive terminals | Real Windows and Windows→WSL home PTYs verified | Explicit terminal grant, per-session launcher, existing session attach, exclusive 30-second input lease, immediate desktop reclaim/revocation and sequenced at-most-once input; xterm color/cursor display and direct input, compact keyboard layout and explicit keyboard activation; no managed-task/login control, full mouse reporting or terminal file transfer |
| Per-session launch choice | Desktop/tablet flows verified with controlled CLIs | Empty shell, saved profile, fresh Codex/Claude/Grok/Hermes and available Ollama model; fixed discovery/revalidation and preserved restart choice. Saved profiles are unchanged; vendor authentication and real inference are separate acceptance |
| Mobile agent profiles | Implemented; browser and native Electron codec verified | Active-device photo reads and separately granted name/role/photo updates with revision checks; normalized PNG at most 32 KiB/256×256; same stored profile and desktop refresh |
| Session reload reconciliation | Real | Renderer rebuilds tabs from `pty:list`; sequence-aware output plus pending exit/removal reconciliation close both reload races |
| Session cleanup | Real | Tab close and agent/category deletion stop and remove owned PTYs; naturally exited sessions reap after 30 minutes |
| Named agents and categories | Real | Persisted identities, photos, runtime/permission settings and backend-aware model choices. Dynamic desktop model discovery preserves saved choices and exposes loading/retry/unavailable states; exact provider/account availability remains an external prerequisite. See `RUNTIME_MODEL_SELECTION.md` |
| Git workspaces | Real, agent/repository/backend-bound | Every agent/repository pair resolves one isolated ADE worktree/branch and uses only the persisted `native` or `wsl:<distribution>` Git boundary; category paths remain compatibility storage |
| Independent project workspaces | Native Windows API and desktop/tablet discovery verified | Projekte shows bounded configured-root discovery and catalog entries; exact original/linked checkout opening without an agent or injected instructions; actual branch, explicit read/open grants, durable recovery after lost replies. Branch, CLI, Git and result controls are available |
| Independent project branches | Native Windows desktop/tablet verified | Local and fetched remote branches, original checkout or separate worktree, concrete previews, drift/session/lease guards and receipt recovery |
| Repository scopes | Real | First-class repository catalog, explicit execution backend, optional agent defaults, portable homes and immutable session/task/run/lease/artifact scope snapshots; legacy records migrate to native |
| Git comparison and explicit update | Implemented; new flow tested on native Windows | Graph, inspector and New Run compare main and agent worktrees with a selected local/origin basis; explicit Fetch, truthful session-local freshness and per-target preview/confirmed fast-forward. Dirty/divergent/detached/busy targets block updates; source/binding/HEAD drift invalidates previews. The mobile manager uses the same native Git service with a device grant and a separate preview/receipt contract. No automatic stash/reset/push or persisted Run basis. See `REPOSITORY_SYNC_PLAN.md` |
| Reusable agents/templates | Real | Agent settings save bounded immutable template seeds; spawning creates an independent id, memory directory, home and optional repository binding |
| Files and changes | Real, execution-scoped | Lazy tree, capped reads, Git status/diff and a visible backend/repo/source/branch/path/dirty/lease header resolve the active session snapshot; WSL mutations enforce containment, no-follow reads and atomic no-replace rename |
| Overview home | Real inventory and launch actions | Catalog projects/agents, live PTYs and historical work refresh from current state. Direct saved-profile terminal and configured dashboard actions; removed identities remain historical context rather than active launch targets. Unknown interactive tokens/cost stay unknown. See `ASSISTANT_ACCESS.md` |
| Independent project entry | Native Windows Git/PTY evidence | Project → branch/worktree → Codex/Claude/Grok/Shell, optional profile. New project on main without automatic CLI. Terminal, Git and Results sections. Explicit read/open/Git/publish grants |
| Independent project Git | Native Windows real Git and browser fixtures | Selective commit, diff, conflict edit/resolve/continue/abort, fetch and reviewed fast-forward. Explicit push and GitHub PR, no force/implicit publishing; GitHub behavior uses a controlled provider fixture |
| Run results and downloads | Native Windows real PTY/browser evidence | Graph file entry and project Results. Before/after changes, truthful legacy labels, current-file downloads and raster preview. Original task worktree required; no immutable binary archive |
| Repository inspector | Real, read-only and backend-aware | The selected catalog repo has an Overview tab with bounded local health, 12 recent commits, lazy capped patches and up to 20 optional GitHub PRs; local state survives provider/offline errors, while Changes/Files stay on the active session binding |
| Memory and role read path | Real | `MEMORY.md` / `USER.md` are injected at launch; each identity also owns a durable role-aware `AGENTS.md`, and managed tasks receive read-only role instructions plus a capped memory snapshot/digests without touching the leased worktree |
| Memory write enforcement | Partial | Agents edit files directly; `MemoryStore` caps and drift checks are not an MCP write gate yet |
| Test evidence | Real | `scripts/**` is a third typechecked project, so the compile-time guards inside the drivers actually run; `pnpm test` executes every suite and fails one that reports fewer checks than its measured floor. Floors are recorded for `win32`; other platforms are named as unmeasured rather than guessed |
| Config durability | Real | Writes are atomic and fsynced; only a missing file seeds defaults. An unreadable, malformed or unmigratable config is preserved under `ade/corrupt/` before defaults are written, a failed preservation leaves the original untouched and turns the store read-only, and `config:health` surfaces either state as a renderer banner |
| Persisted run model | Real | Runs, participants, phased tasks, events, artifacts, structured results, approvals, workspace leases, publication audits and messages are stored atomically in app config; logical phase transitions commit as one save |
| Run journal cursor | Real | Events and messages carry one global monotonic `seq` (backfilled once by migration); `run:events` returns a cursor-paged chronological stream as the future SSE base |
| Command idempotency | Real, opt-in | Mutating run commands accept an optional `commandId`; a bounded command log replays the recorded successful outcome instead of re-executing |
| Sanitized run summaries | Real | `run:getSummary` projects runs without absolute paths, prompts, mailbox bodies or lease paths, for the Graph canvas and the future mobile DTO |
| Run reload/restart recovery | Real | Task/run status is reconstructed from the journal; interrupted processes fail, an idle pending integration approval and its leases remain resumable, and an interrupted external publication recovers as failed/retryable rather than successful |
| Graph topology | Real, run-scoped | A run references catalog agents and assigns run-local orchestrator/lead/worker roles without creating identities |
| Graph canvas | Real, multi-run | Every non-terminal run renders as its own cluster; edge/node activity is journal-driven (message `seq`, task transitions), a global panel shows the four task slots and per-run queues, the node inspector surfaces results/usage/provenance, and a selected failed run exposes its persisted technical reason directly in an accessible alert |
| Managed activity feed | Real, persisted | Claude stream-json and Codex JSONL render into one sanitized live feed in the movable/fullscreen task panel and append to bounded per-task `ACTIVITY.jsonl`; completed-task activity remains available through validated read-only IPC |
| Team pause | Real, main-owned | `run:pauseTeam`/`resumeTeam` journal `team.paused`/`team.resumed`; managed scheduling skips paused teams without cancelling running tasks; renderer `idleTeams` remains manual-dispatch-only |
| Graph task launch | Real, bounded | One-shot non-interactive task sessions, FIFO limit of four active CLIs, queue status and cancellation |
| Graph completion | Real, persisted signal | PTY start/exit/cancel events transition persisted tasks; success requires exit code 0 |
| CLI/auth diagnostics | Real, backend-aware | Read-only availability/version/auth/transport checks execute in the selected native or WSL backend; custom command text remains undisclosed and unexecuted |
| Terminals layout | Real, optional | Settings can put the repository inspector on the left; the default remains rail left / inspector right and is not swapped unless the user chooses |
| Keyboard navigation | Real | Roving terminal/view tabs plus create, close, previous/next, direct session shortcuts and Ctrl+1/2/3 for Terminals / Graph / Overview. Graph cards, cluster bars and team bars are focusable buttons (Enter/Space select, Enter activates a selected card, Escape clears the selection or closes the report); team actions appear on `:focus-within` |
| Finished-run readability | Real | Any finished or failed run stays reachable: the run selector groups open/finished runs with status, an older selected run is pinned onto the canvas, the failure alert names the failed test commands, the inspector shows the full result (summary, every changed file, every test with expandable output, risks, SHA) and `run:report` opens a per-run report dialog with integration range (`fromSha → toSha`), verification, approvals and publication. Retention-archived runs are not browsable in the UI yet |
| Background notifications | Real | Native task completion/failure, abnormal interactive-exit and run-awaits-approval notifications when ADE is unfocused |
| Main-process log | Real, rotating | `console.*` in main is teed into `userData/ade/logs/main.log` (2 MiB × 5 files, 8 KiB per line, credential-redacted); a failing sink disables itself instead of throwing |
| History retention | Real, bounded | Compact config serialization; terminal runs beyond the newest 40 and older than 30 days — or the oldest terminal runs above 4 MiB — are archived to `userData/ade/archive/runs/<runId>.json` before pruning, at startup and hourly; open, leased and published runs are never pruned; the journal `seq` floor keeps SSE/`run:events` cursors monotonic. Renderers receive a slim `OrchestrationView` (digests and lengths instead of prompts, artifact bodies and mailbox texts), coalesced per tick |
| Renderer/IPC security | Real | Sandboxed, context-isolated renderer; default-deny CSP; navigation allowlist; every invoke passes registered-window sender check, payload validation, the exhaustive channel privilege policy (`ipcPolicy.ts`: effect/surface/audit/remote, shell confined to `agent:openDashboard`) and the redaction funnel (`errors.ts`) for error replies; text that leaves over the host API additionally passes `redactForWire` (credentials and absolute host paths removed, bounded); main→renderer events reach registered ADE windows only |
| Credential handling at the WSL boundary | Real | Stored harness/service keys and `ADE_*` fields reach WSL sessions through `WSLENV` in the `wsl.exe` host environment, not argv; the `pty:create` argv log and backend stderr in errors are redacted (verified against a real Ubuntu distro) |
| Dashboard windows | Real, origin-locked | Per-agent partition, deny-all permissions, no preload, fixed title; `will-navigate` and `will-redirect` share the origin guard; session-cookie persistence is limited to the dashboard origin; agent deletion clears the partition's storage and cache |
| Workspace read boundary | Real, link-safe | Native `fs:tree`/`fs:read`/`fs:pathInfo`/`fs:agentFiles` refuse link or junction components and real-path escapes exactly like mutations and the WSL helper; listings never follow links |
| Worker decomposition | Real, managed-run beta | The planner returns schema-validated, participant-specific assignments with optional acyclic dependencies; the run scheduler enforces its own concurrency cap and prepares each dependent repo-backed worker's worktree with its dependencies' validated commits before launch |
| Agent communication | Real, file fallback | Assignment/result messages are journaled and mirrored to per-run INBOX/OUTBOX JSONL under each agent memory directory |
| Structured runtime results | Real | Codex uses native JSONL plus output-schema/output-last-message; Grok Build uses `--prompt-file` plus `--output-format streaming-json` (`grok-json-v1`) for the live activity feed and result/usage extraction; quote-safe stdin or a translated WSL prompt file carries task prompts without command-line interpolation; all managed adapters use the same result/file contract |
| Worktree ownership | Real, trust-mode dependent | Clean workspaces are leased exclusively and ADE commits only an exact reported/observed path-set match; normal adapter roots exclude linked-worktree metadata, while an explicitly selected bypass runtime is fully trusted and violations are detected at task boundaries rather than OS-prevented |
| Repeatable run loop | Real, explicit opt-in | A second managed run over the same worktrees fails closed by default and names each worktree that diverges from the orchestrator HEAD. With the run's "reset worktrees to the orchestrator base" confirmation, ADE pins every divergent tip under `refs/ade/archive/<run>/<participant>`, resets the clean, branch-attached worktree onto the orchestrator HEAD and journals `workspace.rebased` before leasing; dirty worktrees and worktrees leased by another active run are never moved. A late successful task result on an already-ended run is recorded as cancelled and drains the run's leases instead of leaking them |
| Orchestrator behavior | Real, beta | Deterministic planning → worker edits/tests → ADE-owned commits → approval → transactional integration → integration review → read-only verification |
| Verified Draft-PR publishing | Real, local and explicit | A completed repo-backed managed run atomically attests its final verified HEAD; Graph rechecks clean/same worktree, unchanged GitHub base, generated `ade/**` ref and `gh` access, then a separate confirmation creates only a new branch plus Draft PR and journals the result |
| Prompt/context observability | Real | Context builder v2 journals a path-free manifest plus per-task packets with bounded dependency results, role-instruction digest, model/reasoning and adapter provenance; planner and dependent workers are told the dependent worktree already contains upstream validated commits |
| Run budgets | Real, adapter-dependent | Per-run worker concurrency, input/output tokens, USD cost, approval counts and an optional wall-clock limit per managed task (`maxTaskMinutes`, dialog default 60); token/cost telemetry is enforced at task-completion boundaries and missing values fail closed, while an exceeded task time limit fails the run closed with the task named and cancels the process |
| Windows packaging | Real, unsigned by default | x64 assisted NSIS installer; release workflow signs when certificate secrets are configured |
| Linux/WSLg | Package-verified locally and hosted | Ubuntu/WSL2 native install/build, Linux-built node-pty, the full focused suite, platform-aware source and unpacked Electron/Playwright workflows, Codex Sol/xhigh/bypass smoke, unpacked/AppImage/installed-Debian packaged workflows, valid metadata and uploaded SHA-256 artifacts; only versioned public release policy remains pending |
| Windows GUI → WSL | Real, explicit backend | UI discovers distributions and stores `wsl:<distribution>` per repository; canonical paths, Linux Git/files/worktrees, diagnostics, PTY, managed prompt/results, approval/integration and restart are covered by focused backend and cross-boundary Electron workflows |
| macOS | Prepared, unverified | POSIX runtime branches exist; native CI, Electron behavior, signing/notarization and packages remain unverified |
| Remote host API | Local command surface complete, loopback-only and disabled by default | The transport-neutral application service projects mobile-safe health, catalog, sanitized runs and a whitelisted journal projection. The opt-in HTTP adapter is fixed to `127.0.0.1`, requires a strong Bearer token plus an active stored device signature for all reads/SSE/commands, rejects unknown Hosts/Origins/methods/paths, and serves `GET /api/v1/{health,catalog,runs}`, resumable `GET /api/v1/events` (8 clients, 256 KiB per client) and bounded `POST /api/v1/runs`, `/runs/{id}/start`, `/runs/{id}/cancel`, `/api/v1/tasks`. Commands additionally require an `Idempotency-Key` bound to channel and payload. Content-Type, Content-Length (64 KiB), payload shape and identifiers fail closed. The private browser path adds device signatures plus secure session cookies; pairing and Tailscale setup are implemented. Approval and public ingress remain unavailable |
| Remote device inventory and audit | Real, desktop-only; locally verified on native Windows | Settings lists, renames and revokes durable device identities and grants separate restart, catalog and Git administration rights per device. Secrets use OS safeStorage outside config/bundles; revoked tombstones prevent stale startup credentials from reviving a device. The environment device is migrated once. Revocation closes active device HTTP/SSE responses and denies subsequent access; accepted runs continue. A separate fsynced append-only audit records admission/outcomes and transport denials without payloads/keys/host paths. Corrupt or unavailable storage and the 8 MiB audit cap disable device authorization; QR pairing is implemented; audit viewer and maintenance UI remain pending |
| Single-task submission | Real, main-owned | `runTask:submit` / `POST /api/v1/tasks` takes an explicit agent id, repository id, prompt (≤ 8000 chars) and optional name. One atomic save creates a manual run, one worker participant (one-member team named after the agent), the queued task and the idempotency record; the one-shot task session then launches through the managed task launcher (same agent/repository/binding checks and global FIFO of four) without blocking the reply. Progress and completion are journal events; a refused launch is journaled as a failed task; the wrapping run is cancellable via `run:cancel` and cannot be started as a managed orchestration. The wire carries neither prompts nor automatic prompt-derived title excerpts; independent names remain visible |
| Remote channel policy | Real, allowlisted | `ipcPolicy.ts` gives every `shared` channel a `remote` requirement; `shared ⇒ read` holds for all channels except `REMOTE_COMMAND_CHANNELS` (`run:create/start/cancel`, `runTask:submit`), which must demand `runs:write` scope, a required idempotency key, a device signature and audit. Host/shell effects can never be shared; `channelPolicyViolations()` and the security suite pin every rule |
| Mobile companion | Personal-alpha implementation, native Windows automation | Private Tailscale Serve and five-minute QR/manual pairing open a responsive PWA using the desktop's actual dark/light tokens, Overview, Projekte, searchable Work, participant/team Graph and tablet-side/phone-modal Inspector. Task/run dialogs retain separate device-local drafts per project and mode across navigation, reload, theme and connection changes; Work/Graph filter by project and agent identity. Bounded task submission, managed-run prepare/start, state/cancel, remembered device proof, host/network reconnection and Chromium shell-only offline startup use the signed idempotent run API. New Project creates a permanent named main checkout using the configured root and then waits for CLI selection; Continue Working attaches real interactive sessions in a full-screen tablet workspace. The separate administration surface adds agent/project/workspace creation, Git comparison/confirmed update and idle native Windows source relaunch after an explicit per-device desktop grant. Browser/Electron automation covers keyboard/focus and phone/tablet layouts. Managed approvals/notifications remain desktop or future scope; complete answers, activity and file downloads are available remotely. Systematic physical-device/carrier, WebKit offline cold start and other native platform evidence remains open; see `TABLET_PROJECT_START_RESULTS.md`, `goal8/MOBILE_CONNECT_RESULTS.md` and `goal8/MOBILE_DESKTOP_PARITY_RESULTS.md`. An already-running host activates updated assets only after a normal ADE restart and browser reload |
| Remote administration | Implemented; native Windows source-launch evidence | Separate signed application endpoints expose scoped agent/project/workspace provisioning, native Git comparison/Fetch/confirmed fast-forward and idle ADE relaunch. Desktop grants are per device; existing grants do not expand. Administrative receipts coalesce/replay across restart and fail closed on interrupted/corrupt storage (500 receipts / 1 MiB). Restart confirms a new host instance and retains pairing. New projects initialize locally; no arbitrary clone URL, shell, host path, auto-update or OS reboot. See `REMOTE_WORKSPACE_RESULTS.md` |
| Background host mode | Close-to-tray implemented and tested on native Windows | Closing the window while mobile access is enabled keeps the host available via tray; explicit quit stops it. Login autostart, headless startup, sleep prevention, pre-login service and remote wake are not implemented |
| Updates | Not built | No updater or release feed yet |
| CI and Electron E2E | Real, platform-aware | Focused checks, production build and Electron workflows run on Windows and Linux. Windows with DPAPI proves the real encrypted key/service-key roundtrip; headless Linux without a Secret Service proves the explicit fail-closed UI and empty credential state instead of attempting the unavailable positive path. Visual checks require every expected baseline on authoritative platforms (currently Windows); non-authoritative platforms always capture under `test-results/` without reading or writing repository baselines, and `test:visual:update` writes only on an explicitly authoritative platform |

## Validation repository policy

The completed Goal 6 record on `2D_rpg_jumpnrun` remains immutable historical
evidence. New operator-driven ADE product, managed-run and general-use
validation prefers RhinoClaw. Such runs use disposable ADE worktrees and
branches and must not mutate RhinoClaw's ordinary working tree, `main`, deployed
skill or live Rhino installation without separate operator approval.
Deterministic automated CI/Electron workflows continue to use synthetic local
fixture repositories rather than depending on any personal checkout.

## Known constraints

- Worktree-binding cleanup is exposed but deliberately refuses active leases,
  live sessions and dirty worktrees; unmerged branches remain reachable.
  Repository-catalog deletion and bulk cleanup are not exposed. Agent/category
  deletion removes catalog references without deleting user files.
- The repeatable-run reset targets the orchestrator worktree's HEAD, not a
  repository default branch, and never touches the orchestrator worktree
  itself. Archive refs under `refs/ade/archive/` accumulate one entry per
  reset participant per run and are not pruned automatically. The task time
  budget is coordinator-owned: the timer is not persisted, so after an ADE
  restart interrupted tasks fail through restart recovery rather than through
  the budget. `forceStop` still does not escalate the kill, task PTYs still
  run at 120 columns, and `attempt` never exceeds 1.
- Dashboards whose sign-in redirects through a foreign identity provider
  cannot complete that hop inside the ADE window (the redirect opens in the
  system browser); use `dashboardTarget: 'external'` for such dashboards.
  Clearing a dashboard partition is exposed only through agent deletion; there
  is no "sign out of dashboard" action yet. The channel policy's `audit` lines
  go to the main-process log. Remote requests and device administration additionally
  have their own durable audit journal; general desktop calls do not.
- Workspaces whose root or a component is itself a symlink/junction are now
  unreadable in the Files panel, consistent with the mutation guards. A
  `dashboardCommand` remains operator text executed through a shell; the
  policy marks it, it does not sandbox it.
- Legacy Graph categories and `teamRole` fields are retained to avoid deleting
  user data, but new runs and the Graph renderer do not use them as ownership.
- The event journal, structured results, approvals, messages, artifacts and
  the command log share the atomic JSON config, now written compact. History
  retention bounds it: terminal runs beyond the newest 40 that are older than
  30 days — and, above 4 MiB, the oldest terminal runs regardless — are
  archived to `userData/ade/archive/runs/<runId>.json` and pruned at startup
  and hourly; open, leased and published runs are never pruned, and the
  journal `seq` floor keeps cursors monotonic. Archived runs are no longer
  visible in the Graph or the host API (there is no archive browser yet).
  Renderers receive a slim `OrchestrationView` (no prompts, artifact bodies or
  mailbox texts), coalesced per tick; the renderer still replaces whole slices
  on every broadcast (no `run:events` delta consumer, no `React.memo`).
  Indexed storage is conditional on measured need in Goal 11; bounded retention already exists.
- Team pause does not survive an ADE restart: restart recovery fails runs with
  queued tasks, so a paused run closes fail-closed instead of resuming paused.
  Restart-persistent pause is a separate work item.
- Task provenance (prompt/schema/adapter versions, manifest hash) lives in the
  journaled task-context artifact rather than directly on the task record.
  Restart restoration validates uniqueness, digest and version compatibility
  before reusing the persisted manifest and brief.
- Task transports are deterministic for supported non-interactive CLIs. Native
  Grok Build managed tasks use `--prompt-file` plus `--output-format streaming-json`
  (`grok-json-v1`); ADE renders a live activity feed, extracts the structured
  result from streamed `text` / `end` events, and overlays token/cost
  telemetry fail-closed. `--json-schema` is not used because the CLI accepts
  only inline JSON, which ADE will not interpolate into a shell. Custom
  commands still receive the prompt over stdin.
- Auth status is definitive for Claude, Codex and Grok Build (`grok models`
  login line, a stored ADE `XAI_API_KEY`, or the process environment). Other
  third-party CLIs that lack a stable non-interactive status command report an
  explicit warning; custom command text is never executed or returned by
  diagnostics.
- Windows packaging is x64-first; local/branch artifacts are unsigned and the
  release workflow requires `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` to sign.
  Linux x64 AppImage and Debian targets are locally and hosted package-tested;
  the project-license decision and versioned public release remain gates.
  Auto-update, Linux signing and macOS packages do not exist yet.
- The Windows-GUI→WSL backend is explicit and Windows-only. It requires WSL2
  plus `/bin/bash`, Git, Python 3, `gio` and each selected agent CLI/credential
  inside the distribution. Repository import accepts a Linux absolute path;
  the native folder picker does not browse it. WSL worktrees use a sibling
  `.ade-worktrees` root and ignore the Windows worktree-base setting.
- Managed WSL tasks receive their durable, role-aware `AGENTS.md` snapshot and
  Windows-owned task artifacts through controlled path translation. An
  interactive WSL shell reads repository instructions normally, but ADE does
  not yet inject its Windows-owned memory block into that Linux worktree.
- The global task cap remains four CLIs; a managed run can choose a lower
  worker cap. Native Codex usage arrives with the final turn, so one task can
  overshoot a run token limit and concurrent tasks can consume tokens before a
  just-exceeded limit cancels their siblings. Provider-side account limits are
  still the ultimate real-time spend boundary.
- Codex reports token usage in native JSONL but no billed USD. Cost budgets are
  therefore unavailable for that adapter until the CLI/provider reports cost;
  custom wrappers may supply trusted token/cost fields through the file result.
- Dependency edges transfer Git state: before a dependent repo-backed worker
  launches, ADE prepares its leased worktree with its dependencies' validated
  commits (first parent adopted verbatim, further parents replayed as owned
  deltas in assignment order) and persists the prepared base on the task.
  Validation and integration count only owned deltas, so upstream ranges are
  never duplicated; conflicting parent deltas fail the run closed before the
  dependent launches. This closes the Goal 6 F3/F4 add/add-union failure mode
  and is proven by focused real-Git coordinator tests that reconstruct the
  2-producer→1-consumer topology. The completed live Codex reruns
  `3a2773cc` (F3) and `9bcd8932` (F4) then proved the same contract through
  approval, conflict-free integration, integration review and read-only
  verification: dependent prepared bases matched their upstream tips exactly,
  integrated ranges equaled the union of owned deltas, and both runs had zero
  rollback. The earlier `51bdbaf7` driver interruption and `c3c232c6` external
  DNS outage remain explicitly excluded evidence; protocol and full SHAs are
  in `docs/goal6/F3F4_RETEST.md`. Base preparation and integration cherry-picks
  require a resolvable Git committer identity in the repository's backend, as
  integration always has.
- Git integration requires each changing worker to report every changed path
  and leave HEAD untouched. ADE refuses a report/diff mismatch, creates the
  commit with hooks and signing disabled, and transactionally cherry-picks the
  validated linear ranges from each task's owned base. Merge commits are
  rejected and a conflict aborts the whole sequence. The beta caps one worker
  range at 50 and one run integration at 200 commits.
- Plain-workspace runs keep the same plan/result/approval/verification control
  plane but can only reconcile reports; they do not claim git integration.
- Managed-run verified publishing currently supports only a GitHub `origin` plus an
  installed/authenticated `gh` in the repository's own execution backend. The
  remote default branch must still equal the leased base exactly; ADE does not
  rebase, update an existing conflicting ref, merge, auto-merge or delete a
  remote branch. Multiple origin URLs and multiple/different explicit push URLs
  are rejected; Git URL-rewrite configuration remains part of the trusted local
  Git environment. Completed runs from before the immutable verification
  attestation must be rerun. WSL publication requires `gh` and its login inside
  that distribution; this slice is locally verified on Windows and remains to
  join the next hosted/native-Linux matrix. Push hooks are disabled, so Git-LFS
  or other hook-dependent publication needs a later explicit contract/manual
  path.
- Open-PR inspection currently supports one unambiguous GitHub `origin` and an
  installed/authenticated `gh` in that repository's execution backend. It does
  not fetch remote refs or show provider CI logs yet; unsupported/offline/auth
  states remain separate from the always-local status and commit history.
- Mobile access is opt-in in desktop Settings and remains loopback-only behind
  private Tailscale Serve. Systematic physical phone/tablet and carrier-network acceptance
  must be measured separately from Chromium/Electron automation. The legacy
  environment API cannot run concurrently with the mobile controller.
- The fsynced remote audit has an 8 MiB hard cap; full/broken storage disables
  device authorization until offline maintenance. Device history is capped at
  100 records including revoked tombstones. Maintenance/recovery UI is pending.
- SSE resumes from the journal cursor, resets to an authoritative snapshot
  behind retained history and closes on session expiry, rotation or revocation.
  Fetched content and file/profile drafts stay in memory. The tablet project-start
  delivery adds bounded device storage for task/terminal drafts and pending work
  keys; reload restores them without submitting anything automatically. General
  management-dialog retry state still requires the same open page.
- Electron IPC, runtime configuration and managed-run verified publishing remain
  local. Independent-project commit/merge/push/PR use the dedicated T3–T5 project
  API with explicit device grants. Terminal, file and profile access also use
  dedicated APIs and desktop grants. Direct LAN binds, router forwarding,
  Tailscale Funnel and public tunnels are unsupported.
