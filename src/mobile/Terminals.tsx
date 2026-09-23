import { localizeAppMessage } from '../shared/i18n/appMessages';
import { t as translate } from "../shared/i18n";
import { useLocale } from "../renderer/i18n/language";
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MobileRecentSession, MobileSessionInventory, MobileTerminalSelection } from '../shared/remote';
import { sessionStateLabel } from '../shared/sessionState';
import type { MobileHost } from './useMobileHost';
import { RemoteTerminalPane } from './RemoteTerminalPane';
import { AgentNavigation } from './AgentNavigation';
import { MobileClientError } from './client';
import { TabletKeyboardContext } from './useTabletViewport';
import { useWorkspaceSelection, WorkspaceAssignmentDialog } from './WorkspaceAssignment';
import { TerminalPanelResize, useTerminalPanelWidths } from './TerminalPanelResize';

export type TerminalTarget = MobileTerminalSelection & { terminalId?: string; expectedBranch?: string };
export function terminalTarget(session: MobileRecentSession): TerminalTarget {
  return { ...(session.terminalHome ? { terminalHome: true as const } : session.projectWorkspaceId
    ? { projectWorkspaceId: session.projectWorkspaceId, expectedBranch: session.branch }
    : { agentId: session.agentId!, repositoryId: session.repositoryId ?? null }), terminalId: session.id };
}

/** Main owns each session; navigation chooses a scope and attaches to the same PTY. */
export function Terminals({ host, target, onTarget, onWorkspace, launchVersion }: {
  host: MobileHost; target: TerminalTarget; onTarget: (target: TerminalTarget) => void;
  onWorkspace: (agentId: string, repositoryId: string | null) => void; launchVersion: number;
}) {
  useLocale();
  const [inventory, setInventory] = useState<MobileSessionInventory>();
  const [error, setError] = useState(''); const [refresh, setRefresh] = useState(0);
  const [railOpen, setRailOpen] = useState(false);
  const [focusVersion, setFocusVersion] = useState(0);
  const title = useRef<HTMLHeadingElement>(null);
  const panels = useRef<HTMLDivElement>(null);
  const panelWidths = useTerminalPanelWidths();
  const keyboardOpen = useContext(TabletKeyboardContext);
  const [keyboardControls, setKeyboardControls] = useState(false);
  const keyboardToggle = useRef<HTMLButtonElement>(null);
  const wasKeyboardOpen = useRef(false);
  useLayoutEffect(() => {
    if (!keyboardOpen) {
      setKeyboardControls(false);
      if (wasKeyboardOpen.current && (document.activeElement === keyboardToggle.current || document.activeElement === document.body)) title.current?.focus();
    }
    wasKeyboardOpen.current = keyboardOpen;
  }, [keyboardOpen]);
  useEffect(() => {
    if (host.status !== 'online') return;
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    const update = async () => {
      try { const result = await host.request<MobileSessionInventory>('/api/v1/terminal/sessions');
        if (!stopped) { setInventory(result); setError(''); }
      } catch (reason) { if (!stopped) { setInventory(undefined); setError(reason instanceof MobileClientError && reason.status === 403
        ? translate("On the PC, open Settings → Connected devices and enable “Control interactive terminals”. Standalone terminals require the project selection to allow “All”.")
        : translate("Sessions could not be loaded. Check connection and reload.")); } }
      if (!stopped) timer = setTimeout(() => { void update(); }, 5000);
    };
    void update(); return () => { stopped = true; clearTimeout(timer); };
  }, [host.request, host.status, host.identityVersion, refresh]);
  const choose = (next: TerminalTarget) => { onTarget(next); setRailOpen(false); setFocusVersion((n) => n + 1); };
  const agent = host.catalog?.agents.find((item) => item.id === target.agentId);
  const assigned = useWorkspaceSelection(host, target.agentId, target.repositoryId);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const project = host.catalog?.repositories.find((item) => item.id === target.repositoryId);
  const key = `${target.terminalHome ? 'home' : target.projectWorkspaceId ?? `${target.agentId}:${target.repositoryId ?? 'home'}`}:${launchVersion}`;
  useLayoutEffect(() => { title.current?.focus({ preventScroll: true }); }, [focusVersion, launchVersion]);
  return <div ref={panels} style={panelWidths.style} className={`m-terminals-page ${keyboardOpen ? 'm-terminals-keyboard' : ''}`}>
    <button ref={keyboardToggle} hidden={!keyboardOpen} className="m-keyboard-controls-toggle" aria-label={translate("Terminal controls")}
      aria-expanded={keyboardControls} aria-controls="workspace-terminal-controls" onPointerDown={(event) => event.preventDefault()}
      onClick={() => setKeyboardControls((value) => !value)}>{keyboardControls ? translate("Collapse controls") : translate("Controls")}</button>
    <button className="m-terminal-navigation-toggle" aria-expanded={railOpen} aria-controls="terminal-navigation" onClick={() => setRailOpen(!railOpen)}>{translate("Agents and sessions")}</button>
    <aside id="terminal-navigation" className={`m-terminal-navigation ${railOpen ? 'is-open' : ''}`} aria-label={translate("Agents and terminals")}>
      <button aria-pressed={!!target.terminalHome} onClick={() => choose({ terminalHome: true })}>{translate("Standalone terminals")}</button>
      <h2>{translate("Agents")}</h2>
      <AgentNavigation host={host} selectedId={target.agentId} onSelect={(id) => choose({ agentId: id, repositoryId: null })} />
      <h2>{translate("Sessions")}</h2>
      <button disabled={host.status !== 'online'} onClick={() => setRefresh((n) => n + 1)}>{translate("Refresh sessions")}</button>
      {error ? <p role="alert">{localizeAppMessage(error)}</p> : !inventory ? <p role="status">{translate("Loading sessions…")}</p> : !inventory.sessions.length ? <p>{translate("No terminals are open yet.")}</p>
        : inventory.sessions.map((session) => <button key={session.id} aria-pressed={target.terminalId === session.id}
          onClick={() => choose(terminalTarget(session))}><span>{session.title}<small>{session.terminalHome ? translate("User directory") : session.projectName ?? host.catalog?.agents.find((item) => item.id === session.agentId)?.name ?? 'Workspace'}</small><small>{sessionStateLabel(session)}</small></span></button>)}
      {!!inventory?.omitted && <p>{inventory.omitted}{" "}{translate("other or unavailable sessions.")}</p>}
    </aside>
    <TerminalPanelResize side="agents" value={panelWidths.widths[0]} onChange={(value) => panelWidths.resize(0, value)} container={panels} />
    <section className="m-terminal-main" aria-label={translate("Terminal workspace")}>
      <h2 ref={title} tabIndex={-1} className="m-terminal-heading">{target.terminalHome ? translate("Standalone terminals") : agent?.name ?? translate("Project terminal")}</h2>
      {agent && <label className="m-terminal-scope">{translate("Project")}<select id="terminal-project-selection" aria-label={translate("Terminal project")} value={target.repositoryId ?? ''}
        onChange={(event) => { if (event.target.value === '@browse') setAssignmentOpen(true); else choose({ agentId: agent.id, repositoryId: event.target.value || null }); }}>
        <option value="">{translate("No project · Personal workspace")}</option>{host.catalog?.repositories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        <option value="@browse">{translate("Search projects…")}</option>
      </select></label>}
      {agent && <button className="m-terminal-scope" disabled={host.status !== 'online'} onClick={() => setAssignmentOpen(true)}>{translate("Search for projects")}</button>}
      {assigned.loading && <p role="status">{translate("Loading workspace assignment…")}</p>}{assigned.error && <p role="alert">{localizeAppMessage(assigned.error)}</p>}
      {!assigned.loading && !assigned.error && <RemoteTerminalPane key={`${host.identityVersion}:${key}:${assigned.selection.projectWorkspaceId ?? ''}`} host={host} {...(agent ? assigned.selection : target)}
        expectedBranch={agent ? assigned.view?.branch : target.expectedBranch} defaultProfileId={agent && assigned.selection.projectWorkspaceId ? agent.id : undefined}
        active initialTerminalId={target.terminalId} projectEntry={!!target.projectWorkspaceId}
        compactControls={keyboardOpen && !keyboardControls} fallbackFocusId="view-tab-terminals" onSelectionChanged={(id) => onTarget({ ...target, terminalId: id })} />}
    </section>
    <TerminalPanelResize side="inspector" value={panelWidths.widths[1]} onChange={(value) => panelWidths.resize(1, value)} container={panels} />
    <aside id="terminal-inspector" className="m-terminal-context" aria-label={translate("Terminal context")}><h2>{translate("Inspector")}</h2>
      <p>{target.terminalHome ? translate("Standalone terminal") : agent?.name ?? translate("Project terminal")}</p>
      <p>{target.terminalHome ? translate("Start in the user directory of the ADE computer.") : project?.name ?? (target.projectWorkspaceId ? translate("Existing project workspace") : translate("Own Agent Workspace"))}</p>
      {target.expectedBranch && <p>{translate("Branch:")}{" "}{target.expectedBranch}</p>}
      <p>{translate("CLI, font size and input transfer are set in the terminal.")}</p>
      {agent && <button onClick={() => onWorkspace(agent.id, target.repositoryId ?? null)}>{translate("Files and Agent Profile")}</button>}
    </aside>
    {assignmentOpen && agent && <WorkspaceAssignmentDialog host={host} agentId={agent.id} repositoryId={target.repositoryId ?? undefined} browseInitially
      fallbackId="terminal-project-selection" onClose={() => setAssignmentOpen(false)} onAssigned={(view) => {
        onTarget({ agentId: agent.id, repositoryId: view.repositoryId }); setRailOpen(false); assigned.refresh();
      }} />}
  </div>;
}
