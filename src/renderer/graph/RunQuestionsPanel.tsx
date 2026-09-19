import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
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
  useLocale();
  const [view, setView] = useState<RunQuestionsView | null>(null);
  const [error, setError] = useState(''); const [reload, setReload] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    let live = true; let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      if (!online) return;
      try { const value = await port.read(runId); if (live) { setView(value); setError(''); } }
      catch (reason) { if (live) setError(reason instanceof Error ? reason.message : translate("Questions could not be loaded.")); }
      finally { if (live && active) timer = setTimeout(() => { void refresh(); }, 2000); }
    };
    void refresh(); return () => { live = false; if (timer) clearTimeout(timer); };
  }, [runId, port, online, active, reload]);
  const count = view?.tasks.reduce((sum, task) => sum + task.questions.length, 0) ?? 0;
  return <section className="run-questions" aria-label={translate("Agent questions")}>
    <h3 ref={heading} tabIndex={-1}>{translate("Questions")}{" "}{count > 0 ? `(${count})` : ''}</h3>
    {!online && <p role="status">{translate("Connection interrupted. Your input is preserved in this open window.")}</p>}
    {error && <p role="alert">{localizeAppMessage(error)} <button type="button" disabled={!online} onClick={() => setReload((value) => value + 1)}>{translate("Reload questions")}</button></p>}
    {!view && !error && online && <p role="status">{translate("Loading questions…")}</p>}
    {view && !count && <p role="status">{translate("No open questions.")}</p>}
    {count > 0 && <p role="status">{count} {" "}{translate("Question")}{count === 1 ? '' : 'n'} {" "}{translate("open. Blocking questions pause the task time limit.")}</p>}
    {view?.tasks.flatMap((task) => task.questions.map((question) => <QuestionCard key={question.id} question={question}
      taskId={task.taskId} runId={runId} label={`${task.agentName} · ${task.title}`} port={port}
      online={online} canAnswer={canAnswer} onAnswered={() => { heading.current?.focus(); setReload((value) => value + 1); }} />))}
  </section>;
}

export function QuestionCard({ question, taskId, runId, label, port, online, canAnswer, onAnswered, unavailableReason }: {
  question: RunQuestion; taskId: string; runId: string; label: string; port: RunQuestionsPort;
  online: boolean; canAnswer: boolean; onAnswered(): void; unavailableReason?: string;
}): JSX.Element {
  useLocale();
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
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : translate("Answer could not be confirmed.")); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  return <form className="run-question" onSubmit={(event) => { event.preventDefault(); void send(); }}>
    <p><strong>{label}</strong> · {question.blocking ? translate("Wait for your response") : translate("The agent continues to work")}</p>
    {question.questions.map((item) => <fieldset key={item.id} disabled={busy || !!pending || question.status === 'answering'}>
      <legend>{item.header}</legend><p className="run-question-text">{item.question}</p>
      {item.options?.map((option, index) => <label key={index} className="run-question-option">
        <input type="radio" name={`${question.id}-${item.id}`} checked={choices[item.id] === option.label}
          onChange={() => setChoices((value) => ({ ...value, [item.id]: option.label }))} />
        <span>{option.label}{option.description && <small>{option.description}</small>}</span>
      </label>)}
      {item.options && item.isOther && <label><input type="radio" name={`${question.id}-${item.id}`} checked={choices[item.id] === '__free'}
        onChange={() => setChoices((value) => ({ ...value, [item.id]: '__free' }))} />{translate("Own response")}</label>}
      {(!item.options || item.isOther && choices[item.id] === '__free') && <label>{item.isSecret ? translate("Confidential response") : translate("Your reply")}
        {item.isSecret ? <input type="password" autoComplete="off" value={free[item.id] ?? ''} maxLength={8000}
          onChange={(event) => setFree((value) => ({ ...value, [item.id]: event.target.value }))} />
          : <textarea rows={3} value={free[item.id] ?? ''} maxLength={8000} onChange={(event) => setFree((value) => ({ ...value, [item.id]: event.target.value }))} />}
      </label>}
    </fieldset>)}
    {!canAnswer && <p>{unavailableReason ?? translate("To answer, release the run permissions of this device on the PC.")}</p>}
    {question.status === 'answering' && <p role="status">{translate("Codex is confirming receipt of your answer…")}</p>}
    {error && <p role="alert">{localizeAppMessage(error)} {" "}{translate("A recheck sends the same response with the same process ID.")}</p>}
    <button type="submit" disabled={busy || !online || !canAnswer || (!pending && (!complete || question.status !== 'pending'))}>
      {busy ? translate("Confirming answer…") : pending ? translate("Check answer again") : translate("Send a reply")}</button>
    <p className="run-question-note">{translate("The form input remains only in this window, and your response will be sent to the agent and may appear in its result.")}</p>
  </form>;
}
