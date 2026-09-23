import { t as translate } from "../../shared/i18n";
import type { OrganizerDocument, OrganizerImage, SketchPoint, SketchStroke } from '../../shared/organizer';
export function organizerImageUrl(image: OrganizerImage): string {
  const binary = atob(image.base64); const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: image.mime }));
}
export async function loadOrganizerAttachment(image: OrganizerImage): Promise<HTMLImageElement> {
  const url = organizerImageUrl(image); try { return await loadOrganizerImage(url); } finally { URL.revokeObjectURL(url); }
}
export function drawStroke(context: CanvasRenderingContext2D, stroke: SketchStroke): void {
  context.strokeStyle = stroke.color; context.fillStyle = stroke.color; context.lineCap = 'round'; context.lineJoin = 'round';
  const first = stroke.points[0]; if (!first) return;
  if (stroke.points.length === 1) { context.beginPath(); context.arc(first.x, first.y, stroke.width * Math.max(.3, first.pressure) / 2, 0, Math.PI * 2); context.fill(); return; }
  if (stroke.points.length === 2) { segment(context, stroke, stroke.points[0]!, stroke.points[1]!); return; }
  // Smooth on screen and in exports alike: quadratic curves through the midpoints of
  // consecutive samples, each recorded point acting as control point. Stored data is untouched.
  const points = stroke.points; const mid = (a: SketchPoint, b: SketchPoint): SketchPoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, pressure: (a.pressure + b.pressure) / 2 });
  let from = points[0]!;
  for (let i = 1; i < points.length - 1; i++) {
    const control = points[i]!; const to = mid(control, points[i + 1]!);
    context.lineWidth = stroke.width * Math.max(.3, (from.pressure + to.pressure) / 2);
    context.beginPath(); context.moveTo(from.x, from.y); context.quadraticCurveTo(control.x, control.y, to.x, to.y); context.stroke();
    from = to;
  }
  segment(context, stroke, from, points[points.length - 1]!);
}
function segment(context: CanvasRenderingContext2D, stroke: SketchStroke, a: SketchPoint, b: SketchPoint): void {
  context.lineWidth = stroke.width * Math.max(.3, (a.pressure + b.pressure) / 2);
  context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke();
}
export function loadOrganizerImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error(translate("The picture could not be displayed."))); image.src = source; });
}
/** White sheet with the optional background photo and, unless `strokes` is false, every stroke; the sheet draws strokes live instead. */
export async function renderOrganizerSketch(document: OrganizerDocument, options: { strokes?: boolean; scale?: number } = {}): Promise<HTMLCanvasElement> {
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
