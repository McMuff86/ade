import { localizedState } from '../../shared/i18n/states';
import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { validSupervisionMode, validSupervisionObjective, type SupervisionMode, type SupervisionView, type SupervisionAction, type SupervisionTarget } from '../../shared/supervision';
import { Modal } from '../onboarding/Modal';
import { useAppData } from '../stores/appdata';
import { useSessions } from '../stores/sessions';
import { useRuns } from '../stores/runs';
import { useMode } from '../stores/mode';
import { useSupervision } from './supervisionState';
import { SupervisionGraph, SUPERVISION_MODE_LABELS } from './SupervisionGraph';
import { navigateSupervisedWork } from './navigateSupervisedWork';
import { HandoffComposer, MorningOverview, type HandoffQueries } from './MorningBriefing';
import { DesktopConversation } from '../conversation/DesktopConversation';
import { ConversationModes } from '../conversation/ConversationModes';

export function DesktopSupervision({ repositoryId, onClose }: { repositoryId?: string; onClose(): void }) {
  useLocale();
  const [conversation, setConversation] = useState(false);
  const [area, setArea] = useState<'home' | 'project' | 'casual'>(repositoryId ? 'project' : 'home');
  const backToModes = () => { setArea('home'); requestAnimationFrame(() => document.getElementById(`conversation-mode-${area}`)?.focus()); };
  const controller = useSupervision(); const { repositories, agents } = useAppData();
  const live = useRef(true); const navigation = useRef(0);
  useEffect(() => { live.current = true; return () => { live.current = false; navigation.current++; }; }, []);
  const sessions = useSessions(s => s.sessions); const runs = useRuns(s => s.runs);
  useEffect(() => { void useSessions.getState().hydrate(true); void useRuns.getState().refresh(); }, []);
  const targets = [...Object.values(sessions).filter(s => s.repositoryId && s.kind === 'interactive' && !s.runTaskId && !s.remoteAccessBlocked)
    .map(s => ({ repositoryId: s.repositoryId!, target: { kind: 'session' as const, id: s.id }, label: `${s.title} · ${s.branch ?? s.runtime}` })),
    ...runs.filter(r => r.repositoryId).map(r => ({ repositoryId: r.repositoryId!, target: { kind: 'run' as const, id: r.id }, label: `${r.name} · ${r.status}` }))];
  if (conversation) return <DesktopConversation onClose={onClose} onBack={() => { setConversation(false); requestAnimationFrame(() => document.getElementById('ade-conversation-open')?.focus()); }} />;
  if (area === 'casual') return <DesktopConversation mode="casual" onClose={onClose} onBack={backToModes} />;
  if (area === 'home') return <Modal key="conversation-home" title={translate('Conversations')} onClose={onClose} className="conversation-dialog" fallbackFocus={() => document.getElementById('desktop-supervision')}><ConversationModes onChoose={setArea} /></Modal>;
  return <Modal key="project-supervision" title={translate('Project supervision')} onClose={onClose} className="supervision-dialog" fallbackFocus={() => document.getElementById('desktop-supervision') ?? document.getElementById(`mode-tab-${useMode.getState().mode}`)}>
    <button type="button" onClick={backToModes}>{translate('Back to conversations')}</button>
    <button id="ade-conversation-open" type="button" onClick={() => setConversation(true)}>{translate("Talk to ADE")}</button>
    <SupervisionContent repositoryId={repositoryId} controller={controller} repositories={repositories} agents={Object.values(agents)} targets={targets}
      handoffs={{ briefing: () => window.ade.invoke('supervision:briefing'), handoff: (projectId, handoffId) => window.ade.invoke('supervision:handoff', { projectId, handoffId }) }}
      detail={projectId => window.ade.invoke('supervision:detail', { projectId })} draftScope="desktop" onClose={onClose}
      onNavigate={target => {
        const attempt = ++navigation.current; const current = () => live.current && navigation.current === attempt;
        void navigateSupervisedWork(target, current).then(() => { if (current()) onClose(); }).catch(reason => { if (current()) useSupervision.setState({ error: String(reason) }); });
      }} />
  </Modal>;
}
export interface SupervisionController {
  view: SupervisionView | null; error: string; busy: boolean; refresh(): Promise<void>; command(action: SupervisionAction, revision: number): Promise<number>;
}
export interface SupervisionContentProps {
  repositoryId?: string; controller: SupervisionController;
  repositories: Array<{ id: string; name: string; verified: boolean }>; agents: Array<{ id: string; name: string; runtime: string }>;
  targets: Array<{ repositoryId: string; target: SupervisionTarget; label: string }>;
  detail(projectId: string): Promise<{ objective: string; redacted?: boolean }>;
  handoffs: HandoffQueries;
  draftScope: string; onClose(): void; onNavigate(target: SupervisionTarget): void;
}
export function SupervisionContent({ repositoryId, controller, repositories, agents, targets, detail, handoffs, draftScope, onClose, onNavigate }: SupervisionContentProps) {
  useLocale();
  const { view, error, busy, refresh, command } = controller;
  const [selected, setSelected] = useState(repositoryId ?? ''); const [profile, setProfile] = useState('');
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (view) setProfile(view.profile?.id ?? ''); }, [view?.profile?.id]);
  return <div className="supervision-panel">
      <p>{translate("Management plan for your projects. Automatic execution is connected separately.")}</p>
      {error && <p role="alert">{localizeAppMessage(error)}</p>}{!view && !error && <p role="status">{translate("Loading supervision…")}</p>}
      <button type="button" disabled={busy} onClick={() => void refresh()}>{translate("Refresh supervision")}</button>
      {view && <>
        <MorningOverview queries={handoffs} command={command} busy={busy} />
        <label>{translate("Central ADE profile")}<select aria-label={translate("Central ADE profile")} value={profile} onChange={e => setProfile(e.target.value)}>
          <option value="">{translate("Not yet selected")}</option>{agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name} · {agent.runtime}</option>)}
        </select></label>
        <button type="button" disabled={busy || profile === (view.profile?.id ?? '')} onClick={() => void command({ operation: 'profile', agentId: profile || null }, view.revision).catch(() => undefined)}>{translate("Save the ADE profile")}</button>
        <SupervisionGraph view={view} onProject={setSelected} onWork={onNavigate} />
        <label>{translate("Supervise project")}<select aria-label={translate("Supervise project")} value={selected} onChange={e => setSelected(e.target.value)}>
          <option value="">{translate("Choose project [50726f6a]")}</option>{repositories.filter(repo => repo.verified).map(repo => <option key={repo.id} value={repo.id}>{repo.name}</option>)}
        </select></label>
        {!repositories.length && <p>{translate("First open a project in ADE.")}</p>}
        {selected && <ProjectSupervision key={selected} repositoryId={selected} view={view} controller={controller} detail={detail} targets={targets} draftScope={draftScope} />}
        {view.projects.find(p => p.repositoryId === selected) && <HandoffComposer key={`handoff-${selected}`} project={view.projects.find(p => p.repositoryId === selected)!}
          revision={view.revision} busy={busy} draftScope={draftScope} command={command} />}
      </>}
      <button type="button" onClick={onClose}>{translate("Close")}</button>
    </div>
  ;
}
function ProjectSupervision({ repositoryId, view, controller, detail, targets, draftScope }: Pick<SupervisionContentProps, 'controller' | 'detail' | 'targets' | 'draftScope'> & { repositoryId: string; view: SupervisionView }) {
  useLocale();
  const project = view.projects.find(p => p.repositoryId === repositoryId); const { command, busy } = controller;
  const [objective, setObjective] = useState(''); const [mode, setMode] = useState<SupervisionMode>(project?.mode ?? 'direct');
  const [revision, setRevision] = useState(view.revision); const [loaded, setLoaded] = useState(false); const [detailError, setDetailError] = useState('');
  const [draftNotice, setDraftNotice] = useState('');
  const draftKey = `ade:supervision-draft:${draftScope}:${repositoryId}`;
  const [redacted, setRedacted] = useState(false);
  const objectiveInput = useRef<HTMLTextAreaElement>(null); const restoreFocus = useRef(false);
  useLayoutEffect(() => { if (loaded && restoreFocus.current) { restoreFocus.current = false; objectiveInput.current?.focus(); } }, [loaded]);
  const live = useRef(true);
  const load = async (restoreDraft: boolean) => {
    if (!restoreDraft) restoreFocus.current = true;
    setLoaded(false); setDetailError('');
    try {
      const result = project ? await detail(project.id) : { objective: '' };
      if (!live.current) return;
      setObjective(result.objective); setMode(project?.mode ?? 'direct'); setRevision(view.revision); setRedacted(!!result.redacted);
      try {
        const raw = restoreDraft ? localStorage.getItem(draftKey) : null;
        if (raw) { const draft: unknown = JSON.parse(raw);
          if (draft && typeof draft === 'object' && 'revision' in draft && 'mode' in draft && 'objective' in draft && Number.isSafeInteger(draft.revision)
            && (draft.revision as number) >= 0 && validSupervisionMode(draft.mode) && validSupervisionObjective(draft.objective)) {
            setObjective(draft.objective); setMode(draft.mode); setRevision(draft.revision as number); setDraftNotice(translate("Unsaved project draft restored."));
          }
        }
        if (!restoreDraft) { localStorage.removeItem(draftKey); setDraftNotice(translate("Current job loaded.")); }
      } catch { setDraftNotice(translate("Draft cannot be permanently stored on this device. Copy text before closing.")); }
      setLoaded(true);
    } catch (reason) { if (live.current) setDetailError(String(reason)); }
  };
  const draft = (text: string, nextMode: SupervisionMode) => {
    if (text !== objective) setRedacted(false);
    setObjective(text); setMode(nextMode);
    try { localStorage.setItem(draftKey, JSON.stringify({ revision, mode: nextMode, objective: text })); setDraftNotice(translate("Draft saved on this device. [456e7477]")); }
    catch { setDraftNotice(translate("Draft cannot be permanently stored on this device. Copy text before closing.")); }
  };
  useEffect(() => { live.current = true; void load(true);
    return () => { live.current = false; };
  }, []);
  const candidates = targets.filter(item => item.repositoryId === repositoryId && !project?.links.some(l => l.target.id === item.target.id && l.target.kind === item.target.kind));
  return <section className="supervision-editor" aria-label={translate("Edit project supervision")}>
    {detailError && <p role="alert">{detailError}</p>}{!loaded && !detailError && <p role="status">{translate("Loading assignment…")}</p>}
    {loaded && <>
      <label>{translate("Supervision mode")}<select aria-label={translate("Supervision mode")} value={mode} onChange={e => draft(objective, e.target.value as SupervisionMode)}>
        {Object.entries(SUPERVISION_MODE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>{translate("Assignment for this project")}<textarea ref={objectiveInput} aria-label={translate("Assignment for this project")} rows={4} maxLength={8000} value={objective} onChange={e => draft(e.target.value, mode)} /></label>
      {draftNotice && <p role="status">{draftNotice}</p>}
      {redacted && <p role="status">{translate("Parts of the assignment are hidden on this device. Enter a new assignment to replace it.")}</p>}
      {revision !== view.revision && <p role="status">{translate("Supervision state changed. Reload before saving.")}</p>}
      <button type="button" disabled={busy || redacted || revision !== view.revision} onClick={() => {
        void command({ operation: 'project', repositoryId, mode, objective }, revision).then(savedRevision => {
          try { const saved = localStorage.getItem(draftKey); if (saved === JSON.stringify({ revision, mode, objective })) localStorage.removeItem(draftKey); } catch { /* Preserve visible state. */ }
          if (live.current) { setRevision(savedRevision); setDraftNotice(translate("Project supervision saved.")); }
        }).catch(() => undefined);
      }}>{translate("Save project supervision")}</button>
      {revision !== view.revision && <button type="button" disabled={busy} onClick={() => void load(false)}>{translate("Load current assignment")}</button>}
      {project && <><h3>{translate("Linked work")}</h3>{!project.links.length && <p>{translate("No session or work linked yet.")}</p>}
        <ul>{project.links.map(link => <li key={link.id}>{link.title} · {localizedState(link.status)}
          {link.origin === 'conversation' ? <span>{translate("From ADE conversation")}</span> : <button type="button" disabled={busy} aria-label={translate("Unlink: {{value1}}", { value1: link.title })} onClick={() => void command({ operation: 'unlink', projectId: project.id, linkId: link.id }, view.revision).catch(() => undefined)}>{translate("Unlink")}</button>}
        </li>)}</ul>
        {candidates.map(item => <button type="button" key={`${item.target.kind}:${item.target.id}`} disabled={busy}
          data-supervision-target={`${item.target.kind}:${item.target.id}`}
          onClick={() => void command({ operation: 'link', projectId: project.id, target: item.target }, view.revision).catch(() => undefined)}>{translate("Linking:")}{" "}{item.label}</button>)}
      </>}
    </>}
  </section>;
}
