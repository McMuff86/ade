import { localizeAppMessage } from '../shared/i18n/appMessages';
import { t as translate } from "../shared/i18n";
import { useLocale } from "../renderer/i18n/language";
import { useEffect, useState, type JSX } from 'react';
import type { MobileRecentSession, MobileSessionInventory } from '../shared/remote';
import type { MobileHost } from './useMobileHost';
import { MobileClientError } from './client';
import { sessionStateLabel } from '../shared/sessionState';

export function ContinueWork({ host, onSession, onProject }: { host: MobileHost;
  onSession: (session: MobileRecentSession) => void; onProject: (repositoryId: string) => void;
}): JSX.Element {
  useLocale();
  const [inventory, setInventory] = useState<MobileSessionInventory>(); const [error, setError] = useState('');
  useEffect(() => {
    if (host.status !== 'online') return;
    let disposed = false; let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try { const result = await host.request<MobileSessionInventory>('/api/v1/terminal/sessions'); if (!disposed) { setInventory(result); setError(''); } }
      catch (reason) { if (!disposed) { setInventory(undefined); setError(reason instanceof MobileClientError && reason.code === 'scope_not_granted'
        ? translate("For running sessions, enable “Control interactive terminals” on the PC.") : translate("Sessions could not be loaded. Check connection to the PC.")); } }
      if (!disposed) timer = setTimeout(() => { if (!document.hidden) void refresh(); else timer = setTimeout(() => void refresh(), 5000); }, 5000);
    };
    void refresh(); return () => { disposed = true; clearTimeout(timer); };
  }, [host.request, host.status, host.identityVersion]);
  return <section className="m-continue" aria-labelledby="continue-title">
    <div className="m-continue-heading"><div><h2 id="continue-title">{translate("Continue working")}</h2><p>{translate("Your projects and sessions on the PC.")}</p></div></div>
    {host.status !== 'online' && <p role="status">{translate("PC not connected · Session status last confirmed, possibly obsolete.")}</p>}
    {error ? <p role="status">{localizeAppMessage(error)}</p> : !inventory ? <p role="status">{translate("Loading sessions…")}</p> : !inventory.sessions.length
      ? <p>{translate("No open terminals. Open a project or start with a new idea.")}</p>
      : <ul className="m-session-cards">{inventory.sessions.map((session) => <li key={session.id}><button disabled={host.status !== 'online'}
        onClick={(event) => { event.currentTarget.focus(); onSession(session); }} aria-label={translate("Continue working in {{value1}} with {{value2}} · {{value3}}", { value1: session.terminalHome ? translate("User directory") : session.projectName ?? host.catalog?.repositories.find((repo) => repo.id === session.repositoryId)?.name ?? translate("Personal workspace"), value2: session.terminalHome ? translate("Without an agent profile") : session.projectWorkspaceId ? session.launchProfileName ?? translate("Without an agent profile") : host.catalog?.agents.find((agent) => agent.id === session.agentId)?.name ?? 'Agent', value3: session.title })}>
        <strong>{session.terminalHome ? translate("Standalone terminal") : session.projectName ?? host.catalog?.repositories.find((repo) => repo.id === session.repositoryId)?.name ?? translate("Personal workspace")}</strong>
        <span>{session.terminalHome ? translate("Without an agent profile") : session.projectWorkspaceId ? session.launchProfileName ?? translate("Without an agent profile") : host.catalog?.agents.find((agent) => agent.id === session.agentId)?.name} · {session.title}{session.branch ? ` · ${session.branch}` : ''}</span>
        <small>{sessionStateLabel(session)}</small>
      </button></li>)}</ul>}
    {!!inventory?.omitted && <p>{translate("Further or no longer reachable sessions are hidden.")}</p>}
    {!!host.catalog?.repositories.some(repo => repo.inMyProjects !== false) && <div className="m-project-shortcuts" aria-label={translate("Open projects")}>{host.catalog.repositories.filter(repo => repo.inMyProjects !== false).slice(-12).reverse().map((repo) =>
      <button key={repo.id} onClick={(event) => { event.currentTarget.focus(); onProject(repo.id); }}>{translate("Open project:")}{" "}{repo.name}</button>)}</div>}
  </section>;
}
