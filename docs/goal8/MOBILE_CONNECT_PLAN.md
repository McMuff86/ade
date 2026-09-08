# Goals for reliable tablet and phone access

Status: Goals 8.2–8.4 and close-to-tray implemented, 2026-09-08. Builds on the
Git sync and durable device inventory slices, delivered together with their
existing changes preserved. Goal 8.5 has automated Windows/browser and real private HTTPS evidence;
physical-device/carrier acceptance remains open. See `MOBILE_CONNECT_RESULTS.md`.

## Goal 8.2 — trusted pairing and browser authentication

- Start a five-minute, single-use pairing challenge in desktop Settings.
- Display a QR link and a copyable/manual alternative; no reusable secret in URLs.
- Keep browser signing keys non-exportable in IndexedDB, host keys OS-encrypted.
- Require short-lived Secure/HttpOnly/SameSite=Strict sessions, exact origin,
  CSRF and device-signed, idempotent commands. Bound pairing/authentication rates.
- Revoke immediately, including open streams; audit before effects.

## Goal 8.3 — private Tailscale connection from ADE

- Discover the native host's Tailscale state with bounded, fixed-argument CLI calls.
- Desktop opt-in starts the loopback listener and an HTTPS Serve proxy.
- Preserve unrelated Serve configuration; refuse Funnel and conflicting routes.
- Show readiness, address, retry and disable controls; persist explicit opt-in.
  Distinguish a configured proxy from independently verified HTTPS reachability.
- Diagnose logout, missing CLI, HTTPS setup, offline host and route changes.

## Goal 8.4 — responsive mobile companion

- Installable PWA, independent from the Electron renderer and preload bridge.
- Pair, select repository/agent, submit a task, create/start a managed run,
  inspect sanitized run/task state, cancel, disconnect and reconnect. Detailed
  reports and approval evidence stay on the desktop until Goal 9.
- Touch-sized controls, keyboard/focus support and useful empty/error states.
- Resume authoritative events after network/background changes. Retries keep
  their idempotency key; offline operation never queues work implicitly.
- Service worker caches only the public application shell, never API data.

## Goal 8.5 — executable connection evidence

- Protocol negatives: unpaired/revoked device, wrong origin/host, expired/reused
  pairing, missing session/CSRF/signature, duplicate commands and audit failures.
- Real browser workflow at phone and tablet sizes, reload/offline/reconnect,
  desktop pairing/revoke, app shell cache inspection and final positive controls.
- Run `pnpm verify`, then probe this PC's actual Tailscale HTTPS route.
- Physical iOS/Android and cellular-network acceptance requires the user's
  devices. Record measured evidence separately from automation and open gates.

## Next goals

- Goal 10 next: opt-in start-at-login, explicit sleep/offline state and tested
  Windows restart recovery. Close-to-tray is already implemented. This improves
  daily access without depending on remote approval features.
- Goal 9: bounded run reports/approval evidence, passkey step-up before approval,
  audit review and opt-in completion notifications.
- Goal 11: bounded audit maintenance/recovery, authenticated updates and measured
  multi-device/browser reliability before expanding the remote trust boundary.

No public tunnel, remote terminal, Git publishing or remote configuration is
part of these goals. Platform evidence must distinguish native Windows,
native Linux/WSLg, Windows UI with WSL execution, and macOS.
