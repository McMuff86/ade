# ADE remote control and mobile companion plan

Scope update, 2026-09-08: the operator explicitly authorized Goals 12–19.
Goals 12–15 add narrow restart, catalog/workspace creation and Git-sync APIs;
Goals 16–19 add bounded files/diffs/edits, an explicitly granted interactive
terminal and narrow profile/photo maintenance. Their current binding contracts
and limits are in `SPEC.md`, `ARCHITECTURE.md`, `REMOTE_WORKSPACE_GOALS.md` and
`REMOTE_WORKBENCH_GOALS.md`. Those additions extend the historical exclusions
below through dedicated application APIs; raw IPC, runtime configuration and
unrestricted filesystem endpoints remain excluded. All execution stays on the
desktop. New device grants are never inherited from pairing or Tailscale.

Status: Goal 7 includes read endpoints, signed commands, SSE and bounded single-task
submission (2026-09-06). Goal 8 step 1 adds durable revocable device inventory,
desktop rename/revoke controls and a fsynced remote audit. Goal 8.2–8.4 now add
desktop QR pairing, browser sessions, private Tailscale setup and the mobile PWA
(2026-09-08). Close-to-tray is the first Goal 10 slice. Physical device/network
acceptance is tracked in `goal8/MOBILE_CONNECT_RESULTS.md`. The
delivery order and exit criteria are tracked in `ROADMAP.md`; the wire
contract lives in `ARCHITECTURE.md` ("ADE host API").

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

ADE's separately implemented local verified-publishing flow does not change
this contract. Only the trusted desktop UI may preview and explicitly confirm a
new `ade/**` branch plus Draft PR; no publication operation, credential or PR
mutation is included in the remote endpoint allowlist.

## Application boundary

Electron IPC and the remote HTTP adapter share one transport-neutral
application service (`AdeApplicationService`) for path-free health, catalog,
run-summary and journal projections and for the remote commands. The HTTP
server never proxies arbitrary IPC channel names: the channel policy
(`ipcPolicy.ts`) names which channels are `shared`, and every shared channel
carries the remote scope, proof and idempotency requirement the service
enforces before a command runs.

The legacy environment listener is disabled unless `ADE_HOST_API_ENABLED=1`; enabled
startup also requires a non-logged `ADE_HOST_API_TOKEN` of 32-128 URL-safe
ASCII characters and accepts an optional bounded `ADE_HOST_API_PORT` (default
`4317`). Its bind address is not configurable and is always `127.0.0.1`. The
token is an outer gate; every production read, SSE connection and command also
requires a signature from an active stored device. The old
`ADE_HOST_API_COMMAND_DEVICE=<id>:<secret>` is imported exactly once into the
encrypted host-local device store. ADE removes both variables from `process.env`
after startup so agent subprocesses cannot inherit them. Revocation survives
restart and stale bootstrap values. GET proofs sign the full request target,
an empty key field and the empty-body digest; POST proofs are unchanged.
This legacy environment mode is separate from Settings → Mobiler Zugriff,
which enables the signed session/cookie browser mode and private Serve route.
Storage, audit bounds, pairing/session details and revocation semantics are
specified in `ARCHITECTURE.md` under "Desktop device inventory and durable audit".

The first remote contract is intentionally small:

| Operation | Purpose |
|---|---|
| `GET /api/v1/health` | **Implemented:** API version, readiness, queue summary, whether commands are enabled |
| `GET /api/v1/catalog` | **Implemented:** sanitized projects and agents without paths/commands/secrets |
| `GET /api/v1/runs` | **Implemented:** mobile-safe orchestration summaries |
| `POST /api/v1/tasks` | **Implemented:** submit one bounded task with explicit `agentId`/`repositoryId`/`prompt`; reply is the wrapping run summary plus `taskId`, progress over `/events` |
| `POST /api/v1/runs` | **Implemented:** create a managed run draft from explicit `repositoryId`/`agentIds` |
| `POST /api/v1/runs/{id}/start` | **Implemented:** start a draft exactly once (managed runs only) |
| `POST /api/v1/runs/{id}/cancel` | **Implemented:** cancel active/queued work for that run, including a single-task run |
| `GET /api/v1/events` | **Implemented:** resumable server-sent event stream over the journal `seq` |
| `GET /api/v1/host` | Goal 12: signed instance/version/readiness and granted administrative capabilities |
| `POST /api/v1/host/restart` | Goal 12: explicitly granted, idle-only ADE relaunch with durable receipt |
| `POST /api/v1/admin/commands` | Goals 13–14: bounded agent/project/workspace provisioning or Fetch/confirmed Git update, explicit scoped operation union |
| `POST /api/v1/admin/git` | Goal 14: native repository comparison/preview; no arbitrary paths or Git argv |

Approval resolution is added only in Goal 9. Every run/task mutation carries an
`Idempotency-Key`; it is bound to the command and payload digest, so replaying
the same key returns the original outcome, a concurrent duplicate coalesces,
and the same key with another payload is rejected — a retry never launches
duplicate work. Events carry the journal's monotonic `seq` as SSE `id`, so a
client resumes with `Last-Event-ID` after switching networks or returning from
the background and receives a bundled snapshot only when its cursor is unusable.

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
- Device listing, renaming and immediate revocation are implemented in desktop
  Settings. Revocation terminates device HTTP/SSE access; already accepted runs
  continue under ADE and can be cancelled separately from the desktop.
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

That completed Goal 6 pilot remains historical evidence. Ongoing
operator-driven product and general-use validation uses RhinoClaw as the
preferred real repository through disposable ADE worktrees/branches, while
deterministic automated workflows retain synthetic fixture repositories. The
same no-working-tree/no-main/no-push rule below applies, and RhinoClaw's
deployed skill or live Rhino installation requires separate approval as well.

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
