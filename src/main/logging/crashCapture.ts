/**
 * Failures that used to leave no trace in main.log: uncaught exceptions and
 * unhandled rejections in main, renderer/GPU/utility processes that died, and
 * uncaught errors the desktop renderer reports to its console.
 *
 * Everything goes through `console.error`, so the rotating main log and its
 * credential redactor apply. A gate per category bounds a failure loop to a
 * few lines per minute and counts what it dropped.
 *
 * Installing the main-process handlers replaces Electron's modal error box for
 * uncaught exceptions: nobody sees a dialog on a host driven from the tablet,
 * and the process keeps running exactly as it did behind the dialog.
 */

import type { App, WebContents } from 'electron';
import { basename } from 'node:path';
import { redactedErrorDetail, redactSensitiveText } from '../errors';

export class LogGate {
  private windowStart = Number.NEGATIVE_INFINITY;
  private used = 0;
  private dropped = 0;

  constructor(
    private readonly category: string,
    private readonly limit = 20,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Whether one more line may be written now; reports what a past window dropped. */
  admit(): boolean {
    const now = this.now();
    if (now - this.windowStart >= this.windowMs) {
      if (this.dropped > 0) console.error(`[ade] ${this.category}: ${this.dropped} further failure(s) not logged in the previous minute`);
      this.windowStart = now;
      this.used = 0;
      this.dropped = 0;
    }
    if (this.used >= this.limit) {
      this.dropped += 1;
      return false;
    }
    this.used += 1;
    return true;
  }
}

export function captureMainProcessFailures(target: NodeJS.Process = process, gate = new LogGate('main process')): void {
  target.on('uncaughtException', (error) => {
    if (gate.admit()) console.error('[ade] uncaught exception in main:', redactedErrorDetail(error));
  });
  target.on('unhandledRejection', (reason) => {
    if (gate.admit()) console.error('[ade] unhandled rejection in main:', redactedErrorDetail(reason));
  });
}

type ProcessEvents = Pick<App, 'on'>;

export function captureProcessCrashes(app: ProcessEvents, gate = new LogGate('processes')): void {
  app.on('render-process-gone', (_event, _contents, details) => {
    if (details.reason === 'clean-exit' || !gate.admit()) return;
    console.error(`[ade] renderer process gone: ${details.reason}, exit code ${details.exitCode}`);
  });
  app.on('child-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit' || !gate.admit()) return;
    const name = details.name ?? details.serviceName;
    console.error(`[ade] ${details.type} process gone${name ? ` (${name})` : ''}: ${details.reason}, exit code ${details.exitCode}`);
  });
}

type ConsoleEvents = Pick<WebContents, 'on'>;

/** Chromium reports uncaught renderer errors and rejections as console errors. */
export function captureRendererConsoleErrors(contents: ConsoleEvents, gate = new LogGate('renderer')): void {
  contents.on('console-message', (event) => {
    if (event.level !== 'error' || !gate.admit()) return;
    const source = event.sourceId ? ` (${basename(event.sourceId.split(/[?#]/)[0]!)}:${event.lineNumber})` : '';
    console.error(`[ade] renderer error: ${redactSensitiveText(event.message).slice(0, 2_000)}${source}`);
  });
}
