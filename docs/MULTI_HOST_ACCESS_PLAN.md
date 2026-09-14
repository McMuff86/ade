# ADE multi-host access plan (proposed Goals 28–30)

Status: proposed 2026-09-13, not yet authorized by the operator. Nothing in
this document changes the current contract in `SPEC.md`, `ARCHITECTURE.md` or
`REMOTE_CONTROL_PLAN.md`. Operator request: reach the own desktop while away,
reach a second PC after its owner confirms or hands over a code, and keep a
durable SSH-like path for hosts that are used again and again.

Numbering corrected on 2026-09-15: the original proposed 20/21/22 labels
collided with delivered session-workspace Goals 20/21. This proposal now uses
28/29/30; its scope and authorization status are unchanged. See the
[goal registry](GOAL_REGISTRY.md).

## Decision

ADE stays a narrow control plane per host. It does not become a Parsec or
TeamViewer replacement: no screen capture, video streaming, mouse/keyboard
injection, hosted relay or public ingress. Pixel-level remote desktop stays an
external tool (RDP, Parsec, RustDesk) that runs over the same private tailnet;
ADE may only launch it.

Three bounded additions cover the request:

| Goal | Adds | Reuses |
|---|---|---|
| 28 | Host directory and host switching on desktop and PWA, optional remote-desktop launcher | `GET /api/v1/host` identity, Tailscale Serve origin, existing PWA per host |
| 29 | Access request approved on the target host: one-time session grant or durable device grant | QR pairing challenge, `RemoteDeviceStore`, admin scopes, resource access, revocation, audit |
| 30 | SSH terminal preset per host | Free terminals, PTY sessions, `SessionLaunchChoice`, `terminal:control` grant |

Execution, credentials, repositories and worktrees stay on the host that owns
them. A client never runs an agent for another host locally.

## Current baseline

- Each ADE desktop can run one loopback-only host behind Tailscale Serve.
- A client (PWA) is served by exactly one host and talks only to that origin;
  CSRF uses exact Origin validation.
- Pairing starts at the desktop with a single-use QR challenge and code. A
  paired device is durable until revoked; scopes and repository/agent access
  are granted only in desktop Settings.
- `RemoteDeviceInfo` has no expiry; `activeDevices()` filters revocation only.
- Free terminals exist on desktop and mobile; launch choices are shell and
  fixed agent CLIs. No SSH choice, no host list.

## Goal 28 - host directory and switching

Model (client-side, path-free):

```text
KnownHost {
  id: string            // instance id from GET /api/v1/host, verified on connect
  name: string          // operator label, e.g. "Büro-PC"
  origin: string        // https://<machine>.<tailnet>.ts.net[:port], exact
  lastSeen: number | null
  pairing: 'unknown' | 'paired' | 'revoked' | 'expired'
  remoteDesktop?: { kind: 'rdp'; target: string } | { kind: 'url'; url: string }
  ssh?: { target: string }   // Goal 30, e.g. adi@buero-pc
}
```

- Desktop stores known hosts in the userData JSON store; the PWA stores them
  per installed origin. Entries carry no secrets; device credentials stay in
  each host's own encrypted store as today.
- Switching does not cross origins. Selecting a host opens that host's own
  served PWA: on the desktop in a dedicated `BrowserWindow` with an isolated
  session partition per host, on the PWA as a navigation to the other origin.
  This keeps exact-Origin CSRF, cookies and CSP unchanged and needs no CORS.
- The host identity returned by `GET /api/v1/host` is pinned on first contact;
  a changed identity for a known origin is shown as a warning, never merged.
- Optional launcher "Desktop-Fernsteuerung öffnen": `rdp` runs the system
  client with the stored target only (`mstsc /v:<target>` on Windows); `url`
  allows `parsec:`, `rustdesk:` and `https:` schemes only, via
  `shell.openExternal`. ADE never stores remote-desktop passwords.
- A unified client that talks to several origins from one page is deferred
  until a concrete UX need justifies CORS relaxation and per-origin session
  handling.

## Goal 29 - access request with session or device grant

Today pairing can only start on the target desktop. Goal 29 adds the inverse
flow so a client that already knows a host origin can ask for access while the
host owner decides on the host screen.

Flow:

```text
Client                              Target host desktop
  | POST /api/v1/access/requests      |
  |  { requesterName, clientNonce }   |
  |---------------------------------->| shows prompt: requester name,
  |  { requestId, expiresAt }         | fingerprint, one-time code (6 digits)
  |<----------------------------------|
  |                                   | owner chooses ONE of:
  |                                   |  a) "Bestätigen" on the host, or
  |                                   |  b) shares the code out of band
  | POST /api/v1/access/requests/{id} |
  |  { code }   (path b only)         |
  |---------------------------------->| owner selects grant kind + scopes
  |  device credential, grant kind    |
  |<----------------------------------|
```

- The requester never selects scopes or resource access; the owner does, using
  the existing presets from Settings → Mobiler Zugriff.
- Grant kinds: **Sitzung** (device with `expiresAt`, default 4 h, max 24 h,
  auto-revoked, no admin scopes unless explicitly added) and **Gerät**
  (durable, identical to a QR-paired device). Both appear in the device list
  with kind, expiry and requester name and can be revoked immediately.
- `RemoteDeviceInfo` gains optional `expiresAt` and `grantKind`; expired
  devices are inactive for HTTP and SSE and produce an `expired` audit entry.
- The unauthenticated request endpoint is reachable only through the Serve
  route, rate limited per source, holds at most three pending requests, expires
  each after 120 s and answers denials, timeouts and unknown ids identically.
  Every request, confirmation, code failure, grant and denial is audited.
- Three wrong codes cancel the request. Codes are generated and compared on the
  host only; they are never sent to the requester by ADE.
- No grant is inherited from Tailscale identity, an existing device or a prior
  session. A revoked device cannot reuse its request id.

## Goal 30 - SSH terminal preset

- `SessionLaunchChoice` gains `{ mode: 'ssh'; hostId: string }`. The PTY runs
  the system `ssh` client with the stored `target` and fixed safe options
  (no port forwarding flags, no user-supplied argv).
- Desktop: a free-terminal preset "SSH zu <Host>" per known host with an SSH
  target. Mobile: the choice appears in the launch options only for devices
  holding `terminal:control`, with `available=false` when no `ssh` client is
  found. Key material, agents and known_hosts stay with the OS.
- Recommended host setups, documented in `REMOTE_TERMINAL_GUIDE.md`: Windows
  OpenSSH Server for native hosts; Tailscale SSH for WSL/Linux homes, which
  authenticates through tailnet identity without codes or key distribution.
- ADE never stores passwords or private keys and never edits `sshd_config`.

## Non-goals

- Screen streaming, input injection, clipboard/file transfer over ADE, hosted
  relay, Tailscale Funnel, LAN or public binds, Wake-on-LAN, pre-login access.
- Accounts or multi-user authorization; every grant is decided on the target
  host by whoever sits at it, which is the existing single-owner model per host.
- Cross-origin API calls from one PWA to several hosts (see Goal 28).

## Security requirements

- All existing rules from `REMOTE_CONTROL_PLAN.md` apply unchanged: loopback
  bind, Serve-only ingress, signed device requests, exact Origin, bounded
  payloads, redacted errors, append-only audit.
- Goal 29 is the only unauthenticated write surface ever added; it creates
  nothing but a pending prompt and must fail closed when the desktop window is
  unavailable or the host is not in mobile-access mode.
- Session grants are the default in the approval dialog; durable grants need an
  explicit second confirmation.
- Launchers and SSH use fixed argv from validated stored fields; no free text
  reaches a shell.
- A stolen session grant expires on its own; a stolen device credential is
  handled by existing revocation.

## Verification

- Focused tests: known-host store validation, identity pinning, expiry
  filtering in `RemoteDeviceStore`, request lifecycle (expiry, code limits,
  rate limits, identical denials), argv construction for launchers and SSH.
- Electron workflow: two loopback host instances with separate user-data
  directories and ports, one acting as client window; request → confirm →
  session grant → expiry → audit; request → code → durable grant → revoke.
- Physical acceptance: two ADE hosts in the operator's tailnet, one tablet;
  results recorded in a `MULTI_HOST_RESULTS.md` before any release claim.

## Delivery sequence

1. Goal 28a host directory + desktop host window (smallest useful slice).
2. Goal 30 SSH preset (independent of Goal 29, immediately useful).
3. Goal 29 session/device grants (largest change, touches the host API).
4. Goal 28b remote-desktop launcher (optional, after 28a).

Exit criteria: a known host can be opened from desktop and tablet without
re-pairing; a second PC grants a session that expires and a device that can be
revoked; an SSH terminal opens against a host from the directory; audit shows
every grant and denial; no new generic IPC or remote allowlist entry exists.

## Open decisions for the operator

- Which second PC will be the acceptance host, and does it run ADE or only SSH?
- Default session length (proposed 4 h) and whether session grants may ever
  hold `terminal:control`.
- Whether the remote-desktop launcher is wanted at all, and which client.

## References

- Tailscale SSH: <https://tailscale.com/kb/1193/tailscale-ssh>
- Windows OpenSSH Server: <https://learn.microsoft.com/windows-server/administration/openssh/openssh_install_firstuse>
- Tailscale Serve: <https://tailscale.com/docs/features/tailscale-serve>
- ADE remote control plan: `REMOTE_CONTROL_PLAN.md`
- ADE remote terminal guide: `REMOTE_TERMINAL_GUIDE.md`
