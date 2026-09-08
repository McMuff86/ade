import { useEffect, useRef, useState, type JSX } from 'react';
import type { MobileFileSaveInput, MobileFileSaveResult, MobileWorkspaceFile, MobileWorkspaceResult } from '../shared/remote';
import type { MobileHost } from './useMobileHost';
import { MobileClientError } from './client';
import { workspaceError } from './AgentWorkspace';

interface FileDraft {
  base: MobileWorkspaceFile; workspaceVersion: string; text: string; undo: string[];
  pending?: { input: MobileFileSaveInput; key: string };
  conflict?: MobileWorkspaceFile;
  notice?: string;
}
/** In-memory drafts survive dialog/project navigation, never identity changes or page reload. */
export function useFileDrafts(identity: number) {
  const [drafts, setDrafts] = useState<Record<string, FileDraft>>({});
  const epoch = useRef(identity); epoch.current = identity;
  useEffect(() => { setDrafts({}); }, [identity]);
  const change = (key: string, apply: (draft: FileDraft | undefined) => FileDraft | undefined) => {
    if (epoch.current !== identity) return;
    setDrafts((current) => {
      const draft = apply(current[key]); const next = { ...current };
      if (!draft) delete next[key]; else if (next[key] || Object.keys(next).length < 20) next[key] = draft;
      return next;
    });
  };
  return { drafts, change };
}
export type FileDrafts = ReturnType<typeof useFileDrafts>;

export function FileEditor({ host, file, workspaceVersion, agentId, repositoryId, busyWorkspace, drafts, onSaved }: {
  host: MobileHost; file: MobileWorkspaceFile; workspaceVersion: string; agentId: string; repositoryId: string | null;
  busyWorkspace: boolean; drafts: FileDrafts; onSaved: () => void;
}): JSX.Element {
  const key = `${agentId}:${repositoryId}:${file.path}`; const draft = drafts.drafts[key];
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false); const [find, setFind] = useState('');
  const editor = useRef<HTMLTextAreaElement>(null); const numbers = useRef<HTMLPreElement>(null); const inFlight = useRef(false);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    let live = true;
    void host.request<{ capabilities?: string[] }>('/api/v1/host').then((state) => { if (live) setAllowed(state.capabilities?.includes('workspace:write') === true); }).catch(() => undefined);
    return () => { live = false; };
  }, [host.request, host.status]);
  const editing = !!draft;
  useEffect(() => { if (editing) editor.current?.focus(); }, [editing]);
  const updateText = (text: string) => drafts.change(key, (current) => current ? { ...current, text,
    undo: [...current.undo, current.text].slice(-10), notice: undefined } : undefined);
  const begin = () => {
    if (!draft && Object.keys(drafts.drafts).length >= 20) { setError('Zuerst einen der 20 offenen Entwürfe speichern oder verwerfen.'); return; }
    drafts.change(key, (current) => current ?? { base: file, workspaceVersion, text: file.text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'), undo: [] });
  };
  const save = async () => {
    if (!draft || inFlight.current || host.status !== 'online') return;
    const pending = draft.pending ?? { input: { agentId, repositoryId, path: file.path, workspaceVersion: draft.workspaceVersion,
      revision: draft.base.revision, text: draft.text }, key: crypto.randomUUID() };
    inFlight.current = true; setSaving(true); setError('');
    drafts.change(key, (current) => current ? { ...current, pending } : undefined);
    try {
      const result = await host.request<MobileFileSaveResult>('/api/v1/workspace/save', 'POST', pending.input, pending.key);
      if (result.saved) {
        // Keep the exact submitted draft until the receipt arrives, even across navigation.
        drafts.change(key, (current) => current?.pending?.key === pending.key ? undefined : current);
        if (live.current) onSaved();
      } else {
        const latest = await host.request<MobileWorkspaceResult>('/api/v1/workspace/query', 'POST', { agentId, repositoryId, operation: 'file', path: file.path });
        drafts.change(key, (current) => current ? { ...current, pending: undefined, conflict: latest.file,
          notice: 'Die Datei wurde inzwischen geändert. Dein Entwurf wurde nicht gespeichert.' } : undefined);
      }
    } catch (reason) {
      if (reason instanceof MobileClientError && [400, 403, 404, 409, 422].includes(reason.status)) drafts.change(key, (current) => current ? { ...current, pending: undefined } : undefined);
      setError(reason instanceof MobileClientError && reason.code === 'scope_not_granted'
        ? 'Zum Speichern am PC die Gerätefreigabe „Kleine Workspace-Textdateien bearbeiten“ aktivieren.' : workspaceError(reason));
    } finally { inFlight.current = false; setSaving(false); }
  };
  const search = () => {
    const area = editor.current; if (!area || !find) return;
    const from = area.selectionEnd; let index = area.value.toLocaleLowerCase().indexOf(find.toLocaleLowerCase(), from);
    if (index < 0) index = area.value.toLocaleLowerCase().indexOf(find.toLocaleLowerCase());
    if (index >= 0) { area.focus(); area.setSelectionRange(index, index + find.length); } else setError('Text nicht gefunden.');
  };
  if (!draft) return <><button disabled={!file.editable || busyWorkspace || !allowed || host.status !== 'online'} onClick={begin}>Datei bearbeiten</button>
    {busyWorkspace && <p>Während einer laufenden Sitzung ist der Workspace nur lesbar.</p>}
    {!allowed && file.editable && <p>Zum Bearbeiten die Gerätefreigabe „Kleine Workspace-Textdateien bearbeiten“ am PC aktivieren.</p>}
    {error && <p role="alert">{error}</p>}<pre tabIndex={0} aria-label="Dateivorschau">{file.text}</pre></>;
  const disabled = saving || !!draft.pending;
  return <div className="m-file-editor">
    <p>Entwurf auf diesem Gerät · {new TextEncoder().encode(draft.text).length} Bytes · Speichern bis 24 KiB</p>
    {error && <p role="alert" className="m-alert">{error}</p>}{draft.notice && <p role="status">{draft.notice}</p>}
    {draft.base.revision !== file.revision && <p>Dieser Entwurf basiert auf einer älteren Dateiversion. Beim Speichern wird der aktuelle Stand geprüft.</p>}
    <div className="m-management-actions"><label>Im Text suchen<input value={find} onChange={(event) => setFind(event.target.value)} maxLength={100} /></label>
      <button onClick={search} disabled={!find}>Weitersuchen</button><button disabled={disabled || !draft.undo.length} onClick={() => drafts.change(key, (current) => current?.undo.length
        ? { ...current, text: current.undo.at(-1)!, undo: current.undo.slice(0, -1) } : current)}>Rückgängig</button></div>
    <div className="m-code-editor"><pre ref={numbers} aria-hidden="true">{draft.text.split('\n').map((_, index) => index + 1).join('\n')}</pre>
      <textarea ref={editor} aria-label="Datei bearbeiten" value={draft.text} disabled={disabled} spellCheck={false} autoCapitalize="off" autoCorrect="off"
        wrap="off" maxLength={24 * 1024} onChange={(event) => updateText(event.target.value)}
        onScroll={(event) => { if (numbers.current) numbers.current.scrollTop = event.currentTarget.scrollTop; }}
        onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (!disabled && !busyWorkspace && allowed) void save(); } }} /></div>
    {draft.conflict && <section aria-label="Dateikonflikt"><h4>Aktueller Stand auf dem PC</h4><pre>{draft.conflict.text}</pre>
      <h4>Dein Entwurf</h4><pre>{draft.text}</pre><p>Übertrage benötigte Änderungen in deinen Entwurf, bevor du eine neue Basis bestätigst.</p>
      <button disabled={!draft.conflict.editable || disabled} onClick={() => drafts.change(key, (current) => current?.conflict ? { ...current, base: current.conflict,
        conflict: undefined, notice: 'Aktuellen Stand als Basis bestätigt. Entwurf prüfen und bewusst speichern.' } : current)}>Aktuellen Stand als Basis bestätigen</button></section>}
    <div className="m-management-actions"><button className="m-primary" disabled={saving || busyWorkspace || !allowed || !!draft.conflict || host.status !== 'online'} onClick={() => void save()}>
      {draft.pending ? 'Speicherstatus erneut prüfen' : 'Datei speichern'}</button>
      <button disabled={disabled} onClick={() => drafts.change(key, () => undefined)}>Entwurf verwerfen</button></div>
    {draft.pending && <p>Speichern ist noch nicht bestätigt. Erneutes Prüfen verwendet denselben Auftrag.</p>}
    {busyWorkspace && <p>Workspace ist belegt. Sitzung zuerst beenden; dein Entwurf bleibt erhalten.</p>}
  </div>;
}
