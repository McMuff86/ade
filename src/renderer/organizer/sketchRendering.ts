import { t as translate } from "../../shared/i18n";
import type { OrganizerDocument, OrganizerImage, SketchStroke } from '../../shared/organizer';
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
  for (let i = 1; i < stroke.points.length; i++) {
    const a = stroke.points[i - 1]!; const b = stroke.points[i]!;
    context.lineWidth = stroke.width * Math.max(.3, (a.pressure + b.pressure) / 2);
    context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke();
  }
}
export function loadOrganizerImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error(translate("The picture could not be displayed."))); image.src = source; });
}
export async function renderOrganizerSketch(document: OrganizerDocument): Promise<HTMLCanvasElement> {
  const canvas = window.document.createElement('canvas'); canvas.width = document.sketch.width; canvas.height = document.sketch.height;
  const context = canvas.getContext('2d'); if (!context) throw new Error(translate("Drawing space is not available on this device."));
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
  const background = document.images.find(image => image.id === document.sketch.backgroundImageId);
  if (background) {
    const image = await loadOrganizerAttachment(background);
    const scale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
    context.drawImage(image, (canvas.width - image.naturalWidth * scale) / 2, (canvas.height - image.naturalHeight * scale) / 2, image.naturalWidth * scale, image.naturalHeight * scale);
  }
  for (const stroke of document.sketch.strokes) drawStroke(context, stroke);
  return canvas;
}
