# Remote workspace goals — 2026-09-08

Requested by the operator on the work PC after confirming delivery of the
mobile desktop-parity UI. Implement these goals in order; keep this checklist,
STATUS, ROADMAP, architecture/spec and HANDOFF aligned with measured evidence.
The umbrella Codex goal tracks the whole delivery, not just this plan.

## Goal 12 — authenticated ADE restart

- [x] Add a narrow remote administration contract through AdeApplicationService;
  keep REMOTE_COMMAND_CHANNELS and desktop filesystem/config/PTY channels closed.
- [x] Persist separate, desktop-granted device capabilities for restarting ADE,
  managing projects/agents and synchronizing Git. Existing devices retain only
  their existing rights. Enforce signatures, session/CSRF, idempotency and audit.
- [x] Show current host instance/readiness and restart blockers. Refuse restart
  while tasks, interactive processes or repository operations are active.
- [x] Restart the same ADE executable/profile gracefully with fixed local
  arguments, a durable receipt and duplicate/reconnect handling. Never reboot
  Windows, run caller-supplied commands or change Tailscale configuration.
- [x] Add a mobile confirmation, truthful progress/error states and explicit
  instance-change confirmation; retain pairing after reconnect.
- [x] Validate negative controls and real Electron relaunch/browser recovery.

The old home process cannot acquire this endpoint over the network. A one-time
local update/restart and device grant are required to activate it at home.

## Goal 13 — remote agent and workspace provisioning

- [x] Create independent agents from host-configured agent/template settings;
  accept bounded names and opaque source ids, never shell commands or secrets.
- [x] Create new native Git projects inside an ADE-owned project root and
  prepare isolated agent/repository worktrees using existing scope services.
  Existing catalog projects remain selectable. No arbitrary host paths.
- [x] Make creation durable/idempotent and validate unavailable templates,
  busy bindings, link containment and partial failures.
- [x] Provide accessible mobile forms, catalog refresh and positive workflows
  that create agents/projects/workspaces and then submit work to them.

## Goal 14 — remote Git comparison and synchronization

- [x] Project the existing repository sync service into bounded path-free DTOs:
  branch/HEAD, dirty/busy state, source freshness, ahead/behind and blockers.
- [x] Offer explicit Fetch and preview/confirmed fast-forward for the selected
  catalog repository and agent workspace. Revalidate source, binding, HEAD,
  clean state and leases immediately before mutation; coalesce retries.
- [x] Explain divergent/dirty/detached/busy states with useful recovery guidance.
  Preserve local work: no implicit stash/reset/merge, force push or unattended
  publishing. Remote integration approvals remain the separate Goal 9 contract.
- [x] Test real temporary Git repositories and the mobile user-visible flow.

## Goal 15 — parallel projects and agents

- [x] Add explicit project/agent filters to remote Work and Graph, show active
  work and global slots across projects, and preserve selection on updates.
- [x] Keep independent in-memory drafts per project/task mode, with explicit
  agent selection and clear busy-workspace feedback. Never persist prompts or
  queue commands for automatic offline execution.
- [x] Cover two projects and multiple agents with real domain/HTTP scheduling
  and deterministic runtime fixtures, plus phone/tablet keyboard/focus flows.
- [x] Complete pnpm verify on native Windows and record exact results. Other
  deployment models and physical-device acceptance remain unmeasured unless
  executed. Do not deploy to or interrupt the existing home host from fixtures.

## Delivery state

Goals 12–15 are implemented and verified. Final native Windows `pnpm verify` passed
all 1,717 checks, three TypeScript projects and the production build. Exact
evidence, intermediate failures and limits: `REMOTE_WORKSPACE_RESULTS.md`.
No new capability has been activated on either personal ADE profile.
Home activation still needs the new code, a
local build/restart and explicit desktop grants for the paired device.
