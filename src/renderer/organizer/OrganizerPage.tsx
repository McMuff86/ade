import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { intlLocale } from '../../shared/i18n';
import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { newOrganizerDocument, type OrganizerKind } from '../../shared/organizer';
import { OrganizerCache, cachedDocument, type OrganizerCacheState, type OrganizerDispatch, type OrganizerPort } from './OrganizerCache';
import { IndexedOrganizerStorage } from './organizerStorage';
import { OrganizerEditor } from './OrganizerEditor';
import type { ConversationRecordingPort } from '../conversation/ConversationRecording';
import { ConversationDrafts } from '../conversation/conversationDrafts';
import { Modal } from '../onboarding/Modal';
import './organizer.css';

export interface OrganizerPagePort extends OrganizerPort {
  recording: ConversationRecordingPort;
  submit(input: OrganizerDispatch): Promise<{ runId: string }>;
  describe(error: unknown): string;
}
export interface OrganizerPageProps {
  kind: OrganizerKind; scope: string; port: OrganizerPagePort; online: boolean; canRead: boolean; canWrite: boolean; canDictate: boolean;
  repositories: Array<{ id: string; name: string }>; agents: Array<{ id: string; name: string }>;
  onKind(kind: OrganizerKind): void; onRun(id: string): void;
}
const snapshotSignature = (state: OrganizerCacheState) => JSON.stringify([state.sequence, state.pending?.input.sequence, state.dispatches.map(item => item.key), state.entries.map(e => [e.id, e.localVersion, e.base?.revision, !!e.draft, e.deletePending, e.redacted])]);
const sameSnapshot = (a: OrganizerCacheState | null, b: OrganizerCacheState) => a && snapshotSignature(a) === snapshotSignature(b);
export function OrganizerPage(props: OrganizerPageProps) {
  useLocale();
  const { kind, scope, port, online, canRead, canWrite } = props;
  const cache = useMemo(() => new OrganizerCache(new IndexedOrganizerStorage(scope)), [scope]);
  const voiceDrafts = useMemo(() => new ConversationDrafts(window.localStorage, scope), [scope]);
  const [state, setState] = useState<OrganizerCacheState | null>(null); const [selected, setSelected] = useState('');
  const [filter, setFilter] = useState('all'); const [search, setSearch] = useState(''); const [project, setProject] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [dispatching, setDispatching] = useState(false);
  const [now, setNow] = useState(Date.now); const [synced, setSynced] = useState(false); const latest = useRef(props); latest.current = props;
  const live = useRef(true); const working = useRef(false);
  const load = useCallback(async () => { const next = await cache.snapshot(); if (live.current) setState(previous => sameSnapshot(previous, next) ? previous : next); }, [cache]);
  const sync = useCallback(async () => {
    if (working.current || !latest.current.online || !latest.current.canRead) return;
    working.current = true; setBusy(true);
    const active = () => live.current && latest.current.scope === scope && latest.current.online && latest.current.canRead;
    const work = async () => {
      if (!active()) return;
      if (latest.current.canWrite) await cache.flush(port, active);
      if (active()) await cache.refresh(port, active);
    };
    try {
      if (navigator.locks) await navigator.locks.request(`ade-organizer:${scope}`, work); else await work();
      if (active()) { setError(''); setSynced(true); }
    } catch (reason) { if (live.current) setError(port.describe(reason)); }
    finally { working.current = false; if (live.current) { setBusy(false); await load().catch(reason => setError(port.describe(reason))); } }
  }, [cache, load, port, scope]);
  useEffect(() => {
    live.current = true; setState(null); setSelected('');
    void load().then(() => sync()).catch(reason => setError(port.describe(reason)));
    const timer = setInterval(() => { if (!document.hidden) { setNow(Date.now()); void load().catch(reason => setError(port.describe(reason))); void sync(); } }, 3500);
    const resume = () => { if (!document.hidden) void sync(); };
    window.addEventListener('online', resume); document.addEventListener('visibilitychange', resume);
    return () => { live.current = false; clearInterval(timer); window.removeEventListener('online', resume); document.removeEventListener('visibilitychange', resume); };
  }, [load, sync, port]);
  useEffect(() => { if (online && canRead) void sync(); }, [online, canRead, canWrite, sync]);
  const entries = state?.entries.filter(entry => !entry.deletePending && (entry.draft || !entry.base?.deleted) && cachedDocument(entry)?.kind === kind) ?? [];
  const selectedEntry = entries.find(entry => entry.id === selected);
  const today = new Date(now); today.setHours(23, 59, 59, 999);
  const visible = entries.filter(entry => {
    const doc = cachedDocument(entry)!;
    return (!project || doc.repositoryId === project) && `${doc.title} ${doc.text}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())
      && (kind === 'note' || filter === 'all' || filter === 'done' && doc.done || !doc.done && (filter === 'today' && doc.dueAt !== null && doc.dueAt <= today.getTime()
        || filter === 'planned' && doc.dueAt !== null || filter === 'later' && doc.dueAt === null || filter === 'reminders' && doc.reminderAt !== null && doc.reminderAt <= now && (doc.reminderSeenAt === null || doc.reminderSeenAt < doc.reminderAt)));
  }).sort((a, b) => b.editedAt - a.editedAt);
  const pending = state?.entries.filter(entry => entry.draft || entry.deletePending).length ?? 0;
  const create = async () => {
    try { const doc = newOrganizerDocument(kind); doc.repositoryId = project || null; const entry = await cache.edit(doc, null); await load(); setSelected(entry.id); setError(''); }
    catch (reason) { setError(port.describe(reason)); }
  };
  if (!canRead) return <section className="organizer"><h1>{kind === 'task' ? translate("Tasks [41756667]") : translate("Notes")}</h1><p role="status">{translate("On the PC, open Settings → Connected devices and enable “Read personal tasks and notes”. Enable write access to edit them as well.")}</p></section>;
  return <section className={`organizer${selectedEntry ? ' organizer-editing' : ''}`} aria-label={kind === 'task' ? translate("Personal tasks") : translate("Notes")}>
    <header className="organizer-header"><div><h1>{kind === 'task' ? translate("Tasks [41756667]") : translate("Notes")}</h1><p>{kind === 'task' ? translate("Capture, plan and get things done.") : translate("Thoughts, photos and sketches in one place.")}</p></div>
      <div className="organizer-tools" role="group" aria-label={translate("Manage tasks and notes")}><button type="button" className="organizer-primary" disabled={!state || !canWrite} onClick={() => void create()}>{kind === 'task' ? translate("New task") : translate("New note")}</button>
        <button type="button" disabled={!online || busy} onClick={() => void sync()}>{busy ? translate("Syncing…") : translate("Sync")}</button></div>
    </header>
    <p className="organizer-save-status" role="status">{!online ? translate("Offline · Drafts are stored on this device.") : pending ? translate("{{value1}} local change(s) waiting for the PC.", { value1: pending }) : busy ? translate("Syncing… [4162676c]") : state && synced && !error ? translate("Saved on this device · Synced with the PC.") : state ? translate("Saved on this device · PC sync not yet confirmed.") : translate("Loading local storage…")}</p>
    {!canWrite && <p role="status">{translate("Read-only mode. To edit, enable “Edit personal tasks and notes” on the PC.")}</p>}
    {error && <p className="organizer-error" role="alert">{localizeAppMessage(error)}{" "}{translate("Local drafts are preserved.")}</p>}
    <div className="organizer-body"><aside className="organizer-list" aria-label={kind === 'task' ? translate("Task list") : translate("Note list")}>
      <label>{translate("Search")}<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={kind === 'task' ? translate("Search for tasks") : translate("Browse notes")} /></label>
      <label>{translate("Project filters")}<select value={project} onChange={event => setProject(event.target.value)}><option value="">{translate("All projects")}</option>{props.repositories.map(repo => <option key={repo.id} value={repo.id}>{repo.name}</option>)}</select></label>
      {kind === 'task' && <div className="organizer-filters" role="group" aria-label={translate("Task view")}>{[['all', translate("All")], ['today', translate("Today")], ['planned', translate("Planned")], ['later', translate("Later")], ['done', translate("Completed [45726c65]")], ['reminders', translate("Reminders")]].map(([value, label]) =>
        <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value!)}>{label}</button>)}</div>}
      {state && !visible.length && <p>{entries.length ? translate("No matching entries. Search or change filters.") : kind === 'task' ? translate("No tasks yet. Hold on to an idea for later.") : translate("No notes yet. Start with text, a photo or a sketch.")}</p>}
      <ul>{visible.map(entry => { const doc = cachedDocument(entry)!; const reminder = !doc.done && doc.reminderAt !== null && doc.reminderAt <= now && (doc.reminderSeenAt === null || doc.reminderSeenAt < doc.reminderAt);
        return <li key={entry.id}><button type="button" id={`organizer-entry-${entry.id}`} className="organizer-list-item" aria-pressed={selected === entry.id} onClick={() => setSelected(entry.id)}>
          <strong>{doc.done ? '✓ ' : ''}{doc.title || (kind === 'task' ? translate("Unnamed task") : translate("Unnamed note"))}</strong>
          <span>{doc.text.slice(0, 110) || (doc.sketches.some(sketch => sketch.strokes.length) ? translate("Sketch") : doc.images.length ? translate("Photo") : translate("No content yet"))}</span>
          {doc.dueAt !== null && <small>{doc.dueAt < now && !doc.done ? translate("Overdue · ") : translate("Due · ")}{new Date(doc.dueAt).toLocaleString(intlLocale())}</small>}
          {reminder && <small className="organizer-reminder">{translate("Reminder due")}</small>}{entry.base?.conflictOf && <small>{translate("Conflict copy · Both versions preserved")}</small>}
          {entry.draft && <small>{translate("Locally stored")}</small>}
        </button></li>;
      })}</ul>
    </aside>
    <div className="organizer-detail">{selectedEntry ? <OrganizerEditor key={selectedEntry.id} entry={selectedEntry} scope={scope} cache={cache} port={port} voiceDrafts={voiceDrafts}
      disabled={!canWrite} canDictate={props.canDictate && online && !!selectedEntry.base} repositories={props.repositories}
      onSaved={async entry => { await load(); if (entry.id !== selectedEntry.id) setSelected(entry.id); }} onBack={() => { setSelected(''); requestAnimationFrame(() => document.getElementById(`organizer-entry-${selectedEntry.id}`)?.focus()); }}
      onDelete={async () => { await cache.remove(selectedEntry.id, selectedEntry.localVersion); await load(); setSelected(''); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.organizer-header button')?.focus()); void sync(); }}
      onTask={async (doc, text) => { const entry = await cache.taskFromNote(doc, text); await load(); setSelected(entry.id); props.onKind('task'); }}
      onDispatch={() => setDispatching(true)} onRun={props.onRun} /> : <div className="organizer-empty"><h2>{kind === 'task' ? translate("What do you want to do?") : translate("Space for your ideas")}</h2><p>{kind === 'task' ? translate("Select a task or create a new one.") : translate("Select a note or create a new one. Text, photos and drawings can be combined.")}</p></div>}</div></div>
    {dispatching && selectedEntry && <OrganizerDispatchDialog cache={cache} entryId={selectedEntry.id} port={port} state={state!} agents={props.agents} repositories={props.repositories}
      online={online} onClose={() => setDispatching(false)} onSaved={async () => { await load(); void sync(); }} />}
  </section>;
}
function OrganizerDispatchDialog({ cache, entryId, state, port, agents, repositories, online, onClose, onSaved }: {
  cache: OrganizerCache; entryId: string; state: OrganizerCacheState; port: OrganizerPagePort; agents: OrganizerPageProps['agents']; repositories: OrganizerPageProps['repositories']; online: boolean; onClose(): void; onSaved(): Promise<void>;
}) {
  useLocale();
  const document = cachedDocument(state.entries.find(entry => entry.id === entryId)!)!; const existing = state.dispatches.find(item => item.documentId === entryId);
  const [agentId, setAgent] = useState(existing?.agentId ?? agents[0]?.id ?? ''); const [repositoryId, setRepository] = useState(existing?.repositoryId ?? document.repositoryId ?? repositories[0]?.id ?? '');
  const [prompt, setPrompt] = useState(existing?.prompt ?? [document.title, document.text, ...document.checklist.map(item => `- [${item.done ? 'x' : ' '}] ${item.text}`)].filter(Boolean).join('\n\n'));
  const [pending, setPending] = useState(existing); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const lock = useRef(false);
  const send = async () => {
    if (lock.current) return; lock.current = true; setBusy(true); setError('');
    try {
      const input = pending ?? await cache.reserveDispatch({ documentId: entryId, agentId, repositoryId, prompt }); setPending(input); await onSaved();
      const result = await port.submit(input); await cache.confirmDispatch(input, result.runId); await onSaved(); onClose();
    } catch (reason) { setError(port.describe(reason)); } finally { lock.current = false; setBusy(false); }
  };
  return <Modal title={translate("Hand over task to agents")} className="organizer-dialog" onClose={() => { if (!busy) onClose(); }} fallbackFocus={() => window.document.querySelector('.organizer-header button')}>
    <p>{translate("Title, text and checklist are handed over as an assignment. Pictures and sketches remain stored at the personal task.")}</p>
    <fieldset disabled={busy || !!pending}><label>{translate("Project")}<select value={repositoryId} onChange={event => setRepository(event.target.value)}><option value="">{translate("Choose project")}</option>{repositories.map(repo => <option key={repo.id} value={repo.id}>{repo.name}</option>)}</select></label>
      <label>{translate("Agent")}<select value={agentId} onChange={event => setAgent(event.target.value)}><option value="">{translate("Choose agent")}</option>{agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
      <label>{translate("Job instructions")}<textarea aria-label={translate("Job instructions")} rows={8} value={prompt} maxLength={8000} onChange={event => setPrompt(event.target.value)} /></label></fieldset>
    {pending && <p role="status">{translate("The handoff remains stored with the same process ID until ADE confirms it.")}</p>}
    {error && <p role="alert">{localizeAppMessage(error)}</p>}
    <div className="organizer-tools"><button type="button" disabled={busy} onClick={onClose}>{translate("Close")}</button><button type="button" className="organizer-primary" disabled={busy || !online || !agentId || !repositoryId || !prompt.trim() || prompt.length > 8000} onClick={() => void send()}>{busy ? translate("Confirming…") : pending ? translate("Check handoff again") : translate("Start job")}</button></div>
  </Modal>;
}
