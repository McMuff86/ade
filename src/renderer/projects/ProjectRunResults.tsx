import { useEffect, useState } from 'react';
import type { ProjectRunResults as Results, ProjectWorkspaceQuery, ProjectWorkspaceQueryResult } from '../../shared/remote';
import { RunFilesPanel, type RunFilesPort } from '../graph/RunFilesPanel';

export function ProjectRunResults({ workspaceId, query, port, online, identity, errorText }: {
  workspaceId: string; query: (input: ProjectWorkspaceQuery) => Promise<ProjectWorkspaceQueryResult>;
  port: RunFilesPort; online: boolean; identity?: string | number; errorText: (error: unknown) => string;
}) {
  const [data, setData] = useState<Results>(); const [error, setError] = useState(''); const [choice, setChoice] = useState(''); const [revision, setRevision] = useState(0);
  useEffect(() => { let live = true; setData(undefined); setError('');
    if (online) void query({ operation: 'run-results', workspaceId }).then((result) => { if (live) setData(result.runResults); }).catch((reason) => { if (live) setError(errorText(reason)); });
    return () => { live = false; };
  }, [workspaceId, query, online, identity, errorText, revision]);
  const run = data?.runs.find((item) => item.id === choice) ?? data?.runs[0];
  return <section aria-label="Projekt-Ergebnisse"><h2>Ergebnisse</h2>
    <p>Dateien der letzten Runs dieses Projekts, aus den jeweiligen Aufgaben-Arbeitskopien. Sie sind nicht automatisch in den aktuell gewählten Branch übernommen.</p>
    <button disabled={!online} onClick={() => setRevision((value) => value + 1)}>Projekt-Ergebnisse aktualisieren</button>
    {!online && <p role="status">PC nicht verbunden.</p>}{online && !data && !error && <p role="status">Runs werden geladen…</p>}{error && <p role="alert">{error}</p>}
    {data && !data.runs.length && <p>Noch keine Runs für dieses Projekt. Dateien aus einer interaktiven CLI-Sitzung findest du im gewählten Checkout unter Git.</p>}
    {data?.limited && <p>Die letzten 20 Runs werden angezeigt.</p>}
    {run && <><label>Run<select aria-label="Run für Projekt-Ergebnisse" value={run.id} onChange={(event) => setChoice(event.target.value)}>
      {data!.runs.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.status} · {new Date(item.createdAt).toLocaleString()}</option>)}</select></label>
      <RunFilesPanel key={run.id} runId={run.id} taskIds={run.taskIds} port={port} online={online} identity={identity} errorText={errorText} /></>}
  </section>;
}
