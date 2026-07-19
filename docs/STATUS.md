# ADE implementation status

Status date: 2026-07-19. This is the short, factual capability matrix. Product
intent lives in `SPEC.md`; sequencing and exit criteria live in `ROADMAP.md`.
Implemented repository bindings and planned mobile boundaries are detailed in
`REPOSITORY_SCOPES_PLAN.md` and `REMOTE_CONTROL_PLAN.md`; Linux, WSL and macOS
sequencing lives in `MULTIPLATFORM_PLAN.md`.

| Capability | State | Current behavior |
|---|---|---|
| Interactive terminals | Real, backend-aware | Main-owned node-pty sessions, ConPTY/native POSIX or explicit Windows→WSL launch, xterm UI, resize, replay, theme, exit state and restart action |
| Session reload reconciliation | Real | Renderer rebuilds tabs from `pty:list`; sequence-aware output plus pending exit/removal reconciliation close both reload races |
| Session cleanup | Real | Tab close and agent/category deletion stop and remove owned PTYs; naturally exited sessions reap after 30 minutes |
| Named agents and categories | Real | Persisted JSON config, photos, runtime/permission settings and native Codex model/reasoning profiles; the current pilot roster is Codex-only (`gpt-5.6-sol`, bypass, orchestrator `xhigh`) except deliberate shell utilities; its audit archives only fully ADE-owned legacy `CLAUDE.md` scaffolds and preserves all mixed/user content |
| Git workspaces | Real, agent/repository/backend-bound | Every agent/repository pair resolves one isolated ADE worktree/branch and uses only the persisted `native` or `wsl:<distribution>` Git boundary; category paths remain compatibility storage |
| Repository scopes | Real | First-class repository catalog, explicit execution backend, optional agent defaults, portable homes and immutable session/task/run/lease/artifact scope snapshots; legacy records migrate to native |
| Reusable agents/templates | Real | Agent settings save bounded immutable template seeds; spawning creates an independent id, memory directory, home and optional repository binding |
| Files and changes | Real, execution-scoped | Lazy tree, capped reads, Git status/diff and a visible backend/repo/source/branch/path/dirty/lease header resolve the active session snapshot; WSL mutations enforce containment, no-follow reads and atomic no-replace rename |
| Memory and role read path | Real | `MEMORY.md` / `USER.md` are injected at launch; each identity also owns a durable role-aware `AGENTS.md`, and managed tasks receive read-only role instructions plus a capped memory snapshot/digests without touching the leased worktree |
| Memory write enforcement | Partial | Agents edit files directly; `MemoryStore` caps and drift checks are not an MCP write gate yet |
| Persisted run model | Real | Runs, participants, phased tasks, events, artifacts, structured results, approvals, workspace leases and messages are stored atomically in app config; logical phase transitions commit as one save |
| Run journal cursor | Real | Events and messages carry one global monotonic `seq` (backfilled once by migration); `run:events` returns a cursor-paged chronological stream as the future SSE base |
| Command idempotency | Real, opt-in | Mutating run commands accept an optional `commandId`; a bounded command log replays the recorded successful outcome instead of re-executing |
| Sanitized run summaries | Real | `run:getSummary` projects runs without absolute paths, prompts, mailbox bodies or lease paths, for the Graph canvas and the future mobile DTO |
| Run reload/restart recovery | Real | Task/run status is reconstructed from the journal; interrupted processes fail, while an idle pending integration approval and its leases remain resumable |
| Graph topology | Real, run-scoped | A run references catalog agents and assigns run-local orchestrator/lead/worker roles without creating identities |
| Graph canvas | Real, multi-run | Every non-terminal run renders as its own cluster; edge/node activity is journal-driven (message `seq`, task transitions), a global panel shows the four task slots and per-run queues, the node inspector surfaces results/usage/provenance, and a selected failed run exposes its persisted technical reason directly in an accessible alert |
| Managed activity feed | Real, persisted | Claude stream-json and Codex JSONL render into one sanitized live feed in the movable/fullscreen task panel and append to bounded per-task `ACTIVITY.jsonl`; completed-task activity remains available through validated read-only IPC |
| Team pause | Real, main-owned | `run:pauseTeam`/`resumeTeam` journal `team.paused`/`team.resumed`; managed scheduling skips paused teams without cancelling running tasks; renderer `idleTeams` remains manual-dispatch-only |
| Graph task launch | Real, bounded | One-shot non-interactive task sessions, FIFO limit of four active CLIs, queue status and cancellation |
| Graph completion | Real, persisted signal | PTY start/exit/cancel events transition persisted tasks; success requires exit code 0 |
| CLI/auth diagnostics | Real, backend-aware | Read-only availability/version/auth/transport checks execute in the selected native or WSL backend; custom command text remains undisclosed and unexecuted |
| Keyboard navigation | Real | Roving terminal/view tabs plus create, close, previous/next and direct session shortcuts |
| Background notifications | Real | Native task completion/failure and abnormal interactive-exit notifications when ADE is unfocused |
| Renderer/IPC security | Real | Sandboxed, context-isolated renderer; default-deny CSP; navigation allowlist; exact sender and payload validation on every invoke |
| Worker decomposition | Real, managed-run beta | The planner returns schema-validated, participant-specific assignments with optional acyclic dependencies; the run scheduler enforces its own concurrency cap |
| Agent communication | Real, file fallback | Assignment/result messages are journaled and mirrored to per-run INBOX/OUTBOX JSONL under each agent memory directory |
| Structured runtime results | Real | Codex uses native JSONL plus output-schema/output-last-message; quote-safe stdin or a translated WSL prompt file carries task prompts without command-line interpolation; all managed adapters use the same result/file contract |
| Worktree ownership | Real | Clean workspaces are leased exclusively; runtimes cannot write linked-worktree Git metadata, while ADE commits only an exact reported/observed path-set match |
| Orchestrator behavior | Real, beta | Deterministic planning → worker edits/tests → ADE-owned commits → approval → transactional integration → integration review → read-only verification |
| Prompt/context observability | Real | Context builder v2 journals a path-free manifest plus per-task packets with bounded dependency results, role-instruction digest, model/reasoning and adapter provenance; the planner is told dependent workers inherit no upstream code |
| Run budgets | Real, adapter-dependent | Per-run worker concurrency, input/output tokens, USD cost and approval counts; exact telemetry is enforced at task-completion boundaries and missing values fail closed |
| Windows packaging | Real, unsigned by default | x64 assisted NSIS installer; release workflow signs when certificate secrets are configured |
| Linux/WSLg | Package-verified locally and hosted | Ubuntu/WSL2 native install/build, Linux-built node-pty, 409 focused checks, 47-check Electron/Playwright under Xvfb, Codex Sol/xhigh/bypass smoke, unpacked/AppImage/installed-Debian packaged workflows, valid metadata and uploaded SHA-256 artifacts; only versioned public release policy remains pending |
| Windows GUI → WSL | Real, explicit backend | UI discovers distributions and stores `wsl:<distribution>` per repository; canonical paths, Linux Git/files/worktrees, diagnostics, PTY, managed prompt/results, approval/integration and restart are proven by 31 backend plus 67 Electron checks |
| macOS | Prepared, unverified | POSIX runtime branches exist; native CI, Electron behavior, signing/notarization and packages remain unverified |
| Remote host API | Not built, bounded GO | Goal 6 permits starting Goal 7's disabled-by-default, loopback-only, transport-neutral control adapter; public remote exposure remains no-go until Goal 7's security gates pass |
| Mobile companion | Not built, planned | Goals 8-9 add a private-tailnet PWA for bounded task/run control, pairing, approvals and notifications; no raw terminal |
| Background host mode | Not built, planned | Goal 10 adds logged-in-user tray/startup operation and explicit online/offline health; no pre-login service or remote wake |
| Updates | Not built | No updater or release feed yet |
| CI and Electron E2E | Real locally and hosted | Windows passes 410 focused assertions plus 47 Electron checks; native Ubuntu passes 409 plus source/unpacked/AppImage/installed-Debian 47-check workflows; the first hosted CI and Linux package runs passed on `d32faa9`; Windows→WSL passes 31 backend and 67 extended Electron checks |

## Known constraints

- Worktree-binding cleanup is exposed but deliberately refuses active leases,
  live sessions and dirty worktrees; unmerged branches remain reachable.
  Repository-catalog deletion and bulk cleanup are not exposed. Agent/category
  deletion removes catalog references without deleting user files.
- Legacy Graph categories and `teamRole` fields are retained to avoid deleting
  user data, but new runs and the Graph renderer do not use them as ownership.
- The event journal, structured results, approvals, messages, artifacts and
  the new command log currently share the atomic JSON config. Long histories
  need indexed storage/retention before large-scale production use; parallel
  multi-run canvases increase this pressure.
- Team pause does not survive an ADE restart: restart recovery fails runs with
  queued tasks, so a paused run closes fail-closed instead of resuming paused.
  Restart-persistent pause is a separate work item.
- Task provenance (prompt/schema/adapter versions, manifest hash) lives in the
  journaled task-context artifact rather than directly on the task record.
  Restart restoration validates uniqueness, digest and version compatibility
  before reusing the persisted manifest and brief.
- Task transports are deterministic for supported non-interactive CLIs. Custom
  commands and Grok receive the prompt over stdin and depend on the command
  honoring stdin.
- Auth status is definitive for Claude and Codex. Other third-party CLIs that
  lack a stable non-interactive status command report an explicit warning;
  custom command text is never executed or returned by diagnostics.
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
- Dependency edges currently forward validated result/context data, not an
  upstream worker's Git state: every worker worktree starts from the run base.
  Goal 6 F3/F4 proved that a dependent worker which re-authors upstream files
  can produce divergent add/add or union commits that fail integration. Until
  worker-base/patch ownership is redesigned, planners must keep code-changing
  assignments independent or give one worker end-to-end ownership.
- Git integration requires each changing worker to report every changed path
  and leave HEAD untouched. ADE refuses a report/diff mismatch, creates the
  commit with hooks and signing disabled, and transactionally cherry-picks the
  validated linear ranges. Merge commits are rejected and a conflict aborts
  the whole sequence. The beta caps one worker range at 50 and one run
  integration at 200 commits.
- Plain-workspace runs keep the same plan/result/approval/verification control
  plane but can only reconcile reports; they do not claim git integration.
- There is currently no network listener, paired-device store, mobile build or
  remote ingress in ADE. Until the remote goals are implemented and verified,
  users must not expose Electron IPC or an ad-hoc local server through a router,
  LAN bind, Tailscale Funnel or public tunnel.
