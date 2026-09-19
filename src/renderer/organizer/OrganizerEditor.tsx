import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
import { useEffect, useRef, useState } from 'react';
import { ORGANIZER_LIMITS, type OrganizerDocument, type OrganizerImage } from '../../shared/organizer';
import { organizerImageUrl } from './sketchRendering';
import { type CachedOrganizerEntry, type OrganizerCache } from './OrganizerCache';
import { organizerEditing, retainOrganizerEditing, releaseOrganizerEditing } from './OrganizerEditing';
import type { OrganizerPagePort, OrganizerPageProps } from './OrganizerPage';
import { SketchEditor } from './SketchEditor';
import { ConversationVoice } from '../conversation/ConversationVoice';
import type { ConversationDrafts } from '../conversation/conversationDrafts';
import { Modal } from '../onboarding/Modal';
import { downloadOrganizerBlob, importOrganizerImage, organizerMarkdown, organizerPdf, organizerPng } from './organizerExports';

function localTime(value: number | null): string { if (value === null) return ''; const date = new Date(value); return new Date(value - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); }
const parseTime = (text: string): number | null => text && Number.isFinite(new Date(text).getTime()) ? new Date(text).getTime() : null;
export function OrganizerEditor({ entry, scope, cache, port, voiceDrafts, disabled, canDictate, repositories, onSaved, onBack, onDelete, onTask, onDispatch, onRun }: {
  entry: CachedOrganizerEntry; scope: string; cache: OrganizerCache; port: OrganizerPagePort; voiceDrafts: ConversationDrafts; disabled: boolean; canDictate: boolean;
  repositories: OrganizerPageProps['repositories']; onSaved(entry: CachedOrganizerEntry): Promise<void>; onBack(): void; onDelete(): Promise<void>;
  onTask(document: OrganizerDocument, text?: string): Promise<void>; onDispatch(): void; onRun(id: string): void;
}) {
  useLocale();
  const [editing] = useState(() => organizerEditing(scope, cache, entry));
  const [value, setValue] = useState(() => editing.document()); const current = useRef(value); current.current = value;
  const latestSaved = useRef(onSaved); latestSaved.current = onSaved;
  const [saving, setSaving] = useState(editing.saving); const [saveError, setSaveError] = useState(editing.error); const [error, setError] = useState(''); const [exporting, setExporting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false); const [showVoice, setShowVoice] = useState(false); const [selectedText, setSelectedText] = useState('');
  const title = useRef<HTMLInputElement>(null); const textarea = useRef<HTMLTextAreaElement>(null); const file = useRef<HTMLInputElement>(null);
  const readOnly = disabled || entry.redacted;
  useEffect(() => { title.current?.focus(); }, []);
  useEffect(() => {
    retainOrganizerEditing(scope, cache, entry, editing);
    const stop = editing.subscribe(() => {
      const next = editing.document(); current.current = next; setValue(next); setSaving(editing.saving); setSaveError(editing.error);
      if (!editing.saving && !editing.dirty && editing.committed) void latestSaved.current(editing.committed).catch(reason => setError(port.describe(reason)));
    });
    return () => { stop(); releaseOrganizerEditing(scope, entry.id); };
  }, [editing, scope, entry.id, port]);
  useEffect(() => { editing.receive(entry); }, [editing, entry]);
  const patch = (change: Partial<OrganizerDocument>) => {
    if (readOnly) return;
    const next = { ...current.current, ...change }; current.current = next; setValue(next);
    void editing.edit(next).catch(() => undefined);
  };
  const safely = async (action: () => Promise<unknown>) => { try { await editing.flush(); await action(); } catch (reason) { setError(port.describe(reason)); } };
  const exportFile = async (format: 'md' | 'png' | 'pdf') => {
    if (exporting) return; setExporting(true); setError(''); const snapshot = structuredClone(current.current);
    try { const blob = format === 'md' ? new Blob([organizerMarkdown(snapshot)], { type: 'text/markdown;charset=utf-8' }) : format === 'png' ? await organizerPng(snapshot) : await organizerPdf(snapshot);
      downloadOrganizerBlob(blob, snapshot.title, format);
    } catch (reason) { setError(port.describe(reason)); } finally { setExporting(false); }
  };
  const remaining = ORGANIZER_LIMITS.attachments - value.images.length;
  return <article className="organizer-editor" aria-label={value.kind === 'task' ? translate("Edit task") : translate("Edit note")}>
    <div className="organizer-tools organizer-editor-top"><button type="button" onClick={() => void safely(async () => onBack())}>{translate("To the list")}</button>
      {value.kind === 'task' ? <><button type="button" disabled={readOnly || saving} aria-pressed={value.done} onClick={() => patch({ done: !value.done })}>{value.done ? translate("Reopen") : translate("Mark as done")}</button>
        <button type="button" disabled={readOnly || saving || value.runIds.length >= 32} onClick={() => void safely(async () => onDispatch())}>{translate("Assign to agent")}</button></>
        : <button type="button" disabled={readOnly || saving} onClick={() => void safely(() => onTask(current.current, selectedText || undefined))}>{selectedText ? translate("Task from marked text") : translate("Create a task from it")}</button>}
    </div>
    <p className="organizer-help" role="status">{saveError ? translate("Not yet saved. This draft is only preserved in the open app.") : saving ? translate("Saving on this device…") : entry.draft ? translate("Draft saved on this device.") : translate("Saved.")}</p>
    {saveError && <p role="alert" className="organizer-error">{saveError} <button type="button" onClick={() => void editing.flush().catch(() => undefined)}>{translate("Try saving again")}</button></p>}
    {entry.base?.conflictOf && <p className="organizer-conflict">{translate("Conflict copy: The original entry was also retained. Check both versions and merge them if necessary.")}</p>}
    {entry.redacted && <p role="status">{translate("Some content is hidden on the tablet. Edit the original on the PC. The export contains the version visible here.")}</p>}
    {error && <p role="alert" className="organizer-error">{localizeAppMessage(error)} {" "}{translate("Copy or export the visible text if necessary.")}</p>}
    <label>{translate("Title")}<input ref={title} value={value.title} maxLength={ORGANIZER_LIMITS.title} readOnly={readOnly} placeholder={value.kind === 'task' ? translate("What do you want to do?") : translate("Title of the note")} onChange={event => patch({ title: event.target.value })} /></label>
    <div className="organizer-fields"><label>{translate("Project")}<select value={value.repositoryId ?? ''} disabled={readOnly} onChange={event => patch({ repositoryId: event.target.value || null })}>
      <option value="">{translate("No project")}</option>{value.repositoryId && !repositories.some(repo => repo.id === value.repositoryId) && <option value={value.repositoryId}>{translate("Previous project not available")}</option>}{repositories.map(repo => <option key={repo.id} value={repo.id}>{repo.name}</option>)}</select></label>
      {value.kind === 'task' && <><label>{translate("Due on")}<input type="datetime-local" value={localTime(value.dueAt)} disabled={readOnly} onChange={event => patch({ dueAt: parseTime(event.target.value) })} /></label>
        <label>{translate("Reminder")}<input type="datetime-local" value={localTime(value.reminderAt)} disabled={readOnly} onChange={event => patch({ reminderAt: parseTime(event.target.value), reminderSeenAt: null })} /></label></>}
    </div>
    {value.kind === 'task' && value.reminderAt !== null && <div className="organizer-reminder"><p>{translate("Reminder in ADE while the PC is running. In the background, a PC notification will also appear if the system allows it, and reminders will appear on the tablet when opened.")}</p>
      {value.reminderAt <= Date.now() && !value.done && (value.reminderSeenAt === null || value.reminderSeenAt < value.reminderAt) && <button type="button" disabled={readOnly} onClick={() => patch({ reminderSeenAt: Date.now() })}>{translate("Acknowledge reminder")}</button>}</div>}
    <label>{value.kind === 'task' ? translate("Description") : translate("Note text")}<textarea aria-label={value.kind === 'task' ? translate("Description") : translate("Note text")} ref={textarea} rows={7} value={value.text} readOnly={readOnly} maxLength={ORGANIZER_LIMITS.text} placeholder={translate("Type or dictate…")}
      onChange={event => patch({ text: event.target.value })} onSelect={event => { const input = event.currentTarget; setSelectedText(input.value.slice(input.selectionStart, input.selectionEnd)); }} /></label>
    <div className="organizer-tools" role="group" aria-label={translate("Add content")}><button type="button" disabled={readOnly} aria-expanded={showVoice} onClick={() => setShowVoice(!showVoice)}>{translate("Dictation")}</button>
      <button type="button" disabled={readOnly || remaining <= 0 || exporting} onClick={() => file.current?.click()}>{translate("Add photo")}</button>
      <input className="organizer-file-input" ref={file} type="file" accept="image/png,image/jpeg,image/webp" aria-label={translate("Select photo")} multiple onChange={event => {
        const chosen = Array.from(event.target.files ?? []); event.target.value = '';
        void safely(async () => {
          if (chosen.length > ORGANIZER_LIMITS.attachments - current.current.images.length) throw new Error(translate("Select up to four photos per entry."));
          const images = await Promise.all(chosen.map(importOrganizerImage));
          patch({ images: [...current.current.images, ...images], sketch: current.current.images.length === 0 && images[0] ? { ...current.current.sketch, backgroundImageId: images[0].id } : current.current.sketch });
        });
      }} /></div>
    {showVoice && <ConversationVoice key={`${value.id}:${canDictate}`} id={value.id} drafts={voiceDrafts} port={port.recording} purpose="organizer" enabled={canDictate && !readOnly}
      maxApplyChars={ORGANIZER_LIMITS.text - current.current.text.length - (current.current.text ? 1 : 0)}
      onApply={async text => { await editing.flush(); const next = { ...current.current, text: [current.current.text, text].filter(Boolean).join('\n') };
        await editing.edit(next); textarea.current?.focus(); }} />}
    {showVoice && !canDictate && <p role="status">{translate("Sync this entry with the PC before dictating. On the tablet, dictation permission is also required.")}</p>}
    {value.kind === 'task' && <section className="organizer-checklist" aria-label={translate("Checklist")}><h3>{translate("Checklist")}</h3>{value.checklist.map(item => <div key={item.id}>
      <input type="checkbox" aria-label={translate("Done: {{value1}}", { value1: item.text || translate("Checklist point") })} disabled={readOnly} checked={item.done} onChange={event => patch({ checklist: current.current.checklist.map(line => line.id === item.id ? { ...line, done: event.target.checked } : line) })} />
      <input aria-label={translate("Checklist point")} value={item.text} maxLength={500} disabled={readOnly} onChange={event => patch({ checklist: current.current.checklist.map(line => line.id === item.id ? { ...line, text: event.target.value } : line) })} />
      <button type="button" aria-label={translate("Remove checklist item: {{value1}}", { value1: item.text || translate("no text") })} disabled={readOnly} onClick={() => patch({ checklist: current.current.checklist.filter(line => line.id !== item.id) })}>{translate("Remove")}</button></div>)}
      <button type="button" disabled={readOnly || value.checklist.length >= ORGANIZER_LIMITS.checklist} onClick={() => patch({ checklist: [...current.current.checklist, { id: crypto.randomUUID(), text: '', done: false }] })}>{translate("Add checklist item")}</button></section>}
    {value.images.length > 0 && <div className="organizer-images">{value.images.map(image => <figure key={image.id}><OrganizerPhoto image={image} /><figcaption>{image.name}</figcaption>
      <button type="button" disabled={readOnly} onClick={() => patch({ images: current.current.images.filter(item => item.id !== image.id), sketch: current.current.sketch.backgroundImageId === image.id ? { ...current.current.sketch, backgroundImageId: null } : current.current.sketch })}>{translate("Remove photo")}</button></figure>)}</div>}
    <details className="organizer-sketch-disclosure" open={value.kind === 'note' || !!value.sketch.strokes.length || undefined}><summary>{translate("Sketch and photo annotations")}</summary>
      <SketchEditor document={value} disabled={readOnly} onChange={sketch => patch({ sketch })} /></details>
    {!!value.runIds.length && <section aria-label={translate("Assigned jobs")}><h3>{translate("Jobs and results")}</h3>{value.runIds.map((id, index) => <button type="button" key={id} onClick={() => onRun(id)}>{translate("Job")}{" "}{index + 1} {" "}{translate("Open [c3b66666]")}</button>)}</section>}
    {value.sourceNoteId && <p className="organizer-help">{translate("Created from a note. The original note remains.")}</p>}
    <footer className="organizer-tools" role="group" aria-label={translate("Export and other actions")}><button type="button" disabled={exporting} onClick={() => void exportFile('md')}>{translate("Text as Markdown")}</button>
      <button type="button" disabled={exporting} onClick={() => void exportFile('png')}>{translate("Sketch as PNG")}</button><button type="button" disabled={exporting} onClick={() => void exportFile('pdf')}>{exporting ? translate("Creating export…") : translate("Save as PDF")}</button>
      <button type="button" className="organizer-danger" disabled={readOnly || saving} onClick={() => setDeleteOpen(true)}>{translate("Delete entry")}</button></footer>
    {deleteOpen && <Modal title={translate("Delete entry")} className="organizer-dialog" onClose={() => setDeleteOpen(false)} fallbackFocus={() => window.document.querySelector('.organizer-header button')}>
      <p>„{value.title || translate("Untitled entry")}{translate("” from the list? Other versions being edited at the same time will be preserved.")}</p><div className="organizer-tools"><button type="button" onClick={() => setDeleteOpen(false)}>{translate("Keep")}</button>
        <button type="button" onClick={() => void safely(onDelete)}>{translate("Confirm deletion")}</button></div></Modal>}
  </article>;
}
function OrganizerPhoto({ image }: { image: OrganizerImage }) {
  useLocale();
  const [url, setUrl] = useState('');
  useEffect(() => { const next = organizerImageUrl(image); setUrl(next); return () => URL.revokeObjectURL(next); }, [image.base64, image.mime]);
  return url ? <img src={url} alt={image.name} /> : <span role="status">{translate("Loading photo…")}</span>;
}
