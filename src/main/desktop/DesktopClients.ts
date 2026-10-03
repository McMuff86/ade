/**
 * Desktop renderer windows as host clients (Goal 34.6, H1e).
 *
 * Each ADE renderer's webContents gets one random client id for its lifetime.
 * Host-side ownership (dictation jobs, reply speech, workspace import
 * selections) uses that id instead of Electron's numeric `sender.id`, so the
 * same code can serve a desktop over a local socket later. Microphone grants
 * stay an Electron permission keyed by webContents (desktopMicrophone.ts).
 */
import { randomUUID } from 'node:crypto';
import type { HostClient } from '../host/ports';

/** The part of Electron's WebContents this registry needs. */
export interface ClientContents {
  readonly id: number;
  isDestroyed(): boolean;
  once(event: 'destroyed', listener: () => void): unknown;
}

export class DesktopClients {
  private readonly clients = new Map<number, HostClient>();

  /** The client for one renderer; stable until that renderer is destroyed. */
  for(contents: ClientContents): HostClient {
    const existing = this.clients.get(contents.id);
    if (existing && existing.alive()) return existing;
    const client: HostClient = {
      id: randomUUID(),
      alive: () => !contents.isDestroyed() && this.clients.get(contents.id) === client,
      onClose: (listener) => { contents.once('destroyed', listener); },
    };
    this.clients.set(contents.id, client);
    contents.once('destroyed', () => { if (this.clients.get(contents.id) === client) this.clients.delete(contents.id); });
    return client;
  }
}
