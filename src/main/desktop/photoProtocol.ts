/**
 * The `ade-photo://<filename>` scheme: desktop-only delivery of stored profile
 * photos (storage lives in photos.ts). The photos directory is passed in; this
 * module never derives profile paths itself.
 */

import { net, protocol } from 'electron';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PHOTO_PROTOCOL } from '../photos';

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
export function registerPhotoProtocolHandler(photosDir: string): void {
  protocol.handle(PHOTO_PROTOCOL, (request) => {
    // Parse the filename ourselves so scheme-parser quirks can't bite us:
    // strip the scheme, any query/hash, and any trailing slash.
    const raw = request.url.slice(`${PHOTO_PROTOCOL}://`.length);
    const filename = decodeURIComponent(raw.replace(/[?#].*$/, '').replace(/\/+$/, ''));

    // Reject anything that isn't a bare filename (path traversal guard).
    if (!filename || filename !== basename(filename)) {
      return new Response('bad request', { status: 400 });
    }

    const filePath = join(photosDir, filename);
    if (!existsSync(filePath)) {
      return new Response('not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}
