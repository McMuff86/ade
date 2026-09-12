import { useEffect, useRef, useState, type JSX } from 'react';
import type { RunQuestion, RunQuestionAnswerInput, RunQuestionAnswers, RunQuestionsView } from '../../shared/runQuestions';
import './runQuestions.css';

export interface RunQuestionsPort {
  read(runId: string): Promise<RunQuestionsView>;
  answer(input: RunQuestionAnswerInput, key: string): Promise<unknown>;
}
export const desktopRunQuestions: RunQuestionsPort = {
  read: (runId) => window.ade.invoke('run:questions', { runId }),
  answer: (input, commandId) => window.ade.invoke('run:answer', { ...input, commandId }),
};

export function RunQuestionsPanel({ runId, port, online, canAnswer, active = true }: {
  runId: string; port: RunQuestionsPort; online: boolean; canAnswer: boolean; active?: boolean;
}): JSX.Element {
  const [view, setView] = useState<RunQuestionsView | null>(null);
  const [error, setError] = useState(''); const [reload, setReload] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    let live = true; let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      if (!online) return;
      try { const value = await port.read(runId); if (live) { setView(value); setError(''); } }
      catch (reason) { if (live) setError(reason instanceof Error ? reason.message : 'Rückfragen konnten nicht geladen werden.'); }
      finally { if (live && active) timer = setTimeout(() => { void refresh(); }, 2000); }
    };
    void refresh(); return () => { live = false; if (timer) clearTimeout(timer); };
  }, [runId, port, online, active, reload]);
  const count = view?.tasks.reduce((sum, task) => sum + task.questions.length, 0) ?? 0;
  return <section className="run-questions" aria-label="Rückfragen des Agenten">
    <h3 ref={heading} tabIndex={-1}>Rückfragen {count > 0 ? `(${count})` : ''}</h3>
    {!online && <p role="status">Verbindung unterbrochen. Deine Eingabe bleibt in diesem geöffneten Fenster erhalten.</p>}
    {error && <p role="alert">{error} <button type="button" disabled={!online} onClick={() => setReload((value) => value + 1)}>Rückfragen erneut laden</button></p>}
    {!view && !error && online && <p role="status">Rückfragen werden geladen…</p>}
    {view && !count && <p role="status">Keine offenen Rückfragen.</p>}
    {count > 0 && <p role="status">{count} Rückfrage{count === 1 ? '' : 'n'} offen. Blockierende Fragen pausieren das Zeitlimit der jeweiligen Aufgabe.</p>}
    {view?.tasks.flatMap((task) => task.questions.map((question) => <QuestionCard key={question.id} question={question}
      taskId={task.taskId} runId={runId} label={`${task.agentName} · ${task.title}`} port={port}
      online={online} canAnswer={canAnswer} onAnswered={() => { heading.current?.focus(); setReload((value) => value + 1); }} />))}
  </section>;
}

function QuestionCard({ question, taskId, runId, label, port, online, canAnswer, onAnswered }: {
  question: RunQuestion; taskId: string; runId: string; label: string; port: RunQuestionsPort;
  online: boolean; canAnswer: boolean; onAnswered(): void;
}): JSX.Element {
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [free, setFree] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [pending, setPending] = useState<{ key: string; answers: RunQuestionAnswers }>();
  const lock = useRef(false); const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const answers: RunQuestionAnswers = Object.fromEntries(question.questions.map((item) => [item.id, {
    answers: [item.options && choices[item.id] !== '__free' ? choices[item.id] ?? '' : free[item.id] ?? ''],
  }]));
  const complete = Object.values(answers).every((item) => item.answers[0]?.trim());
  const send = async () => {
    if (lock.current || !online || !canAnswer || !pending && !complete) return;
    lock.current = true; setBusy(true); setError('');
    const attempt = pending ?? { key: crypto.randomUUID(), answers }; setPending(attempt);
    try {
      await port.answer({ runId, taskId, questionId: question.id, answers: attempt.answers }, attempt.key);
      if (mounted.current) { setFree({}); setChoices({}); setPending(undefined); onAnswered(); }
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : 'Antwort konnte nicht bestätigt werden.'); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  return <form className="run-question" onSubmit={(event) => { event.preventDefault(); void send(); }}>
    <p><strong>{label}</strong> · {question.blocking ? 'Wartet auf deine Antwort' : 'Agent arbeitet weiter'}</p>
    {question.questions.map((item) => <fieldset key={item.id} disabled={busy || !!pending || question.status === 'answering'}>
      <legend>{item.header}</legend><p className="run-question-text">{item.question}</p>
      {item.options?.map((option, index) => <label key={index} className="run-question-option">
        <input type="radio" name={`${question.id}-${item.id}`} checked={choices[item.id] === option.label}
          onChange={() => setChoices((value) => ({ ...value, [item.id]: option.label }))} />
        <span>{option.label}{option.description && <small>{option.description}</small>}</span>
      </label>)}
      {item.options && item.isOther && <label><input type="radio" name={`${question.id}-${item.id}`} checked={choices[item.id] === '__free'}
        onChange={() => setChoices((value) => ({ ...value, [item.id]: '__free' }))} />Eigene Antwort</label>}
      {(!item.options || item.isOther && choices[item.id] === '__free') && <label>{item.isSecret ? 'Vertrauliche Antwort' : 'Deine Antwort'}
        {item.isSecret ? <input type="password" autoComplete="off" value={free[item.id] ?? ''} maxLength={8000}
          onChange={(event) => setFree((value) => ({ ...value, [item.id]: event.target.value }))} />
          : <textarea rows={3} value={free[item.id] ?? ''} maxLength={8000} onChange={(event) => setFree((value) => ({ ...value, [item.id]: event.target.value }))} />}
      </label>}
    </fieldset>)}
    {!canAnswer && <p>Zum Antworten die Run-Schreibrechte dieses Geräts am PC freigeben.</p>}
    {question.status === 'answering' && <p role="status">Codex bestätigt den Empfang deiner Antwort…</p>}
    {error && <p role="alert">{error} Eine erneute Prüfung sendet dieselbe Antwort mit derselben Vorgangs-ID.</p>}
    <button type="submit" disabled={busy || !online || !canAnswer || (!pending && (!complete || question.status !== 'pending'))}>
      {busy ? 'Antwort wird bestätigt…' : pending ? 'Antwort erneut prüfen' : 'Antwort senden'}</button>
    <p className="run-question-note">Die Formulareingabe bleibt nur in diesem Fenster. Deine Antwort wird an den Agenten übermittelt und kann in seinem Ergebnis vorkommen.</p>
  </form>;
}
