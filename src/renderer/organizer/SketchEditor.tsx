import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { type OrganizerDocument, type OrganizerSketch } from '../../shared/organizer';
import { renderOrganizerSketch } from './sketchRendering';
import { readSketchPreferences, sketchPreferenceStorage, writeSketchPreferences, type SketchInputState } from './sketchInput';
import { SketchSheet, type SketchHandover, type SketchTools } from './SketchSheet';

/**
 * The sketch inside a note: a preview and the way onto the sheet. This
 * component owns what outlives the sheet — tool and input preferences per
 * device, the undo/redo history and the pen memory — and hands the document
 * changes up as `onChange(sketch)`. Drawing itself happens in SketchSheet.
 */

export function SketchEditor({ document, disabled, title, onChange, onExportPng }: { document: OrganizerDocument; disabled: boolean; title: string; onChange(sketch: OrganizerSketch): void; onExportPng(): void }) {
  useLocale();
  const canvas = useRef<HTMLCanvasElement>(null); const opener = useRef<HTMLButtonElement>(null);
  const current = useRef(document); current.current = document;
  const [prefs] = useState(() => readSketchPreferences(sketchPreferenceStorage()));
  const [tools, setToolsState] = useState<SketchTools>({ tool: 'pen', color: prefs.color, width: prefs.width, mode: prefs.mode, toolsSide: prefs.toolsSide, hintSeen: prefs.hintSeen, grid: prefs.grid,
    pressure: prefs.pressure, eraserMode: prefs.eraserMode, eraserSize: prefs.eraserSize, exportScale: prefs.exportScale });
  const [handover, setHandover] = useState<SketchHandover | null>(null);
  const [penSeen, setPenSeen] = useState(prefs.penSeen); const [error, setError] = useState(''); const [open, setOpen] = useState(false);
  const input = useRef<SketchInputState>({ mode: prefs.mode, penSeen: prefs.penSeen, lastPenAt: Number.NEGATIVE_INFINITY, penDown: false });
  input.current.mode = tools.mode; input.current.penSeen = penSeen;
  const setTools = (change: Partial<SketchTools>) => setToolsState(value => ({ ...value, ...change }));
  useEffect(() => { const { tool: _tool, ...rest } = tools; writeSketchPreferences(sketchPreferenceStorage(), { ...rest, penSeen }); }, [tools, penSeen]);
  /** A pen touching the preview opens the sheet at once and carries the stroke over (docs/SKETCH_UX_PROPOSAL.md §7). */
  const previewPen = (event: PointerEvent<HTMLButtonElement>) => {
    if (disabled || open || event.pointerType !== 'pen' || event.button !== 0) return;
    event.preventDefault(); input.current.lastPenAt = event.timeStamp || performance.now(); input.current.penSeen = true; setPenSeen(true);
    const rect = event.currentTarget.getBoundingClientRect(); const sketch = current.current.sketch;
    setHandover({ pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, point: {
      x: Math.max(0, Math.min(sketch.width, (event.clientX - rect.left) * sketch.width / rect.width)),
      y: Math.max(0, Math.min(sketch.height, (event.clientY - rect.top) * sketch.height / rect.height)), pressure: Math.max(.2, event.pressure) } });
    setOpen(true);
  };
  // History holds whole sketch snapshots so undo also covers sheet-size changes.
  const undo = useRef<OrganizerSketch[]>([]); const redo = useRef<OrganizerSketch[]>([]); const [, setHistoryVersion] = useState(0);
  const rendered = useRef(0);
  useEffect(() => {
    if (!document.sketch.strokes.length && !document.sketch.backgroundImageId) return;
    const version = ++rendered.current;
    void renderOrganizerSketch(document).then(image => { if (version === rendered.current && canvas.current) {
      const context = canvas.current.getContext('2d'); context?.clearRect(0, 0, image.width, image.height); context?.drawImage(image, 0, 0);
    } }).catch(reason => setError(reason instanceof Error ? reason.message : translate("Drawing surface could not be loaded.")));
    return () => { rendered.current++; };
  }, [document]);
  const commit = (change: Partial<OrganizerSketch>) => {
    undo.current.push(current.current.sketch); if (undo.current.length > 30) undo.current.shift(); redo.current = []; setHistoryVersion(value => value + 1);
    onChange({ ...current.current.sketch, ...change });
  };
  const travel = (direction: 'undo' | 'redo') => {
    const source = direction === 'undo' ? undo.current : redo.current; const destination = direction === 'undo' ? redo.current : undo.current;
    const value = source.pop(); if (!value) return; destination.push(current.current.sketch); setHistoryVersion(version => version + 1); onChange(value);
  };
  const empty = !document.sketch.strokes.length && !document.sketch.backgroundImageId;
  const strokes = document.sketch.strokes.length;
  return <section className="organizer-sketch" aria-label={translate("Sketch")}>
    <h3>{translate("Sketch")}</h3>
    <button type="button" className={`organizer-sketch-preview${empty ? ' organizer-sketch-empty' : ''}`} onClick={() => setOpen(true)} onPointerDown={previewPen} onContextMenu={event => event.preventDefault()}
      aria-label={empty ? translate("Open sketch") : translate("Open sketch: {{count}} lines", { count: strokes })}>
      {empty ? <span>{disabled ? translate("No sketch yet.") : translate("Tap here or choose Draw.")}</span> : <canvas ref={canvas} width={document.sketch.width} height={document.sketch.height} aria-hidden="true" />}
    </button>
    <div className="organizer-sketch-row">
      <button type="button" ref={opener} onClick={() => setOpen(true)}>{disabled ? translate("View sketch") : translate("Draw")}</button>
      {document.images.length > 0 && <label>{translate("Photo to annotate")}<select aria-label={translate("Photo to annotate")} disabled={disabled} value={document.sketch.backgroundImageId ?? ''} onChange={event => onChange({ ...document.sketch, backgroundImageId: event.target.value || null })}>
        <option value="">{translate("Empty drawing surface")}</option>{document.images.map(image => <option key={image.id} value={image.id}>{image.name}</option>)}
      </select></label>}
    </div>
    {error && !open && <p role="alert">{localizeAppMessage(error)}</p>}
    {open && <SketchSheet document={document} title={title} disabled={disabled} tools={tools} setTools={setTools} input={input} onPenSeen={() => setPenSeen(true)}
      history={{ canUndo: undo.current.length > 0, canRedo: redo.current.length > 0, undo: () => travel('undo'), redo: () => travel('redo') }} commit={commit}
      error={error ? localizeAppMessage(error) : ''} setError={setError} onExportPng={onExportPng} onClose={() => { setOpen(false); setHandover(null); }}
      handover={handover} onHandover={() => setHandover(null)}
      fallbackFocus={() => opener.current ?? window.document.querySelector<HTMLElement>('.organizer-editor input')} />}
  </section>;
}
