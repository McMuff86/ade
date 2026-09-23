import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { newOrganizerSketch, ORGANIZER_LIMITS, type OrganizerDocument, type OrganizerImage, type OrganizerSketch, type SketchPoint } from '../../shared/organizer';
import { renderOrganizerSketch } from './sketchRendering';
import { readSketchPreferences, sketchPreferenceStorage, writeSketchPreferences, type SketchInputState } from './sketchInput';
import { SketchSheet, type SketchHandover, type SketchTools } from './SketchSheet';

/**
 * The sheets of a note: one preview per sheet and the way onto the sheet.
 * This component owns what outlives an open sheet — tool and input
 * preferences per device, an undo/redo history per sheet and the pen memory —
 * and hands document changes up as `onChange(sketches)`. Drawing itself
 * happens in SketchSheet. A sheet that was opened from the empty state and
 * closed without a mark is dropped again, so a look does not leave a sheet
 * behind; a sheet on a photo copy always stays.
 */

interface History { undo: OrganizerSketch[]; redo: OrganizerSketch[] }
export const sheetLabel = (sketch: OrganizerSketch, index: number): string => sketch.title || translate("Sheet {{n}}", { n: index + 1 });
const clampPoint = (event: { clientX: number; clientY: number; pressure: number }, rect: DOMRect, size: { width: number; height: number }): SketchPoint => ({
  x: Math.max(0, Math.min(size.width, (event.clientX - rect.left) * size.width / rect.width)),
  y: Math.max(0, Math.min(size.height, (event.clientY - rect.top) * size.height / rect.height)), pressure: Math.max(.2, event.pressure) });

export function SketchEditor({ document, disabled, title, onChange, onExportPng, intent, onIntentConsumed }: {
  document: OrganizerDocument; disabled: boolean; title: string; onChange(sketches: OrganizerSketch[]): void; onExportPng(sketchId: string): void;
  /** A sheet id the note wants opened (e.g. just created from a photo); consumed once it is open. */
  intent?: string | null; onIntentConsumed?(): void;
}) {
  useLocale();
  const root = useRef<HTMLElement>(null);
  const current = useRef(document); current.current = document;
  const [prefs] = useState(() => readSketchPreferences(sketchPreferenceStorage()));
  const [tools, setToolsState] = useState<SketchTools>({ tool: 'pen', color: prefs.color, width: prefs.width, mode: prefs.mode, toolsSide: prefs.toolsSide, hintSeen: prefs.hintSeen, grid: prefs.grid,
    pressure: prefs.pressure, eraserMode: prefs.eraserMode, eraserSize: prefs.eraserSize, exportScale: prefs.exportScale, brush: prefs.brush, opacity: prefs.opacity });
  const [handover, setHandover] = useState<SketchHandover | null>(null);
  const [penSeen, setPenSeen] = useState(prefs.penSeen); const [error, setError] = useState(''); const [openId, setOpenId] = useState<string | null>(null);
  const [removeArmed, setRemoveArmed] = useState<string | null>(null);
  const input = useRef<SketchInputState>({ mode: prefs.mode, penSeen: prefs.penSeen, lastPenAt: Number.NEGATIVE_INFINITY, penDown: false });
  input.current.mode = tools.mode; input.current.penSeen = penSeen;
  const setTools = (change: Partial<SketchTools>) => setToolsState(value => ({ ...value, ...change }));
  useEffect(() => { const { tool: _tool, ...rest } = tools; writeSketchPreferences(sketchPreferenceStorage(), { ...rest, penSeen }); }, [tools, penSeen]);
  // History holds whole sheet snapshots per sheet so size changes undo too; removing a sheet forgets its history.
  const histories = useRef(new Map<string, History>()); const [, setHistoryVersion] = useState(0);
  const created = useRef(new Set<string>());
  const sketches = document.sketches; const open = openId ? sketches.find(sketch => sketch.id === openId) ?? null : null;
  useEffect(() => { if (openId && !open) { setOpenId(null); setHandover(null); } }, [openId, open]);
  useEffect(() => { if (intent && sketches.some(sketch => sketch.id === intent)) { setOpenId(intent); onIntentConsumed?.(); } }, [intent, sketches, onIntentConsumed]);
  const replace = (id: string, next: OrganizerSketch) => onChange(current.current.sketches.map(sketch => sketch.id === id ? next : sketch));
  const history = (id: string): History => { let value = histories.current.get(id); if (!value) { value = { undo: [], redo: [] }; histories.current.set(id, value); } return value; };
  const commit = (change: Partial<OrganizerSketch>) => {
    const sketch = open; if (!sketch) return;
    const past = history(sketch.id); past.undo.push(sketch); if (past.undo.length > 30) past.undo.shift(); past.redo = []; setHistoryVersion(value => value + 1);
    replace(sketch.id, { ...sketch, ...change });
  };
  const travel = (direction: 'undo' | 'redo') => {
    const sketch = open; if (!sketch) return; const past = history(sketch.id);
    const source = direction === 'undo' ? past.undo : past.redo; const destination = direction === 'undo' ? past.redo : past.undo;
    const value = source.pop(); if (!value) return; destination.push(sketch); setHistoryVersion(version => version + 1); replace(sketch.id, { ...value, id: sketch.id });
  };
  /** A new sheet; `overrides` places it on a photo copy. Returns null when the note already holds its six sheets. */
  const add = (overrides: Partial<Omit<OrganizerSketch, 'id'>> = {}): OrganizerSketch | null => {
    if (disabled || current.current.sketches.length >= ORGANIZER_LIMITS.sketches) return null;
    const sketch = newOrganizerSketch(overrides); created.current.add(sketch.id); onChange([...current.current.sketches, sketch]); setOpenId(sketch.id); return sketch;
  };
  const remove = (id: string) => { histories.current.delete(id); created.current.delete(id); setRemoveArmed(null); onChange(current.current.sketches.filter(sketch => sketch.id !== id)); };
  const close = () => {
    const sketch = open; setOpenId(null); setHandover(null);
    if (sketch && created.current.has(sketch.id) && !sketch.strokes.length && !sketch.backgroundImageId) remove(sketch.id);
  };
  /** A pen touching a preview opens that sheet at once and carries the stroke over (docs/SKETCH_UX_PROPOSAL.md §7). */
  const previewPen = (event: PointerEvent<HTMLButtonElement>, sketch: OrganizerSketch | null) => {
    if (disabled || open || event.pointerType !== 'pen' || event.button !== 0) return;
    event.preventDefault(); input.current.lastPenAt = event.timeStamp || performance.now(); input.current.penSeen = true; setPenSeen(true);
    const rect = event.currentTarget.getBoundingClientRect();
    const target = sketch ?? add(); if (!target) return;
    setHandover({ pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, point: clampPoint(event, rect, target) });
    setOpenId(target.id);
  };
  const full = sketches.length >= ORGANIZER_LIMITS.sketches;
  const openIndex = open ? sketches.indexOf(open) : -1;
  const fallbackFocus = () => root.current?.querySelector<HTMLElement>(`[data-sketch-open="${openId ?? ''}"]`)
    ?? root.current?.querySelector<HTMLElement>('[data-sketch-open]') ?? window.document.querySelector<HTMLElement>('.organizer-editor input');
  return <section ref={root} className="organizer-sketch" aria-label={translate("Sketches")}>
    <h3>{translate("Sketches")}</h3>
    {!sketches.length && <div className="organizer-sketch-item">
      <button type="button" className="organizer-sketch-preview organizer-sketch-empty" disabled={disabled} onClick={() => add()} onPointerDown={event => previewPen(event, null)} onContextMenu={event => event.preventDefault()} aria-label={translate("Open sketch")}>
        <span>{disabled ? translate("No sketch yet.") : translate("Tap here or choose Draw.")}</span>
      </button>
      <div className="organizer-sketch-row"><button type="button" data-sketch-open="new" disabled={disabled} onClick={() => add()}>{translate("Draw")}</button></div>
    </div>}
    {sketches.map((sketch, index) => <div key={sketch.id} className="organizer-sketch-item">
      <SketchPreview images={document.images} sketch={sketch} label={sheetLabel(sketch, index)} onOpen={() => setOpenId(sketch.id)} onPen={event => previewPen(event, sketch)} onError={setError} />
      <div className="organizer-sketch-row">
        <label>{translate("Sheet title")}<input aria-label={translate("Sheet title")} value={sketch.title} maxLength={ORGANIZER_LIMITS.sketchTitle} readOnly={disabled} placeholder={translate("Sheet {{n}}", { n: index + 1 })}
          onChange={event => replace(sketch.id, { ...sketch, title: event.target.value })} /></label>
        <button type="button" data-sketch-open={sketch.id} onClick={() => setOpenId(sketch.id)}>{disabled ? translate("View sketch") : translate("Draw")}</button>
        {document.images.length > 0 && <label>{translate("Photo to annotate")}<select aria-label={translate("Photo to annotate")} disabled={disabled} value={sketch.backgroundImageId ?? ''} onChange={event => replace(sketch.id, { ...sketch, backgroundImageId: event.target.value || null })}>
          <option value="">{translate("Empty drawing surface")}</option>{document.images.map(image => <option key={image.id} value={image.id}>{image.name}</option>)}
        </select></label>}
        <button type="button" onClick={() => onExportPng(sketch.id)}>{translate("Sketch as PNG")}</button>
        <button type="button" className={removeArmed === sketch.id ? 'organizer-danger' : undefined} disabled={disabled} aria-label={removeArmed === sketch.id ? translate("Really remove sheet {{value1}}?", { value1: sheetLabel(sketch, index) }) : translate("Remove sheet {{value1}}", { value1: sheetLabel(sketch, index) })}
          onClick={() => removeArmed === sketch.id ? remove(sketch.id) : setRemoveArmed(sketch.id)} onBlur={() => setRemoveArmed(value => value === sketch.id ? null : value)}>{removeArmed === sketch.id ? translate("Really remove?") : translate("Remove sheet")}</button>
      </div>
    </div>)}
    {sketches.length > 0 && <div className="organizer-sketch-row">
      <button type="button" disabled={disabled || full} onClick={() => add()}>{translate("New drawing")}</button>
      {full && <span className="organizer-help">{translate("Up to {{count}} drawings per entry.", { count: ORGANIZER_LIMITS.sketches })}</span>}
    </div>}
    {error && !open && <p role="alert">{localizeAppMessage(error)}</p>}
    {open && <SketchSheet document={{ images: document.images, sketch: open }} title={[sheetLabel(open, openIndex), title].filter(Boolean).join(' · ')} disabled={disabled} tools={tools} setTools={setTools} input={input} onPenSeen={() => setPenSeen(true)}
      history={{ canUndo: history(open.id).undo.length > 0, canRedo: history(open.id).redo.length > 0, undo: () => travel('undo'), redo: () => travel('redo') }} commit={commit}
      error={error ? localizeAppMessage(error) : ''} setError={setError} onExportPng={() => onExportPng(open.id)} onClose={close}
      handover={handover} onHandover={() => setHandover(null)} fallbackFocus={fallbackFocus} />}
  </section>;
}

/** Read-only picture of one sheet; a plain sheet without marks still opens on tap. */
function SketchPreview({ images, sketch, label, onOpen, onPen, onError }: { images: OrganizerImage[]; sketch: OrganizerSketch; label: string; onOpen(): void; onPen(event: PointerEvent<HTMLButtonElement>): void; onError(message: string): void }) {
  useLocale();
  const canvas = useRef<HTMLCanvasElement>(null); const rendered = useRef(0);
  const empty = !sketch.strokes.length && !sketch.backgroundImageId;
  useEffect(() => {
    if (empty) return;
    const version = ++rendered.current;
    void renderOrganizerSketch({ images, sketch }).then(image => { if (version === rendered.current && canvas.current) {
      const context = canvas.current.getContext('2d'); context?.clearRect(0, 0, image.width, image.height); context?.drawImage(image, 0, 0);
    } }).catch(reason => onError(reason instanceof Error ? reason.message : translate("Drawing surface could not be loaded.")));
    return () => { rendered.current++; };
  }, [images, sketch, empty, onError]);
  return <button type="button" className={`organizer-sketch-preview${empty ? ' organizer-sketch-empty' : ''}`} onClick={onOpen} onPointerDown={onPen} onContextMenu={event => event.preventDefault()}
    style={{ aspectRatio: `${sketch.width} / ${sketch.height}`, maxWidth: Math.min(560, Math.round(420 * sketch.width / sketch.height)) }}
    aria-label={sketch.strokes.length ? translate("Open sketch {{title}}: {{count}} lines", { title: label, count: sketch.strokes.length }) : translate("Open sketch {{title}}", { title: label })}>
    {empty ? <span>{label}</span> : <canvas ref={canvas} width={sketch.width} height={sketch.height} aria-hidden="true" />}
  </button>;
}
