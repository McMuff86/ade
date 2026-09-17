import { createContext, useContext, useEffect, useRef } from 'react';
import type { SupervisionTarget, SupervisionView } from '../../shared/supervision';
import { useSupervision } from './supervisionState';
import { navigateSupervisedWork } from './navigateSupervisedWork';
import './supervision.css';

export const SupervisionContext = createContext<((repositoryId?: string) => void) | null>(null);
export const SUPERVISION_MODE_LABELS = { direct: 'Direkt', observe: 'Beobachten', coordinate: 'Koordinieren' } as const;
export function SupervisionButton({ repositoryId, id }: { repositoryId?: string; id?: string }) {
  const open = useContext(SupervisionContext);
  return open ? <button id={id} type="button" className="session-switch-trigger" onClick={event => { event.currentTarget.focus(); open(repositoryId); }}>ADE-Betreuung</button> : null;
}
/** Exact host-owned edges only. No inferred relationship from profile names or output text. */
export function SupervisionGraph({ view, onProject, onWork }: { view: SupervisionView; onProject(id: string): void; onWork(target: SupervisionTarget): void }) {
  return <section className="supervision-graph" aria-label="ADE-Projektverbindungen">
    <div className="supervision-root">ADE · {view.profile?.name ?? 'Betreuungsplan'}</div>
    {!view.projects.length && <p>Noch keine Projekte zugeordnet.</p>}
    <ul>{view.projects.map(project => <li key={project.id} data-supervised-project={project.id}>
      <button type="button" aria-label={`Betreuung öffnen: ${project.name}`} onClick={() => onProject(project.repositoryId)}>
        <strong>{project.name}</strong><span>{SUPERVISION_MODE_LABELS[project.mode]}{!project.available && ' · Nicht verfügbar'}</span>
      </button>
      <ul>{project.links.map(link => <li key={link.id} data-supervision-link={link.id}>
        <button type="button" disabled={!link.available} onClick={() => onWork(link.target)} aria-label={`Verknüpfte ${link.target.kind === 'session' ? 'Sitzung' : 'Arbeit'} öffnen: ${link.title}`}>
          <strong>{link.title}</strong><span>{link.target.kind === 'session' ? 'Sitzung' : 'Run'} · {link.status}</span>
        </button>
      </li>)}</ul>
    </li>)}</ul>
  </section>;
}
export function DesktopSupervisionGraph() {
  const { view, error, refresh } = useSupervision(); const open = useContext(SupervisionContext);
  const live = useRef(true); const navigation = useRef(0);
  useEffect(() => { live.current = true; void refresh(); const timer = setInterval(() => void refresh(), 2000); return () => { live.current = false; navigation.current++; clearInterval(timer); }; }, [refresh]);
  if (!view?.projects.length || !open) return null;
  return <details className="supervision-overlay" open><summary>ADE-Projekte · {view.projects.length}</summary>
    {error && <p role="alert">{error}</p>}
    <SupervisionGraph view={view} onProject={id => { navigation.current++; open(id); }} onWork={target => {
      const attempt = ++navigation.current; const current = () => live.current && navigation.current === attempt;
      void navigateSupervisedWork(target, current).catch(reason => { if (current()) useSupervision.setState({ error: String(reason) }); });
    }} />
  </details>;
}
