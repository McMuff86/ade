/** Personal tasks/notes are documents, separate from executable orchestration tasks. */
export const ORGANIZER_LIMITS = {
  documents: 1000, writers: 256, title: 200, text: 32_000, checklist: 100,
  attachments: 4, imageBase64: 700_000, documentBytes: 3_000_000,
  strokes: 500, points: 20_000, storeBytes: 48 * 1024 * 1024,
} as const;
export type OrganizerKind = 'task' | 'note';
export const ORGANIZER_REJECTED = '[ADE_ORGANIZER_REJECTED]';
export interface OrganizerImage { id: string; name: string; mime: 'image/png' | 'image/jpeg'; base64: string; width: number; height: number }
export interface SketchPoint { x: number; y: number; pressure: number }
/** Brush families; `pen` (or absent) is the original pressure line. Rendering lives in the renderer, the document only names the brush. */
export const SKETCH_BRUSHES = ['pen', 'pencil', 'ballpoint', 'charcoal', 'calligraphy', 'highlighter'] as const;
export type SketchBrush = typeof SKETCH_BRUSHES[number];
export const SKETCH_OPACITY = { min: 0.05, max: 1 } as const;
/** `brush` and `opacity` are optional so strokes saved before Phase 5 stay valid unchanged. */
export interface SketchStroke { id: string; color: string; width: number; points: SketchPoint[]; brush?: SketchBrush; opacity?: number }
export interface OrganizerSketch { width: number; height: number; backgroundImageId: string | null; strokes: SketchStroke[] }
export interface OrganizerDocument {
  id: string; kind: OrganizerKind; title: string; text: string; repositoryId: string | null;
  done: boolean; checklist: Array<{ id: string; text: string; done: boolean }>;
  dueAt: number | null; reminderAt: number | null; reminderSeenAt: number | null;
  images: OrganizerImage[]; sketch: OrganizerSketch; sourceNoteId: string | null; runIds: string[];
}
export interface OrganizerEntry {
  document: OrganizerDocument; revision: number; createdAt: number; updatedAt: number;
  deleted: boolean; conflictOf: string | null;
}
export interface OrganizerSummary {
  id: string; kind: OrganizerKind; title: string; repositoryId: string | null; done: boolean;
  dueAt: number | null; reminderAt: number | null; reminderSeenAt: number | null;
  revision: number; updatedAt: number; deleted: boolean; conflictOf: string | null;
}
export interface OrganizerIndex { revision: number; entries: OrganizerSummary[] }
export function dueOrganizerReminders(index: OrganizerIndex, now = Date.now()): OrganizerSummary[] {
  return index.entries.filter(item => item.kind === 'task' && !item.deleted && !item.done && item.reminderAt !== null && item.reminderAt <= now
    && (item.reminderSeenAt === null || item.reminderSeenAt < item.reminderAt));
}
export type OrganizerQueryResult = { index: OrganizerIndex } | { entry: OrganizerEntry | null; redacted: boolean } | { sequence: number };
export type OrganizerMutation = { writerId: string; sequence: number; baseRevision: number } & (
  { operation: 'put'; document: OrganizerDocument }
  | { operation: 'delete'; id: string }
);
export interface OrganizerReceipt { id: string; revision: number; createdAt: number; updatedAt: number; conflict: boolean; deleted: boolean; replayed: boolean }
export type OrganizerQuery = { operation: 'list' } | { operation: 'detail'; id: string }
  | { operation: 'writer'; writerId: string };
export const organizerId = (value: unknown): value is string => typeof value === 'string'
  && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
export const organizerReference = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
export const organizerRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export const organizerKeys = (value: Record<string, unknown>, keys: string[]): boolean => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export const organizerCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const time = (value: unknown): value is number | null => value === null || organizerCount(value) && value <= 8_640_000_000_000_000;
const text = (value: unknown, limit: number): value is string => typeof value === 'string' && value.length <= limit && !value.includes('\0');
const unique = (values: { id: string }[]): boolean => new Set(values.map(value => value.id)).size === values.length;
const dimension = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 4096;
export function validOrganizerDocument(value: unknown): value is OrganizerDocument {
  if (!organizerRecord(value) || !organizerKeys(value, ['id', 'kind', 'title', 'text', 'repositoryId', 'done', 'checklist', 'dueAt', 'reminderAt', 'reminderSeenAt', 'images', 'sketch', 'sourceNoteId', 'runIds'])
    || !organizerId(value.id) || !['task', 'note'].includes(String(value.kind)) || !text(value.title, ORGANIZER_LIMITS.title) || !text(value.text, ORGANIZER_LIMITS.text)
    || !(value.repositoryId === null || organizerReference(value.repositoryId)) || typeof value.done !== 'boolean'
    || !time(value.dueAt) || !time(value.reminderAt) || !time(value.reminderSeenAt) || !(value.sourceNoteId === null || organizerId(value.sourceNoteId))
    || !Array.isArray(value.runIds) || value.runIds.length > 32 || !value.runIds.every(organizerReference) || new Set(value.runIds).size !== value.runIds.length
    || !Array.isArray(value.checklist) || value.checklist.length > ORGANIZER_LIMITS.checklist
    || !value.checklist.every(item => organizerRecord(item) && organizerKeys(item, ['id', 'text', 'done']) && organizerId(item.id) && text(item.text, 500) && typeof item.done === 'boolean') || !unique(value.checklist)
    || !Array.isArray(value.images) || value.images.length > ORGANIZER_LIMITS.attachments
    || !value.images.every(item => organizerRecord(item) && organizerKeys(item, ['id', 'name', 'mime', 'base64', 'width', 'height']) && organizerId(item.id) && text(item.name, 120)
      && ['image/png', 'image/jpeg'].includes(String(item.mime)) && typeof item.base64 === 'string' && item.base64.length > 0 && item.base64.length <= ORGANIZER_LIMITS.imageBase64
      && item.base64.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(item.base64) && dimension(item.width) && dimension(item.height)) || !unique(value.images)) return false;
  const sketch = value.sketch;
  if (!organizerRecord(sketch) || !organizerKeys(sketch, ['width', 'height', 'backgroundImageId', 'strokes']) || !dimension(sketch.width) || !dimension(sketch.height)
    || !(sketch.backgroundImageId === null || organizerId(sketch.backgroundImageId) && value.images.some(image => image.id === sketch.backgroundImageId))
    || !Array.isArray(sketch.strokes) || sketch.strokes.length > ORGANIZER_LIMITS.strokes) return false;
  let points = 0;
  for (const stroke of sketch.strokes) {
    if (!organizerRecord(stroke) || !Object.keys(stroke).every(key => ['id', 'color', 'width', 'points', 'brush', 'opacity'].includes(key))
      || !['id', 'color', 'width', 'points'].every(key => Object.hasOwn(stroke, key)) || !organizerId(stroke.id)
      || !(stroke.brush === undefined || (SKETCH_BRUSHES as readonly unknown[]).includes(stroke.brush))
      || !(stroke.opacity === undefined || typeof stroke.opacity === 'number' && Number.isFinite(stroke.opacity) && stroke.opacity >= SKETCH_OPACITY.min && stroke.opacity <= SKETCH_OPACITY.max)
      || typeof stroke.color !== 'string' || !/^#[a-f0-9]{6}$/i.test(stroke.color) || typeof stroke.width !== 'number' || !Number.isFinite(stroke.width) || stroke.width < 1 || stroke.width > 40
      || !Array.isArray(stroke.points) || !stroke.points.length) return false;
    points += stroke.points.length; if (points > ORGANIZER_LIMITS.points) return false;
    if (!stroke.points.every(point => organizerRecord(point) && organizerKeys(point, ['x', 'y', 'pressure'])
      && typeof point.x === 'number' && Number.isFinite(point.x) && point.x >= 0 && point.x <= (sketch.width as number)
      && typeof point.y === 'number' && Number.isFinite(point.y) && point.y >= 0 && point.y <= (sketch.height as number)
      && typeof point.pressure === 'number' && Number.isFinite(point.pressure) && point.pressure >= 0 && point.pressure <= 1)) return false;
  }
  return unique(sketch.strokes) && (value.kind === 'task' || !value.done && value.dueAt === null && value.reminderAt === null && value.reminderSeenAt === null && value.checklist.length === 0);
}
export function validOrganizerMutation(value: unknown): value is OrganizerMutation {
  if (!organizerRecord(value) || !organizerId(value.writerId) || !organizerCount(value.sequence) || !value.sequence || !organizerCount(value.baseRevision)) return false;
  const keys = ['writerId', 'sequence', 'baseRevision', 'operation'];
  return value.operation === 'put' ? organizerKeys(value, [...keys, 'document']) && validOrganizerDocument(value.document)
    : value.operation === 'delete' && organizerKeys(value, [...keys, 'id']) && organizerId(value.id) && value.baseRevision > 0;
}
export function validOrganizerQuery(value: unknown): value is OrganizerQuery {
  return organizerRecord(value) && (value.operation === 'list' ? organizerKeys(value, ['operation'])
    : value.operation === 'detail' ? organizerKeys(value, ['operation', 'id']) && organizerId(value.id)
      : value.operation === 'writer' && organizerKeys(value, ['operation', 'writerId']) && organizerId(value.writerId));
}
export const organizerCommandKey = (input: Pick<OrganizerMutation, 'writerId' | 'sequence'>): string => `${input.writerId}:${input.sequence}`;
export function newOrganizerDocument(kind: OrganizerKind, id = crypto.randomUUID()): OrganizerDocument {
  return { id, kind, title: '', text: '', repositoryId: null, done: false, checklist: [], dueAt: null, reminderAt: null, reminderSeenAt: null,
    images: [], sketch: { width: 1600, height: 1000, backgroundImageId: null, strokes: [] }, sourceNoteId: null, runIds: [] };
}
export function organizerSummary(entry: OrganizerEntry): OrganizerSummary {
  const { id, kind, title, repositoryId, done, dueAt, reminderAt, reminderSeenAt } = entry.document;
  return { id, kind, title, repositoryId, done, dueAt, reminderAt, reminderSeenAt, revision: entry.revision, updatedAt: entry.updatedAt, deleted: entry.deleted, conflictOf: entry.conflictOf };
}
