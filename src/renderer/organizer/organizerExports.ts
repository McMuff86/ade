import { ORGANIZER_LIMITS, type OrganizerDocument, type OrganizerImage } from '../../shared/organizer';
import { loadOrganizerAttachment, loadOrganizerImage, renderOrganizerSketch } from './sketchRendering';

export async function importOrganizerImage(file: File): Promise<OrganizerImage> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) throw new Error('Bitte ein PNG-, JPEG- oder WebP-Foto bis 20 MB auswählen.');
  const url = URL.createObjectURL(file);
  try {
    const source = await loadOrganizerImage(url);
    for (const size of [1600, 1200, 800, 512]) {
      const scale = Math.min(1, size / Math.max(source.naturalWidth, source.naturalHeight)); const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(source.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
      const context = canvas.getContext('2d'); if (!context) throw new Error('Bildverarbeitung ist nicht verfügbar.');
      context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(source, 0, 0, canvas.width, canvas.height);
      const base64 = canvas.toDataURL('image/jpeg', .86).split(',')[1]!;
      if (base64.length <= ORGANIZER_LIMITS.imageBase64) return { id: crypto.randomUUID(), name: file.name.replace(/[\\/\x00-\x1f]/g, '_').slice(0, 120) || 'Foto', mime: 'image/jpeg', base64, width: canvas.width, height: canvas.height };
    }
    throw new Error('Das Foto bleibt zu gross. Bitte einen kleineren Ausschnitt auswählen.');
  } finally { URL.revokeObjectURL(url); }
}
export function organizerMarkdown(note: OrganizerDocument): string {
  return [`# ${note.title || (note.kind === 'task' ? 'Aufgabe' : 'Notiz')}`, '', note.text,
    ...note.checklist.map(item => `- [${item.done ? 'x' : ' '}] ${item.text}`),
    ...(note.dueAt !== null ? ['', `Fällig: ${new Date(note.dueAt).toISOString()}`] : [])].join('\n') + '\n';
}
export function downloadOrganizerBlob(blob: Blob, title: string, extension: string): void {
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url;
  link.download = `${(title.trim() || 'ADE-Notiz').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100)}.${extension}`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
export async function organizerPng(note: OrganizerDocument): Promise<Blob> {
  const canvas = await renderOrganizerSketch(note);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG konnte nicht erstellt werden.')), 'image/png'));
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
  const commit = () => { if (++pages > 64) throw new Error('Der PDF-Export überschreitet 64 Seiten. Die Notiz in kleinere Teile aufteilen.'); if (pages > 1) pdf.addPage(); pdf.addImage(canvas.toDataURL('image/jpeg', .9), 'JPEG', 0, 0, 595.28, 841.89); };
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
  wrap(note.title || (note.kind === 'task' ? 'Aufgabe' : 'Notiz'), true); line(''); wrap(note.text);
  for (const item of note.checklist) wrap(`${item.done ? '☑' : '☐'} ${item.text}`);
  if (note.dueAt !== null) { line(''); wrap(`Fällig: ${new Date(note.dueAt).toLocaleString('de-CH')}`); }
  if (note.sketch.strokes.length || note.sketch.backgroundImageId) {
    next(); const sketch = await renderOrganizerSketch(note); const scale = Math.min(1088 / sketch.width, 1540 / sketch.height);
    context.drawImage(sketch, 76, 92, sketch.width * scale, sketch.height * scale);
  }
  for (const image of note.images.filter(image => image.id !== note.sketch.backgroundImageId)) {
    next(); const source = await loadOrganizerAttachment(image); wrap(image.name);
    const scale = Math.min(1088 / source.naturalWidth, (1630 - y) / source.naturalHeight); context.drawImage(source, 76, y, source.naturalWidth * scale, source.naturalHeight * scale);
  }
  commit(); return pdf.output('blob');
}
