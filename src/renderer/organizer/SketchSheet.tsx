import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
import { useCallback, useEffect, useRef, useState, type MutableRefObject, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ORGANIZER_LIMITS, SKETCH_BRUSHES, type OrganizerSketch, type SketchBrush, type SketchPoint, type SketchStroke } from '../../shared/organizer';
import { ERASER_SIZE, LINE_WIDTH, SHEET_FORMATS, SHEET_SIZE, erasePartial, eraseStroke, exportScalesFor, sheetFormatFor, sheetSizeVerdict, type EraserMode, type SheetFormatId } from './sketchErase';
import { useDialogFocus } from '../onboarding/Modal';
import { clampView, fitView, pinchView, panView, toContentPoint, zoomViewAt, type ScaleBounds, type ViewTransform } from '../viewTransform';
import { drawStroke, renderOrganizerSketch, type SketchScene } from './sketchRendering';
import { SKETCH_INKS, SKETCH_INPUT_MODES, SKETCH_WIDTHS, fingerNavigates, sheetPointerRole, type SheetPointerRole, type SketchInkId, type SketchInputMode, type SketchInputState, type SketchPreferences } from './sketchInput';

/**
 * The sheet: the note steps back and the drawing surface fills the window
 * (docs/SKETCH_UX_PROPOSAL.md §5–§6). A fixed overlay inside the app, not the
 * browser Fullscreen API, so Electron and the tablet PWA behave the same. View
 * (pan/zoom), tools and input mode are view/device state; only strokes reach
 * the document. Rendering happens at device resolution with the view transform,
 * so lines stay sharp at every zoom level.
 */

export interface SketchTools extends Omit<SketchPreferences, 'penSeen'> { tool: 'pen' | 'eraser' }
/** A pen that touched the note's preview: the sheet opens and continues that very stroke (docs/SKETCH_UX_PROPOSAL.md §7). */
export interface SketchHandover { pointerId: number; point: SketchPoint; clientX: number; clientY: number }
export interface SketchHistory { canUndo: boolean; canRedo: boolean; undo(): void; redo(): void }
interface Props {
  document: SketchScene; title: string; disabled: boolean;
  tools: SketchTools; setTools(change: Partial<SketchTools>): void;
  input: MutableRefObject<SketchInputState>; onPenSeen(): void;
  history: SketchHistory; commit(change: Partial<OrganizerSketch>): void;
  error: string; setError(message: string): void;
  onExportPng(): void; onClose(): void; fallbackFocus(): HTMLElement | null;
  handover?: SketchHandover | null; onHandover?(): void;
}
interface PointerSample { clientX: number; clientY: number; pressure: number; pointerType: string }
const INK_LABELS: Record<SketchInkId, () => string> = {
  ink: () => translate("Ink"), blue: () => translate("Blue ink"), copper: () => translate("Copper ink"), red: () => translate("Red ink"), green: () => translate("Green ink"), grey: () => translate("Grey ink"), yellow: () => translate("Yellow ink"),
};
const WIDTH_LABELS: Record<number, () => string> = { 2: () => translate("Fine line"), 5: () => translate("Medium line"), 11: () => translate("Broad line") };
const FORMAT_LABELS: Record<SheetFormatId, () => string> = {
  landscape: () => translate("Landscape 1600 × 1000"), portrait: () => translate("Portrait 1000 × 1600"), square: () => translate("Square 1200 × 1200"), wide: () => translate("Wide 2400 × 1200"), large: () => translate("Large 3200 × 2000"),
};
const MODE_LABELS: Record<SketchInputMode, () => string> = {
  auto: () => translate("Automatic"), 'pen-draws': () => translate("Pen draws, finger moves"), 'finger-draws': () => translate("Finger draws too"),
};
const Ico = ({ children }: { children: ReactNode }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
const I = {
  pen: <path d="M4 20l3.5-.8L19 7.7a1.8 1.8 0 000-2.5l-.2-.2a1.8 1.8 0 00-2.5 0L4.8 16.5z M14.5 6.5l3 3" />,
  eraser: <path d="M4 16.5l8.5-8.5a2 2 0 012.8 0l3.7 3.7a2 2 0 010 2.8L14 19.5H8.5L4 15z M9 19.5h11" />,
  undo: <path d="M9 14l-4-4 4-4 M5 10h9a5 5 0 010 10h-3" />,
  redo: <path d="M15 14l4-4-4-4 M19 10h-9a5 5 0 000 10h3" />,
  fit: <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />,
  more: <path d="M12 6h.01M12 12h.01M12 18h.01" />,
  minus: <path d="M5 12h14" />, plus: <path d="M12 5v14M5 12h14" />,
};
const PADDING = 24; const FIT_RANGE = { min: .5, max: 6 };
const BRUSH_LABELS: Record<SketchBrush, () => string> = {
  pen: () => translate("Pen"), pencil: () => translate("Pencil"), ballpoint: () => translate("Ballpoint"), charcoal: () => translate("Charcoal"), calligraphy: () => translate("Calligraphy"), highlighter: () => translate("Highlighter"),
};
/** New strokes only carry brush/opacity when they differ from the original pen, so older documents keep their shape. */
const strokeStyle = (tools: SketchTools): Pick<SketchStroke, 'brush' | 'opacity'> => ({ ...(tools.brush !== 'pen' ? { brush: tools.brush } : {}), ...(tools.opacity < 100 ? { opacity: tools.opacity / 100 } : {}) });

export function SketchSheet({ document, title, disabled, tools, setTools, input, onPenSeen, history, commit, error, setError, onExportPng, onClose, fallbackFocus, handover, onHandover }: Props) {
  useLocale();
  const dialog = useRef<HTMLDivElement>(null); const surface = useRef<HTMLDivElement>(null); const canvas = useRef<HTMLCanvasElement>(null);
  const trapTab = useDialogFocus(dialog, fallbackFocus, () => canvas.current);
  const current = useRef(document); current.current = document;
  const view = useRef<ViewTransform>({ x: 0, y: 0, scale: 1 }); const bounds = useRef<ScaleBounds>({ min: .1, max: 10 }); const touched = useRef(false);
  const viewport = useRef({ width: 0, height: 0 }); const background = useRef<HTMLCanvasElement | null>(null);
  const stroke = useRef<SketchStroke | null>(null); const active = useRef<{ id: number; role: 'draw' | 'erase'; pointerType: string; last: { x: number; y: number } } | null>(null);
  const fingers = useRef(new Map<number, { x: number; y: number }>()); const twoFingerAt = useRef(0); const spaceHeld = useRef(false); const spacePanned = useRef(false);
  const keyboardPoint = useRef<SketchPoint>({ x: 100, y: 100, pressure: 1 });
  const [readout, setReadout] = useState(''); const [drawing, setDrawing] = useState(false); const [menu, setMenu] = useState(false); const [clearArmed, setClearArmed] = useState(false);
  const [sheetDraft, setSheetDraft] = useState({ width: document.sketch.width, height: document.sketch.height });
  const eraserAt = useRef<SketchPoint | null>(null); const toolsRef = useRef(tools); toolsRef.current = tools;
  // An erase drag works on this copy and commits once on release: one undo step, no IndexedDB/sync write per sample.
  const erasing = useRef<{ strokes: SketchStroke[]; changed: boolean } | null>(null);
  const frame = useRef(0); const grid = useRef(tools.grid); grid.current = tools.grid; const pending = useRef(handover ?? null);
  // The finished sheet is cached as a layer; while a stroke is in progress only that stroke is drawn on top each frame.
  const layer = useRef<{ canvas: HTMLCanvasElement; key: string; strokes: readonly SketchStroke[]; background: HTMLCanvasElement | null } | null>(null);
  const sheet = () => ({ width: current.current.sketch.width, height: current.current.sketch.height });

  /* -------------------------------------------------------------- render */
  const paint = useCallback(() => {
    frame.current = 0; const element = canvas.current; const context = element?.getContext('2d'); if (!element || !context) return;
    const dpr = window.devicePixelRatio || 1; const v = view.current; const size = sheet();
    const strokes = erasing.current?.strokes ?? current.current.sketch.strokes;
    const key = `${element.width}x${element.height}|${v.x.toFixed(2)},${v.y.toFixed(2)},${v.scale.toFixed(5)}|${dpr}|${grid.current ? 'g' : ''}|${size.width}x${size.height}`;
    let cached = layer.current;
    if (!cached || cached.key !== key || cached.strokes !== strokes || cached.background !== background.current) {
      const base = cached?.canvas ?? window.document.createElement('canvas');
      if (base.width !== element.width || base.height !== element.height) { base.width = element.width; base.height = element.height; }
      const layerContext = base.getContext('2d'); if (!layerContext) return;
      layerContext.setTransform(1, 0, 0, 1, 0, 0); layerContext.clearRect(0, 0, base.width, base.height);
      layerContext.setTransform(v.scale * dpr, 0, 0, v.scale * dpr, v.x * dpr, v.y * dpr);
      layerContext.save(); layerContext.shadowColor = 'rgba(0, 0, 0, .35)'; layerContext.shadowBlur = 18 * dpr; layerContext.shadowOffsetY = 3 * dpr; layerContext.fillStyle = '#ffffff'; layerContext.fillRect(0, 0, size.width, size.height); layerContext.restore();
      if (background.current) layerContext.drawImage(background.current, 0, 0);
      if (grid.current) {
        // A view-only guide: never part of the document, never exported.
        const step = 50; const radius = 1.2 / v.scale; layerContext.fillStyle = 'rgba(30, 29, 26, .22)'; layerContext.beginPath();
        for (let gx = step; gx < size.width; gx += step) for (let gy = step; gy < size.height; gy += step) { layerContext.moveTo(gx + radius, gy); layerContext.arc(gx, gy, radius, 0, Math.PI * 2); }
        layerContext.fill();
      }
      for (const item of strokes) drawStroke(layerContext, item);
      cached = layer.current = { canvas: base, key, strokes, background: background.current };
    }
    context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, element.width, element.height); context.drawImage(cached.canvas, 0, 0);
    context.setTransform(v.scale * dpr, 0, 0, v.scale * dpr, v.x * dpr, v.y * dpr);
    if (stroke.current) drawStroke(context, stroke.current);
    if (eraserAt.current && toolsRef.current.tool === 'eraser') {
      context.beginPath(); context.arc(eraserAt.current.x, eraserAt.current.y, toolsRef.current.eraserSize / 2, 0, Math.PI * 2);
      context.lineWidth = 1 / v.scale; context.strokeStyle = 'rgba(30, 29, 26, .6)'; context.setLineDash([3 / v.scale, 3 / v.scale]); context.stroke(); context.setLineDash([]);
    }
    element.dataset.view = `${Math.round(v.x)},${Math.round(v.y)},${v.scale.toFixed(3)}`;
    const percent = `${Math.round(v.scale / (bounds.current.min / FIT_RANGE.min) * 100)} %`; setReadout(value => value === percent ? value : percent);
  }, []);
  const schedule = useCallback(() => { if (!frame.current) frame.current = window.requestAnimationFrame(paint); }, [paint]);
  const setView = (next: ViewTransform) => { view.current = clampView(next, sheet(), viewport.current); touched.current = true; schedule(); };
  const fit = useCallback(() => {
    const fitted = fitView(sheet(), viewport.current, PADDING); bounds.current = { min: fitted.scale * FIT_RANGE.min, max: fitted.scale * FIT_RANGE.max };
    view.current = fitted; touched.current = false; schedule();
  }, [schedule]);
  useEffect(() => {
    const host = surface.current; const element = canvas.current; if (!host || !element) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1; const rect = host.getBoundingClientRect(); viewport.current = { width: rect.width, height: rect.height };
      element.width = Math.max(1, Math.round(rect.width * dpr)); element.height = Math.max(1, Math.round(rect.height * dpr));
      if (touched.current) { const fitted = fitView(sheet(), viewport.current, PADDING); bounds.current = { min: fitted.scale * FIT_RANGE.min, max: fitted.scale * FIT_RANGE.max }; view.current = clampView(view.current, sheet(), viewport.current); schedule(); } else fit();
    };
    resize(); const observer = new ResizeObserver(resize); observer.observe(host);
    const carried = pending.current; pending.current = null;
    if (carried) {
      // Continue the stroke the pen started on the preview. Capture only works while the pen is still down;
      // a quick tap simply opens the sheet.
      try {
        element.setPointerCapture(carried.pointerId);
        active.current = { id: carried.pointerId, role: 'draw', pointerType: 'pen', last: { x: carried.clientX, y: carried.clientY } };
        stroke.current = { id: crypto.randomUUID(), color: tools.color, width: tools.width, points: [carried.point], ...strokeStyle(tools) };
        input.current.penDown = true; setDrawing(true); schedule();
      } catch { /* pointer already lifted */ }
      onHandover?.();
    }
    return () => { observer.disconnect(); if (frame.current) window.cancelAnimationFrame(frame.current); };
  }, [fit, schedule]);
  const backgroundKey = `${document.sketch.backgroundImageId ?? ''}:${document.images.map(image => image.id).join(',')}`; const rendered = useRef(0);
  useEffect(() => {
    const version = ++rendered.current;
    void renderOrganizerSketch(document, { strokes: false }).then(image => { if (version === rendered.current) { background.current = image; schedule(); } })
      .catch(reason => setError(reason instanceof Error ? reason.message : translate("Drawing surface could not be loaded.")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backgroundKey, schedule]);
  useEffect(() => { schedule(); }, [document.sketch.strokes, tools.grid, tools.tool, tools.eraserSize, schedule]);
  // A new sheet size (format change or undo of one) is shown whole.
  const sizeKey = `${document.sketch.width}x${document.sketch.height}`; const shownSize = useRef(sizeKey);
  useEffect(() => { setSheetDraft({ width: document.sketch.width, height: document.sketch.height }); if (shownSize.current !== sizeKey) { shownSize.current = sizeKey; fit(); } }, [sizeKey, fit, document.sketch.width, document.sketch.height]);

  /* -------------------------------------------------------------- input */
  const point = (sample: PointerSample): SketchPoint => {
    const rect = canvas.current!.getBoundingClientRect(); const size = sheet();
    const at = toContentPoint(view.current, { x: sample.clientX - rect.left, y: sample.clientY - rect.top });
    return { x: Math.max(0, Math.min(size.width, at.x)), y: Math.max(0, Math.min(size.height, at.y)), pressure: sample.pointerType === 'pen' && tools.pressure ? Math.max(.2, sample.pressure) : 1 };
  };
  const markPen = (event: PointerEvent) => {
    if (event.pointerType !== 'pen') return;
    input.current.lastPenAt = event.timeStamp || performance.now();
    if (!input.current.penSeen) { input.current.penSeen = true; onPenSeen(); }
  };
  const finish = () => {
    const value = stroke.current; stroke.current = null; active.current = null; input.current.penDown = false; setDrawing(false);
    const erased = erasing.current; erasing.current = null;
    if (erased) { if (erased.changed) commit({ strokes: erased.strokes }); else schedule(); return; }
    if (value?.points.length) { commit({ strokes: [...current.current.sketch.strokes, value] }); if (!tools.hintSeen) setTools({ hintSeen: true }); } else schedule();
  };
  const cancelStroke = () => { stroke.current = null; active.current = null; input.current.penDown = false; erasing.current = null; setDrawing(false); schedule(); };
  /** Erase under `at` on the working copy: a part of every line it touches, or the topmost whole line (tools.eraserMode). */
  const eraseAt = (at: SketchPoint) => {
    const work = erasing.current ?? (erasing.current = { strokes: current.current.sketch.strokes, changed: false });
    const radius = tools.eraserSize / 2;
    const next = tools.eraserMode === 'partial' ? erasePartial(work.strokes, at, radius, () => crypto.randomUUID()) : eraseStroke(work.strokes, at, radius);
    if (next.length !== work.strokes.length || next.some((item, i) => item !== work.strokes[i])) { work.strokes = next; work.changed = true; schedule(); }
  };
  const full = () => current.current.sketch.strokes.length >= ORGANIZER_LIMITS.strokes || current.current.sketch.strokes.reduce((n, item) => n + item.points.length, 0) >= ORGANIZER_LIMITS.points;
  const down = (event: PointerEvent<HTMLCanvasElement>) => {
    markPen(event); setMenu(false);
    let role: SheetPointerRole = sheetPointerRole(input.current, { pointerType: event.pointerType, button: event.button, buttons: event.buttons, width: event.width, height: event.height }, event.timeStamp || performance.now(), { spaceHeld: spaceHeld.current });
    if (role === 'ignore') return;
    if (disabled && role !== 'pan') role = event.pointerType === 'touch' || event.pointerType === 'mouse' ? 'pan' : 'ignore';
    if (role === 'ignore') return;
    event.preventDefault(); event.currentTarget.focus();
    if (role === 'pan' || (event.pointerType === 'touch' && active.current?.pointerType === 'touch')) {
      // A second finger beside a drawing finger turns the gesture into a pinch; the unfinished stroke is dropped.
      if (active.current?.pointerType === 'touch') { fingers.current.set(active.current.id, active.current.last); cancelStroke(); }
      fingers.current.set(event.pointerId, { x: event.clientX, y: event.clientY }); event.currentTarget.setPointerCapture(event.pointerId);
      if (fingers.current.size === 2) { const now = event.timeStamp || performance.now(); if (now - twoFingerAt.current < 400) fit(); twoFingerAt.current = now; }
      if (spaceHeld.current) spacePanned.current = true;
      return;
    }
    if (active.current) { if (event.pointerType === 'pen' && active.current.pointerType === 'touch') { event.currentTarget.releasePointerCapture(active.current.id); finish(); } else return; }
    const at = point(event); setError('');
    if (event.pointerType === 'pen') input.current.penDown = true;
    const last = { x: event.clientX, y: event.clientY };
    if (role === 'erase' || tools.tool === 'eraser') { active.current = { id: event.pointerId, role: 'erase', pointerType: event.pointerType, last }; event.currentTarget.setPointerCapture(event.pointerId); eraseAt(at); return; }
    if (full()) { input.current.penDown = false; setError(translate("The sketch is full. Create a new note for more drawings.")); return; }
    event.currentTarget.setPointerCapture(event.pointerId); active.current = { id: event.pointerId, role: 'draw', pointerType: event.pointerType, last }; setDrawing(true);
    stroke.current = { id: crypto.randomUUID(), color: tools.color, width: tools.width, points: [at], ...strokeStyle(tools) }; schedule();
  };
  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    markPen(event);
    if (tools.tool === 'eraser' && !fingers.current.has(event.pointerId)) { eraserAt.current = point(event); schedule(); }
    const finger = fingers.current.get(event.pointerId);
    if (finger) {
      const next = { x: event.clientX, y: event.clientY }; const others = [...fingers.current.entries()].filter(([id]) => id !== event.pointerId);
      if (others.length >= 1) { const [, other] = others[0]!; setView(pinchView(view.current, finger, other, next, other, bounds.current)); }
      else setView(panView(view.current, next.x - finger.x, next.y - finger.y));
      fingers.current.set(event.pointerId, next); return;
    }
    if (event.pointerId !== active.current?.id) return;
    active.current.last = { x: event.clientX, y: event.clientY };
    const native = event.nativeEvent; const coalesced = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    const samples: PointerSample[] = coalesced.length ? coalesced : [native];
    if (active.current.role === 'erase') { for (const sample of samples) eraseAt(point(sample)); schedule(); return; }
    if (!stroke.current) return;
    const minimum = 1 / Math.max(.25, view.current.scale / (bounds.current.min / FIT_RANGE.min));
    for (const sample of samples) {
      const at = point(sample); const previous = stroke.current.points.at(-1)!;
      if (Math.hypot(at.x - previous.x, at.y - previous.y) < minimum) continue;
      const total = current.current.sketch.strokes.reduce((n, item) => n + item.points.length, 0) + stroke.current.points.length;
      if (total >= ORGANIZER_LIMITS.points) { finish(); setError(translate("Point limit reached. The previous drawing has been preserved.")); return; }
      stroke.current.points.push(at);
    }
    schedule();
  };
  const up = (event: PointerEvent<HTMLCanvasElement>) => { fingers.current.delete(event.pointerId); if (event.pointerId === active.current?.id) finish(); };
  const leave = () => { if (eraserAt.current) { eraserAt.current = null; schedule(); } };
  useEffect(() => {
    const host = surface.current; if (!host) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault(); const rect = host.getBoundingClientRect(); const unit = event.deltaMode === 1 ? 16 : 1;
      if (event.ctrlKey || event.metaKey) setView(zoomViewAt(view.current, event.deltaY < 0 ? 1.1 : 1 / 1.1, { x: event.clientX - rect.left, y: event.clientY - rect.top }, bounds.current));
      else if (event.shiftKey) setView(panView(view.current, -(event.deltaY || event.deltaX) * unit, 0));
      else setView(panView(view.current, -event.deltaX * unit, -event.deltaY * unit));
    };
    host.addEventListener('wheel', wheel, { passive: false }); return () => host.removeEventListener('wheel', wheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const zoomBy = (factor: number) => setView(zoomViewAt(view.current, factor, { x: viewport.current.width / 2, y: viewport.current.height / 2 }, bounds.current));
  const keyboardStroke = (points: SketchPoint[]) => {
    if (disabled) return;
    if (full() || current.current.sketch.strokes.reduce((n, s) => n + s.points.length, 0) + points.length > ORGANIZER_LIMITS.points) { setError(translate("The sketch is full.")); return; }
    commit({ strokes: [...current.current.sketch.strokes, { id: crypto.randomUUID(), color: tools.color, width: tools.width, points, ...strokeStyle(tools) }] });
  };
  const onCanvasKey = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) history.redo(); else history.undo(); return; }
    if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomBy(1.25); return; }
    if (event.key === '-') { event.preventDefault(); zoomBy(1 / 1.25); return; }
    if (event.key === '0') { event.preventDefault(); fit(); return; }
    if (event.key.toLowerCase() === 'e') { setTools({ tool: 'eraser' }); return; }
    if (event.key.toLowerCase() === 'p') { setTools({ tool: 'pen' }); return; }
    const ink = SKETCH_INKS[Number(event.key) - 1]; if (/^[1-7]$/.test(event.key) && ink) { setTools({ color: ink.value }); return; }
    if (event.key === ' ') { event.preventDefault(); if (!spaceHeld.current) { spaceHeld.current = true; spacePanned.current = false; } return; }
    const directions: Record<string, [number, number]> = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] };
    const delta = directions[event.key]; if (!delta) return; event.preventDefault();
    const size = sheet(); const from = { ...keyboardPoint.current };
    const to = { x: Math.max(0, Math.min(size.width, from.x + delta[0])), y: Math.max(0, Math.min(size.height, from.y + delta[1])), pressure: 1 };
    keyboardPoint.current = to; if (event.shiftKey) keyboardStroke([from, to]);
  };
  const onCanvasKeyUp = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (event.key !== ' ') return; event.preventDefault(); spaceHeld.current = false;
    // Space alone still adds a dot; Space held while dragging the mouse was a pan.
    if (!spacePanned.current) keyboardStroke([{ ...keyboardPoint.current }]);
  };
  const clearAll = () => { if (!clearArmed) { setClearArmed(true); return; } setClearArmed(false); setMenu(false); commit({ strokes: [] }); };
  const applySheetSize = () => {
    const verdict = sheetSizeVerdict(sheetDraft.width, sheetDraft.height, current.current.sketch.strokes);
    if (!verdict.ok) { setError(verdict.reason === 'range' ? translate("Sheet size must be between {{min}} and {{max}} points.", { min: SHEET_SIZE.min, max: SHEET_SIZE.max })
      : translate("The drawing needs at least {{width}} × {{height}} points. Choose a larger sheet or erase first.", { width: verdict.width, height: verdict.height })); return; }
    setError(''); if (sheetDraft.width !== current.current.sketch.width || sheetDraft.height !== current.current.sketch.height) commit({ width: sheetDraft.width, height: sheetDraft.height });
    // The apply button disables itself once the sizes match; keep the focus inside the menu.
    dialog.current?.querySelector<HTMLElement>('.sketch-sheet-menu select')?.focus();
  };
  const exportScales = exportScalesFor(document.sketch.width, document.sketch.height);
  const navigate = fingerNavigates(input.current);
  const hint = !tools.hintSeen && !disabled ? navigate || input.current.penSeen ? translate("Pen draws, finger moves. Two fingers zoom.") : translate("Draw with pen or finger. Two fingers zoom.") : '';

  return createPortal(<div ref={dialog} className={`sketch-sheet${tools.toolsSide === 'right' ? ' sketch-sheet-right' : ''}${drawing ? ' sketch-sheet-drawing' : ''}`} role="dialog" aria-modal="true" aria-label={translate("Sketch")} tabIndex={-1}
    onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); if (menu) { setMenu(false); canvas.current?.focus(); } else onClose(); return; } trapTab(event); }}>
    <header className="sketch-sheet-head">
      <button type="button" onClick={onClose} aria-label={translate("Back to note")}>← {translate("Note")}</button>
      <span className="sketch-sheet-title">{title || translate("Untitled entry")}</span>
      <div className="sketch-sheet-zoom" role="group" aria-label={translate("View")}>
        <button type="button" aria-label={translate("Zoom out of the sheet")} onClick={() => zoomBy(1 / 1.25)}><Ico>{I.minus}</Ico></button>
        <output className="sketch-sheet-zoom-level" aria-label={translate("Zoom level")}>{readout}</output>
        <button type="button" aria-label={translate("Zoom in the sheet")} onClick={() => zoomBy(1.25)}><Ico>{I.plus}</Ico></button>
        <button type="button" onClick={fit}><Ico>{I.fit}</Ico><span>{translate("Fit sheet")}</span></button>
      </div>
    </header>
    <div className="sketch-sheet-tools" role="group" aria-label={translate("Drawing tools")}>
      <button type="button" aria-label={translate("Pen")} title={translate("Pen")} aria-pressed={tools.tool === 'pen'} disabled={disabled} onClick={() => setTools({ tool: 'pen' })}><Ico>{I.pen}</Ico></button>
      <button type="button" aria-label={translate("Eraser")} title={translate("Eraser")} aria-pressed={tools.tool === 'eraser'} disabled={disabled} onClick={() => setTools({ tool: 'eraser' })}><Ico>{I.eraser}</Ico></button>
      <hr />
      {SKETCH_INKS.map(ink => <button type="button" key={ink.id} aria-label={INK_LABELS[ink.id]()} title={INK_LABELS[ink.id]()} aria-pressed={tools.color.toLowerCase() === ink.value.toLowerCase()} disabled={disabled}
        onClick={() => setTools({ color: ink.value, tool: 'pen' })}><span className="sketch-ink" style={{ background: ink.value }} /></button>)}
      <hr />
      {SKETCH_WIDTHS.map(width => <button type="button" key={width} aria-label={WIDTH_LABELS[width]!()} title={WIDTH_LABELS[width]!()} aria-pressed={tools.width === width} disabled={disabled} onClick={() => setTools({ width, tool: 'pen' })}>
        <span className="sketch-width" style={{ width: 4 + width, height: 4 + width }} /></button>)}
      <hr />
      <button type="button" aria-label={translate("Undo")} title={translate("Undo")} disabled={disabled || !history.canUndo} onClick={history.undo}><Ico>{I.undo}</Ico></button>
      <button type="button" aria-label={translate("Redo")} title={translate("Redo")} disabled={disabled || !history.canRedo} onClick={history.redo}><Ico>{I.redo}</Ico></button>
      <hr />
      <button type="button" aria-label={translate("More options")} title={translate("More options")} aria-expanded={menu} onClick={() => { setMenu(value => !value); setClearArmed(false); }}><Ico>{I.more}</Ico></button>
    </div>
    <div ref={surface} className="sketch-sheet-canvas">
      <canvas ref={canvas} tabIndex={0}
        aria-label={translate("Drawing canvas. Arrow keys move the drawing point, Shift+arrow keys draw, Space adds a dot, + and - zoom, 0 fits the sheet, E and P switch eraser and pen, 1 to 7 pick an ink.")}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up} onPointerLeave={leave} onContextMenu={event => event.preventDefault()} onKeyDown={onCanvasKey} onKeyUp={onCanvasKeyUp} />
      {!disabled && <div className="sketch-sheet-options" role="group" aria-label={tools.tool === 'pen' ? translate("Pen settings") : translate("Eraser settings")}>
        {tools.tool === 'pen' ? <>
          <label>{translate("Brush")}<select aria-label={translate("Brush")} value={tools.brush} onChange={event => { const brush = event.target.value as SketchBrush;
            // A highlighter starts translucent; leaving it restores full opacity unless the person chose another value.
            setTools({ brush, tool: 'pen', ...(brush === 'highlighter' && tools.color.toLowerCase() === SKETCH_INKS[0].value.toLowerCase() ? { color: SKETCH_INKS[6].value } : brush !== 'highlighter' && tools.brush === 'highlighter' && tools.color.toLowerCase() === SKETCH_INKS[6].value.toLowerCase() ? { color: SKETCH_INKS[0].value } : {}), ...(brush === 'highlighter' && tools.opacity === 100 ? { opacity: 35 } : brush !== 'highlighter' && tools.brush === 'highlighter' && tools.opacity === 35 ? { opacity: 100 } : {}) }); }}>
            {SKETCH_BRUSHES.map(brush => <option key={brush} value={brush}>{BRUSH_LABELS[brush]()}</option>)}
          </select></label>
          <label>{translate("Opacity")}<input type="range" aria-label={translate("Opacity")} min={5} max={100} step={5} value={tools.opacity} disabled={tools.brush === 'ballpoint'} onChange={event => setTools({ opacity: Number(event.target.value) })} /><output>{tools.opacity} %</output></label>
          <label>{translate("Line width")}<input type="range" aria-label={translate("Line width")} min={LINE_WIDTH.min} max={LINE_WIDTH.max} step={1} value={tools.width} onChange={event => setTools({ width: Number(event.target.value) })} /><output>{tools.width}</output></label>
          <label className="sketch-sheet-check"><input type="checkbox" checked={tools.pressure} onChange={event => setTools({ pressure: event.target.checked })} />{translate("Pen pressure")}</label>
        </> : <>
          <div className="sketch-sheet-segments" role="group" aria-label={translate("Eraser mode")}>
            <button type="button" aria-pressed={tools.eraserMode === 'partial'} onClick={() => setTools({ eraserMode: 'partial' as EraserMode })}>{translate("Part of a line")}</button>
            <button type="button" aria-pressed={tools.eraserMode === 'stroke'} onClick={() => setTools({ eraserMode: 'stroke' as EraserMode })}>{translate("Whole line")}</button>
          </div>
          <label>{translate("Eraser size")}<input type="range" aria-label={translate("Eraser size")} min={ERASER_SIZE.min} max={ERASER_SIZE.max} step={2} value={tools.eraserSize} onChange={event => setTools({ eraserSize: Number(event.target.value) })} /><output>{tools.eraserSize}</output></label>
        </>}
      </div>}
      {hint && <p className="sketch-sheet-hint">{hint}</p>}
      {error && <p role="alert" className="sketch-sheet-alert">{error}</p>}
      {menu && <div className="sketch-sheet-menu" role="group" aria-label={translate("Sketch settings")}>
        <label>{translate("Input")}<select aria-label={translate("Input")} value={tools.mode} onChange={event => setTools({ mode: event.target.value as SketchInputMode })}>
          {SKETCH_INPUT_MODES.map(item => <option key={item} value={item}>{MODE_LABELS[item]()}</option>)}</select></label>
        <label className="sketch-sheet-check"><input type="checkbox" checked={tools.toolsSide === 'right'} onChange={event => setTools({ toolsSide: event.target.checked ? 'right' : 'left' })} />{translate("Tools on the right")}</label>
        <label className="sketch-sheet-check"><input type="checkbox" checked={tools.grid} onChange={event => setTools({ grid: event.target.checked })} />{translate("Dot grid (screen only)")}</label>
        <fieldset className="sketch-sheet-fieldset"><legend>{translate("Sheet")}</legend>
          <label>{translate("Sheet format")}<select aria-label={translate("Sheet format")} value={sheetFormatFor(sheetDraft.width, sheetDraft.height)} disabled={disabled}
            onChange={event => { const format = SHEET_FORMATS.find(item => item.id === event.target.value); if (format) setSheetDraft({ width: format.width, height: format.height }); }}>
            {SHEET_FORMATS.map(format => <option key={format.id} value={format.id}>{FORMAT_LABELS[format.id]()}</option>)}<option value="custom">{translate("Custom size")}</option></select></label>
          <div className="sketch-sheet-size">
            <label>{translate("Width (points)")}<input type="number" aria-label={translate("Width (points)")} min={SHEET_SIZE.min} max={SHEET_SIZE.max} value={sheetDraft.width} disabled={disabled} onChange={event => setSheetDraft(value => ({ ...value, width: Number(event.target.value) }))} /></label>
            <label>{translate("Height (points)")}<input type="number" aria-label={translate("Height (points)")} min={SHEET_SIZE.min} max={SHEET_SIZE.max} value={sheetDraft.height} disabled={disabled} onChange={event => setSheetDraft(value => ({ ...value, height: Number(event.target.value) }))} /></label>
          </div>
          <button type="button" disabled={disabled || (sheetDraft.width === document.sketch.width && sheetDraft.height === document.sketch.height)} onClick={applySheetSize}>{translate("Apply sheet size")}</button>
        </fieldset>
        <label>{translate("PNG resolution")}<select aria-label={translate("PNG resolution")} value={exportScales.includes(tools.exportScale) ? tools.exportScale : 1} onChange={event => setTools({ exportScale: Number(event.target.value) })}>
          {exportScales.map(scale => <option key={scale} value={scale}>{translate("{{scale}}× ({{width}} × {{height}} px)", { scale, width: document.sketch.width * scale, height: document.sketch.height * scale })}</option>)}</select></label>
        <button type="button" onClick={onExportPng}>{translate("Sketch as PNG")}</button>
        <button type="button" className="sketch-sheet-danger" disabled={disabled || !document.sketch.strokes.length} onClick={clearAll}>{clearArmed ? translate("Really clear the sheet? Undo stays available.") : translate("Clear the sheet")}</button>
      </div>}
    </div>
  </div>, window.document.body);
}
