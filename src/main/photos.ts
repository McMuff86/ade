/**
 * Profile-photo import + storage, and the `ade-photo://` custom protocol.
 *
 * Photos are written under `userData/ade/photos/<uuid>.<ext>` (PNG alpha is
 * preserved — we store the bytes verbatim, no re-encode). The renderer loads
 * them through the privileged `ade-photo://<filename>` scheme so it never has
 * to deal with file:// / CSP restrictions.
 */

import { app, net, protocol } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
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

function photosDir(): string {
  return join(app.getPath('userData'), 'ade', 'photos');
}

/**
 * Store the given image bytes and return the stored filename (not a path).
 * Throws on unsupported mime, empty payload, or oversize input.
 */
export function importPhoto(req: PhotoImportRequest): PhotoImportResult {
  const ext = MIME_EXT[req.mime?.toLowerCase() ?? ''];
  if (!ext) throw new Error(`ade: unsupported image type "${req.mime}"`);

  const buf = Buffer.from(req.bytesBase64, 'base64');
  if (buf.length === 0) throw new Error('ade: empty image payload');
  if (buf.length > MAX_BYTES) {
    throw new Error(`ade: image too large (${buf.length} bytes; max ${MAX_BYTES})`);
  }

  const dir = photosDir();
  mkdirSync(dir, { recursive: true });
  const file = `${randomUUID()}.${ext}`;
  writeFileSync(join(dir, file), buf); // bytes verbatim — PNG alpha preserved
  return { file };
}

/**
 * Register the `ade-photo` scheme as privileged. MUST be called before the app
 * `ready` event (module import time in main/index.ts). Privileges chosen so the
 * renderer can put the URL straight into an <img src> under any CSP.
 */
export function registerPhotoProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: PHOTO_PROTOCOL,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
      },
    },
  ]);
}

/**
 * Wire the actual `ade-photo://<filename>` handler. Call once after app ready.
 * Only serves basename-only filenames out of the photos dir (no traversal).
 */
export function registerPhotoProtocolHandler(): void {
  protocol.handle(PHOTO_PROTOCOL, (request) => {
    // Parse the filename ourselves so scheme-parser quirks can't bite us:
    // strip the scheme, any query/hash, and any trailing slash.
    const raw = request.url.slice(`${PHOTO_PROTOCOL}://`.length);
    const filename = decodeURIComponent(raw.replace(/[?#].*$/, '').replace(/\/+$/, ''));

    // Reject anything that isn't a bare filename (path traversal guard).
    if (!filename || filename !== basename(filename)) {
      return new Response('bad request', { status: 400 });
    }

    const filePath = join(photosDir(), filename);
    if (!existsSync(filePath)) {
      return new Response('not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}
