/**
 * Profile-photo import + storage.
 *
 * Photos are written under `userData/ade/photos/<uuid>.<ext>` (PNG alpha is
 * preserved — we store the bytes verbatim, no re-encode). The desktop serves
 * them through the privileged `ade-photo://<filename>` scheme
 * (desktop/photoProtocol.ts) so the renderer never deals with file:// / CSP.
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PhotoImportRequest, PhotoImportResult } from '../shared/ipc';

export const PHOTO_PROTOCOL = 'ade-photo';

/** ~10 MB cap — profile photos, not asset libraries. */
const MAX_BYTES = 10 * 1024 * 1024;

/** Accepted image types → stored file extension. */
const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
};

/**
 * Store the given image bytes and return the stored filename (not a path).
 * Throws on unsupported mime, empty payload, or oversize input.
 */
export function importPhoto(req: PhotoImportRequest, photosDir: string): PhotoImportResult {
  const ext = MIME_EXT[req.mime?.toLowerCase() ?? ''];
  if (!ext) throw new Error(`ade: unsupported image type "${req.mime}"`);

  const buf = Buffer.from(req.bytesBase64, 'base64');
  if (buf.length === 0) throw new Error('ade: empty image payload');
  if (buf.length > MAX_BYTES) {
    throw new Error(`ade: image too large (${buf.length} bytes; max ${MAX_BYTES})`);
  }

  const dir = photosDir;
  mkdirSync(dir, { recursive: true });
  const file = `${randomUUID()}.${ext}`;
  writeFileSync(join(dir, file), buf); // bytes verbatim — PNG alpha preserved
  return { file };
}
