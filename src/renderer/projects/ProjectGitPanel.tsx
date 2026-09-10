import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MobileFileSaveInput, MobileFileSaveResult, MobileWorkspaceResult, ProjectGitAction, ProjectGitDiff, ProjectGitOverview, ProjectGitPreview, ProjectWorkspaceQuery, ProjectWorkspaceQueryResult, ProjectWorkspaceView } from '../../shared/remote';

export interface PendingProjectGit { key: string; preview: ProjectGitPreview }
export interface PendingProjectFile { key: string; input: MobileFileSaveInput }
export interface ProjectGitPanelProps {
  workspace: ProjectWorkspaceView; online: boolean; canChange: boolean; canEdit: boolean;
  query: (query: ProjectWorkspaceQuery) => Promise<ProjectWorkspaceQueryResult>;
  apply: (id: string, key: string) => Promise<ProjectGitOverview>;
  readFile: (path: string) => Promise<MobileWorkspaceResult>;
  saveFile: (input: MobileFileSaveInput, key: string) => Promise<MobileFileSaveResult>;
  errorText: (error: unknown) => string; onWorkspace: (workspace: ProjectWorkspaceView) => void;
  pending: PendingProjectGit | null; savePending: (value: PendingProjectGit | null) => boolean;
  filePending: PendingProjectFile | null; saveFilePending: (value: PendingProjectFile | null) => boolean;
}
const labels: Record<ProjectGitAction['kind'], string> = { commit: 'Commit erstellen', fetch: 'Remote-Stand abrufen', pull: 'Fast-forward übernehmen', merge: 'Merge vorbereiten', resolve: 'Konflikte als aufgelöst markieren', continue: 'Merge-Commit erstellen', abort: 'Merge abbrechen' };

export function ProjectGitPanel(props: ProjectGitPanelProps) {
  const { workspace, online, canChange, canEdit, query, apply, readFile, saveFile, errorText, pending, savePending, filePending, saveFilePending } = props;
  const [state, setState] = useState<ProjectGitOverview>(); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<string[]>([]); const [message, setMessage] = useState(''); const [ref, setRef] = useState(''); const [remote, setRemote] = useState('origin'); const [pullRef, setPullRef] = useState('');
  const [preview, setPreview] = useState<ProjectGitPreview>(); const [diff, setDiff] = useState<ProjectGitDiff>();
  const [filePath, setFilePath] = useState(filePending?.input.path ?? ''); const [file, setFile] = useState<MobileWorkspaceResult>(); const [text, setText] = useState(filePending?.input.text ?? '');
  const live = useRef(true); const lock = useRef(false); const focus = useRef<HTMLHeadingElement>(null); const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null); const restore = useRef(false); const onWorkspace = useRef(props.onWorkspace); onWorkspace.current = props.onWorkspace;
  const attemptedFile = useRef('');
  const editor = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (file?.file) editor.current?.focus(); }, [file?.file?.path]);
  const current = pending?.preview ?? preview;
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useLayoutEffect(() => { if (current) focus.current?.focus(); else if (restore.current) { restore.current = false; (opener.current?.isConnected ? opener.current : heading.current)?.focus(); } }, [current]);
  const load = useCallback(async (clearError = true) => {
    if (!online || lock.current) return; lock.current = true; setBusy(true); if (clearError) setError('');
    try {
      const next = (await query({ operation: 'git', workspaceId: workspace.id })).git;
      if (!live.current || !next) return; setState(next);
      setSelected((value) => value.filter((path) => next.files.some((file) => file.path === path && file.selectable)));
      setRef((value) => next.refs.some((item) => item.ref === value) ? value : next.refs.find((item) => item.ref !== `refs/heads/${next.workspace.branch}`)?.ref ?? '');
      setRemote((value) => next.remotes.includes(value) ? value : next.remotes[0] ?? '');
      if (next.workspace.branch !== workspace.branch) onWorkspace.current(next.workspace);
    } catch (reason) { if (live.current) setError(errorText(reason)); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  }, [online, query, workspace.id, workspace.branch, errorText]);
  useEffect(() => { void load(); }, [load]);
  const pullRefs = state?.refs.filter((item) => item.ref.startsWith(`refs/remotes/${remote}/`)) ?? [];
  const selectedPull = pullRefs.some((item) => item.ref === pullRef) ? pullRef : pullRefs.find((item) => item.ref === `refs/remotes/${remote}/${workspace.branch}`)?.ref ?? pullRefs[0]?.ref ?? '';
  const prepare = async (action: ProjectGitAction) => {
    if (lock.current || !online || !canChange || pending) return; lock.current = true; setBusy(true); setError(''); setNotice(''); opener.current = document.activeElement as HTMLElement;
    try { const result = await query({ operation: 'git-preview', workspaceId: workspace.id, action }); if (live.current) setPreview(result.gitPreview); }
    catch (reason) { if (live.current) setError(errorText(reason)); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  };
  const execute = async () => {
    if (!current || lock.current || !online || !canChange) return;
    const command = pending ?? { key: crypto.randomUUID(), preview: current };
    if (!savePending(command)) { setError('Browser-Speicher nicht verfügbar. Git-Aktion wurde nicht gesendet.'); return; }
    lock.current = true; setBusy(true); setError('');
    try {
      const next = await apply(command.preview.id, command.key); if (!live.current) return;
      if (!savePending(null)) { setError('Aktion ausgeführt; Bestätigung nicht gespeichert. Erneut prüfen.'); return; }
      setPreview(undefined); setState(next); setSelected([]); setDiff(undefined); setNotice(next.merge ? 'Merge ist offen. Konflikte auflösen und Merge-Commit ausdrücklich erstellen oder abbrechen.' : 'Git-Aktion bestätigt. Aktueller Stand wurde gelesen.');
      if (command.preview.action.kind === 'commit') setMessage(''); onWorkspace.current(next.workspace); restore.current = true;
    } catch (reason) { if (live.current) setError(errorText(reason)); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  };
  const openFile = async (path: string, editing: boolean) => {
    if (lock.current || !online || filePending && filePending.input.path !== path) return; lock.current = true; setBusy(true); setError('');
    try {
      if (editing) { const value = await readFile(path); if (live.current) { setFilePath(path); setFile(value); setText(filePending?.input.text ?? value.file?.text ?? ''); setDiff(undefined); } }
      else { const value = await query({ operation: 'git-diff', workspaceId: workspace.id, path }); if (live.current) { setDiff(value.gitDiff); setFilePath(''); setFile(undefined); } }
    } catch (reason) { if (live.current) setError(errorText(reason)); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  };
  useEffect(() => { if (filePending && state && !file && online && !busy && !lock.current && attemptedFile.current !== filePending.key) {
    attemptedFile.current = filePending.key; void openFile(filePending.input.path, true);
  } }, [filePending, online, busy, file, state]);
  const save = async () => {
    if (lock.current || !online || !canEdit || !file?.file || !file.file.editable || !state || state.blockedReason) return;
    const command = filePending ?? { key: crypto.randomUUID(), input: { projectWorkspaceId: workspace.id, path: filePath, text, revision: file.file.revision, workspaceVersion: file.workspaceVersion } };
    if (!saveFilePending(command)) { setError('Browser-Speicher nicht verfügbar. Datei wurde nicht gesendet.'); return; }
    lock.current = true; setBusy(true); setError('');
    try {
      const result = await saveFile(command.input, command.key); if (!live.current) return;
      if (!saveFilePending(null)) { setError('Speicherbestätigung fehlt. Erneut prüfen.'); return; }
      if (!result.saved) { setError('Datei wurde inzwischen geändert. Entwurf kopieren und Datei neu laden; nichts wurde überschrieben.'); return; }
      setFile(undefined); setFilePath(''); setNotice('Datei gespeichert. Konfliktauflösung bei Bedarf noch ausdrücklich markieren.');
    } catch (reason) { if (live.current) setError(errorText(reason)); }
    finally { lock.current = false; if (live.current) { setBusy(false); void load(false); } }
  };
  const blocked = busy || !online || !canChange || !!state?.blockedReason || !!pending || !!filePending || !!filePath;
  return <section className="project-git" aria-label="Projekt-Git">
    <div className="project-workspace-actions"><h2 ref={heading} tabIndex={-1}>Git · {state?.workspace.branch ?? workspace.branch}</h2><button disabled={busy || !online} onClick={() => void load()}>Git aktualisieren</button></div>
    {!online && <p role="status">Offline · letzter bekannter Git-Stand. Aktionen sind gesperrt.</p>}
    {!canChange && <p role="status">Am PC „Projekt-Branches und lokale Git-Aktionen ausführen“ sowie Projekt-Workspaces freigeben.</p>}
    {busy && <p role="status">Git-Zustand wird geprüft…</p>}{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {state?.blockedReason && <p role="status">{state.blockedReason}</p>}
    {filePending && !file && <button disabled={busy || !online} onClick={() => void openFile(filePending.input.path, true)}>Offene Dateispeicherung prüfen</button>}
    {current ? <section className="project-branch-review" aria-label="Git-Vorschau">
      <h3 ref={focus} tabIndex={-1}>{labels[current.action.kind]} prüfen</h3><p>{current.projectName} · Branch {current.branch}</p>
      <p>HEAD {current.head?.slice(0, 12) ?? 'ohne Commit'}{current.targetHead ? ` → ${current.targetHead.slice(0, 12)}` : ''}</p>
      {'remote' in current.action && <p>Remote: {current.action.remote}</p>}{'ref' in current.action && <p>Quelle: {current.action.ref}</p>}
      {current.action.kind === 'commit' && <><pre>{current.action.message}</pre><p>Nur ausgewählte Dateien werden mit ihrem Arbeitsstand gestaged und committet. Andere gestagte Dateien bleiben erhalten.</p></>}
      {current.action.kind === 'abort' && <p>Abbrechen verwirft die aktuelle Merge-Auflösung und stellt den Stand vor dem Merge wieder her.</p>}
      {current.action.kind === 'merge' && <p>Der Merge bleibt zur Prüfung offen. Den Merge-Commit danach ausdrücklich erstellen.</p>}
      <ul>{current.affected.map((path) => <li key={path}>{path}</li>)}</ul>
      {pending && <p role="status">Antwort noch nicht bestätigt. Erneut prüfen verwendet denselben Vorgang.</p>}
      <div className="project-workspace-actions"><button disabled={busy || !online || !canChange} onClick={() => void execute()}>{pending ? 'Git-Aktion erneut prüfen' : 'Git-Aktion ausführen'}</button>
        <button disabled={busy} onClick={() => { if (!savePending(null)) return; restore.current = true; setPreview(undefined); setError(''); void load(); }}>{pending ? 'Stand lesen und Vorschau verwerfen' : 'Abbrechen'}</button></div>
    </section> : state && <>
      <p>{state.files.length ? `${state.files.length} geänderte Dateien` : 'Arbeitsverzeichnis sauber'} · HEAD {state.head?.slice(0, 12) ?? 'ohne Commit'}</p>
      {state.merge && <p role="status">Merge offen · {state.files.filter((file) => file.conflict).length} Konfliktdateien</p>}
      <ul className="project-git-files">{state.files.map((file) => <li key={file.path}>
        <label><input type="checkbox" disabled={busy || !file.selectable || !!pending} checked={selected.includes(file.path)} onChange={(event) => setSelected((value) => event.target.checked ? [...value, file.path] : value.filter((path) => path !== file.path))} />{file.path}</label>
        <span>{file.conflict ? 'Konflikt' : `${file.index}${file.working}`}</span>
        <button aria-label={`Diff anzeigen: ${file.path}`} disabled={busy || !online || !file.selectable || !!filePending || !!filePath} onClick={() => void openFile(file.path, false)}>Diff</button>
        <button aria-label={`Datei bearbeiten: ${file.path}`} disabled={busy || !online || !file.selectable || !!filePending || !!filePath} onClick={() => void openFile(file.path, true)}>Datei öffnen</button>
        {file.notice && <p>{file.notice}</p>}
      </li>)}</ul>
      {!state.merge ? <form onSubmit={(event) => { event.preventDefault(); void prepare({ kind: 'commit', paths: selected, message }); }}>
        <label>Commit-Nachricht<textarea aria-label="Commit-Nachricht" value={message} onChange={(event) => setMessage(event.target.value)} maxLength={2000} rows={2} disabled={busy} /></label>
        <button disabled={blocked || !selected.length || !message.trim()}>Commit prüfen</button>
      </form> : <div className="project-workspace-actions">
        <button disabled={blocked || !selected.length || selected.some((path) => !state.files.find((file) => file.path === path)?.conflict)} onClick={() => void prepare({ kind: 'resolve', paths: selected })}>Als aufgelöst prüfen</button>
        <button disabled={blocked || state.files.some((file) => file.conflict)} onClick={() => void prepare({ kind: 'continue' })}>Merge abschliessen prüfen</button>
        <button disabled={blocked} onClick={() => void prepare({ kind: 'abort' })}>Merge abbrechen prüfen</button>
      </div>}
      {diff && <section aria-label="Git-Diff"><h3>{diff.path}</h3><pre tabIndex={0}>{diff.text || 'Kein Text-Diff vorhanden.'}</pre>{diff.limited && <p>Ausgabe begrenzt.</p>}</section>}
      {file?.file && <section className="project-git-editor" aria-label="Git-Datei"><h3>{filePath}</h3><label>Dateiinhalt<textarea ref={editor} aria-label="Git-Dateiinhalt" value={text} maxLength={24 * 1024} rows={12}
        readOnly={!file.file.editable || !canEdit || !!filePending} disabled={busy} onChange={(event) => setText(event.target.value)} /></label>
        {file.file.notice && <p>{file.file.notice}</p>}{!canEdit && <p>Zum Speichern am PC „Kleine Workspace-Textdateien bearbeiten“ freigeben.</p>}
        <button disabled={busy || !online || !canEdit || !file.file.editable || !!state.blockedReason} onClick={() => void save()}>{filePending ? 'Dateispeicherung erneut prüfen' : 'Datei speichern'}</button>
        <button disabled={busy} onClick={() => { if (!saveFilePending(null)) return; setFile(undefined); setFilePath(''); }}>Editor schliessen · Entwurf verwerfen</button>
        <p>Ungespeicherter Text bleibt nur auf dieser Seite. Eine gesendete, unbestätigte Speicherung bleibt bis zur Prüfung erhalten.</p>
      </section>}
      {!state.merge && <details><summary>Branches zusammenführen und Remote-Stand</summary>
        <label>Quellbranch<select aria-label="Git-Quellbranch" value={ref} onChange={(event) => setRef(event.target.value)}>{state.refs.filter((item) => item.ref !== `refs/heads/${workspace.branch}`).map((item) => <option key={item.ref} value={item.ref}>{item.ref.replace(/^refs\/(heads|remotes)\//, '')}</option>)}</select></label>
        <button disabled={blocked || !ref || !!state.files.length} onClick={() => void prepare({ kind: 'merge', ref })}>Merge prüfen</button>
        {state.remotes.length ? <><label>Remote<select aria-label="Git-Remote" value={remote} onChange={(event) => setRemote(event.target.value)}>{state.remotes.map((name) => <option key={name}>{name}</option>)}</select></label>
          <button disabled={blocked || !remote} onClick={() => void prepare({ kind: 'fetch', remote })}>Fetch prüfen</button>
          <label>Pull-Branch<select aria-label="Pull-Branch" value={selectedPull} onChange={(event) => setPullRef(event.target.value)}>{pullRefs.map((item) => <option key={item.ref} value={item.ref}>{item.ref.slice(13)}</option>)}</select></label>
          <button disabled={blocked || !selectedPull || !!state.files.length} onClick={() => void prepare({ kind: 'pull', remote, ref: selectedPull })}>Fast-forward prüfen</button>
          <p>Remote-Branches zeigen den zuletzt gefetchten Stand. Fetch aktualisiert sie; Fast-forward übernimmt den danach geprüften Commit.</p>
        </> : <p>Noch kein Remote konfiguriert. Am PC einen Remote hinzufügen.</p>}
      </details>}
    </>}
  </section>;
}
