# ADE implementation status

Status date: 2026-07-11. This is the short, factual capability matrix. Product
intent lives in `SPEC.md`; sequencing and exit criteria live in `ROADMAP.md`.

| Capability | State | Current behavior |
|---|---|---|
| Interactive terminals | Real | Main-owned ConPTY/node-pty sessions, xterm UI, resize, replay, theme, exit state and restart action |
| Session reload reconciliation | Real | Renderer rebuilds tabs from `pty:list`; sequence-aware output plus pending exit/removal reconciliation close both reload races |
| Session cleanup | Real | Tab close and agent/category deletion stop and remove owned PTYs; naturally exited sessions reap after 30 minutes |
| Named agents and categories | Real | Persisted JSON config, photos, runtime and permission settings |
| Git workspaces | Real | Repo-backed agents receive isolated worktrees and branches |
| Files and changes | Real | Lazy tree, capped reads, polled Git status, capped unified diff |
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
| Worktree ownership | Real | Clean workspaces are leased exclusively for the run; repo participants must share one git common directory; restart recovery fails work and releases orphaned leases |
| Orchestrator behavior | Real, beta | Deterministic planning → worker scheduling → approval → transactional integration → integration review → read-only verification |
| Run budgets | Real, adapter-dependent | Per-run worker concurrency, input/output tokens, USD cost and approval counts; telemetry-backed limits fail closed rather than estimating missing values |
| Windows packaging | Real, unsigned by default | x64 assisted NSIS installer; release workflow signs when certificate secrets are configured |
| Updates | Not built | No updater or release feed yet |
| CI and Electron E2E | Real | Windows CI runs 165 focused assertions plus a 30-check production Electron workflow and unpacked package validation |

## Known constraints

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
  worker cap. Concurrent tasks can consume telemetry before a just-exceeded
  token/cost limit cancels their siblings, so provider-side account limits are
  still the ultimate spend boundary.
- Codex reports token usage in native JSONL but no billed USD. Cost budgets are
  therefore unavailable for that adapter until the CLI/provider reports cost;
  custom wrappers may supply trusted token/cost fields through the file result.
- Git integration requires each changing worker to leave a clean worktree and
  report a descendant commit. ADE validates and transactionally cherry-picks
  the full linear range from the leased base; merge commits are rejected and a
  conflict aborts the whole sequence. The beta caps one worker range at 50 and
  one run integration at 200 commits.
- Plain-workspace runs keep the same plan/result/approval/verification control
  plane but can only reconcile reports; they do not claim git integration.
