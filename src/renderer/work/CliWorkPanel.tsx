import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
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
  useLocale();
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
    catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : translate("The session could not be opened.")); }
    finally { openingRef.current = false; if (mounted.current) setOpening(null); }
  };
  return <section className={`cli-work${compact ? ' cli-work-compact' : ''}`} aria-label={translate("CLI work")}>
    <header className="cli-work-heading"><div><h2 ref={heading} tabIndex={-1}>{translate("CLI work")}</h2>
      <p>{rows.filter(row => row.state === 'running').length}{" "}{translate("CLIs started or ongoing ·")}{" "}{rows.filter(row => row.session.status === 'running').length}{" "}{translate("Open terminals")}</p></div>
      <button disabled={!hydrated} onClick={() => void useSessions.getState().hydrate(true)}>{translate("Refresh sessions")}</button>
    </header>
    <div className="cli-work-filters">
      <label>{translate("Search work")}<input type="search" aria-label={translate("Search CLI work")} placeholder={translate("Project, Title, Branch or CLI")} value={search} onChange={event => setSearch(event.target.value)} /></label>
      {project === undefined && <label>{translate("Project")}<select aria-label={translate("CLI project filter")} value={selectedProject} onChange={event => setSelectedProject(event.target.value)}>
        <option value="">{translate("All projects")}</option>{repositories.map(repo => <option key={repo.id} value={repo.id}>{repo.name}</option>)}
      </select></label>}
      <label>{translate("CLI")}<select aria-label={translate("CLI filter")} value={cli} onChange={event => setCli(event.target.value)}><option value="">{translate("All CLIs")}</option>
        {[...new Set(rows.map(row => row.cli))].sort().map(value => <option key={value}>{value}</option>)}
      </select></label>
      <label>{translate("Status [53746174]")}<select aria-label={translate("CLI status filter")} value={status} onChange={event => setStatus(event.target.value)}>
        <option value="open">{translate("Open terminals [4f666665]")}</option><option value="running">{translate("CLI starts/runs")}</option>
        <option value="shell">{translate("Shell/CLI terminated")}</option><option value="unknown">{translate("Unknown status")}</option>
        <option value="ended">{translate("Terminal terminated")}</option><option value="all">{translate("All sessions")}</option>
      </select></label>
    </div>
    {(error || recoveryError) && <p role="alert">{error || recoveryError}</p>}
    {!hydrated && !rows.length && <p role="status">{translate("Loading terminal sessions…")}</p>}
    {hydrated && !recoveryError && !visible.length && <div className="cli-work-empty">
      <h3>{rows.length ? translate("No matching CLI sessions") : translate("No CLI sessions yet")}</h3>
      <p>{rows.length ? translate("Change search or filter.") : translate("Open a project and start Codex, Claude Code or Grok. The sessions appear automatically here.")}</p>
    </div>}
    <ul className="cli-work-list">{visible.map(row => <li key={row.session.id} data-session-id={row.session.id}>
      <button className="cli-work-row" disabled={opening !== null} aria-label={translate("Open session: {{value1}} · {{value2}}", { value1: row.title, value2: row.project })} onClick={() => void open(row.session.id)}>
        <span className="cli-work-title"><strong>{row.title}</strong>{row.unread && <span className="cli-work-unread">{translate("New output")}</span>}</span>
        <span>{row.project} · {row.workspace}{row.session.branch && ` · ${row.session.branch}`}</span>
        <span className="cli-work-runtime">{row.cli} · {row.session.executionBackend?.startsWith('wsl:') ? `WSL · ${row.session.executionBackend.slice(4)}` : row.session.executionBackend === 'native' ? translate("Native") : translate("Environment unknown")}
          {row.profile && translate(" · Profile: {{value1}}", { value1: row.profile })}{row.session.launchModel && ` · Startmodell: ${row.session.launchModel}`}</span>
        <span className={`cli-work-status cli-work-status-${row.state}`}>{opening === row.session.id ? translate("Opening session…") : row.status}</span>
        {row.session.workspaceDir && <span className="cli-work-path">{row.session.workspaceDir}</span>}
        <span className="cli-work-observation">{row.session.lastOutputAt ? translate("Last output {{value1}}", { value1: formatRelativeTime(now, row.session.lastOutputAt) }) : translate("No output observed yet")}{" "}{translate("· Branch at start")}</span>
      </button>
      <button className="cli-work-rename" aria-label={translate("Rename work: {{value1}}", { value1: row.title })} onClick={() => setRename({ id: row.session.id, title: row.title })}>{translate("Rename")}</button>
    </li>)}</ul>
    {rename && <Modal title={translate("Name CLI work")} subtitle={translate("A custom title makes this session easier to find.")} onClose={() => setRename(null)} fallbackFocus={() => heading.current}>
      <form onSubmit={event => { event.preventDefault(); useCliWorkPreferences.getState().update(rename.id, { title: rename.title.trim() }); setRename(null); }}>
        <label>{translate("Working title")}<input aria-label={translate("Working title")} maxLength={120} value={rename.title} onChange={event => setRename({ ...rename, title: event.target.value })} /></label>
        <div className="modal-actions"><button type="button" onClick={() => setRename(null)}>{translate("Cancel")}</button><button type="submit">{translate("Save title")}</button></div>
      </form>
    </Modal>}
  </section>;
}
