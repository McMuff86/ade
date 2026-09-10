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
  if (!at) return 'Noch keine Ausgabe empfangen';
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  return `Letzte Ausgabe vor ${seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min`}`;
}

export function RunActivityPanel({ host, run, participantId }: { host: MobileHost; run: MobileRunSummary; participantId: string | null }) {
  const tasks = run.tasks.filter((task) => !participantId || task.participantId === participantId);
  const [choice, setChoice] = useState('');
  const taskId = tasks.some((task) => task.id === choice) ? choice : (tasks.find((task) => task.status === 'running') ?? tasks.at(-1))?.id;
  const { data, error, refresh } = useRunActivity(host, run.id, taskId);
  const task = data?.tasks.find((item) => item.id === taskId);
  const [tab, setTab] = useState<'activity' | 'result' | 'files'>(finalStates.has(run.status) ? 'result' : 'activity');
  const filePort = useRunFilesPort(host);
  return <section className="m-run-activity" aria-label="Run-Aktivität und Ergebnis">
    <h3>Aktivität & Ergebnis</h3>
    {tasks.length > 1 && <label>Aufgabe<select aria-label="Aufgabe für Aktivität" value={taskId ?? ''} onChange={(event) => setChoice(event.target.value)}>
      {tasks.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
    <div className="m-actions">{(['activity', 'result', 'files'] as const).map((value) => <button key={value} aria-pressed={tab === value} onClick={() => setTab(value)}>{value === 'activity' ? 'Aktivität' : value === 'result' ? 'Ergebnis' : 'Dateien'}</button>)}
      <button disabled={host.status !== 'online'} onClick={refresh}>Jetzt aktualisieren</button></div>
    {host.status !== 'online' && <p role="status">PC nicht verbunden. Letzter bestätigter Stand.</p>}
    {error && <p role="alert">{error}</p>}
    {!taskId && <p>Noch keine Aufgabe vorhanden.</p>}
    {taskId && !task && !error && <p role="status">Aktivität wird vom PC geladen…</p>}
    {task && <p role="status">{task.status === 'running' ? task.process === 'running' ? 'Prozess läuft' : 'Laufstatus nicht bestätigt' : `Aufgabe ${task.status}`}
      {task.exitCode !== undefined ? ` · Exit ${task.exitCode}` : ''} · Stand {new Date(data!.checkedAt).toLocaleTimeString()}</p>}
    {tab === 'activity' && task && <>
      <p>{outputAge(task.lastOutputAt, data!.checkedAt)}{task.outputBytes !== undefined ? ` · ${task.outputBytes.toLocaleString()} Bytes empfangen` : ''}</p>
      {task.notice && <p role="status">{task.notice}</p>}
      {!task.activity.length ? <p>Hier erscheinen die vom CLI gemeldeten Arbeitsschritte. Ohne neue Meldung wird kein Fortschritt vorgetäuscht.</p>
        : <ol className="m-run-activity-lines">{task.activity.map((line, index) => <li key={index}>{line.text}</li>)}</ol>}
      {task.status !== 'running' && <button onClick={() => setTab('result')}>Ergebnis ansehen</button>}
    </>}
    {tab === 'result' && task && <>
      {task.result && <ResultDetails result={task.result} idPrefix={`mobile-result-${task.id}`} />}
      {task.output && <><h4>Antwort des Agenten</h4><pre className="m-run-answer">{task.output.text}</pre>{task.output.limited && <p>Die Antwort überschreitet die Anzeigegrenze von 64 KiB.</p>}
        {task.output.source === 'recovered-cli' && <p>Aus der zugehörigen früheren CLI-Sitzung wiederhergestellt.</p>}</>}
      {!task.result && !task.output && <p>{task.status === 'running' ? 'Noch keine Abschlussantwort. Unter Aktivität den aktuellen Stand verfolgen.' : 'Für diese frühere Sitzung wurde keine strukturierte Antwort gespeichert. Vorhandene Dateien findest du unter Dateien.'}</p>}
      {task.status === 'completed' && !task.result && <p>Exit 0 bestätigt das Prozessende. Ob die Aufgabe erfüllt ist, steht in der Antwort und den Dateien.</p>}
    </>}
    {tab === 'files' && <RunFilesPanel runId={run.id} taskId={taskId} port={filePort} online={host.status === 'online'} identity={host.identityVersion} errorText={workspaceError} />}
  </section>;
}
