import { t as translate } from "../../shared/i18n";
import type { OrganizerImage, OrganizerSketch, SketchBrush, SketchPoint, SketchStroke } from '../../shared/organizer';
/** What the sheet, preview and exports draw: one sheet plus the note's photos it may sit on. */
export interface SketchScene { images: OrganizerImage[]; sketch: OrganizerSketch }
export function organizerImageUrl(image: OrganizerImage): string {
  const binary = atob(image.base64); const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: image.mime }));
}
export async function loadOrganizerAttachment(image: OrganizerImage): Promise<HTMLImageElement> {
  const url = organizerImageUrl(image); try { return await loadOrganizerImage(url); } finally { URL.revokeObjectURL(url); }
}
/**
 * Brush look, shared by the sheet, the preview and PNG/PDF export so they agree.
 *  pen         pressure-modulated width (the original line)
 *  pencil      thinner, slightly translucent single path with a fine grain pass
 *  ballpoint   constant width, pressure ignored, always opaque
 *  charcoal    wide, soft edge from three passes of decreasing width
 *  calligraphy nib at 45°: width follows the stroke direction
 *  highlighter constant flat band, multiply blending, translucent by default
 * Translucent strokes are drawn opaque onto a bounded offscreen canvas and composited once, so
 * overlapping segment joints never double-darken. Stored points are never changed here.
 */
export const NIB_ANGLE = Math.PI / 4;
const mid = (a: SketchPoint, b: SketchPoint): SketchPoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, pressure: (a.pressure + b.pressure) / 2 });
/** Effective drawn width of a brush relative to the stored width; erasing uses it for hit reach. */
export function brushWidthFactor(brush: SketchBrush | undefined): number {
  return brush === 'highlighter' ? 1.8 : brush === 'charcoal' ? 1.6 : brush === 'calligraphy' ? 1.4 : brush === 'pencil' ? .55 : brush === 'ballpoint' ? .8 : 1;
}
export function drawStroke(context: CanvasRenderingContext2D, stroke: SketchStroke): void {
  const first = stroke.points[0]; if (!first) return;
  // Graphite reads lighter than ink even at full slider: a pencil without an explicit opacity draws at 80 %.
  const brush = stroke.brush ?? 'pen'; const opacity = brush === 'ballpoint' ? 1 : Math.max(.05, Math.min(1, stroke.opacity ?? (brush === 'pencil' ? .8 : 1)));
  const composite: GlobalCompositeOperation = brush === 'highlighter' ? 'multiply' : 'source-over';
  withComposite(context, stroke, opacity, composite, target => paintBrush(target, stroke, brush));
}
function paintBrush(context: CanvasRenderingContext2D, stroke: SketchStroke, brush: SketchBrush): void {
  context.strokeStyle = stroke.color; context.fillStyle = stroke.color; context.lineCap = brush === 'highlighter' ? 'butt' : 'round'; context.lineJoin = 'round';
  const points = stroke.points; const width = stroke.width * brushWidthFactor(brush);
  if (points.length === 1) { context.beginPath(); context.arc(points[0]!.x, points[0]!.y, width * (brush === 'pen' ? Math.max(.3, points[0]!.pressure) : 1) / 2, 0, Math.PI * 2); context.fill(); return; }
  if (brush === 'pen') { pressureLine(context, points, width); return; }
  if (brush === 'calligraphy') { nibLine(context, points, width); return; }
  if (brush === 'charcoal') {
    for (const [factor, alpha] of [[1.35, .18], [1.12, .3], [.85, .7]] as const) { context.globalAlpha = alpha; singlePath(context, points, width * factor); }
    context.globalAlpha = 1; return;
  }
  singlePath(context, points, width);
  if (brush === 'pencil') {
    // Grain: a broken, wider halo beside the core, like graphite catching the paper tooth.
    context.save(); context.globalAlpha = .45; context.setLineDash([Math.max(1, width * .5), Math.max(1.5, width * 1.1)]); singlePath(context, points, width * 1.7); context.restore();
  }
}
/** One path, one stroke call: every pixel painted once, so translucency stays even along the line. */
function singlePath(context: CanvasRenderingContext2D, points: SketchPoint[], width: number): void {
  context.lineWidth = width; context.beginPath(); context.moveTo(points[0]!.x, points[0]!.y);
  if (points.length === 2) context.lineTo(points[1]!.x, points[1]!.y);
  else { for (let i = 1; i < points.length - 1; i++) { const control = points[i]!; const to = mid(control, points[i + 1]!); context.quadraticCurveTo(control.x, control.y, to.x, to.y); } context.lineTo(points[points.length - 1]!.x, points[points.length - 1]!.y); }
  context.stroke();
}
/** The original pen: quadratic curves through midpoints, width from the average pressure of each piece. */
function pressureLine(context: CanvasRenderingContext2D, points: SketchPoint[], width: number): void {
  const piece = (a: SketchPoint, b: SketchPoint, control?: SketchPoint) => {
    context.lineWidth = width * Math.max(.3, (a.pressure + b.pressure) / 2); context.beginPath(); context.moveTo(a.x, a.y);
    if (control) context.quadraticCurveTo(control.x, control.y, b.x, b.y); else context.lineTo(b.x, b.y); context.stroke();
  };
  if (points.length === 2) { piece(points[0]!, points[1]!); return; }
  let from = points[0]!;
  for (let i = 1; i < points.length - 1; i++) { const control = points[i]!; const to = mid(control, points[i + 1]!); piece(from, to, control); from = to; }
  piece(from, points[points.length - 1]!);
}
/** Broad-nib feel: thin along the nib angle, full width across it. */
function nibLine(context: CanvasRenderingContext2D, points: SketchPoint[], width: number): void {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!; const b = points[i]!; const angle = Math.atan2(b.y - a.y, b.x - a.x);
    context.lineWidth = width * (.1 + .9 * Math.abs(Math.sin(angle - NIB_ANGLE))); context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke();
  }
}
/** Draw opaque into a bounded offscreen canvas that shares the target transform, then composite once. */
/** One reusable scratch surface: translucent strokes are frequent while drawing, and a fresh canvas per stroke per frame costs allocation and GC time. */
let scratch: HTMLCanvasElement | undefined;
function withComposite(context: CanvasRenderingContext2D, stroke: SketchStroke, opacity: number, composite: GlobalCompositeOperation, draw: (target: CanvasRenderingContext2D) => void): void {
  if (opacity >= 1 && composite === 'source-over') { draw(context); return; }
  const matrix = context.getTransform(); const pad = stroke.width * 2 + 4;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const point of stroke.points) for (const [x, y] of [[point.x - pad, point.y - pad], [point.x + pad, point.y + pad], [point.x - pad, point.y + pad], [point.x + pad, point.y - pad]]) {
    const device = matrix.transformPoint({ x, y }); left = Math.min(left, device.x); top = Math.min(top, device.y); right = Math.max(right, device.x); bottom = Math.max(bottom, device.y);
  }
  const x0 = Math.max(0, Math.floor(left)); const y0 = Math.max(0, Math.floor(top));
  const x1 = Math.min(context.canvas.width, Math.ceil(right)); const y1 = Math.min(context.canvas.height, Math.ceil(bottom));
  if (x1 <= x0 || y1 <= y0) return;
  const offscreen = scratch ?? (scratch = window.document.createElement('canvas'));
  if (offscreen.width < x1 - x0 || offscreen.height < y1 - y0) { offscreen.width = Math.max(offscreen.width, x1 - x0); offscreen.height = Math.max(offscreen.height, y1 - y0); }
  const target = offscreen.getContext('2d'); if (!target) { draw(context); return; }
  target.setTransform(1, 0, 0, 1, 0, 0); target.clearRect(0, 0, x1 - x0, y1 - y0);
  target.setTransform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e - x0, matrix.f - y0); draw(target);
  context.save(); context.setTransform(1, 0, 0, 1, 0, 0); context.globalAlpha = opacity; context.globalCompositeOperation = composite; context.drawImage(offscreen, 0, 0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0); context.restore();
}
export function loadOrganizerImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error(translate("The picture could not be displayed."))); image.src = source; });
}
/** White sheet with the optional background photo and, unless `strokes` is false, every stroke; the sheet draws strokes live instead. */
export async function renderOrganizerSketch(document: SketchScene, options: { strokes?: boolean; scale?: number } = {}): Promise<HTMLCanvasElement> {
  const scale = options.scale ?? 1; const canvas = window.document.createElement('canvas'); canvas.width = document.sketch.width * scale; canvas.height = document.sketch.height * scale;
  const context = canvas.getContext('2d'); if (!context) throw new Error(translate("Drawing space is not available on this device."));
  context.scale(scale, scale); context.fillStyle = '#ffffff'; context.fillRect(0, 0, document.sketch.width, document.sketch.height);
  const background = document.images.find(image => image.id === document.sketch.backgroundImageId);
  if (background) {
    const image = await loadOrganizerAttachment(background);
    const fit = Math.min(document.sketch.width / image.naturalWidth, document.sketch.height / image.naturalHeight);
    context.drawImage(image, (document.sketch.width - image.naturalWidth * fit) / 2, (document.sketch.height - image.naturalHeight * fit) / 2, image.naturalWidth * fit, image.naturalHeight * fit);
  }
  if (options.strokes !== false) for (const stroke of document.sketch.strokes) drawStroke(context, stroke);
  return canvas;
}
