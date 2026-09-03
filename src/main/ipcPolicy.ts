/**
 * Privilege classification of every IPC invoke channel. The record is
 * exhaustive by type: adding a channel to `IPC` without classifying it here is
 * a compile error, so "what may this channel do, and from where" is a typed
 * fact rather than a review convention. `handle()` in ipc.ts consults the
 * policy at registration and per call; the Goal 7 host API must expose only
 * `shared` channels (see the security suite).
 *
 * Pure module (no Electron import) so contract tests can read it directly.
 */

import type { InvokeChannel } from '../shared/ipc';

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
 *   host API. Shared channels must be `read` until the host API gains a
 *   real authorization model beyond its bearer token.
 */
export type ChannelSurface = 'desktop' | 'shared';

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
}

const read: ChannelPolicy = { effect: 'read', surface: 'desktop', audit: false };
const mutate: ChannelPolicy = { effect: 'mutate', surface: 'desktop', audit: false };
const host: ChannelPolicy = { effect: 'host', surface: 'desktop', audit: true };
const launch: ChannelPolicy = { effect: 'launch', surface: 'desktop', audit: true };
const launchQuiet: ChannelPolicy = { effect: 'launch', surface: 'desktop', audit: false };
const shell: ChannelPolicy = { effect: 'shell', surface: 'desktop', audit: true };
const armsShell: ChannelPolicy = { ...mutate, armsShell: true };
const shared: ChannelPolicy = { effect: 'read', surface: 'shared', audit: false };

export const CHANNEL_POLICY: Readonly<Record<InvokeChannel, ChannelPolicy>> = {
  'config:get': shared,
  'config:health': read,
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
  'run:events': read,
  'run:approvalDiff': read,
  'run:publicationPreview': read,
  'run:publish': launch,
  'run:create': mutate,
  'run:delete': mutate,
  'run:start': launch,
  'run:cancel': launch,
  'run:pauseTeam': mutate,
  'run:resumeTeam': mutate,
  'runApproval:resolve': launch,
  'runTask:create': mutate,
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
    if (entry.surface === 'shared' && entry.effect !== 'read') {
      violations.push(`${channel}: shared surface requires the read effect`);
    }
    if (entry.armsShell && entry.effect !== 'mutate') {
      violations.push(`${channel}: armsShell applies to mutate channels only`);
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
