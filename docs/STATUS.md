# ADE implementation status

Status date: 2026-07-10. This is the short, factual capability matrix. Product
intent lives in `SPEC.md`; sequencing and exit criteria live in `ROADMAP.md`.

| Capability | State | Current behavior |
|---|---|---|
| Interactive terminals | Real | Main-owned ConPTY/node-pty sessions, xterm UI, resize, replay, theme |
| Session reload reconciliation | Real | Renderer rebuilds tabs from `pty:list`; sequence-aware attach closes the replay/live race |
| Session cleanup | Real | Tab close and agent/category deletion stop and remove owned PTYs; naturally exited sessions reap after 30 minutes |
| Named agents and categories | Real | Persisted JSON config, photos, runtime and permission settings |
| Git workspaces | Real | Repo-backed agents receive isolated worktrees and branches |
| Files and changes | Real | Lazy tree, capped reads, polled Git status, capped unified diff |
| Memory read path | Real | `MEMORY.md` / `USER.md` are injected into runtime instruction files at launch |
| Memory write enforcement | Partial | Agents edit files directly; `MemoryStore` caps and drift checks are not an MCP write gate yet |
| Graph task launch | Real, bounded | One-shot non-interactive task sessions, FIFO limit of four active CLIs, queue status and cancellation |
| Graph completion | Real process signal | Success is exit code 0; cancellation/failure is not presented as done |
| Worker decomposition | Not built | Opt-in fan-out still gives every worker the same task |
| Agent communication | Not built | No shared task list, mailbox, result or artifact protocol |
| Orchestrator behavior | Not built | The orchestrator node does not plan, assign, verify, or integrate work |
| Packaging and updates | Not built | Development/build commands only; no signed installer or updater |
| CI and broad E2E | Not built | Focused scripts exist; Electron workflow coverage remains limited |

## Known constraints

- Graph `teamRole` is persisted on agents and teams are categories. This is an
  expedient MVP model, not the intended run-scoped orchestration model.
- Task transports are deterministic for supported non-interactive CLIs. Custom
  commands and Grok receive the prompt over stdin and depend on the command
  honoring stdin.
- The active task cap controls CLI processes, not provider token or monetary
  budgets. Provider-level budgets belong in the orchestration milestone.
