import type { OrganizerEntry, OrganizerSummary } from '../../shared/organizer';
import { redactForWire } from '../errors';
export function organizerEntryForWire(entry: OrganizerEntry): { entry: OrganizerEntry; redacted: boolean } {
  const copy = structuredClone(entry); const document = copy.document;
  document.title = redactForWire(document.title, 200); document.text = redactForWire(document.text, 32_000);
  for (const item of document.checklist) item.text = redactForWire(item.text, 500);
  for (const image of document.images) image.name = redactForWire(image.name, 120);
  return { entry: copy, redacted: JSON.stringify(entry.document) !== JSON.stringify(document) };
}
export function organizerSummaryForWire(summary: OrganizerSummary): OrganizerSummary { return { ...summary, title: redactForWire(summary.title, 200) }; }
