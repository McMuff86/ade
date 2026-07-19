# ADE engineering instructions

## Repository map

- `src/main`: Electron main process, filesystem/Git/runtime boundaries, orchestration.
- `src/preload`: the narrow context-isolated bridge.
- `src/renderer`: React UI and interaction design.
- `src/shared`: main/preload/renderer contracts and runtime profiles.
- `scripts`: executable unit, integration, security, Electron/Playwright, and Goal 6 drivers.
- `docs`: architecture, current status, roadmap, handoff, platform plans, and validation evidence.

## Definition of done

- Inspect the nearest existing conventions before editing and preserve unrelated user changes.
- Keep code and documentation synchronized in the same change. Update architecture/spec for contracts, status/roadmap for current support, and handoff/results for operator state.
- Add or update focused tests for every behavioral contract. Run the focused check while iterating.
- Before claiming repository-wide completion, run `pnpm verify`: both TypeScript projects, all focused suites, production build, and real Electron/Playwright automation.
- Treat expected-failure negative controls as successful evidence only when they fail for the intended reason and the final positive control passes.
- Never claim a runtime, model, platform, packaging target, or UI flow is supported without executable evidence.

## Agent/runtime policy

- Goal 6 fixtures are Codex-only measurements. The operator driver must fail closed unless every selected identity uses the native Codex adapter, the pinned model, the required reasoning level, bypass mode, and a durable `AGENTS.md`.
- Managed tasks work only in their leased workspace. When the task contract says ADE owns Git metadata, agents must not add, commit, reset, checkout, rebase, merge, or push.
- Keep role guidance outside leased repositories and pass it through the managed task context so worktrees remain clean.

## Product quality

- Preserve Electron sandboxing, context isolation, strict IPC validation, bounded artifacts, truthful telemetry, and fail-closed integration.
- UI changes must include keyboard/focus/accessibility behavior, useful empty/error/loading states, responsive layout, and Playwright coverage for the user-visible flow.
- Platform work must distinguish native Windows, native Linux/WSLg, Windows UI with a WSL backend, and macOS; do not blur those deployment models.
