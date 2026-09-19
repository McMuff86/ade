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
  return <article className="organizer-editor" aria-label={value.kind === 'task' ? 'Aufgabe bearbeiten' : 'Notiz bearbeiten'}>
    <div className="organizer-tools organizer-editor-top"><button type="button" onClick={() => void safely(async () => onBack())}>Zur Liste</button>
      {value.kind === 'task' ? <><button type="button" disabled={readOnly || saving} aria-pressed={value.done} onClick={() => patch({ done: !value.done })}>{value.done ? 'Wieder öffnen' : 'Als erledigt markieren'}</button>
        <button type="button" disabled={readOnly || saving || value.runIds.length >= 32} onClick={() => void safely(async () => onDispatch())}>An Agenten übergeben</button></>
        : <button type="button" disabled={readOnly || saving} onClick={() => void safely(() => onTask(current.current, selectedText || undefined))}>{selectedText ? 'Aufgabe aus markiertem Text' : 'Aufgabe daraus erstellen'}</button>}
    </div>
    <p className="organizer-help" role="status">{saveError ? 'Noch nicht gespeichert. Dieser Entwurf ist nur in der geöffneten App erhalten.' : saving ? 'Wird auf diesem Gerät gespeichert…' : entry.draft ? 'Entwurf auf diesem Gerät gespeichert.' : 'Gespeichert.'}</p>
    {saveError && <p role="alert" className="organizer-error">{saveError} <button type="button" onClick={() => void editing.flush().catch(() => undefined)}>Speichern erneut versuchen</button></p>}
    {entry.base?.conflictOf && <p className="organizer-conflict">Konfliktkopie: Der ursprüngliche Eintrag wurde ebenfalls behalten. Beide Fassungen prüfen und bei Bedarf zusammenführen.</p>}
    {entry.redacted && <p role="status">Einige Inhalte sind auf dem Tablet ausgeblendet. Das Original am PC bearbeiten. Der Export enthält die hier sichtbare Fassung.</p>}
    {error && <p role="alert" className="organizer-error">{error} Den sichtbaren Text bei Bedarf kopieren oder exportieren.</p>}
    <label>Titel<input ref={title} value={value.title} maxLength={ORGANIZER_LIMITS.title} readOnly={readOnly} placeholder={value.kind === 'task' ? 'Was möchtest du erledigen?' : 'Titel der Notiz'} onChange={event => patch({ title: event.target.value })} /></label>
    <div className="organizer-fields"><label>Projekt<select value={value.repositoryId ?? ''} disabled={readOnly} onChange={event => patch({ repositoryId: event.target.value || null })}>
      <option value="">Ohne Projekt</option>{value.repositoryId && !repositories.some(repo => repo.id === value.repositoryId) && <option value={value.repositoryId}>Bisheriges Projekt nicht verfügbar</option>}{repositories.map(repo => <option key={repo.id} value={repo.id}>{repo.name}</option>)}</select></label>
      {value.kind === 'task' && <><label>Fällig am<input type="datetime-local" value={localTime(value.dueAt)} disabled={readOnly} onChange={event => patch({ dueAt: parseTime(event.target.value) })} /></label>
        <label>Erinnerung<input type="datetime-local" value={localTime(value.reminderAt)} disabled={readOnly} onChange={event => patch({ reminderAt: parseTime(event.target.value), reminderSeenAt: null })} /></label></>}
    </div>
    {value.kind === 'task' && value.reminderAt !== null && <div className="organizer-reminder"><p>Erinnerung in ADE, solange der PC läuft. Im Hintergrund erscheint zusätzlich eine PC-Benachrichtigung, sofern das System sie zulässt. Auf dem Tablet werden Erinnerungen beim Öffnen angezeigt.</p>
      {value.reminderAt <= Date.now() && !value.done && (value.reminderSeenAt === null || value.reminderSeenAt < value.reminderAt) && <button type="button" disabled={readOnly} onClick={() => patch({ reminderSeenAt: Date.now() })}>Erinnerung bestätigen</button>}</div>}
    <label>{value.kind === 'task' ? 'Beschreibung' : 'Notiztext'}<textarea aria-label={value.kind === 'task' ? 'Beschreibung' : 'Notiztext'} ref={textarea} rows={7} value={value.text} readOnly={readOnly} maxLength={ORGANIZER_LIMITS.text} placeholder="Schreiben oder diktieren…"
      onChange={event => patch({ text: event.target.value })} onSelect={event => { const input = event.currentTarget; setSelectedText(input.value.slice(input.selectionStart, input.selectionEnd)); }} /></label>
    <div className="organizer-tools" role="group" aria-label="Inhalte hinzufügen"><button type="button" disabled={readOnly} aria-expanded={showVoice} onClick={() => setShowVoice(!showVoice)}>Diktat</button>
      <button type="button" disabled={readOnly || remaining <= 0 || exporting} onClick={() => file.current?.click()}>Foto hinzufügen</button>
      <input className="organizer-file-input" ref={file} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Foto auswählen" multiple onChange={event => {
        const chosen = Array.from(event.target.files ?? []); event.target.value = '';
        void safely(async () => {
          if (chosen.length > ORGANIZER_LIMITS.attachments - current.current.images.length) throw new Error('Bis zu vier Fotos pro Eintrag auswählen.');
          const images = await Promise.all(chosen.map(importOrganizerImage));
          patch({ images: [...current.current.images, ...images], sketch: current.current.images.length === 0 && images[0] ? { ...current.current.sketch, backgroundImageId: images[0].id } : current.current.sketch });
        });
      }} /></div>
    {showVoice && <ConversationVoice key={`${value.id}:${canDictate}`} id={value.id} drafts={voiceDrafts} port={port.recording} purpose="organizer" enabled={canDictate && !readOnly}
      maxApplyChars={ORGANIZER_LIMITS.text - current.current.text.length - (current.current.text ? 1 : 0)}
      onApply={async text => { await editing.flush(); const next = { ...current.current, text: [current.current.text, text].filter(Boolean).join('\n') };
        await editing.edit(next); textarea.current?.focus(); }} />}
    {showVoice && !canDictate && <p role="status">Für Diktat den Eintrag zuerst mit dem PC synchronisieren. Auf dem Tablet ist zusätzlich die Diktatfreigabe nötig.</p>}
    {value.kind === 'task' && <section className="organizer-checklist" aria-label="Checkliste"><h3>Checkliste</h3>{value.checklist.map(item => <div key={item.id}>
      <input type="checkbox" aria-label={`Erledigt: ${item.text || 'Checklistenpunkt'}`} disabled={readOnly} checked={item.done} onChange={event => patch({ checklist: current.current.checklist.map(line => line.id === item.id ? { ...line, done: event.target.checked } : line) })} />
      <input aria-label="Checklistenpunkt" value={item.text} maxLength={500} disabled={readOnly} onChange={event => patch({ checklist: current.current.checklist.map(line => line.id === item.id ? { ...line, text: event.target.value } : line) })} />
      <button type="button" aria-label={`Checklistenpunkt entfernen: ${item.text || 'ohne Text'}`} disabled={readOnly} onClick={() => patch({ checklist: current.current.checklist.filter(line => line.id !== item.id) })}>Entfernen</button></div>)}
      <button type="button" disabled={readOnly || value.checklist.length >= ORGANIZER_LIMITS.checklist} onClick={() => patch({ checklist: [...current.current.checklist, { id: crypto.randomUUID(), text: '', done: false }] })}>Checklistenpunkt hinzufügen</button></section>}
    {value.images.length > 0 && <div className="organizer-images">{value.images.map(image => <figure key={image.id}><OrganizerPhoto image={image} /><figcaption>{image.name}</figcaption>
      <button type="button" disabled={readOnly} onClick={() => patch({ images: current.current.images.filter(item => item.id !== image.id), sketch: current.current.sketch.backgroundImageId === image.id ? { ...current.current.sketch, backgroundImageId: null } : current.current.sketch })}>Foto entfernen</button></figure>)}</div>}
    <details className="organizer-sketch-disclosure" open={value.kind === 'note' || !!value.sketch.strokes.length || undefined}><summary>Skizze und Fotomarkierungen</summary>
      <SketchEditor document={value} disabled={readOnly} onChange={sketch => patch({ sketch })} /></details>
    {!!value.runIds.length && <section aria-label="Übergebene Aufträge"><h3>Aufträge und Ergebnisse</h3>{value.runIds.map((id, index) => <button type="button" key={id} onClick={() => onRun(id)}>Auftrag {index + 1} öffnen</button>)}</section>}
    {value.sourceNoteId && <p className="organizer-help">Aus einer Notiz erstellt. Die ursprüngliche Notiz bleibt erhalten.</p>}
    <footer className="organizer-tools" role="group" aria-label="Export und weitere Aktionen"><button type="button" disabled={exporting} onClick={() => void exportFile('md')}>Text als Markdown</button>
      <button type="button" disabled={exporting} onClick={() => void exportFile('png')}>Skizze als PNG</button><button type="button" disabled={exporting} onClick={() => void exportFile('pdf')}>{exporting ? 'Export wird erstellt…' : 'Als PDF speichern'}</button>
      <button type="button" className="organizer-danger" disabled={readOnly || saving} onClick={() => setDeleteOpen(true)}>Eintrag löschen</button></footer>
    {deleteOpen && <Modal title="Eintrag löschen" className="organizer-dialog" onClose={() => setDeleteOpen(false)} fallbackFocus={() => window.document.querySelector('.organizer-header button')}>
      <p>„{value.title || 'Unbenannter Eintrag'}“ aus der Liste entfernen? Andere gleichzeitig bearbeitete Fassungen bleiben erhalten.</p><div className="organizer-tools"><button type="button" onClick={() => setDeleteOpen(false)}>Behalten</button>
        <button type="button" onClick={() => void safely(onDelete)}>Löschen bestätigen</button></div></Modal>}
  </article>;
}
function OrganizerPhoto({ image }: { image: OrganizerImage }) {
  const [url, setUrl] = useState('');
  useEffect(() => { const next = organizerImageUrl(image); setUrl(next); return () => URL.revokeObjectURL(next); }, [image.base64, image.mime]);
  return url ? <img src={url} alt={image.name} /> : <span role="status">Foto wird geladen…</span>;
}
