import { localizeAppMessage } from '../shared/i18n/appMessages';
import { t as translate } from "../shared/i18n";
import { useLocale } from "../renderer/i18n/language";
import { useEffect, useRef, useState, type JSX } from 'react';
import type { OrganizerImage, OrganizerSketch } from '../shared/organizer';
import { IndexedOrganizerStorage } from '../renderer/organizer/organizerStorage';
import { noteImageBlob, noteImageSources, type NoteImageSource } from '../renderer/organizer/noteImageSources';
import { organizerPng } from '../renderer/organizer/organizerExports';
import { renderOrganizerSketch } from '../renderer/organizer/sketchRendering';
import { sheetLabel } from '../renderer/organizer/SketchEditor';

/**
 * Picks a photo or a sheet from the notes on this device for the terminal's
 * image handoff. Reads the same IndexedDB cache the Notes room uses (drafts
 * included), lists notes first and loads thumbnails only for the note that
 * was opened, so a large notebook stays cheap. The chosen item becomes a Blob
 * that the image dialog treats like a freshly selected file.
 */
export function NoteImagePicker({ scope, disabled, onPick, onClose }: { scope: string; disabled: boolean; onPick(blob: Blob, label: string): void; onClose(): void }): JSX.Element {
  useLocale();
  const [sources, setSources] = useState<NoteImageSource[] | null>(null); const [error, setError] = useState('');
  const [openId, setOpenId] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null); const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    let cancelled = false;
    new IndexedOrganizerStorage(scope).transaction(state => noteImageSources(state.entries))
      .then(value => { if (!cancelled) setSources(value); })
      .catch(reason => { if (!cancelled) { setSources([]); setError(reason instanceof Error ? reason.message : translate("Notes could not be read on this device.")); } });
    return () => { cancelled = true; };
  }, [scope]);
  useEffect(() => { heading.current?.focus(); }, [openId]);
  const open = sources?.find(source => source.id === openId) ?? null;
  const pickPhoto = (image: OrganizerImage) => { if (disabled) return; onPick(noteImageBlob(image), image.name); };
  const pickSheet = async (source: NoteImageSource, sketch: OrganizerSketch, index: number) => {
    if (disabled || busy) return; setBusy(true); setError('');
    try { const blob = await organizerPng(source.document, sketch.id, 1); if (live.current) onPick(blob, `${sheetLabel(sketch, index)} · ${source.title}`); }
    catch (reason) { if (live.current) setError(reason instanceof Error ? reason.message : translate("The sheet could not be rendered.")); }
    finally { if (live.current) setBusy(false); }
  };
  return <section className="m-note-image-picker" aria-label={translate("From the notes")} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (open) setOpenId(null); else onClose(); }
  }}>
    <div className="m-note-image-picker-head">
      <h3 ref={heading} tabIndex={-1}>{open ? open.title : translate("From the notes")}</h3>
      {open ? <button type="button" onClick={() => setOpenId(null)}>{translate("Back to the notes")}</button> : <button type="button" onClick={onClose}>{translate("Close")}</button>}
    </div>
    {error && <p role="alert">{localizeAppMessage(error)}</p>}
    {sources === null && <p role="status">{translate("Reading notes on this device…")}</p>}
    {sources && !sources.length && <p>{translate("No photos or sheets in the notes yet. Add a photo or draw in a note first.")}</p>}
    {sources && sources.length > 0 && !open && <ul className="m-note-image-notes">{sources.map(source => <li key={source.id}>
      <button type="button" disabled={disabled} onClick={() => setOpenId(source.id)} aria-label={translate("Open note {{value1}}", { value1: source.title })}>
        <strong>{source.title}</strong><small>{[source.photos.length ? translate("{{count}} photo(s)", { count: source.photos.length }) : '', source.sheets.length ? translate("{{count}} sheet(s)", { count: source.sheets.length }) : ''].filter(Boolean).join(' · ')}</small>
      </button></li>)}</ul>}
    {open && <ul className="m-note-image-items">
      {open.photos.map(image => <li key={image.id}><button type="button" disabled={disabled || busy} onClick={() => pickPhoto(image)} aria-label={translate("Use photo {{value1}}", { value1: image.name })}>
        <PhotoThumb image={image} /><span>{image.name}</span></button></li>)}
      {open.sheets.map((sketch, index) => <li key={sketch.id}><button type="button" disabled={disabled || busy} onClick={() => void pickSheet(open, sketch, index)} aria-label={translate("Use sheet {{value1}}", { value1: sheetLabel(sketch, index) })}>
        <SheetThumb images={open.document.images} sketch={sketch} /><span>{sheetLabel(sketch, index)}</span></button></li>)}
    </ul>}
    {busy && <p role="status">{translate("The sheet is being rendered…")}</p>}
  </section>;
}

function PhotoThumb({ image }: { image: OrganizerImage }): JSX.Element {
  const [url, setUrl] = useState('');
  useEffect(() => { const next = URL.createObjectURL(noteImageBlob(image)); setUrl(next); return () => URL.revokeObjectURL(next); }, [image.base64, image.mime]);
  return url ? <img src={url} alt="" /> : <span className="m-note-image-blank" aria-hidden="true" />;
}
function SheetThumb({ images, sketch }: { images: OrganizerImage[]; sketch: OrganizerSketch }): JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    void renderOrganizerSketch({ images, sketch }, { scale: Math.min(1, 240 / Math.max(sketch.width, sketch.height)) }).then(image => {
      if (cancelled || !canvas.current) return; canvas.current.width = image.width; canvas.current.height = image.height;
      canvas.current.getContext('2d')?.drawImage(image, 0, 0);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [images, sketch]);
  return <canvas ref={canvas} aria-hidden="true" />;
}
