import { localizedState } from '../../shared/i18n/states';
import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { t as translate } from "../../shared/i18n";
import { localizedLabels } from "../../shared/i18n/labels";
import { useLocale } from "../i18n/language";
import { createContext, useContext, useEffect, useRef } from 'react';
import type { SupervisionTarget, SupervisionView } from '../../shared/supervision';
import { useSupervision } from './supervisionState';
import { navigateSupervisedWork } from './navigateSupervisedWork';
import './supervision.css';

export const SupervisionContext = createContext<((repositoryId?: string) => void) | null>(null);
export const SUPERVISION_MODE_LABELS = localizedLabels(() => ({ direct: translate("Direct"), observe: translate("Observe"), coordinate: translate("Coordinate") } as const));
export function SupervisionButton({ repositoryId, id }: { repositoryId?: string; id?: string }) {
  useLocale();
  const open = useContext(SupervisionContext);
  return open ? <button id={id} type="button" className="session-switch-trigger" onClick={event => { event.currentTarget.focus(); open(repositoryId); }}>{repositoryId ? translate('Project supervision') : translate('Conversations')}</button> : null;
}
/** Exact host-owned edges only. No inferred relationship from profile names or output text. */
export function SupervisionGraph({ view, onProject, onWork }: { view: SupervisionView; onProject(id: string): void; onWork(target: SupervisionTarget): void }) {
  useLocale();
  return <section className="supervision-graph" aria-label={translate("ADE project links")}>
    <div className="supervision-root">{translate("ADE ·")}{" "}{view.profile?.name ?? translate("Supervision plan")}</div>
    {!view.projects.length && <p>{translate("No projects assigned yet.")}</p>}
    <ul>{view.projects.map(project => <li key={project.id} data-supervised-project={project.id}>
      <button type="button" aria-label={translate("Open supervision: {{value1}}", { value1: project.name })} onClick={() => onProject(project.repositoryId)}>
        <strong>{project.name}</strong><span>{SUPERVISION_MODE_LABELS[project.mode]}{!project.available && translate(" · Not available [20c2b720]")}</span>
      </button>
      <ul>{project.links.map(link => <li key={link.id} data-supervision-link={link.id}>
        <button type="button" disabled={!link.available} onClick={() => onWork(link.target)} aria-label={translate("Open linked {{value1}}: {{value2}}", { value1: link.target.kind === 'session' ? translate("Session") : translate("Work"), value2: link.title })}>
          <strong>{link.title}</strong><span>{link.target.kind === 'session' ? translate("Session") : translate("Run")} · {localizedState(link.status)}</span>
        </button>
      </li>)}</ul>
    </li>)}</ul>
  </section>;
}
export function DesktopSupervisionGraph() {
  useLocale();
  const { view, error, refresh } = useSupervision(); const open = useContext(SupervisionContext);
  const live = useRef(true); const navigation = useRef(0);
  useEffect(() => { live.current = true; void refresh(); const timer = setInterval(() => void refresh(), 2000); return () => { live.current = false; navigation.current++; clearInterval(timer); }; }, [refresh]);
  if (!view?.projects.length || !open) return null;
  return <details className="supervision-overlay" open><summary>{translate("ADE projects ·")}{" "}{view.projects.length}</summary>
    {error && <p role="alert">{localizeAppMessage(error)}</p>}
    <SupervisionGraph view={view} onProject={id => { navigation.current++; open(id); }} onWork={target => {
      const attempt = ++navigation.current; const current = () => live.current && navigation.current === attempt;
      void navigateSupervisedWork(target, current).catch(reason => { if (current()) useSupervision.setState({ error: String(reason) }); });
    }} />
  </details>;
}
