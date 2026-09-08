/**
 * Privilege classification of every IPC invoke channel. The record is
 * exhaustive by type: adding a channel to `IPC` without classifying it here is
 * a compile error, so "what may this channel do, and from where" is a typed
 * fact rather than a review convention. `handle()` in ipc.ts consults the
 * policy at registration and per call; the Goal 7 host API serves only
 * `shared` channels and enforces their `remote` requirement before a command
 * reaches the application service (see the security suite).
 *
 * Pure module (no Electron import) so contract tests can read it directly.
 */

import type { InvokeChannel } from '../shared/ipc';
import type { RemoteAdminScope } from '../shared/remoteDevices';

/**
 * Highest privilege a handler exercises, ordered from least to most:
 * - `read`: returns state; no side effect beyond reading files/config
 *   (fixed-argv Git/gh plumbing included).
 * - `mutate`: changes ADE-owned state — config, journal, worktrees, memory.
 * - `host`: reaches the host outside ADE-owned state — clipboard, dialogs,
 *   external browser, file manager, trash.
 * - `launch`: starts, feeds or stops an agent/CLI process, or pushes to a
 *   remote (run start/cancel, PTYs, login, publish, diagnostics probes).
 * - `shell`: executes operator-authored command text through a shell. The
 *   single deliberate exception to the argv-only boundary.
 */
export type ChannelEffect = 'read' | 'mutate' | 'host' | 'launch' | 'shell';

/**
 * Where the channel's operation may be served from:
 * - `desktop`: only the sandboxed ADE renderer in a registered window.
 * - `shared`: the same operation is (or may be) exposed through the local
 *   host API. A shared channel must declare the `remote` requirement a
 *   caller has to satisfy; a shared non-read channel is additionally confined
 *   to `REMOTE_COMMAND_CHANNELS` and must demand a signed device proof plus an
 *   idempotency key (see `channelPolicyViolations`).
 */
export type ChannelSurface = 'desktop' | 'shared';

/**
 * Capability a remote principal must hold. `read` is granted to every
 * authenticated listener client; `runs:write` only to a device identity that
 * the operator configured (Goal 7 bootstrap) or paired (Goal 8).
 */
export type RemoteScope = 'read' | 'runs:write' | RemoteAdminScope;

/**
 * How a remote caller proves it may run this channel:
 * - `bearer`: the listener access token is sufficient (read-only data).
 * - `device-signature`: the request must additionally carry a per-request
 *   HMAC signature from a device secret, binding method, path, timestamp,
 *   idempotency key and body. A leaked bearer token alone cannot mutate.
 */
export type RemoteProof = 'bearer' | 'device-signature';

export interface RemoteAccess {
  scope: RemoteScope;
  /** Mutations must carry an idempotency key that maps to `commandId`. */
  idempotency: 'none' | 'required';
  proof: RemoteProof;
}

export interface ChannelPolicy {
  effect: ChannelEffect;
  surface: ChannelSurface;
  /** Emit one audit log line per call (never for high-frequency channels). */
  audit: boolean;
  /**
   * The payload can store text that a later `shell` channel executes
   * (`dashboardCommand`). Such channels are `mutate`, but reviewers must
   * treat their validators as part of the shell boundary.
   */
  armsShell?: true;
  /** Required for `surface: 'shared'`, forbidden for `desktop`. */
  remote?: RemoteAccess;
}

const REMOTE_READ: RemoteAccess = { scope: 'read', idempotency: 'none', proof: 'bearer' };
const REMOTE_COMMAND: RemoteAccess = {
  scope: 'runs:write',
  idempotency: 'required',
  proof: 'device-signature',
};

const read: ChannelPolicy = { effect: 'read', surface: 'desktop', audit: false };
const mutate: ChannelPolicy = { effect: 'mutate', surface: 'desktop', audit: false };
const host: ChannelPolicy = { effect: 'host', surface: 'desktop', audit: true };
const launch: ChannelPolicy = { effect: 'launch', surface: 'desktop', audit: true };
const launchQuiet: ChannelPolicy = { effect: 'launch', surface: 'desktop', audit: false };
const shell: ChannelPolicy = { effect: 'shell', surface: 'desktop', audit: true };
const armsShell: ChannelPolicy = { ...mutate, armsShell: true };
const shared: ChannelPolicy = { effect: 'read', surface: 'shared', audit: false, remote: REMOTE_READ };
/** Remote-capable mutation: audited on every surface, device-signed and idempotent remotely. */
const sharedMutate: ChannelPolicy = { effect: 'mutate', surface: 'shared', audit: true, remote: REMOTE_COMMAND };
const sharedLaunch: ChannelPolicy = { effect: 'launch', surface: 'shared', audit: true, remote: REMOTE_COMMAND };

export const CHANNEL_POLICY: Readonly<Record<InvokeChannel, ChannelPolicy>> = {
  'config:get': shared,
  'config:health': read,
  'remoteDevices:list': read,
  'mobileAccess:status': read,
  'mobileAccess:setEnabled': launch,
  'mobileAccess:pair': { ...mutate, audit: true },
  'mobileAccess:cancelPair': { ...mutate, audit: true },
  'remoteDevices:rename': { ...mutate, audit: true },
  'remoteDevices:revoke': { ...mutate, audit: true },
  'remoteDevices:setAdminScopes': { ...mutate, audit: true },
  'config:save': mutate,
  'workspaceBundle:pickImport': host,
  'workspaceBundle:authorizeMappings': mutate,
  'workspaceBundle:preview': read,
  'workspaceBundle:apply': { ...armsShell, audit: true },
  'workspaceBundle:export': host,
  'photo:import': mutate,
  'category:create': mutate,
  'category:update': mutate,
  'category:delete': mutate,
  'category:reorder': mutate,
  'agent:create': armsShell,
  'agent:update': armsShell,
  'agent:openDashboard': shell,
  'agent:delete': mutate,
  'agent:move': mutate,
  'agent:setDefaultRepository': mutate,
  'agentTemplate:create': armsShell,
  'agentTemplate:delete': mutate,
  'agentTemplate:spawn': armsShell,
  'repository:import': mutate,
  'repository:overview': read,
  'repository:syncOverview': read,
  'repository:fetch': { ...mutate, audit: true },
  'repository:syncPreview': read,
  'repository:syncApply': { ...mutate, audit: true },
  'repository:pullRequests': read,
  'repository:pullRequestChecks': read,
  'repository:commitDiff': read,
  'harness:status': read,
  'harness:setKey': mutate,
  'harness:clearKey': mutate,
  'harness:setServiceKey': mutate,
  'harness:clearServiceKey': mutate,
  'harness:login': launch,
  'harness:diagnose': launch,
  'workspace:describe': read,
  'workspace:removeBinding': mutate,
  'clipboard:readText': host,
  'clipboard:writeText': host,
  'pty:create': launch,
  'pty:write': launchQuiet,
  'pty:resize': launchQuiet,
  'pty:kill': launch,
  'pty:attach': read,
  'pty:activitySnapshot': read,
  'runTask:activity': read,
  'pty:list': read,
  'overview:get': read,
  'pty:cancelTasks': launch,
  'runtime:diagnose': launch,
  'run:get': read,
  'run:getSummary': shared,
  'run:events': shared,
  // Desktop-only until the host adapter funnels task errors/summaries through
  // redactForWire; the projection itself is what Goal 9's approval view needs.
  'run:report': read,
  'run:approvalDiff': read,
  'run:publicationPreview': read,
  'run:publish': launch,
  'run:create': sharedMutate,
  'run:delete': mutate,
  'run:start': sharedLaunch,
  'run:cancel': sharedLaunch,
  'run:pauseTeam': mutate,
  'run:resumeTeam': mutate,
  'runApproval:resolve': launch,
  'runTask:create': mutate,
  'runTask:submit': sharedLaunch,
  'runTask:fail': mutate,
  'runArtifact:create': mutate,
  'git:status': read,
  'git:diff': read,
  'fs:tree': read,
  'fs:read': read,
  'fs:agentFiles': read,
  'fs:pathInfo': read,
  'fs:reveal': host,
  'fs:openPath': host,
  'fs:rename': mutate,
  'fs:delete': host,
  'dialog:pickFolder': host,
  'wsl:list': read,
};

/** The only channels allowed to carry the `shell` effect. Grow this list deliberately. */
export const SHELL_CHANNELS: readonly InvokeChannel[] = ['agent:openDashboard'];

/**
 * The only non-read channels the host API may mirror. Each one is a bounded
 * run or single-task command with explicit ids; nothing here touches
 * interactive PTYs, the filesystem, configuration, credentials or
 * publication. `runTask:submit` launches one one-shot task session for an
 * explicit agent/repository pair — it is a `launch`, not a PTY channel: the
 * caller cannot write to, resize or attach to the session. Grow deliberately.
 */
export const REMOTE_COMMAND_CHANNELS: readonly InvokeChannel[] = [
  'run:create', 'run:start', 'run:cancel', 'runTask:submit',
];

/** Channels the host API may serve at all (read projections plus the commands above). */
export function remoteChannels(
  policy: Readonly<Record<InvokeChannel, ChannelPolicy>> = CHANNEL_POLICY,
): InvokeChannel[] {
  return (Object.keys(policy) as InvokeChannel[]).filter((channel) => policy[channel].surface === 'shared');
}

/**
 * Invariants every policy must satisfy. Returned as a list so the security
 * suite can print each violation; `handle()` throws on the first one at
 * registration so a misclassified channel never reaches a renderer.
 */
export function channelPolicyViolations(
  policy: Readonly<Record<InvokeChannel, ChannelPolicy>> = CHANNEL_POLICY,
): string[] {
  const violations: string[] = [];
  for (const [channel, entry] of Object.entries(policy) as Array<[InvokeChannel, ChannelPolicy]>) {
    if (entry.effect === 'shell' && !SHELL_CHANNELS.includes(channel)) {
      violations.push(`${channel}: shell effect outside SHELL_CHANNELS`);
    }
    if (entry.effect === 'shell' && !entry.audit) {
      violations.push(`${channel}: shell effect must be audited`);
    }
    if (entry.armsShell && entry.effect !== 'mutate') {
      violations.push(`${channel}: armsShell applies to mutate channels only`);
    }
    if (entry.surface === 'desktop' && entry.remote) {
      violations.push(`${channel}: desktop channels carry no remote requirement`);
    }
    if (entry.surface !== 'shared') continue;

    // Shared channels: the read invariant stays the default. Lifting it is a
    // per-channel, allowlisted decision that must demand the strongest remote
    // requirement, so a policy line alone can never make a mutation reachable
    // with only the listener bearer token.
    if (!entry.remote) {
      violations.push(`${channel}: shared surface requires a remote access requirement`);
      continue;
    }
    if (entry.effect === 'host' || entry.effect === 'shell') {
      violations.push(`${channel}: ${entry.effect} effect can never be shared`);
    }
    if (entry.effect === 'read') {
      if (entry.remote.scope !== 'read' || entry.remote.idempotency !== 'none') {
        violations.push(`${channel}: shared read channels use the read scope without idempotency`);
      }
      continue;
    }
    if (!REMOTE_COMMAND_CHANNELS.includes(channel)) {
      violations.push(`${channel}: shared surface requires the read effect outside REMOTE_COMMAND_CHANNELS`);
    }
    if (entry.remote.scope !== 'runs:write') {
      violations.push(`${channel}: remote commands require the runs:write scope`);
    }
    if (entry.remote.idempotency !== 'required') {
      violations.push(`${channel}: remote commands require an idempotency key`);
    }
    if (entry.remote.proof !== 'device-signature') {
      violations.push(`${channel}: remote commands require a device signature, not only the bearer token`);
    }
    if (!entry.audit) {
      violations.push(`${channel}: remote commands must be audited`);
    }
  }
  return violations;
}

export function assertChannelPolicy(channel: InvokeChannel): ChannelPolicy {
  const policy = CHANNEL_POLICY[channel];
  if (!policy) throw new Error(`ade: IPC channel ${channel} has no privilege policy`);
  const violations = channelPolicyViolations({ [channel]: policy } as Record<InvokeChannel, ChannelPolicy>);
  if (violations.length > 0) throw new Error(`ade: IPC policy violation — ${violations.join('; ')}`);
  return policy;
}
