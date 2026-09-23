import { t as translate } from "../../shared/i18n";
import type { OrganizerDocument, OrganizerImage, OrganizerSketch } from '../../shared/organizer';
import { cachedDocument, type CachedOrganizerEntry } from './OrganizerCache';

/**
 * What the terminal's image dialog can take from the notes: every photo and
 * every sheet with content, grouped by note, newest note first. Pure over the
 * cached entries so the projection is unit-testable; blobs are made only for
 * the one item the operator picks.
 */
export interface NoteImageSource { id: string; title: string; editedAt: number; photos: OrganizerImage[]; sheets: OrganizerSketch[]; document: OrganizerDocument }
export function noteImageSources(entries: readonly CachedOrganizerEntry[]): NoteImageSource[] {
  const sources: NoteImageSource[] = [];
  for (const entry of entries) {
    if (entry.deletePending || entry.redacted || (!entry.draft && entry.base?.deleted)) continue;
    const document = cachedDocument(entry); if (!document) continue;
    const sheets = document.sketches.filter(sketch => sketch.strokes.length || sketch.backgroundImageId);
    if (!document.images.length && !sheets.length) continue;
    sources.push({ id: document.id, title: document.title.trim() || translate("Untitled entry"), editedAt: entry.editedAt, photos: document.images, sheets, document });
  }
  return sources.sort((a, b) => b.editedAt - a.editedAt);
}
/** The stored attachment as a Blob for the terminal handoff; the note keeps its own copy. */
export function noteImageBlob(image: OrganizerImage): Blob {
  const binary = atob(image.base64); const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return new Blob([bytes], { type: image.mime });
}
