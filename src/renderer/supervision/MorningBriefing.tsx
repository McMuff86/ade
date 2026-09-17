import { useEffect, useRef, useState } from 'react';
import { validHandoffText, type HandoffDetail, type MorningBriefing, type SupervisionAction, type SupervisionView } from '../../shared/supervision';

export interface HandoffQueries {
  briefing(): Promise<MorningBriefing>;
  handoff(projectId: string, handoffId: string): Promise<HandoffDetail>;
}
const suggestions: Record<MorningBriefing['projects'][number]['suggestion'], string> = {
  'answer-question': 'Zuerst die offene Rückfrage dieser Arbeit beantworten.',
  'review-failure': 'Den fehlgeschlagenen Auftrag und sein Ergebnis prüfen.',
  'resume-handoff': 'Die vorgemerkte Übergabe lesen und den nächsten Schritt auswählen.',
  'observe-work': 'Die laufende Arbeit weiterarbeiten lassen und ihren Stand prüfen.',
  'choose-work': 'Einen nächsten Auftrag oder ein Gespräch für dieses Projekt auswählen.',
};
export function MorningOverview({ queries, command, busy }: { queries: HandoffQueries; command(action: SupervisionAction, revision: number): Promise<number>; busy: boolean }) {
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
  return <section className="morning-overview" aria-label="Morgenüberblick">
    <h3>Morgenüberblick</h3>
    <p>Gespeicherte Übergaben und der zuletzt bekannte Stand deiner verknüpften Arbeit.</p>
    <button type="button" disabled={loading || busy} onClick={() => void load()}>{loading ? 'Stand wird geladen…' : 'Morgenüberblick laden'}</button>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {briefing && <>
      <p>Abgefragt: {new Date(briefing.observedAt).toLocaleString('de-CH')}</p>
      {!briefing.projects.length && <p>Noch keine betreuten Projekte. Wähle unten ein Projekt aus.</p>}
      {briefing.projects.map(project => <article key={project.id} aria-label={`Morgenstand: ${project.name}`}>
        <h4>{project.name}{!project.available && ' · nicht mehr verfügbar'}</h4>
        {!project.work.length && <p>Keine verfügbare Arbeit verknüpft. Daraus lässt sich kein Arbeitsfortschritt ableiten.</p>}
        <ul>{project.work.map(work => <li key={work.linkId}>{work.title} · {work.status}
          {work.updatedAt !== null && <> · aktualisiert {new Date(work.updatedAt).toLocaleString('de-CH')}</>}
          {work.pendingQuestions > 0 && <> · {work.pendingQuestions} offene Rückfrage(n)</>}
        </li>)}</ul>
        {!project.handoffs.length && <p>Keine Übergabe vorgemerkt.</p>}
        {project.handoffs.map(handoff => <div className="handoff-entry" key={handoff.id}>
          <p>Übergabe vom {new Date(handoff.createdAt).toLocaleString('de-CH')} · {handoff.status === 'open' ? 'offen' : 'erledigt'}</p>
          {details[handoff.id] ? <><p className="handoff-text">{details[handoff.id].text}</p>
            {details[handoff.id].nextStep && <p className="handoff-text"><strong>Vorgemerkter nächster Schritt: </strong>{details[handoff.id].nextStep}</p>}
            {details[handoff.id].redacted && <p>Teile der Übergabe sind auf diesem Gerät ausgeblendet.</p>}</>
            : <button type="button" disabled={!!reading || busy} onClick={() => {
              setReading(handoff.id); setError('');
              void queries.handoff(project.id, handoff.id).then(detail => { if (live.current) setDetails(previous => ({ ...previous, [handoff.id]: detail })); })
                .catch(reason => { if (live.current) setError(String(reason)); }).finally(() => { if (live.current) setReading(''); });
            }}>{reading === handoff.id ? 'Übergabe wird geladen…' : 'Übergabe lesen'}</button>}
          <button type="button" disabled={busy || loading} onClick={() => {
            void command({ operation: 'handoff-status', projectId: project.id, handoffId: handoff.id, status: handoff.status === 'open' ? 'done' : 'open' }, briefing.revision)
              .then(async () => { if (live.current) { setNotice('Übergabestatus gespeichert.'); await load(); } }).catch(reason => { if (live.current) setError(String(reason)); });
          }}>{handoff.status === 'open' ? 'Als erledigt markieren' : 'Wieder öffnen'}</button>
        </div>)}
        <p><strong>Vorschlag: </strong>{suggestions[project.suggestion]}</p>
      </article>)}
    </>}
  </section>;
}

export function HandoffComposer({ project, revision, busy, draftScope, command }: {
  project: SupervisionView['projects'][number]; revision: number; busy: boolean; draftScope: string;
  command(action: SupervisionAction, revision: number): Promise<number>;
}) {
  const key = `ade:handoff-draft:${draftScope}:${project.id}`;
  const [text, setText] = useState(''); const [nextStep, setNextStep] = useState(''); const [linkId, setLinkId] = useState('');
  const [notice, setNotice] = useState(''); const [error, setError] = useState(''); const live = useRef(true);
  useEffect(() => {
    live.current = true;
    try { const raw = localStorage.getItem(key); if (raw) { const draft = JSON.parse(raw) as Record<string, unknown>;
      if (validHandoffText(draft.text) && validHandoffText(draft.nextStep) && typeof draft.linkId === 'string') { setText(draft.text); setNextStep(draft.nextStep); setLinkId(draft.linkId); }
    } } catch { setNotice('Entwurf konnte nicht geladen werden.'); }
    return () => { live.current = false; };
  }, [key]);
  const draft = (value: string, step: string, source: string) => {
    setText(value); setNextStep(step); setLinkId(source); setError('');
    try { localStorage.setItem(key, JSON.stringify({ text: value, nextStep: step, linkId: source })); setNotice('Übergabeentwurf auf diesem Gerät gesichert.'); }
    catch { setNotice('Entwurf nicht dauerhaft gesichert. Text vor dem Schliessen kopieren.'); }
  };
  return <section className="handoff-composer" aria-label="Für nächste Session merken">
    <h3>Für nächste Session merken</h3>
    <label>Übergabe<textarea aria-label="Übergabe" disabled={busy} value={text} maxLength={4000} rows={3} onChange={e => draft(e.target.value, nextStep, linkId)} /></label>
    <label>Nächster Schritt<textarea aria-label="Nächster Schritt" disabled={busy} value={nextStep} maxLength={4000} rows={2} onChange={e => draft(text, e.target.value, linkId)} /></label>
    <label>Bezug<select aria-label="Übergabebezug" disabled={busy} value={linkId} onChange={e => draft(text, nextStep, e.target.value)}>
      <option value="">Dieses Projekt</option>{project.links.map(l => <option key={l.id} value={l.id}>{l.title} · {l.status}</option>)}
    </select></label>
    <button type="button" disabled={busy || !project.available || !text.trim()} onClick={() => {
      setError(''); const saved = JSON.stringify({ text, nextStep, linkId });
      void command({ operation: 'remember', projectId: project.id, text, nextStep, linkId: linkId || null }, revision).then(() => {
        try { if (localStorage.getItem(key) === saved) localStorage.removeItem(key); } catch { /* Acknowledged content remains on the host. */ }
        if (live.current) { setText(''); setNextStep(''); setLinkId(''); setNotice('Für die nächste Session gespeichert. Im Morgenüberblick abrufbar.'); }
      }).catch(reason => { if (live.current) setError(String(reason)); });
    }}>Übergabe speichern</button>
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
