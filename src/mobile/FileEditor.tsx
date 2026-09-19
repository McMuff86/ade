import { localizeAppMessage } from '../shared/i18n/appMessages';
import { t as translate } from "../shared/i18n";
import { useLocale } from "../renderer/i18n/language";
import { useEffect, useRef, useState, type JSX } from 'react';
import type { MobileFileSaveInput, MobileFileSaveResult, MobileWorkspaceFile, MobileWorkspaceResult, MobileWorkspaceSelection } from '../shared/remote';
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

export function FileEditor({ host, file, workspaceVersion, agentId, repositoryId, busyWorkspace, drafts, onSaved, selection = { agentId, repositoryId } }: {
  host: MobileHost; file: MobileWorkspaceFile; workspaceVersion: string; agentId: string; repositoryId: string | null;
  busyWorkspace: boolean; drafts: FileDrafts; onSaved: () => void;
  selection?: MobileWorkspaceSelection;
}): JSX.Element {
  useLocale();
  const key = `${selection.projectWorkspaceId ?? `${agentId}:${repositoryId}`}:${file.path}`; const draft = drafts.drafts[key];
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
    if (!draft && Object.keys(drafts.drafts).length >= 20) { setError(translate("First, save or discard one of the 20 open drafts.")); return; }
    drafts.change(key, (current) => current ?? { base: file, workspaceVersion, text: file.text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'), undo: [] });
  };
  const save = async () => {
    if (!draft || inFlight.current || host.status !== 'online') return;
    const pending = draft.pending ?? { input: { ...selection, path: file.path, workspaceVersion: draft.workspaceVersion,
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
        const latest = await host.request<MobileWorkspaceResult>('/api/v1/workspace/query', 'POST', { ...selection, operation: 'file', path: file.path });
        drafts.change(key, (current) => current ? { ...current, pending: undefined, conflict: latest.file,
          notice: translate("The file has since been changed. Your draft has not been saved.") } : undefined);
      }
    } catch (reason) {
      if (reason instanceof MobileClientError && [400, 403, 404, 409, 422].includes(reason.status)) drafts.change(key, (current) => current ? { ...current, pending: undefined } : undefined);
      setError(reason instanceof MobileClientError && reason.code === 'scope_not_granted'
        ? translate("To save on the PC, activate the device share \"Edit small workspace text files\".") : workspaceError(reason));
    } finally { inFlight.current = false; setSaving(false); }
  };
  const search = () => {
    const area = editor.current; if (!area || !find) return;
    const from = area.selectionEnd; let index = area.value.toLocaleLowerCase().indexOf(find.toLocaleLowerCase(), from);
    if (index < 0) index = area.value.toLocaleLowerCase().indexOf(find.toLocaleLowerCase());
    if (index >= 0) { area.focus(); area.setSelectionRange(index, index + find.length); } else setError(translate("Text not found."));
  };
  if (!draft) return <><button disabled={!file.editable || busyWorkspace || !allowed || host.status !== 'online'} onClick={begin}>{translate("Edit file")}</button>
    {busyWorkspace && <p>{translate("During an ongoing session, the workspace is only readable.")}</p>}
    {!allowed && file.editable && <p>{translate("To edit the device share \"Edit small workspace text files\" on the PC activate.")}</p>}
    {error && <p role="alert">{localizeAppMessage(error)}</p>}<pre tabIndex={0} aria-label={translate("File Preview")}>{file.text}</pre></>;
  const disabled = saving || !!draft.pending;
  return <div className="m-file-editor">
    <p>{translate("Draft on this device ·")}{" "}{new TextEncoder().encode(draft.text).length} {" "}{translate("Bytes · Save up to 24 KiB")}</p>
    {error && <p role="alert" className="m-alert">{localizeAppMessage(error)}</p>}{draft.notice && <p role="status">{localizeAppMessage(draft.notice)}</p>}
    {draft.base.revision !== file.revision && <p>{translate("This draft is based on an older version of the file, and when it's saved, it checks the current status.")}</p>}
    <div className="m-management-actions"><label>{translate("Search in the text")}<input value={find} onChange={(event) => setFind(event.target.value)} maxLength={100} /></label>
      <button onClick={search} disabled={!find}>{translate("Continue searching")}</button><button disabled={disabled || !draft.undo.length} onClick={() => drafts.change(key, (current) => current?.undo.length
        ? { ...current, text: current.undo.at(-1)!, undo: current.undo.slice(0, -1) } : current)}>{translate("Undo")}</button></div>
    <div className="m-code-editor"><pre ref={numbers} aria-hidden="true">{draft.text.split('\n').map((_, index) => index + 1).join('\n')}</pre>
      <textarea ref={editor} aria-label={translate("Edit file")} value={draft.text} disabled={disabled} spellCheck={false} autoCapitalize="off" autoCorrect="off"
        wrap="off" maxLength={24 * 1024} onChange={(event) => updateText(event.target.value)}
        onScroll={(event) => { if (numbers.current) numbers.current.scrollTop = event.currentTarget.scrollTop; }}
        onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (!disabled && !busyWorkspace && allowed) void save(); } }} /></div>
    {draft.conflict && <section aria-label={translate("File conflict")}><h4>{translate("Current status on the PC")}</h4><pre>{draft.conflict.text}</pre>
      <h4>{translate("Your draft")}</h4><pre>{draft.text}</pre><p>{translate("Transfer needed changes to your draft before confirming a new base.")}</p>
      <button disabled={!draft.conflict.editable || disabled} onClick={() => drafts.change(key, (current) => current?.conflict ? { ...current, base: current.conflict,
        conflict: undefined, notice: translate("Current status as a basis confirmed. Check draft and consciously save.") } : current)}>{translate("Confirm current status as a basis")}</button></section>}
    <div className="m-management-actions"><button className="m-primary" disabled={saving || busyWorkspace || !allowed || !!draft.conflict || host.status !== 'online'} onClick={() => void save()}>
      {draft.pending ? translate("Check save status again") : translate("Save file")}</button>
      <button disabled={disabled} onClick={() => drafts.change(key, () => undefined)}>{translate("Discard draft")}</button></div>
    {draft.pending && <p>{translate("Saving is not yet confirmed, and re-checking uses the same job.")}</p>}
    {busyWorkspace && <p>{translate("Workspace is busy. End session first; your draft is preserved.")}</p>}
  </div>;
}
