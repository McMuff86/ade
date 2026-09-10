import { useCallback, useEffect, useRef, useState } from 'react';
import type { MobileRunFile, MobileRunFiles } from '../../shared/remote';
import './runFiles.css';

export interface RunFilesPort {
  list(runId: string, taskId?: string): Promise<MobileRunFiles>;
  download(runId: string, taskId: string, fileId: string): Promise<Blob>;
}
export const desktopRunFiles: RunFilesPort = {
  list: (runId, taskId) => window.ade.invoke('run:files', { runId, ...(taskId ? { taskId } : {}) }),
  download: async (runId, taskId, fileId) => {
    const result = await window.ade.invoke('run:fileRead', { runId, taskId, fileId });
    return new Blob([Uint8Array.from(atob(result.base64), (letter) => letter.charCodeAt(0))], { type: result.type });
  },
};
const changeLabels = { created: 'Neu', modified: 'Verändert', deleted: 'Gelöscht', reported: 'Vom Agenten gemeldet', unknown: 'Zuordnung unbekannt', unchanged: 'Unverändert' };

export function RunFilesPanel({ runId, taskId, port, online, identity, errorText, taskIds }: {
  runId: string; taskId?: string; port: RunFilesPort; online: boolean; identity?: string | number;
  errorText: (error: unknown) => string; taskIds?: string[];
}) {
  const [files, setFiles] = useState<MobileRunFiles>(); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [download, setDownload] = useState<{ url: string; name: string; image: boolean }>();
  const [all, setAll] = useState(false); const [revision, setRevision] = useState(0);
  const live = useRef(true); const epoch = useRef(0); const lock = useRef(false); const urlRef = useRef<string | undefined>(undefined);
  const origin = useRef<HTMLButtonElement | null>(null);
  const clear = useCallback(() => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); urlRef.current = undefined; setDownload(undefined); }, []);
  useEffect(() => { live.current = true; return () => { live.current = false; epoch.current++; if (urlRef.current) URL.revokeObjectURL(urlRef.current); }; }, []);
  useEffect(() => {
    const version = ++epoch.current; clear(); setFiles(undefined); setError(''); setBusy(false);
    if (!online) return;
    setBusy(true);
    void port.list(runId, taskId).then((value) => { if (live.current && epoch.current === version) setFiles(value); })
      .catch((reason) => { if (live.current && epoch.current === version) setError(errorText(reason)); })
      .finally(() => { if (live.current && epoch.current === version) setBusy(false); });
  }, [port, runId, taskId, online, identity, revision, clear, errorText]);
  const open = async (file: MobileRunFile, button: HTMLButtonElement) => {
    const source = file.taskId ?? taskId; if (!online || !source || lock.current) return;
    lock.current = true; const version = epoch.current; origin.current = button; setBusy(true); setError(''); clear();
    try { const blob = await port.download(runId, source, file.id);
      if (live.current && version === epoch.current) { const url = URL.createObjectURL(blob); urlRef.current = url; setDownload({ url, name: file.name, image: file.image }); }
    } catch (reason) { if (live.current && version === epoch.current) setError(errorText(reason)); }
    finally { lock.current = false; if (live.current && version === epoch.current) setBusy(false); }
  };
  const scoped = files?.files.filter((file) => !taskIds || !!file.taskId && taskIds.includes(file.taskId)) ?? [];
  const shown = scoped.filter((file) => all || file.change !== 'unchanged');
  return <section className="run-files" aria-label="Dateien des Runs">
    <div className="project-workspace-actions"><h3>Dateien des Runs</h3><button disabled={busy || !online} onClick={() => setRevision((value) => value + 1)}>Dateien aktualisieren</button></div>
    {!online && <p role="status">PC nicht verbunden. Zum Abrufen der Dateien erneut verbinden.</p>}
    {busy && <p role="status">Dateien werden geladen…</p>}{error && <p role="alert">{error}</p>}
    {files?.notice && <p>{files.notice}</p>}{files?.limited && <p role="status">Die Dateiliste ist begrenzt. Einzelne Aufgabe wählen oder weitere Dateien am PC ansehen.</p>}
    {files?.unavailableTasks?.filter((task) => !taskIds || taskIds.includes(task.taskId)).map((task) => <p role="status" key={task.taskId}>{task.title}: {task.notice}</p>)}
    {scoped.some((file) => file.change === 'unchanged') && <label><input type="checkbox" checked={all} onChange={(event) => setAll(event.target.checked)} /> Auch unveränderte Dateien zeigen</label>}
    {files && !shown.length && <p>Keine neuen, geänderten oder zuordenbaren Dateien in dieser Auswahl.</p>}
    <ul className="run-files-list">{shown.map((file) => <li key={file.id}>
      <div><strong>{file.path}</strong> <span className="run-file-change" data-change={file.change}>{changeLabels[file.change ?? 'unknown']}</span>
        <small>{file.taskTitle}{file.available !== false && ` · ${Math.ceil(file.bytes / 1024)} KiB`}</small>
        {file.changedSinceRun && <p>Seit Run-Ende erneut verändert · Download enthält den aktuellen Stand.</p>}
        {file.available === false && <p>Datei nicht mehr abrufbar. Der Run-Nachweis bleibt erhalten.</p>}</div>
      <button disabled={busy || !online || file.available === false} onClick={(event) => void open(file, event.currentTarget)}>{file.image ? 'Bild ansehen' : 'Download vorbereiten'}: {file.name}</button>
    </li>)}</ul>
    {download && <div className="run-file-preview">{download.image && <img src={download.url} alt={`Ergebnisdatei ${download.name}`} />}
      <a ref={(element) => { element?.focus(); }} href={download.url} download={download.name}>Herunterladen: {download.name}</a>
      <button onClick={() => { clear(); origin.current?.focus(); }}>Vorschau schliessen</button></div>}
  </section>;
}
