// Positive control: type-only references to Electron are erased and must pass.
import type { App } from 'electron';
import { type BrowserWindow } from 'electron';
export type { WebContents } from 'electron';
export type Shape = { app: App; window: BrowserWindow; module: typeof import('electron') };
