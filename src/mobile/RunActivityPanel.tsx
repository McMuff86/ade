import { localizeAppMessage } from '../shared/i18n/appMessages';
import { intlLocale } from '../shared/i18n';
import { t as translate } from "../shared/i18n";
import { useLocale } from "../renderer/i18n/language";
import { useEffect, useState } from 'react';
import type { MobileRunActivity, MobileRunSummary } from '../shared/remote';
import type { MobileHost } from './useMobileHost';
import { ResultDetails } from '../renderer/graph/ResultDetails';
import { workspaceError } from './AgentWorkspace';
import { finalStates } from './ui';
import { RunFilesPanel } from '../renderer/graph/RunFilesPanel';
import { useRunFilesPort } from './useRunFilesPort';

export function useRunActivity(host: MobileHost, runId?: string, taskId?: string) {
  const [data, setData] = useState<MobileRunActivity>(); const [error, setError] = useState(''); const [retry, setRetry] = useState(0);
  useEffect(() => {
    setData(undefined); setError('');
    if (!runId || host.status !== 'online') return;
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (stopped) return;
      if (document.hidden) { timer = setTimeout(() => void poll(), 2000); return; }
      try {
        const result = await host.request<MobileRunActivity>(`/api/v1/runs/${runId}${taskId ? `/tasks/${taskId}` : ''}/activity`);
        if (stopped) return; setData(result); setError(''); host.acceptRun(result.run);
        if (!finalStates.has(result.run.status)) timer = setTimeout(() => void poll(), 2000);
      } catch (reason) { if (!stopped) { setError(workspaceError(reason)); timer = setTimeout(() => void poll(), 5000); } }
    };
    void poll(); return () => { stopped = true; clearTimeout(timer); };
  }, [host.request, host.acceptRun, host.identityVersion, host.status, runId, taskId, retry]);
  return { data, error, refresh: () => setRetry((value) => value + 1) };
}

export function outputAge(at: number | undefined, now: number): string {
  if (!at) return translate("Not yet received an output");
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  return translate("Last output {{value1}} ago", { value1: seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min` });
}

export function RunActivityPanel({ host, run, participantId }: { host: MobileHost; run: MobileRunSummary; participantId: string | null }) {
  useLocale();
  const tasks = run.tasks.filter((task) => !participantId || task.participantId === participantId);
  const [choice, setChoice] = useState('');
  const taskId = tasks.some((task) => task.id === choice) ? choice : (tasks.find((task) => task.status === 'running') ?? tasks.at(-1))?.id;
  const { data, error, refresh } = useRunActivity(host, run.id, taskId);
  const task = data?.tasks.find((item) => item.id === taskId);
  const [tab, setTab] = useState<'activity' | 'result' | 'files'>(finalStates.has(run.status) ? 'result' : 'activity');
  const filePort = useRunFilesPort(host);
  return <section className="m-run-activity" aria-label={translate("Run activity and result")}>
    <h3>{translate("Activity & Result")}</h3>
    {tasks.length > 1 && <label>{translate("Task")}<select aria-label={translate("Task for activity")} value={taskId ?? ''} onChange={(event) => setChoice(event.target.value)}>
      {tasks.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
    <div className="m-actions">{(['activity', 'result', 'files'] as const).map((value) => <button key={value} aria-pressed={tab === value} onClick={() => setTab(value)}>{value === 'activity' ? translate("Activity") : value === 'result' ? translate("Result") : translate("Files")}</button>)}
      <button disabled={host.status !== 'online'} onClick={refresh}>{translate("Update now")}</button></div>
    {host.status !== 'online' && <p role="status">{translate("PC not connected. Last confirmed status.")}</p>}
    {error && <p role="alert">{localizeAppMessage(error)}</p>}
    {!taskId && <p>{translate("There is no task yet.")}</p>}
    {taskId && !task && !error && <p role="status">{translate("Loading activity from the PC…")}</p>}
    {task && <p role="status">{task.status === 'running' ? task.process === 'running' ? translate("Process running") : translate("Run status not confirmed") : translate("Task {{value1}}", { value1: task.status })}
      {task.exitCode !== undefined ? ` · Exit ${task.exitCode}` : ''}{" "}{translate("· Status")}{" "}{new Date(data!.checkedAt).toLocaleTimeString(intlLocale())}</p>}
    {tab === 'activity' && task && <>
      <p>{outputAge(task.lastOutputAt, data!.checkedAt)}{task.outputBytes !== undefined ? translate(" · {{value1}} bytes received", { value1: task.outputBytes.toLocaleString(intlLocale()) }) : ''}</p>
      {task.notice && <p role="status">{localizeAppMessage(task.notice)}</p>}
      {!task.activity.length ? <p>{translate("Here are the steps reported by the CLI, and without a new report, no progress is simulated.")}</p>
        : <ol className="m-run-activity-lines">{task.activity.map((line, index) => <li key={index}>{line.text}</li>)}</ol>}
      {task.status !== 'running' && <button onClick={() => setTab('result')}>{translate("View the result")}</button>}
    </>}
    {tab === 'result' && task && <>
      {task.result && <ResultDetails result={task.result} idPrefix={`mobile-result-${task.id}`} />}
      {task.output && <><h4>{translate("Answer of the agent")}</h4><pre className="m-run-answer">{task.output.text}</pre>{task.output.limited && <p>{translate("The response exceeds the display limit of 64 KiB.")}</p>}
        {task.output.source === 'recovered-cli' && <p>{translate("Restored from the associated earlier CLI session.")}</p>}</>}
      {!task.result && !task.output && <p>{task.status === 'running' ? translate("No final answer yet. Under Activity, keep track of the current status.") : translate("No structured reply was saved for this earlier session. Existing files are available under Files.")}</p>}
      {task.status === 'completed' && !task.result && <p>{translate("Exit 0 confirms the end of the process. Whether the task is completed is in the answer and the files.")}</p>}
    </>}
    {tab === 'files' && <RunFilesPanel runId={run.id} taskId={taskId} port={filePort} online={host.status === 'online'} identity={host.identityVersion} errorText={workspaceError} />}
  </section>;
}
