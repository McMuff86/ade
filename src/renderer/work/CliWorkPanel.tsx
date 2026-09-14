import { useEffect, useRef, useState } from 'react';
import { cliWorkRows, matchesCliWork } from '../../shared/cliWork';
import { formatRelativeTime } from '../../shared/overviewFormat';
import { useAppData } from '../stores/appdata';
import { useSessions } from '../stores/sessions';
import { Modal } from '../onboarding/Modal';
import { useCliWorkPreferences } from './cliWorkPreferences';
import { openCliSession } from './openCliSession';
import './cli-work.css';

/** Same real session inventory in Work and Overview. Opening a row only navigates. */
export function CliWorkPanel({ compact = false, project, profile }: { compact?: boolean; project?: string; profile?: string }) {
  const sessions = useSessions(state => state.sessions);
  const hydrated = useSessions(state => state.hydrated);
  const recoveryError = useSessions(state => state.error?.source === 'recovery' ? state.error.message : '');
  const { repositories, agents } = useAppData();
  const preferences = useCliWorkPreferences(state => state.entries);
  const [search, setSearch] = useState(''); const [cli, setCli] = useState('');
  const [status, setStatus] = useState('open'); const [selectedProject, setSelectedProject] = useState('');
  const [error, setError] = useState(''); const [opening, setOpening] = useState<string | null>(null);
  const openingRef = useRef(false); const mounted = useRef(true);
  const [rename, setRename] = useState<{ id: string; title: string } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const rows = cliWorkRows(Object.values(sessions), repositories, agents, preferences);
  const visible = rows.filter(row => matchesCliWork(row, { project: project ?? selectedProject, profile, search, cli, status }));
  const now = Date.now();
  useEffect(() => {
    mounted.current = true;
    const refresh = () => { if (document.visibilityState !== 'hidden') void useSessions.getState().hydrate(true); };
    refresh(); const timer = window.setInterval(refresh, 2000);
    window.addEventListener('focus', refresh);
    return () => { mounted.current = false; clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, []);
  const open = async (id: string) => {
    if (openingRef.current) return;
    openingRef.current = true; setOpening(id); setError('');
    try { await openCliSession(id); }
    catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : 'Sitzung konnte nicht geöffnet werden.'); }
    finally { openingRef.current = false; if (mounted.current) setOpening(null); }
  };
  return <section className={`cli-work${compact ? ' cli-work-compact' : ''}`} aria-label="CLI-Arbeit">
    <header className="cli-work-heading"><div><h2 ref={heading} tabIndex={-1}>CLI-Arbeit</h2>
      <p>{rows.filter(row => row.state === 'running').length} CLIs gestartet oder laufend · {rows.filter(row => row.session.status === 'running').length} offene Terminals</p></div>
      <button disabled={!hydrated} onClick={() => void useSessions.getState().hydrate(true)}>Sitzungen aktualisieren</button>
    </header>
    <div className="cli-work-filters">
      <label>Arbeit suchen<input type="search" aria-label="CLI-Arbeit durchsuchen" placeholder="Projekt, Titel, Branch oder CLI" value={search} onChange={event => setSearch(event.target.value)} /></label>
      {project === undefined && <label>Projekt<select aria-label="CLI-Projektfilter" value={selectedProject} onChange={event => setSelectedProject(event.target.value)}>
        <option value="">Alle Projekte</option>{repositories.map(repo => <option key={repo.id} value={repo.id}>{repo.name}</option>)}
      </select></label>}
      <label>CLI<select aria-label="CLI-Filter" value={cli} onChange={event => setCli(event.target.value)}><option value="">Alle CLIs</option>
        {[...new Set(rows.map(row => row.cli))].sort().map(value => <option key={value}>{value}</option>)}
      </select></label>
      <label>Status<select aria-label="CLI-Statusfilter" value={status} onChange={event => setStatus(event.target.value)}>
        <option value="open">Offene Terminals</option><option value="running">CLI startet / läuft</option>
        <option value="shell">Shell / CLI beendet</option><option value="unknown">Status unbekannt</option>
        <option value="ended">Terminal beendet</option><option value="all">Alle Sitzungen</option>
      </select></label>
    </div>
    {(error || recoveryError) && <p role="alert">{error || recoveryError}</p>}
    {!hydrated && !rows.length && <p role="status">Terminalsitzungen werden geladen…</p>}
    {hydrated && !recoveryError && !visible.length && <div className="cli-work-empty">
      <h3>{rows.length ? 'Keine passenden CLI-Sitzungen' : 'Noch keine CLI-Sitzungen'}</h3>
      <p>{rows.length ? 'Suche oder Filter ändern.' : 'Ein Projekt öffnen und dort Codex, Claude Code oder Grok starten. Die Sitzungen erscheinen hier automatisch.'}</p>
    </div>}
    <ul className="cli-work-list">{visible.map(row => <li key={row.session.id} data-session-id={row.session.id}>
      <button className="cli-work-row" disabled={opening !== null} aria-label={`Sitzung öffnen: ${row.title} · ${row.project}`} onClick={() => void open(row.session.id)}>
        <span className="cli-work-title"><strong>{row.title}</strong>{row.unread && <span className="cli-work-unread">Neue Ausgabe</span>}</span>
        <span>{row.project} · {row.workspace}{row.session.branch && ` · ${row.session.branch}`}</span>
        <span className="cli-work-runtime">{row.cli} · {row.session.executionBackend?.startsWith('wsl:') ? `WSL · ${row.session.executionBackend.slice(4)}` : row.session.executionBackend === 'native' ? 'Native' : 'Umgebung unbekannt'}
          {row.profile && ` · Profil: ${row.profile}`}{row.session.launchModel && ` · Startmodell: ${row.session.launchModel}`}</span>
        <span className={`cli-work-status cli-work-status-${row.state}`}>{opening === row.session.id ? 'Sitzung wird geöffnet…' : row.status}</span>
        {row.session.workspaceDir && <span className="cli-work-path">{row.session.workspaceDir}</span>}
        <span className="cli-work-observation">{row.session.lastOutputAt ? `Letzte Ausgabe ${formatRelativeTime(now, row.session.lastOutputAt)}` : 'Noch keine Ausgabe beobachtet'} · Branch beim Start</span>
      </button>
      <button className="cli-work-rename" aria-label={`Arbeit benennen: ${row.title}`} onClick={() => setRename({ id: row.session.id, title: row.title })}>Benennen</button>
    </li>)}</ul>
    {rename && <Modal title="CLI-Arbeit benennen" subtitle="Ein eigener Titel erleichtert das Wiederfinden dieser Sitzung." onClose={() => setRename(null)} fallbackFocus={() => heading.current}>
      <form onSubmit={event => { event.preventDefault(); useCliWorkPreferences.getState().update(rename.id, { title: rename.title.trim() }); setRename(null); }}>
        <label>Arbeitstitel<input aria-label="Arbeitstitel" maxLength={120} value={rename.title} onChange={event => setRename({ ...rename, title: event.target.value })} /></label>
        <div className="modal-actions"><button type="button" onClick={() => setRename(null)}>Abbrechen</button><button type="submit">Titel speichern</button></div>
      </form>
    </Modal>}
  </section>;
}
