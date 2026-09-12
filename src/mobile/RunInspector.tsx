import { RunQuestionsPanel, type RunQuestionsPort } from '../renderer/graph/RunQuestionsPanel';
import { useLayoutEffect, useMemo, useRef, type JSX } from 'react';
import type { MobileRunSummary } from '../shared/remote';
import type { MobileHost, PendingCommand } from './useMobileHost';
import { formatCostUsd, formatTokenCount } from '../shared/overviewFormat';
import { Avatar } from '../renderer/rail/Avatar';
import { finalStates, runKindLabel, Status } from './ui';
import { RunActivityPanel } from './RunActivityPanel';

export function RunInspector({ run, participantId, host, onSend, focusVersion }: { run: MobileRunSummary; participantId: string | null;
  host: MobileHost; onSend: (command: PendingCommand) => void; focusVersion: number;
}): JSX.Element {
  const title = useRef<HTMLHeadingElement>(null);
  const questionPort = useMemo<RunQuestionsPort>(() => ({ read: (id) => host.request(`/api/v1/runs/${id}/questions`),
    answer: (input, key) => host.request(`/api/v1/runs/${input.runId}/answers`, 'POST', { taskId: input.taskId, questionId: input.questionId, answers: input.answers }, key),
  }), [host.request]);
  useLayoutEffect(() => { title.current?.focus(); }, [run.id, participantId, focusVersion]);
  const participant = run.participants.find((item) => item.id === participantId);
  const tasks = participant ? run.tasks.filter((task) => task.participantId === participant.id) : run.tasks;
  const tokens = run.usage.inputTokens + run.usage.outputTokens;
  return <div className="m-run-inspector run-detail">
    <div className="m-inspector-identity">{participant && <Avatar name={participant.agentName} size={38} />}<div>
      <span className="m-eyebrow">{participant?.role ?? 'Run'}</span><h2 id="run-detail-title" ref={title} tabIndex={-1} data-inspector-heading>{participant?.agentName ?? run.name}</h2></div></div>
    <div className="m-inspector-tags"><Status status={run.status} /><span>{run.phase}</span><span>{runKindLabel(run)}</span></div>
    <section><h3>Kontext</h3><dl><dt>Run</dt><dd>{run.name}</dd><dt>Repository</dt><dd>{run.repositoryName ?? 'Nicht zugeordnet'}</dd>
      {run.branch && <><dt>Branch</dt><dd>{run.branch}</dd></>}{participant?.teamName && <><dt>Team</dt><dd>{participant.teamName}</dd></>}</dl>
      {run.goal && <p className="m-run-goal">{run.goal}</p>}</section>
    <section><h3>Tasks <span>{tasks.length}</span></h3>
      <div className="m-progress" role="progressbar" aria-label="Abgeschlossene Aufgaben" aria-valuemin={0} aria-valuemax={Math.max(1, tasks.length)} aria-valuenow={tasks.filter((task) => task.status === 'completed').length}>
        <span style={{ width: `${tasks.length ? tasks.filter((task) => task.status === 'completed').length / tasks.length * 100 : 0}%` }} /></div>
      {!tasks.length ? <p className="m-empty-copy">Noch keine Aufgaben für diese Auswahl.</p> : <ul className="m-inspector-tasks">{tasks.map((task) => <li key={task.id}>
        <strong>{task.title}</strong><div><Status status={task.status} /><span>{task.phase} · Versuch {task.attempt}</span></div>
      </li>)}</ul>}
    </section>
    {run.tasks.some((task) => task.pendingQuestions !== undefined) && <RunQuestionsPanel key={`${host.identityVersion}:${run.id}`} runId={run.id} port={questionPort} online={host.status === 'online'} canAnswer={host.canSubmit} active={run.status === 'running'} />}
    <RunActivityPanel key={`${run.id}:${participantId ?? 'run'}`} host={host} run={run} participantId={participantId} />
    <section><h3>Budget & Nutzung</h3><dl><dt>Parallel</dt><dd>{run.budget.maxConcurrentTasks} Tasks</dd><dt>Pro Aufgabe</dt><dd>{run.budget.maxTaskMinutes} min</dd>
      <dt>Kostenlimit</dt><dd>{run.budget.maxCostUsd === null ? 'Kein Limit' : formatCostUsd(run.budget.maxCostUsd)}</dd>
      <dt>Gemeldete Tokens</dt><dd>{tokens > 0 ? formatTokenCount(tokens) : 'Keine Angabe'}</dd>
      <dt>Gemeldete Kosten</dt><dd>{run.usage.costUsd > 0 ? formatCostUsd(run.usage.costUsd) : 'Keine Angabe'}</dd></dl>
      {run.usage.unreportedCostTasks > 0 && <p className="m-field-note">{run.usage.unreportedCostTasks} Tasks ohne Kostenangabe.</p>}</section>
    {run.pendingApprovalId && <p className="m-notice">Freigabe am PC erforderlich. Prüfbelege und Änderungen dort ansehen.</p>}
    <div className="m-actions">{run.status === 'draft' && !run.tasks.length && <button className="m-primary" disabled={!host.canSubmit}
      onClick={() => onSend({ path: `/api/v1/runs/${run.id}/start`, key: crypto.randomUUID() })}>Run starten</button>}
      {run.status !== 'draft' && !finalStates.has(run.status) && <button className="m-danger" disabled={!host.canSubmit} onClick={() => {
        if (window.confirm('Diesen Run abbrechen? Bereits erstellte Arbeit bleibt in ADE erhalten.')) onSend({ path: `/api/v1/runs/${run.id}/cancel`, key: crypto.randomUUID() });
      }}>Run abbrechen</button>}</div>
    <p className="m-field-note">Freigaben und Integration werden weiterhin im ADE-Desktop bearbeitet.</p>
  </div>;
}
