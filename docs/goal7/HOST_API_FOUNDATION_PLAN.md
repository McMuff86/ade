# Goal 7 — Host API foundation implementation plan

Status: implemented and locally verified on 2026-07-26 on branch
`feat/goal7-host-api-foundation`. This slice is the first bounded step toward the
tablet companion described in
`REMOTE_CONTROL_PLAN.md`; it does not expose ADE through Tailscale yet and it
does not add remote mutations.

## Objective

Introduce one transport-neutral application boundary and a disabled-by-default,
loopback-only HTTP adapter that can return mobile-safe health, catalog and run
snapshots. Electron IPC and HTTP must share the same run-summary projection so
transport adapters cannot drift into separate orchestration semantics.

## Slice contract

### Production startup

- The host API is disabled unless `ADE_HOST_API_ENABLED=1` is explicitly set.
- An enabled listener also requires `ADE_HOST_API_TOKEN` with 32-128 URL-safe
  ASCII characters; missing or malformed authorization fails closed before
  `listen`. ADE consumes the token at startup and removes it from `process.env`
  before launching agent processes. Operational setup must still generate this
  material randomly.
- The production adapter always binds `127.0.0.1`; no environment variable or
  caller can select a LAN/public address.
- `ADE_HOST_API_PORT` may select a valid user port. The bounded development
  default is `4317`.
- The token is never returned, persisted in ADE config or written to logs.

### Read-only v1 endpoints

- `GET /api/v1/health`
- `GET /api/v1/catalog`
- `GET /api/v1/runs`

Every request requires exact Bearer-token authorization. Unknown methods,
paths, host headers and malformed authorization fail closed. Responses use
bounded JSON, `Cache-Control: no-store`, no CORS allowance and defensive
content-type/security headers.

### Mobile-safe DTO boundary

The catalog projection may include stable IDs, display names, runtime/backend
labels, repository verification and default-repository relationships. It must
not include:

- repository roots or Git metadata paths;
- workspace or memory directories;
- dashboard URLs/commands;
- custom launch commands;
- prompts, mailbox text, artifacts or credentials.

Run responses reuse `OrchestrationService.summarize`, which already excludes
absolute paths, prompts, mailbox bodies, artifact contents, lease paths and
raw task errors.

## Tasks

1. Add focused tests for disabled/default configuration and fail-closed enabled
   configuration.
2. Add focused tests for the transport-neutral health/catalog/run projections,
   including explicit checks that serialized output contains no host paths,
   commands or secrets.
3. Add an in-process HTTP integration test proving loopback bind, Bearer auth,
   exact endpoints, method/path/Host rejection and response headers.
4. Implement the minimal application service and HTTP adapter needed to pass
   those tests.
5. Route Electron `run:getSummary` through the same application service.
6. Start/stop the adapter with the Electron main lifecycle only when explicitly
   enabled.
7. Synchronize `ARCHITECTURE.md`, `STATUS.md`, `ROADMAP.md`,
   `REMOTE_CONTROL_PLAN.md` and `HANDOFF.md` with the implemented boundary and
   its deliberate limitations.
8. Run the focused host-API suite, relevant orchestration/security suites,
   typecheck and production build. Run the full focused suite if the targeted
   gates pass.

## Explicit non-goals

- Tailscale Serve configuration or any public/LAN listener.
- PWA assets, QR pairing, cookies, CSRF or device persistence.
- SSE/live event streaming.
- Creating, starting, cancelling or approving tasks/runs over HTTP.
- Raw PTY, filesystem, configuration, publication or repository-write access.
- Background/tray/startup host operation.

## Next slices

1. Authenticated resumable SSE over the existing monotonic journal cursor.
2. Persisted device pairing/revocation and a private-tailnet PWA shell.
3. Idempotent task/run create, start and cancel commands through the shared
   application boundary.
4. Step-up-authenticated approval review.
5. Logged-in-user background host mode and recovery.

## Verification evidence

- `pnpm test`: passed on the final diff, including 30 host-API checks.
- `pnpm run typecheck`: passed for node and web TypeScript projects.
- `pnpm run build`: passed for main, preload and renderer bundles.
- `git diff --check`: passed.
- Port `4317` was confirmed to have no listener after the test run.

The host-API checks include malformed absolute request targets, response-size
fencing, redacted application failures and concurrent start/stop lifecycle
coverage in addition to the slice contract above.
