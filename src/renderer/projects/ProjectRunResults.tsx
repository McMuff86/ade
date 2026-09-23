import { localizedState } from '../../shared/i18n/states';
import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { intlLocale } from '../../shared/i18n';
import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
import { useEffect, useRef, useState } from 'react';
import type { ProjectRunResults as Results, ProjectWorkspaceQuery, ProjectWorkspaceQueryResult } from '../../shared/remote';
import { RunFilesPanel, type RunFilesPort } from '../graph/RunFilesPanel';

export function ProjectRunResults({ workspaceId, query, port, online, identity, errorText }: {
  workspaceId: string; query: (input: ProjectWorkspaceQuery) => Promise<ProjectWorkspaceQueryResult>;
  port: RunFilesPort; online: boolean; identity?: string | number; errorText: (error: unknown) => string;
}) {
  useLocale();
  const [data, setData] = useState<Results>(); const [error, setError] = useState(''); const [choice, setChoice] = useState(''); const [revision, setRevision] = useState(0);
  const [pages, setPages] = useState<string[]>(['']); const cursor = pages[pages.length - 1]!;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { setPages(['']); setChoice(''); }, [workspaceId, identity]);
  useEffect(() => { let live = true; setData(undefined); setError('');
    if (online) void query({ operation: 'run-results', workspaceId, ...(cursor ? { cursor } : {}) }).then((result) => { if (live) setData(result.runResults); }).catch((reason) => { if (live) setError(errorText(reason)); });
    return () => { live = false; };
  }, [workspaceId, query, online, identity, errorText, revision, cursor]);
  const run = data?.runs.find((item) => item.id === choice) ?? data?.runs[0];
  return <section aria-label={translate("Project Results")}><h2 ref={heading} tabIndex={-1}>{translate("Results")}</h2>
    <p>{translate("Results files of this project. Secure files are kept at the end of the task. They are not automatically transferred to the currently selected branch.")}</p>
    <button disabled={!online} onClick={() => { setPages(['']); setChoice(''); setRevision((value) => value + 1); }}>{translate("Update project results")}</button>
    {!online && <p role="status">{translate("PC not connected.")}</p>}{online && !data && !error && <p role="status">{translate("Loading runs…")}</p>}{error && <p role="alert">{localizeAppMessage(error)}</p>}
    {data && !data.runs.length && <p>{cursor ? translate("No more runs on this page.") : translate("No runs for this project yet. Files from an interactive CLI session can be found in the selected checkout under Git.")}</p>}
    <nav aria-label={translate("Result pages")}><button disabled={!online || pages.length === 1} onClick={() => { setPages((value) => value.slice(0, -1)); setChoice(''); heading.current?.focus(); }}>{translate("Newer Runs")}</button>
      <span role="status">{translate("Page")}{" "}{pages.length}{" "}{translate("· Up to 20 runs")}</span>
      <button disabled={!online || !data?.nextCursor} onClick={() => { setPages((value) => [...value, data!.nextCursor!]); setChoice(''); heading.current?.focus(); }}>{translate("Older runs")}</button></nav>
    {run && <><label>{translate("Run")}<select aria-label={translate("Run for project results")} value={run.id} onChange={(event) => setChoice(event.target.value)}>
      {data!.runs.map((item) => <option key={item.id} value={item.id}>{item.name} · {localizedState(item.status)} · {new Date(item.createdAt).toLocaleString(intlLocale())}</option>)}</select></label>
      <RunFilesPanel key={run.id} runId={run.id} taskIds={run.taskIds} port={port} online={online} identity={identity} errorText={errorText} /></>}
  </section>;
}
