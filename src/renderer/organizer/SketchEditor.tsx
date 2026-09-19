import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { ORGANIZER_LIMITS, type OrganizerDocument, type OrganizerSketch, type SketchPoint, type SketchStroke } from '../../shared/organizer';
import { drawStroke, renderOrganizerSketch } from './sketchRendering';

export function SketchEditor({ document, disabled, onChange }: { document: OrganizerDocument; disabled: boolean; onChange(sketch: OrganizerSketch): void }) {
  const canvas = useRef<HTMLCanvasElement>(null); const stroke = useRef<SketchStroke | null>(null); const pointer = useRef<number | null>(null);
  const current = useRef(document); current.current = document;
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen'); const [color, setColor] = useState('#2155d6'); const [width, setWidth] = useState(5);
  const [penOnly, setPenOnly] = useState(false); const [error, setError] = useState('');
  const undo = useRef<SketchStroke[][]>([]); const redo = useRef<SketchStroke[][]>([]); const [historyVersion, setHistoryVersion] = useState(0);
  const keyboardPoint = useRef<SketchPoint>({ x: 100, y: 100, pressure: 1 });
  const rendered = useRef(0);
  useEffect(() => {
    const version = ++rendered.current;
    void renderOrganizerSketch(document).then(image => { if (version === rendered.current && canvas.current) {
      const context = canvas.current.getContext('2d'); context?.clearRect(0, 0, image.width, image.height); context?.drawImage(image, 0, 0);
      if (context && stroke.current) drawStroke(context, stroke.current);
    } }).catch(reason => setError(reason instanceof Error ? reason.message : 'Zeichenfläche konnte nicht geladen werden.'));
    return () => { rendered.current++; };
  }, [document]);
  const change = (strokes: SketchStroke[]) => {
    undo.current.push(current.current.sketch.strokes); if (undo.current.length > 30) undo.current.shift(); redo.current = []; setHistoryVersion(value => value + 1);
    onChange({ ...current.current.sketch, strokes });
  };
  const finish = () => {
    const value = stroke.current; stroke.current = null; pointer.current = null;
    if (value?.points.length) change([...current.current.sketch.strokes, value]);
  };
  const point = (event: PointerEvent<HTMLCanvasElement>): SketchPoint => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(document.sketch.width, (event.clientX - bounds.left) * document.sketch.width / bounds.width)),
      y: Math.max(0, Math.min(document.sketch.height, (event.clientY - bounds.top) * document.sketch.height / bounds.height)), pressure: event.pointerType === 'pen' ? Math.max(.2, event.pressure) : 1 };
  };
  const start = (event: PointerEvent<HTMLCanvasElement>) => {
    if (disabled || pointer.current !== null || event.button !== 0 || penOnly && event.pointerType !== 'pen') return;
    event.preventDefault(); event.currentTarget.focus(); const at = point(event); setError('');
    if (tool === 'eraser') {
      const strokes = current.current.sketch.strokes;
      // Erase a whole editable stroke; Undo restores it with all original pressure points.
      let index = -1;
      for (let i = strokes.length - 1; i >= 0; i--) { const item = strokes[i]!;
        if (item.points.some((p, j) => {
          const next = item.points[j + 1] ?? p; const dx = next.x - p.x; const dy = next.y - p.y;
          const t = dx || dy ? Math.max(0, Math.min(1, ((at.x - p.x) * dx + (at.y - p.y) * dy) / (dx * dx + dy * dy))) : 0;
          return Math.hypot(p.x + t * dx - at.x, p.y + t * dy - at.y) < Math.max(18, item.width * 2);
        })) { index = i; break; }
      }
      if (index >= 0) change(strokes.filter((_item, i) => i !== index)); return;
    }
    if (current.current.sketch.strokes.length >= ORGANIZER_LIMITS.strokes || current.current.sketch.strokes.reduce((n, item) => n + item.points.length, 0) >= ORGANIZER_LIMITS.points) { setError('Die Skizze ist voll. Eine neue Notiz für weitere Zeichnungen anlegen.'); return; }
    event.currentTarget.setPointerCapture(event.pointerId); pointer.current = event.pointerId;
    stroke.current = { id: crypto.randomUUID(), color, width, points: [at] };
    const context = canvas.current?.getContext('2d'); if (context) drawStroke(context, stroke.current);
  };
  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.pointerId !== pointer.current || !stroke.current) return;
    const at = point(event); const previous = stroke.current.points.at(-1)!;
    if (Math.hypot(at.x - previous.x, at.y - previous.y) < 1) return;
    const total = current.current.sketch.strokes.reduce((n, item) => n + item.points.length, 0) + stroke.current.points.length;
    if (total >= ORGANIZER_LIMITS.points) { finish(); setError('Punktlimit erreicht. Die bisherige Zeichnung ist erhalten.'); return; }
    stroke.current.points.push(at); const context = canvas.current?.getContext('2d');
    if (context) drawStroke(context, { ...stroke.current, points: [previous, at] });
  };
  const travel = (direction: 'undo' | 'redo') => {
    const source = direction === 'undo' ? undo.current : redo.current; const destination = direction === 'undo' ? redo.current : undo.current;
    const value = source.pop(); if (!value) return; destination.push(current.current.sketch.strokes); setHistoryVersion(historyVersion + 1); onChange({ ...current.current.sketch, strokes: value });
  };
  return <section className="organizer-sketch" aria-label="Skizze">
    <div className="organizer-tools" role="group" aria-label="Zeichenwerkzeuge">
      <button type="button" aria-pressed={tool === 'pen'} disabled={disabled} onClick={() => setTool('pen')}>Stift</button>
      <button type="button" aria-pressed={tool === 'eraser'} disabled={disabled} onClick={() => setTool('eraser')}>Radierer</button>
      <label>Farbe<input type="color" aria-label="Stiftfarbe" value={color} disabled={disabled} onChange={event => setColor(event.target.value)} /></label>
      <label>Strichstärke<input type="range" aria-label="Strichstärke" min={1} max={30} value={width} disabled={disabled} onChange={event => setWidth(Number(event.target.value))} /></label>
      <label className="organizer-check"><input type="checkbox" checked={penOnly} onChange={event => setPenOnly(event.target.checked)} />Nur Stift</label>
      <button type="button" disabled={disabled || !undo.current.length} onClick={() => travel('undo')}>Rückgängig</button>
      <button type="button" disabled={disabled || !redo.current.length} onClick={() => travel('redo')}>Wiederholen</button>
    </div>
    {document.images.length > 0 && <label>Foto zum Markieren<select aria-label="Foto zum Markieren" disabled={disabled} value={document.sketch.backgroundImageId ?? ''} onChange={event => onChange({ ...document.sketch, backgroundImageId: event.target.value || null })}>
      <option value="">Leere Zeichenfläche</option>{document.images.map(image => <option key={image.id} value={image.id}>{image.name}</option>)}
    </select></label>}
    <canvas ref={canvas} width={document.sketch.width} height={document.sketch.height} tabIndex={0}
      aria-label="Zeichenfläche. Pfeiltasten bewegen den Zeichenpunkt, Umschalt und Pfeiltaste zeichnen, Leertaste setzt einen Punkt."
      onPointerDown={start} onPointerMove={move} onPointerUp={event => { if (event.pointerId === pointer.current) finish(); }} onPointerCancel={event => { if (event.pointerId === pointer.current) finish(); }}
      onLostPointerCapture={event => { if (event.pointerId === pointer.current) finish(); }} onKeyDown={event => {
        if (disabled) return;
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); travel(event.shiftKey ? 'redo' : 'undo'); return; }
        const directions: Record<string, [number, number]> = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] };
        const delta = directions[event.key]; if (!delta && event.key !== ' ') return; event.preventDefault();
        const from = { ...keyboardPoint.current }; const to = { x: Math.max(0, Math.min(document.sketch.width, from.x + (delta?.[0] ?? 0))), y: Math.max(0, Math.min(document.sketch.height, from.y + (delta?.[1] ?? 0))), pressure: 1 };
        keyboardPoint.current = to;
        if (event.shiftKey || event.key === ' ') {
          if (document.sketch.strokes.length >= ORGANIZER_LIMITS.strokes || document.sketch.strokes.reduce((n, s) => n + s.points.length, 0) + 2 > ORGANIZER_LIMITS.points) { setError('Die Skizze ist voll.'); return; }
          change([...document.sketch.strokes, { id: crypto.randomUUID(), color, width, points: delta ? [from, to] : [to] }]);
        }
      }} />
    <p className="organizer-help">Mit Stift oder Finger zeichnen. Der Radierer entfernt einen Strich. „Nur Stift“ ignoriert Berührungen mit der Hand.</p>
    {error && <p role="alert">{error}</p>}
  </section>;
}
