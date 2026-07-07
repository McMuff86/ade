/**
 * node-pty smoke test (Phase A de-risking).
 * Spawns the user's shell through ConPTY, echoes a marker and resolves with
 * the captured output. Run from main on app start when ADE_PTY_SMOKE=1.
 *
 * The echoed command is split ('ade-pty-' + 'ok') so the marker only appears
 * in real PTY *output*, never in the echoed input line.
 */

import * as os from 'node:os';
import * as pty from 'node-pty';

const MARKER = 'ade-pty-ok';

export function runPtySmoke(timeoutMs = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === 'win32';
    const shell = isWin ? 'powershell.exe' : (process.env['SHELL'] ?? 'bash');

    let proc: pty.IPty;
    try {
      proc = pty.spawn(shell, [], {
        name: 'xterm-color',
        cols: 80,
        rows: 24,
        cwd: os.homedir(),
        env: process.env as Record<string, string>,
        useConpty: true,
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    let output = '';
    let settled = false;

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        proc.kill();
      } catch {
        /* already dead */
      }
      fn();
    };

    const timer = setTimeout(() => {
      finish(() =>
        reject(new Error(`pty smoke timed out after ${timeoutMs}ms; output tail: ${JSON.stringify(output.slice(-400))}`)),
      );
    }, timeoutMs);

    proc.onData((data) => {
      output += data;
      if (output.includes(MARKER)) {
        finish(() => resolve(output));
      }
    });

    proc.onExit(({ exitCode }) => {
      finish(() =>
        reject(new Error(`shell exited (code ${exitCode}) before emitting marker; output tail: ${JSON.stringify(output.slice(-400))}`)),
      );
    });

    const command = isWin ? "echo ('ade-pty-' + 'ok')\r" : "echo 'ade-pty-'ok\r";
    proc.write(command);
  });
}

export { MARKER as PTY_SMOKE_MARKER };
