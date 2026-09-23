/**
 * Erasing and sheet-format rules for the sketch, kept pure so they are
 * unit-testable. Strokes stay structured data: erasing a part of a line
 * splits it into new strokes with fresh ids; the document contract
 * (`shared/organizer.ts`) is untouched — sheet sizes stay within its
 * 1…4096 point bounds and every point stays inside the sheet.
 */
import type { SketchPoint, SketchStroke } from '../../shared/organizer';
import { brushWidthFactor } from './sketchRendering';

export type EraserMode = 'stroke' | 'partial';
export const ERASER_SIZE = { min: 8, max: 120, default: 36 } as const;
export const LINE_WIDTH = { min: 1, max: 40 } as const;

const distance = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);
/** Distance from `at` to the segment a–b. */
export function segmentDistance(a: SketchPoint, b: SketchPoint, at: { x: number; y: number }): number {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const t = dx || dy ? Math.max(0, Math.min(1, ((at.x - a.x) * dx + (at.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(a.x + t * dx - at.x, a.y + t * dy - at.y);
}
/** Half the drawn width of a stroke, brush-aware, so a highlighter band is erased where it is visible. */
export const strokeReach = (stroke: SketchStroke): number => stroke.width * brushWidthFactor(stroke.brush) / 2;
/** Cheap bounding-box gate before any segment geometry runs; a full erase drag calls this for every stroke per sample. */
export function nearStroke(stroke: SketchStroke, at: { x: number; y: number }, radius: number): boolean {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of stroke.points) { if (point.x < minX) minX = point.x; if (point.x > maxX) maxX = point.x; if (point.y < minY) minY = point.y; if (point.y > maxY) maxY = point.y; }
  return at.x >= minX - radius && at.x <= maxX + radius && at.y >= minY - radius && at.y <= maxY + radius;
}
const touches = (stroke: SketchStroke, at: { x: number; y: number }, radius: number): boolean =>
  nearStroke(stroke, at, radius) && stroke.points.some((p, i) => segmentDistance(p, stroke.points[i + 1] ?? p, at) <= radius);

/** Remove the topmost whole stroke under `at`; the hit tolerance never falls below the stroke's own width. */
export function eraseStroke(strokes: readonly SketchStroke[], at: { x: number; y: number }, radius: number): SketchStroke[] {
  for (let i = strokes.length - 1; i >= 0; i--) {
    if (touches(strokes[i]!, at, Math.max(radius, strokeReach(strokes[i]!) * 2))) return strokes.filter((_item, index) => index !== i);
  }
  return [...strokes];
}

/** Parameters t in (0, 1) where the segment a–b crosses the circle around `at`, ascending. */
function crossings(a: SketchPoint, b: SketchPoint, at: { x: number; y: number }, radius: number): number[] {
  const dx = b.x - a.x; const dy = b.y - a.y; const fx = a.x - at.x; const fy = a.y - at.y;
  const qa = dx * dx + dy * dy; const qb = 2 * (fx * dx + fy * dy); const qc = fx * fx + fy * fy - radius * radius;
  const disc = qb * qb - 4 * qa * qc; if (qa === 0 || disc < 0) return [];
  const root = Math.sqrt(disc); return [(-qb - root) / (2 * qa), (-qb + root) / (2 * qa)].filter(t => t > 0 && t < 1);
}
const lerp = (a: SketchPoint, b: SketchPoint, t: number): SketchPoint => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, pressure: a.pressure + (b.pressure - a.pressure) * t });

/**
 * Cut every stroke where it passes through the circle around `at`. Points
 * inside the circle disappear, segments crossing it are split at the circle's
 * edge so both ends keep their shape, and pieces shorter than two points are
 * dropped (a lone dot survives only untouched).
 */
export function erasePartial(strokes: readonly SketchStroke[], at: { x: number; y: number }, radius: number, id: () => string): SketchStroke[] {
  const out: SketchStroke[] = [];
  for (const stroke of strokes) {
    const reach = radius + strokeReach(stroke);
    if (!touches(stroke, at, reach)) { out.push(stroke); continue; }
    const points = stroke.points; if (points.length === 1) continue;
    let piece: SketchPoint[] = [];
    const flush = () => { if (piece.length >= 2) out.push({ ...stroke, id: id(), points: piece }); piece = []; };
    for (let i = 0; i < points.length; i++) {
      const p = points[i]!; const insideP = distance(p, at) <= reach;
      if (i === 0) { if (!insideP) piece.push(p); continue; }
      const q = points[i - 1]!; const insideQ = distance(q, at) <= reach; const ts = crossings(q, p, at, reach);
      if (!insideQ && !insideP) {
        if (ts.length === 2) { piece.push(lerp(q, p, ts[0]!)); flush(); piece.push(lerp(q, p, ts[1]!)); }
        piece.push(p);
      } else if (!insideQ && insideP) { if (ts.length) piece.push(lerp(q, p, ts[0]!)); flush(); }
      else if (insideQ && !insideP) { if (ts.length) piece.push(lerp(q, p, ts[ts.length - 1]!)); piece.push(p); }
    }
    flush();
  }
  return out;
}

/** Smallest sheet (in points) that still contains every stroke; 0 × 0 for an empty sketch. */
export function contentExtent(strokes: readonly SketchStroke[]): { width: number; height: number } {
  let width = 0; let height = 0;
  for (const stroke of strokes) for (const point of stroke.points) { width = Math.max(width, point.x + stroke.width / 2); height = Math.max(height, point.y + stroke.width / 2); }
  return { width: Math.ceil(width), height: Math.ceil(height) };
}

export const SHEET_SIZE = { min: 200, max: 4096 } as const;
export const SHEET_FORMATS = [
  { id: 'landscape', width: 1600, height: 1000 }, { id: 'portrait', width: 1000, height: 1600 }, { id: 'square', width: 1200, height: 1200 },
  { id: 'wide', width: 2400, height: 1200 }, { id: 'large', width: 3200, height: 2000 },
] as const;
export type SheetFormatId = typeof SHEET_FORMATS[number]['id'];
export const sheetFormatFor = (width: number, height: number): SheetFormatId | 'custom' => SHEET_FORMATS.find(item => item.width === width && item.height === height)?.id ?? 'custom';

export type SheetSizeVerdict = { ok: true } | { ok: false; reason: 'range' } | { ok: false; reason: 'content'; width: number; height: number };
/** Whether the sheet may take this size: within the contract bounds and not smaller than the drawing. */
export function sheetSizeVerdict(width: number, height: number, strokes: readonly SketchStroke[]): SheetSizeVerdict {
  const valid = (value: number) => Number.isSafeInteger(value) && value >= SHEET_SIZE.min && value <= SHEET_SIZE.max;
  if (!valid(width) || !valid(height)) return { ok: false, reason: 'range' };
  const extent = contentExtent(strokes);
  if (extent.width > width || extent.height > height) return { ok: false, reason: 'content', width: extent.width, height: extent.height };
  return { ok: true };
}

/** PNG export scales that keep the raster at or below 8192 px per side. */
export const exportScalesFor = (width: number, height: number): number[] => [1, 2, 3].filter(scale => width * scale <= 8192 && height * scale <= 8192);
