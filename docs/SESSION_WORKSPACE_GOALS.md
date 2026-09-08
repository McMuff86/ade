# Projectless workspaces and session launcher — Goals 20–21

Requested 2026-09-08; extend Goals 16–19 in this order. A workspace can be an
agent's own folder without a Git project. A session's launch choice must not
rewrite the saved agent profile.

## Goal 20 — own workspace without project

- [x] Explicit “Ohne Projekt” selection on the tablet, preserving the agent's
  configured native or WSL home; never substitute the first catalog project.
- [x] Bounded files/search/preview/edit and existing conflict/draft safeguards
  work in that home. Git tools are available only for a selected repository.
- [x] Open/attach/control a shell or configured agent in the same home;
  existing signed device grants, idempotency and input ownership still apply.
- [x] Reads never create directories. Explicit terminal launch may prepare the
  configured home; reject changed roots, links, secrets and managed leases.
- [x] Native Windows and Windows→WSL domain/browser/PTY evidence, with clear
  empty/error/loading states, keyboard/focus and phone/tablet layout coverage.

## Goal 21 — choose what each session starts

- [x] Common launch selection for desktop and tablet: empty shell, saved agent
  profile, Codex, Hermes and Ollama with a model available in that environment.
- [x] Detect supported commands and list installed Ollama models with bounded,
  read-only probes; preserve native/WSL scope and truthful unavailable states.
- [x] Main constructs fixed launch choices and validates model selection again.
  No client-supplied executable/path/argv, profile mutation or implicit download.
- [x] Session restart retains its own launch choice. Configured custom profiles
  remain available, including existing Hermes wrappers/profiles.
- [x] Focused positive/negative checks and real desktop/tablet launch flows.

## Delivery

- [x] Architecture/spec/status/roadmap/handoff and operator guide synchronized.
- [x] Full `pnpm verify` passes on the final source; record evidence and limits.
- [ ] Commit and push the verified delivery. Home-host update is an operator step.
