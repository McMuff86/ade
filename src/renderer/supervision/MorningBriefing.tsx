import { localizedState } from '../../shared/i18n/states';
import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { intlLocale } from '../../shared/i18n';
import { t as translate } from "../../shared/i18n";
import { localizedLabels } from "../../shared/i18n/labels";
import { useLocale } from "../i18n/language";
import { useEffect, useRef, useState } from 'react';
import { validHandoffText, type HandoffDetail, type MorningBriefing, type SupervisionAction, type SupervisionView } from '../../shared/supervision';

export interface HandoffQueries {
  briefing(): Promise<MorningBriefing>;
  handoff(projectId: string, handoffId: string): Promise<HandoffDetail>;
}
const suggestions: Record<MorningBriefing['projects'][number]['suggestion'], string> = localizedLabels(() => ({
  'answer-question': translate("First, answer the open question of this work."),
  'review-failure': translate("Check the failed job and its result."),
  'resume-handoff': translate("Read the earmarked handover and select the next step."),
  'observe-work': translate("Let the ongoing work continue and examine its status."),
  'choose-work': translate("Choose a next assignment or conversation for this project."),
}));
export function MorningOverview({ queries, command, busy }: { queries: HandoffQueries; command(action: SupervisionAction, revision: number): Promise<number>; busy: boolean }) {
  useLocale();
  const [briefing, setBriefing] = useState<MorningBriefing | null>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const [details, setDetails] = useState<Record<string, HandoffDetail>>({}); const [reading, setReading] = useState('');
  const [notice, setNotice] = useState(''); const live = useRef(true); const generation = useRef(0);
  useEffect(() => { live.current = true; return () => { live.current = false; generation.current++; }; }, []);
  const load = async () => {
    const current = ++generation.current; setLoading(true); setError('');
    try { const next = await queries.briefing(); if (live.current && current === generation.current) setBriefing(next); }
    catch (reason) { if (live.current && current === generation.current) setError(String(reason)); }
    finally { if (live.current && current === generation.current) setLoading(false); }
  };
  return <section className="morning-overview" aria-label={translate("Morning briefing")}>
    <h3>{translate("Morning briefing")}</h3>
    <p>{translate("Saved handovers and the last known status of your linked work.")}</p>
    <button type="button" disabled={loading || busy} onClick={() => void load()}>{loading ? translate("Loading status…") : translate("Load morning briefing")}</button>
    {error && <p role="alert">{localizeAppMessage(error)}</p>}{notice && <p role="status">{localizeAppMessage(notice)}</p>}
    {briefing && <>
      <p>{translate("Retrieved:")}{" "}{new Date(briefing.observedAt).toLocaleString(intlLocale())}</p>
      {!briefing.projects.length && <p>{translate("No supervised projects yet. Select a project below.")}</p>}
      {briefing.projects.map(project => <article key={project.id} aria-label={translate("Morning status: {{value1}}", { value1: project.name })}>
        <h4>{project.name}{!project.available && translate(" · no longer available")}</h4>
        {!project.work.length && <p>{translate("No work available is linked; no progress can be derived from this.")}</p>}
        <ul>{project.work.map(work => <li key={work.linkId}>{work.title} · {localizedState(work.status)}
          {work.updatedAt !== null && <> {" "}{translate("· Updated")}{" "}{new Date(work.updatedAt).toLocaleString(intlLocale())}</>}
          {work.pendingQuestions > 0 && <> · {work.pendingQuestions}{" "}{translate("open query(s)")}</>}
        </li>)}</ul>
        {!project.handoffs.length && <p>{translate("No handoff saved.")}</p>}
        {project.handoffs.map(handoff => <div className="handoff-entry" key={handoff.id}>
          <p>{translate("Handoff from")}{" "}{new Date(handoff.createdAt).toLocaleString(intlLocale())} · {handoff.status === 'open' ? translate("open") : translate("done")}</p>
          {details[handoff.id] ? <><p className="handoff-text">{details[handoff.id].text}</p>
            {details[handoff.id].nextStep && <p className="handoff-text"><strong>{translate("Planned next step:")}{" "}</strong>{details[handoff.id].nextStep}</p>}
            {details[handoff.id].redacted && <p>{translate("Parts of the handoff are hidden on this device.")}</p>}</>
            : <button type="button" disabled={!!reading || busy} onClick={() => {
              setReading(handoff.id); setError('');
              void queries.handoff(project.id, handoff.id).then(detail => { if (live.current) setDetails(previous => ({ ...previous, [handoff.id]: detail })); })
                .catch(reason => { if (live.current) setError(String(reason)); }).finally(() => { if (live.current) setReading(''); });
            }}>{reading === handoff.id ? translate("Loading handoff…") : translate("Read handoff")}</button>}
          <button type="button" disabled={busy || loading} onClick={() => {
            void command({ operation: 'handoff-status', projectId: project.id, handoffId: handoff.id, status: handoff.status === 'open' ? 'done' : 'open' }, briefing.revision)
              .then(async () => { if (live.current) { setNotice(translate("Handoff status saved.")); await load(); } }).catch(reason => { if (live.current) setError(String(reason)); });
          }}>{handoff.status === 'open' ? translate("Mark as done") : translate("Reopen")}</button>
        </div>)}
        <p><strong>{translate("Proposal:")}{" "}</strong>{suggestions[project.suggestion]}</p>
      </article>)}
    </>}
  </section>;
}

export function HandoffComposer({ project, revision, busy, draftScope, command }: {
  project: SupervisionView['projects'][number]; revision: number; busy: boolean; draftScope: string;
  command(action: SupervisionAction, revision: number): Promise<number>;
}) {
  useLocale();
  const key = `ade:handoff-draft:${draftScope}:${project.id}`;
  const [text, setText] = useState(''); const [nextStep, setNextStep] = useState(''); const [linkId, setLinkId] = useState('');
  const [notice, setNotice] = useState(''); const [error, setError] = useState(''); const live = useRef(true);
  useEffect(() => {
    live.current = true;
    try { const raw = localStorage.getItem(key); if (raw) { const draft = JSON.parse(raw) as Record<string, unknown>;
      if (validHandoffText(draft.text) && validHandoffText(draft.nextStep) && typeof draft.linkId === 'string') { setText(draft.text); setNextStep(draft.nextStep); setLinkId(draft.linkId); }
    } } catch { setNotice(translate("The draft could not be loaded.")); }
    return () => { live.current = false; };
  }, [key]);
  const draft = (value: string, step: string, source: string) => {
    setText(value); setNextStep(step); setLinkId(source); setError('');
    try { localStorage.setItem(key, JSON.stringify({ text: value, nextStep: step, linkId: source })); setNotice(translate("Handoff draft secured on this device.")); }
    catch { setNotice(translate("Draft not permanently secured. Copy text before closing.")); }
  };
  return <section className="handoff-composer" aria-label={translate("Save for next session")}>
    <h3>{translate("Save for next session")}</h3>
    <label>{translate("Handoff")}<textarea aria-label={translate("Handoff")} disabled={busy} value={text} maxLength={4000} rows={3} onChange={e => draft(e.target.value, nextStep, linkId)} /></label>
    <label>{translate("Next step")}<textarea aria-label={translate("Next step")} disabled={busy} value={nextStep} maxLength={4000} rows={2} onChange={e => draft(text, e.target.value, linkId)} /></label>
    <label>{translate("Reference")}<select aria-label={translate("Handoff reference")} disabled={busy} value={linkId} onChange={e => draft(text, nextStep, e.target.value)}>
      <option value="">{translate("This project")}</option>{project.links.map(l => <option key={l.id} value={l.id}>{l.title} · {localizedState(l.status)}</option>)}
    </select></label>
    <button type="button" disabled={busy || !project.available || !text.trim()} onClick={() => {
      setError(''); const saved = JSON.stringify({ text, nextStep, linkId });
      void command({ operation: 'remember', projectId: project.id, text, nextStep, linkId: linkId || null }, revision).then(() => {
        try { if (localStorage.getItem(key) === saved) localStorage.removeItem(key); } catch { /* Acknowledged content remains on the host. */ }
        if (live.current) { setText(''); setNextStep(''); setLinkId(''); setNotice(translate("Saved for the next session. Available in the morning overview.")); }
      }).catch(reason => { if (live.current) setError(String(reason)); });
    }}>{translate("Save handoff")}</button>
    {notice && <p role="status">{localizeAppMessage(notice)}</p>}{error && <p role="alert">{localizeAppMessage(error)}</p>}
  </section>;
}
