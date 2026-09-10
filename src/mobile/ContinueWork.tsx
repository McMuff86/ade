import { useEffect, useState, type JSX } from 'react';
import type { MobileRecentSession, MobileSessionInventory } from '../shared/remote';
import type { MobileHost } from './useMobileHost';
import { MobileClientError } from './client';
import { sessionStateLabel } from '../shared/sessionState';

export function ContinueWork({ host, onSession, onProject }: { host: MobileHost;
  onSession: (session: MobileRecentSession) => void; onProject: (repositoryId: string) => void;
}): JSX.Element {
  const [inventory, setInventory] = useState<MobileSessionInventory>(); const [error, setError] = useState('');
  useEffect(() => {
    if (host.status !== 'online') return;
    let disposed = false; let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try { const result = await host.request<MobileSessionInventory>('/api/v1/terminal/sessions'); if (!disposed) { setInventory(result); setError(''); } }
      catch (reason) { if (!disposed) { setInventory(undefined); setError(reason instanceof MobileClientError && reason.code === 'scope_not_granted'
        ? 'Für laufende Sitzungen am PC „Interaktive Terminals steuern“ freigeben.' : 'Sitzungen konnten nicht geladen werden. Verbindung zum PC prüfen.'); } }
      if (!disposed) timer = setTimeout(() => { if (!document.hidden) void refresh(); else timer = setTimeout(() => void refresh(), 5000); }, 5000);
    };
    void refresh(); return () => { disposed = true; clearTimeout(timer); };
  }, [host.request, host.status, host.identityVersion]);
  return <section className="m-continue" aria-labelledby="continue-title">
    <div className="m-continue-heading"><div><h2 id="continue-title">Weiterarbeiten</h2><p>Deine Projekte und Sitzungen auf dem PC.</p></div></div>
    {host.status !== 'online' && <p role="status">PC nicht verbunden · Sitzungsstand zuletzt bestätigt, möglicherweise veraltet.</p>}
    {error ? <p role="status">{error}</p> : !inventory ? <p role="status">Sitzungen werden geladen…</p> : !inventory.sessions.length
      ? <p>Keine offenen Terminals. Ein Projekt öffnen oder mit einer neuen Idee starten.</p>
      : <ul className="m-session-cards">{inventory.sessions.map((session) => <li key={session.id}><button disabled={host.status !== 'online'}
        onClick={(event) => { event.currentTarget.focus(); onSession(session); }} aria-label={`Weiterarbeiten in ${session.projectName ?? host.catalog?.repositories.find((repo) => repo.id === session.repositoryId)?.name ?? 'Eigener Workspace'} mit ${session.projectWorkspaceId ? session.launchProfileName ?? 'Ohne Agent-Profil' : host.catalog?.agents.find((agent) => agent.id === session.agentId)?.name ?? 'Agent'} · ${session.title}`}>
        <strong>{session.projectName ?? host.catalog?.repositories.find((repo) => repo.id === session.repositoryId)?.name ?? 'Eigener Workspace'}</strong>
        <span>{session.projectWorkspaceId ? session.launchProfileName ?? 'Ohne Agent-Profil' : host.catalog?.agents.find((agent) => agent.id === session.agentId)?.name} · {session.title}{session.branch ? ` · ${session.branch}` : ''}</span>
        <small>{sessionStateLabel(session)}</small>
      </button></li>)}</ul>}
    {!!inventory?.omitted && <p>Weitere oder nicht mehr erreichbare Sitzungen sind ausgeblendet.</p>}
    {!!host.catalog?.repositories.length && <div className="m-project-shortcuts" aria-label="Projekte öffnen">{host.catalog.repositories.slice(-12).reverse().map((repo) =>
      <button key={repo.id} onClick={(event) => { event.currentTarget.focus(); onProject(repo.id); }}>Projekt öffnen: {repo.name}</button>)}</div>}
  </section>;
}
