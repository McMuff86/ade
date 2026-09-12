import { useEffect, useRef, useState } from 'react';
import type { ProjectRunResults as Results, ProjectWorkspaceQuery, ProjectWorkspaceQueryResult } from '../../shared/remote';
import { RunFilesPanel, type RunFilesPort } from '../graph/RunFilesPanel';

export function ProjectRunResults({ workspaceId, query, port, online, identity, errorText }: {
  workspaceId: string; query: (input: ProjectWorkspaceQuery) => Promise<ProjectWorkspaceQueryResult>;
  port: RunFilesPort; online: boolean; identity?: string | number; errorText: (error: unknown) => string;
}) {
  const [data, setData] = useState<Results>(); const [error, setError] = useState(''); const [choice, setChoice] = useState(''); const [revision, setRevision] = useState(0);
  const [pages, setPages] = useState<string[]>(['']); const cursor = pages[pages.length - 1]!;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { setPages(['']); setChoice(''); }, [workspaceId, identity]);
  useEffect(() => { let live = true; setData(undefined); setError('');
    if (online) void query({ operation: 'run-results', workspaceId, ...(cursor ? { cursor } : {}) }).then((result) => { if (live) setData(result.runResults); }).catch((reason) => { if (live) setError(errorText(reason)); });
    return () => { live = false; };
  }, [workspaceId, query, online, identity, errorText, revision, cursor]);
  const run = data?.runs.find((item) => item.id === choice) ?? data?.runs[0];
  return <section aria-label="Projekt-Ergebnisse"><h2 ref={heading} tabIndex={-1}>Ergebnisse</h2>
    <p>Ergebnisdateien dieses Projekts. Gesicherte Dateien behalten den Stand am Aufgabenende. Sie sind nicht automatisch in den aktuell gewählten Branch übernommen.</p>
    <button disabled={!online} onClick={() => { setPages(['']); setChoice(''); setRevision((value) => value + 1); }}>Projekt-Ergebnisse aktualisieren</button>
    {!online && <p role="status">PC nicht verbunden.</p>}{online && !data && !error && <p role="status">Runs werden geladen…</p>}{error && <p role="alert">{error}</p>}
    {data && !data.runs.length && <p>{cursor ? 'Keine weiteren Runs auf dieser Seite.' : 'Noch keine Runs für dieses Projekt. Dateien aus einer interaktiven CLI-Sitzung findest du im gewählten Checkout unter Git.'}</p>}
    <nav aria-label="Ergebnisseiten"><button disabled={!online || pages.length === 1} onClick={() => { setPages((value) => value.slice(0, -1)); setChoice(''); heading.current?.focus(); }}>Neuere Runs</button>
      <span role="status">Seite {pages.length} · bis zu 20 Runs</span>
      <button disabled={!online || !data?.nextCursor} onClick={() => { setPages((value) => [...value, data!.nextCursor!]); setChoice(''); heading.current?.focus(); }}>Ältere Runs</button></nav>
    {run && <><label>Run<select aria-label="Run für Projekt-Ergebnisse" value={run.id} onChange={(event) => setChoice(event.target.value)}>
      {data!.runs.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.status} · {new Date(item.createdAt).toLocaleString()}</option>)}</select></label>
      <RunFilesPanel key={run.id} runId={run.id} taskIds={run.taskIds} port={port} online={online} identity={identity} errorText={errorText} /></>}
  </section>;
}
