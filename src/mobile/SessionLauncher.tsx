import { t as translate } from "../shared/i18n";
import { useLocale } from "../renderer/i18n/language";
import { useId, type ReactNode } from 'react';
import type { MobileTerminalSummary, SessionLaunchOptions } from '../shared/remote';
import type { PermissionMode } from '../shared/types';
import { LAUNCH_PROFILES } from '../shared/runtimes';
import { projectLaunchSelection } from '../shared/sessionLaunch';
import { canReuseLaunch, sessionStateLabel } from '../shared/sessionState';
import { canLaunchChoice } from '../renderer/sessions/SessionLaunchFields';

export type LauncherMode = 'codex' | 'claude' | 'grok' | 'shell';
export interface LaunchTile {
  mode: LauncherMode; title: string; permission: string; command: string; profile: string;
  available: boolean; notice?: string; running?: MobileTerminalSummary;
}

const PERMISSION: Record<PermissionMode, () => string> = {
  bypass: () => translate("Without asking"),
  'accept-edits': () => translate("Edits allowed, asks before commands"),
  default: () => translate("Asks before changes"),
};

/** One tile per CLI, resolved exactly like the launch itself: a project uses the host's
 * default profile for that CLI (permission mode included), otherwise the plain CLI. */
export function launchTiles(options: SessionLaunchOptions | undefined, terminals: MobileTerminalSummary[],
  { project, profileId }: { project: boolean; profileId?: string }): LaunchTile[] {
  const tiles = (['codex', 'claude', 'grok'] as const).map((mode): LaunchTile => {
    const resolved = project ? projectLaunchSelection({ mode }, options, profileId) : { choice: { mode } as const, profileId: undefined };
    const profile = options?.profiles?.find(item => item.id === resolved.profileId);
    const permission = profile?.permissionMode ?? 'default';
    const commands = LAUNCH_PROFILES[mode].commands;
    return { mode, title: LAUNCH_PROFILES[mode].label, permission: PERMISSION[permission](), command: commands[permission] ?? commands.default ?? mode,
      profile: profile ? translate("Profile {{value1}}", { value1: profile.name }) : translate("Without an agent profile"),
      available: canLaunchChoice({ mode }, options), notice: options?.choices.find(item => item.mode === mode)?.notice ?? undefined,
      running: terminals.filter(item => canReuseLaunch(item, resolved.choice.mode) && (!project || item.launchProfileId === resolved.profileId)).at(-1) };
  });
  return [...tiles, { mode: 'shell', title: translate("Empty terminal"), permission: project ? translate("Shell in the project folder") : translate("Shell in your user folder"),
    command: options?.environment === 'Windows' ? 'PowerShell' : 'shell', profile: translate("Without an agent profile"), available: true,
    running: terminals.filter(item => canReuseLaunch(item, 'shell')).at(-1) }];
}

/** Choosing a CLI is one tap: the tile names the CLI, says in plain words how much it may
 * do on its own and shows the literal start command. Sessions already open in this scope
 * are listed below; anything rarer lives in `more`. */
export function SessionLauncher({ tiles, terminals, selectedId, disabled, loading, onLaunch, onShow, more, heading }: {
  tiles: LaunchTile[]; terminals: MobileTerminalSummary[]; selectedId: string; disabled: boolean; loading: boolean;
  onLaunch(mode: LauncherMode): void; onShow(id: string): void; more: ReactNode; heading: string;
}) {
  useLocale();
  const id = useId();
  return <>
    <section className="m-launcher" aria-labelledby={`${id}-heading`}>
      <h3 id={`${id}-heading`}>{heading}</h3>
      <div className="m-launch-tiles">
        {tiles.map(tile => <button key={tile.mode} type="button" className="m-launch-tile" data-mode={tile.mode} data-running={!!tile.running || undefined}
          aria-label={`${tile.title} ${translate("Open [c3b66666]")}`} aria-describedby={`${id}-${tile.mode}`}
          disabled={disabled || !tile.available} onClick={() => onLaunch(tile.mode)}>
          <span className="m-launch-title">{tile.title}</span>
          <span id={`${id}-${tile.mode}`} className="m-launch-detail">
            <span className="m-launch-permission">{tile.permission}</span>
            {tile.command && <code className="m-launch-command">{tile.command}</code>}
            <span className="m-launch-state">{!tile.available ? tile.notice ?? translate("Not available") : tile.running ? translate("Running · tap to continue") : tile.profile}</span>
          </span>
        </button>)}
      </div>
      {loading && <p role="status" className="m-launch-note">{translate("Checking installed CLIs…")}</p>}
    </section>
    {terminals.length > 0 && <section className="m-launch-sessions" aria-labelledby={`${id}-sessions`}>
      <h3 id={`${id}-sessions`}>{translate("Sessions here")}</h3>
      <ul>{terminals.map(terminal => <li key={terminal.id}>
        <button type="button" data-terminal-id={terminal.id} aria-pressed={terminal.id === selectedId} disabled={disabled} onClick={() => onShow(terminal.id)}>
          <span className="m-launch-dot" data-state={terminal.status === 'running' && terminal.program?.status !== 'exited' ? 'running' : 'exited'} aria-hidden="true" />
          <span>{sessionStateLabel(terminal)}</span>
          <span className="m-launch-owner">{terminal.status !== 'running' ? '' : terminal.owner === 'self' ? translate("Input: tablet") : terminal.owner === 'other' ? translate("Another device controls input") : translate("PC controls input")}</span>
        </button></li>)}</ul>
    </section>}
    {more}
  </>;
}
