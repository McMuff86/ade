import { intlLocale } from '../../shared/i18n';
import { t as translate } from "../../shared/i18n";
import { ORGANIZER_LIMITS, type OrganizerDocument, type OrganizerImage } from '../../shared/organizer';
import { loadOrganizerAttachment, loadOrganizerImage, renderOrganizerSketch } from './sketchRendering';
import { sheetLabel } from './SketchEditor';

export async function importOrganizerImage(file: File): Promise<OrganizerImage> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) throw new Error(translate("Please select a PNG, JPEG or WebP photo up to 20 MB."));
  const url = URL.createObjectURL(file);
  try {
    const source = await loadOrganizerImage(url);
    for (const size of [1600, 1200, 800, 512]) {
      const scale = Math.min(1, size / Math.max(source.naturalWidth, source.naturalHeight)); const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(source.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
      const context = canvas.getContext('2d'); if (!context) throw new Error(translate("Image processing is not available."));
      context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(source, 0, 0, canvas.width, canvas.height);
      const base64 = canvas.toDataURL('image/jpeg', .86).split(',')[1]!;
      if (base64.length <= ORGANIZER_LIMITS.imageBase64) return { id: crypto.randomUUID(), name: file.name.replace(/[\\/\x00-\x1f]/g, '_').slice(0, 120) || translate("Photo"), mime: 'image/jpeg', base64, width: canvas.width, height: canvas.height };
    }
    throw new Error(translate("The photo remains too large. Please select a smaller section."));
  } finally { URL.revokeObjectURL(url); }
}
export function organizerMarkdown(note: OrganizerDocument): string {
  return [`# ${note.title || (note.kind === 'task' ? translate("Task") : translate("Note"))}`, '', note.text,
    ...note.checklist.map(item => `- [${item.done ? 'x' : ' '}] ${item.text}`),
    ...(note.dueAt !== null ? ['', translate("Due: {{value1}}", { value1: new Date(note.dueAt).toISOString() })] : [])].join('\n') + '\n';
}
export function downloadOrganizerBlob(blob: Blob, title: string, extension: string): void {
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url;
  link.download = `${(title.trim() || translate("ADE note")).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100)}.${extension}`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
/** One sheet as PNG. `scale` multiplies the raster per sheet point (device preference, 1–3); the document itself is unchanged. */
export async function organizerPng(note: OrganizerDocument, sketchId: string, scale = 1): Promise<Blob> {
  const sketch = note.sketches.find(item => item.id === sketchId); if (!sketch) throw new Error(translate("This sheet no longer exists."));
  const canvas = await renderOrganizerSketch({ images: note.images, sketch }, { scale });
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error(translate("PNG could not be created."))), 'image/png'));
}
/** Load the PDF engine on explicit export only. All user text is rasterized, never interpreted as HTML or PDF syntax. */
export async function organizerPdf(note: OrganizerDocument): Promise<Blob> {
  const { jsPDF } = await import('jspdf'); await document.fonts.ready;
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  let pages = 0;
  const pageCanvas = () => { const canvas = document.createElement('canvas'); canvas.width = 1240; canvas.height = 1754; return canvas; };
  let canvas = pageCanvas(); let context = canvas.getContext('2d')!; let y = 92;
  const reset = () => { context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); context.fillStyle = '#17191e'; context.font = '26px sans-serif'; context.textBaseline = 'top'; };
  reset();
  const commit = () => { if (++pages > 64) throw new Error(translate("The PDF export exceeds 64 pages. Divide the note into smaller parts.")); if (pages > 1) pdf.addPage(); pdf.addImage(canvas.toDataURL('image/jpeg', .9), 'JPEG', 0, 0, 595.28, 841.89); };
  const next = () => { commit(); canvas = pageCanvas(); context = canvas.getContext('2d')!; y = 92; reset(); };
  const line = (text: string, heading = false) => { if (y > 1630) next(); context.font = heading ? 'bold 38px sans-serif' : '26px sans-serif'; context.fillText(text, 76, y); y += heading ? 54 : 38; };
  const wrap = (text: string, heading = false) => {
    context.font = heading ? 'bold 38px sans-serif' : '26px sans-serif';
    for (const paragraph of text.split('\n')) {
      let row = '';
      for (const character of paragraph) { if (row && context.measureText(row + character).width > 1088) { line(row, heading); row = ''; } row += character; }
      line(row, heading);
    }
  };
  wrap(note.title || (note.kind === 'task' ? translate("Task") : translate("Note")), true); line(''); wrap(note.text);
  for (const item of note.checklist) wrap(`${item.done ? '☑' : '☐'} ${item.text}`);
  if (note.dueAt !== null) { line(''); wrap(translate("Due: {{value1}}", { value1: new Date(note.dueAt).toLocaleString(intlLocale()) })); }
  // Every sheet with marks or a photo copy gets its own page, titled; photos no sheet sits on follow as attachments.
  for (const [index, sketch] of note.sketches.entries()) {
    if (!sketch.strokes.length && !sketch.backgroundImageId) continue;
    next(); wrap(sheetLabel(sketch, index)); const image = await renderOrganizerSketch({ images: note.images, sketch }); const scale = Math.min(1088 / image.width, (1630 - y) / image.height);
    context.drawImage(image, 76, y, image.width * scale, image.height * scale);
  }
  for (const image of note.images.filter(image => !note.sketches.some(sketch => sketch.backgroundImageId === image.id))) {
    next(); const source = await loadOrganizerAttachment(image); wrap(image.name);
    const scale = Math.min(1088 / source.naturalWidth, (1630 - y) / source.naturalHeight); context.drawImage(source, 76, y, source.naturalWidth * scale, source.naturalHeight * scale);
  }
  commit(); return pdf.output('blob');
}
