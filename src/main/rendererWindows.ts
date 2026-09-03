/**
 * Registry of the windows that host ADE's own renderer (preload bridge,
 * trusted URL). Main→renderer events, native notification click targets and
 * the IPC sender check consult this set rather than
 * `BrowserWindow.getAllWindows()`, which also contains dashboard windows
 * showing arbitrary https origins. Those windows must never receive ADE
 * payloads nor be accepted as an IPC sender, and that must hold as a
 * boundary, not as a side effect of them lacking a preload script.
 */

import type { BrowserWindow } from 'electron';

const registered = new Set<BrowserWindow>();

export function registerRendererWindow(win: BrowserWindow): void {
  registered.add(win);
  win.once('closed', () => {
    registered.delete(win);
  });
}

/** Live ADE renderer windows, in registration order. */
export function rendererWindows(): BrowserWindow[] {
  const out: BrowserWindow[] = [];
  for (const win of registered) {
    if (win.isDestroyed()) registered.delete(win);
    else out.push(win);
  }
  return out;
}

export function isRendererWindow(win: BrowserWindow | null | undefined): boolean {
  return Boolean(win) && registered.has(win!) && !win!.isDestroyed();
}

/** Send one event to every ADE renderer window and nothing else. */
export function broadcastToRenderers(channel: string, payload: unknown): void {
  for (const win of rendererWindows()) win.webContents.send(channel, payload);
}
