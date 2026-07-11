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
| Persisted run model | Real | Runs, participants, tasks, events, and artifacts are stored atomically in app config |
| Run reload/restart recovery | Real | Task/run status is reconstructed from the event journal; interrupted work is failed on restart |
| Graph topology | Real, run-scoped | A run references catalog agents and assigns run-local orchestrator/lead/worker roles without creating identities |
| Graph task launch | Real, bounded | One-shot non-interactive task sessions, FIFO limit of four active CLIs, queue status and cancellation |
| Graph completion | Real, persisted signal | PTY start/exit/cancel events transition persisted tasks; success requires exit code 0 |
| CLI/auth diagnostics | Real | Read-only availability/version checks; Claude/Codex auth status; Ollama service check; safe warnings for custom/unsupported probes |
| Keyboard navigation | Real | Roving terminal/view tabs plus create, close, previous/next and direct session shortcuts |
| Background notifications | Real | Native task completion/failure and abnormal interactive-exit notifications when ADE is unfocused |
| Renderer/IPC security | Real | Sandboxed, context-isolated renderer; default-deny CSP; navigation allowlist; exact sender and payload validation on every invoke |
| Worker decomposition | Not built | Opt-in fan-out still gives every worker the same task |
| Agent communication | Not built | No shared task list, mailbox, result or artifact protocol |
| Orchestrator behavior | Not built | The orchestrator node does not plan, assign, verify, or integrate work |
| Windows packaging | Real, unsigned by default | x64 assisted NSIS installer; release workflow signs when certificate secrets are configured |
| Updates | Not built | No updater or release feed yet |
| CI and Electron E2E | Real | Windows CI runs 122 focused assertions, production Electron workflow, and unpacked package validation |

## Known constraints

- Legacy Graph categories and `teamRole` fields are retained to avoid deleting
  user data, but new runs and the Graph renderer do not use them as ownership.
- The event journal and artifacts currently share the atomic JSON config. Long
  histories need indexed storage/retention before large-scale production use.
- Task transports are deterministic for supported non-interactive CLIs. Custom
  commands and Grok receive the prompt over stdin and depend on the command
  honoring stdin.
- Auth status is definitive for Claude and Codex. Other third-party CLIs that
  lack a stable non-interactive status command report an explicit warning;
  custom command text is never executed or returned by diagnostics.
- Windows packaging is x64-first. Local/branch artifacts are unsigned; the
  release workflow requires `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` to sign.
  Auto-update remains outside this milestone.
- The active task cap controls CLI processes, not provider token or monetary
  budgets. Provider-level budgets belong in the orchestration milestone.
