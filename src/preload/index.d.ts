import type { AdeApi } from '../shared/ipc';

declare global {
  interface Window {
    /** Typed IPC surface exposed by src/preload/index.ts. */
    ade: AdeApi;
  }
}

export {};
