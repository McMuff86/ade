# ADE remote control and mobile companion plan

Status: planned, 2026-07-12. No remote listener or mobile client is implemented
yet. The delivery order and exit criteria are tracked in `ROADMAP.md`.

## Decision

ADE will treat the smartphone as a narrow control plane, not as a second
execution environment. Agent CLIs, credentials, repositories, worktrees, PTYs,
integration and verification stay on the user's desktop. The first mobile
client will be an installable responsive PWA rather than a native iOS or
Android application.

The personal alpha will be reachable through Tailscale Serve over a private
tailnet. The ADE host will listen only on loopback and will not open a LAN or
public router port. Tailscale is an outer network and identity boundary; ADE
will still pair, authorize, audit and revoke its own remote devices.

The target flow is:

```text
Mobile PWA
  | HTTPS commands + server-sent events
  v
Tailscale Serve and ADE device authorization
  | proxy to loopback only
  v
ADE Host API
  | transport-neutral commands and events
  v
ADE Core -> RunCoordinator -> PTYs/runtime adapters -> worktrees
```

The desktop must be powered on, logged in, online and running the ADE host.
Remote wake and execution before user logon are not part of the alpha.

## Product scope

The mobile client may:

- show whether the desktop host and configured task runtimes are ready;
- list a sanitized catalog of projects and agents;
- select a repository independently from a specialized, portable or
  template-spawned agent;
- list active and historical runs with tasks, usage, results and approvals;
- submit one bounded task to a selected agent;
- create and start a managed multi-agent run with a goal, roster and budget;
- observe authoritative run events and reconnect without inventing state;
- cancel a run; and
- in a later milestone, resolve an integration approval after step-up
  authentication and review of its evidence.

The personal alpha will not expose:

- interactive PTY creation, terminal output or terminal input;
- arbitrary command execution or custom runtime command text;
- configuration, permission-mode, identity or workspace mutation;
- category/agent/run deletion;
- unrestricted filesystem reads, absolute host paths or credential material;
- automatic approval, push, deploy or changes to a repository's main branch.

These exclusions keep a stolen mobile session from becoming a general remote
shell or an ADE administration channel.

## Application boundary

Electron IPC is currently the only adapter into ADE's services. Goal 7 will
introduce a transport-neutral application boundary that owns command
authorization, payload validation and event publication. Electron IPC and the
remote HTTP adapter will call the same boundary; the HTTP server must never
proxy arbitrary IPC channel names.

The first remote contract is intentionally small:

| Operation | Purpose |
|---|---|
| `GET /api/v1/health` | Host version, readiness and queue summary |
| `GET /api/v1/catalog` | Sanitized projects, agents and runtime readiness |
| `GET /api/v1/runs` | Mobile-safe orchestration snapshot |
| `POST /api/v1/tasks` | Submit one bounded task with explicit agent/repo scope |
| `POST /api/v1/runs` | Create a managed run draft |
| `POST /api/v1/runs/{id}/start` | Start a draft once |
| `POST /api/v1/runs/{id}/cancel` | Cancel active/queued work for that run |
| `GET /api/v1/events` | Resumable server-sent event stream |

Approval resolution is added only in Goal 9. Every mutating request carries an
idempotency key. Replaying the same key must return the original outcome rather
than launch duplicate work. Events carry a monotonic cursor so a client can
resume after switching networks or returning from the background.

The mobile DTO is separate from `AdeConfig` and `OrchestrationSnapshot`. It
includes only fields required by the mobile workflow and never inherits new
desktop-only fields accidentally.

## Security requirements

- The host is disabled by default, binds to `127.0.0.1` only and accepts the
  configured HTTPS proxy origin and host name only.
- Tailscale Serve, not Funnel, is the supported personal-alpha ingress. Direct
  LAN and public binds fail closed.
- Pairing begins on the trusted desktop with a short-lived, single-use QR
  challenge. A paired device receives its own revocable identity; secrets are
  never embedded in a reusable pairing URL.
- Sessions are short-lived, rotated after authentication changes and stored in
  cookies with `Secure`, `HttpOnly` and `SameSite=Strict`. Mutations require
  CSRF protection and exact Origin validation.
- High-risk approval requires recent passkey/device reauthentication. A normal
  remembered session is insufficient.
- Authorization is checked per endpoint and per run. All payloads use exact
  runtime schemas, bounded strings/arrays and explicit content types.
- Rate limits, request-size limits and bounded event backlogs protect the
  desktop process. Remote errors never echo command text, paths or credentials.
- Every mutation records time, device, actor identity, request id, target,
  outcome and denial reason in an append-only audit record.
- Device listing and immediate revocation are available from the desktop.
- The PWA service worker caches the versioned application shell only. API
  responses, run details, patches and credentials are not available offline.
- Mobile CSP, dependency review, API security tests and an unauthorized-device
  Electron/host workflow are release gates.

## Mobile experience

The alpha has four small views:

1. **Host** - online/offline, ADE version, queue occupancy and runtime readiness.
2. **New task** - project, single-agent/managed mode, goal, roster and budgets.
3. **Runs** - phase, participants, tasks, usage, events, results and cancel.
4. **Devices** - current device identity and a link back to desktop revocation.

A later approval view shows the exact changed-file set, tests, risks, commit
SHAs and a size-capped diff before enabling approve/reject. Push notifications
are limited to completion, failure and approval-required events. An offline
client clearly shows stale state and cannot queue a command locally for later
implicit execution.

## Validation before remote implementation

Goal 5 first separates reusable agents from immutable repository execution
scopes as specified in `REPOSITORY_SCOPES_PLAN.md`. Goal 6 then validates the
resulting model and orchestration beta on the `2D_rpg_jumpnrun` repository
before adding a network control surface.

- Define 6-10 representative tasks across isolated bug fixes, tests, a
  cross-file feature, refactoring and genuinely parallel work.
- Run suitable tasks once with a single agent and once as a managed run.
- Use disposable ADE worktrees/branches; preserve the repository's working
  tree and never push or update its main branch without separate approval.
- Record completion, verification, elapsed time, token usage, conflicts,
  integration attempts and human interventions.
- Treat any silent diff mismatch, history mutation, lost user change,
  unauthorized integration or false-success status as a release blocker.

Goal 6 ends with an explicit go/no-go decision for remote execution. Mobile
work may proceed only if ADE can safely and usefully finish representative
local runs first.

## Delivery sequence

1. **Goal 5 - repository scopes:** first-class repos, portable/default agents,
   immutable bindings, Files/Changes scope UI and independent templates.
2. **Goal 6 - product validation:** real-repository single/multi-agent study.
3. **Goal 7 - ADE Core and local host API:** shared command boundary, mobile
   DTOs, idempotency, event cursors and loopback-only integration tests.
4. **Goal 8 - personal mobile alpha:** PWA, Tailscale Serve setup, QR pairing,
   revocation/audit, task/run submission, observation and cancellation.
5. **Goal 9 - approvals and notifications:** step-up approval, bounded evidence,
   Web Push and approval-aware audit inspection.
6. **Goal 10 - host availability:** tray/headless mode after login, optional
   startup, run-aware wake lock, health reporting and restart recovery.
7. **Goal 11 - product hardening:** indexed history/retention, signed updates
   and an optional identity-aware outbound tunnel or hosted relay.

Goals 7-10 target a personal, single-owner deployment. Accounts, multi-user
authorization, native mobile packages and a hosted relay require separate
product validation and threat modeling in Goal 11.

## Deferred alternatives

- Remote desktop can validate the use case informally but is not the product
  architecture because it exposes the entire desktop and has poor mobile UX.
- Cloudflare Tunnel plus Access is a later alternative for users who do not
  want a tailnet client. It adds a public hostname, identity provider and token
  validation surface and is therefore not the first personal alpha.
- A native mobile app is deferred until the PWA workflow demonstrates missing
  platform capabilities that justify two additional release pipelines.
- Raw terminal streaming, public port forwarding, Tailscale Funnel, unattended
  pre-login execution and Wake-on-LAN are explicitly outside Goals 7-10.

## References

- Tailscale Serve: <https://tailscale.com/docs/features/tailscale-serve>
- Cloudflare Tunnel: <https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/>
- Cloudflare Access for self-hosted apps: <https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/>
- PWA installation: <https://web.dev/learn/pwa/installation>
- Web Push on iOS/iPadOS: <https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/>
- OWASP REST Security: <https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html>
- OWASP Session Management: <https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html>
- ADE repository scopes: `REPOSITORY_SCOPES_PLAN.md`
