# ADE implementation status

Status date: 2026-07-12. This is the short, factual capability matrix. Product
intent lives in `SPEC.md`; sequencing and exit criteria live in `ROADMAP.md`.
Planned repository bindings and mobile boundaries are detailed in
`REPOSITORY_SCOPES_PLAN.md` and `REMOTE_CONTROL_PLAN.md`.

| Capability | State | Current behavior |
|---|---|---|
| Interactive terminals | Real | Main-owned ConPTY/node-pty sessions, xterm UI, resize, replay, theme, exit state and restart action |
| Session reload reconciliation | Real | Renderer rebuilds tabs from `pty:list`; sequence-aware output plus pending exit/removal reconciliation close both reload races |
| Session cleanup | Real | Tab close and agent/category deletion stop and remove owned PTYs; naturally exited sessions reap after 30 minutes |
| Named agents and categories | Real | Persisted JSON config, photos, runtime and permission settings |
| Git workspaces | Real, category-bound | Repo-backed category agents receive isolated worktrees and branches; reusable cross-repo bindings are not built yet |
| Repository scopes | Not built, planned | Goal 5 separates first-class repositories, optional agent defaults and immutable per-execution bindings |
| Reusable agents/templates | Not built, planned | Goal 5 adds portable agents and independent template spawning across repository bindings |
| Files and changes | Real, fixed agent path | Lazy tree, capped reads, polled Git status and capped unified diff; Goal 5 adds the visible binding/scope header |
| Memory read path | Real | `MEMORY.md` / `USER.md` are injected into runtime instruction files at launch |
| Memory write enforcement | Partial | Agents edit files directly; `MemoryStore` caps and drift checks are not an MCP write gate yet |
| Persisted run model | Real | Runs, participants, phased tasks, events, artifacts, structured results, approvals, workspace leases and messages are stored atomically in app config |
| Run reload/restart recovery | Real | Task/run status is reconstructed from the journal; interrupted processes fail, while an idle pending integration approval and its leases remain resumable |
| Graph topology | Real, run-scoped | A run references catalog agents and assigns run-local orchestrator/lead/worker roles without creating identities |
| Graph task launch | Real, bounded | One-shot non-interactive task sessions, FIFO limit of four active CLIs, queue status and cancellation |
| Graph completion | Real, persisted signal | PTY start/exit/cancel events transition persisted tasks; success requires exit code 0 |
| CLI/auth diagnostics | Real | Read-only availability/version checks; Claude/Codex auth status; Ollama service check; safe warnings for custom/unsupported probes |
| Keyboard navigation | Real | Roving terminal/view tabs plus create, close, previous/next and direct session shortcuts |
| Background notifications | Real | Native task completion/failure and abnormal interactive-exit notifications when ADE is unfocused |
| Renderer/IPC security | Real | Sandboxed, context-isolated renderer; default-deny CSP; navigation allowlist; exact sender and payload validation on every invoke |
| Worker decomposition | Real, managed-run beta | The planner returns schema-validated, participant-specific assignments with optional acyclic dependencies; the run scheduler enforces its own concurrency cap |
| Agent communication | Real, file fallback | Assignment/result messages are journaled and mirrored to per-run INBOX/OUTBOX JSONL under each agent memory directory |
| Structured runtime results | Real | Codex uses native JSONL plus output-schema/output-last-message; other non-shell runtimes use the same result schema through a file contract |
| Worktree ownership | Real | Clean workspaces are leased exclusively; runtimes cannot write linked-worktree Git metadata, while ADE commits only an exact reported/observed path-set match |
| Orchestrator behavior | Real, beta | Deterministic planning → worker edits/tests → ADE-owned commits → approval → transactional integration → integration review → read-only verification |
| Run budgets | Real, adapter-dependent | Per-run worker concurrency, input/output tokens, USD cost and approval counts; exact telemetry is enforced at task-completion boundaries and missing values fail closed |
| Windows packaging | Real, unsigned by default | x64 assisted NSIS installer; release workflow signs when certificate secrets are configured |
| Remote host API | Not built, planned | Goal 7 adds a disabled-by-default, loopback-only, transport-neutral control adapter after product validation |
| Mobile companion | Not built, planned | Goals 8-9 add a private-tailnet PWA for bounded task/run control, pairing, approvals and notifications; no raw terminal |
| Background host mode | Not built, planned | Goal 10 adds logged-in-user tray/startup operation and explicit online/offline health; no pre-login service or remote wake |
| Updates | Not built | No updater or release feed yet |
| CI and Electron E2E | Real | Windows CI runs 169 focused assertions plus a 32-check production Electron workflow and unpacked package validation |

## Known constraints

- Repository ownership is currently derived from category `repoPath`, and each
  agent has one resolved `workspaceDir`. Agent defaults, per-session/run scopes,
  cross-repository reuse, templates and the Files/Changes scope header remain
  planned; see `REPOSITORY_SCOPES_PLAN.md`.
- Legacy Graph categories and `teamRole` fields are retained to avoid deleting
  user data, but new runs and the Graph renderer do not use them as ownership.
- The event journal, structured results, approvals, messages and artifacts
  currently share the atomic JSON config. Long histories need indexed
  storage/retention before large-scale production use.
- Task transports are deterministic for supported non-interactive CLIs. Custom
  commands and Grok receive the prompt over stdin and depend on the command
  honoring stdin.
- Auth status is definitive for Claude and Codex. Other third-party CLIs that
  lack a stable non-interactive status command report an explicit warning;
  custom command text is never executed or returned by diagnostics.
- Windows packaging is x64-first. Local/branch artifacts are unsigned; the
  release workflow requires `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` to sign.
  Auto-update remains outside this milestone.
- The global task cap remains four CLIs; a managed run can choose a lower
  worker cap. Native Codex usage arrives with the final turn, so one task can
  overshoot a run token limit and concurrent tasks can consume tokens before a
  just-exceeded limit cancels their siblings. Provider-side account limits are
  still the ultimate real-time spend boundary.
- Codex reports token usage in native JSONL but no billed USD. Cost budgets are
  therefore unavailable for that adapter until the CLI/provider reports cost;
  custom wrappers may supply trusted token/cost fields through the file result.
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
