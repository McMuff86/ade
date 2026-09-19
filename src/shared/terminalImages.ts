export const TERMINAL_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const TERMINAL_IMAGE_MAX_BASE64 = Math.ceil(TERMINAL_IMAGE_MAX_BYTES / 3) * 4;
export const TERMINAL_IMAGE_MAX_PIXELS = 24_000_000;
export const TERMINAL_IMAGE_TTL_MS = 24 * 60 * 60 * 1000;
export const validTerminalImageId = (value: unknown): value is string => typeof value === 'string'
  && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);

/** Inspect dimensions before invoking an image decoder. The host subsequently
 * decodes and re-encodes PNG, so a signature alone never authorizes a file. */
export function terminalPngDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 33 || bytes.length > TERMINAL_IMAGE_MAX_BYTES
    || ![137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82].every((value, index) => bytes[index] === value)) throw new Error('Ein gültiges PNG-Bild bis 8 MiB auswählen.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16); const height = view.getUint32(20);
  if (!width || !height || width > 16384 || height > 16384 || width * height > TERMINAL_IMAGE_MAX_PIXELS) throw new Error('Das Bild ist zu gross. Höchstens 24 Megapixel auswählen.');
  return { width, height };
}
