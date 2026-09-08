import { Terminal } from '@xterm/headless';
import { redactForWire } from '../errors';

/** Interpret control sequences in main. Only bounded, redacted text reaches the browser. */
export async function remoteTerminalScreen(bytes: Buffer, cols: number, rows: number): Promise<string> {
  const terminal = new Terminal({ cols, rows, scrollback: 200, allowProposedApi: true });
  try {
    await new Promise<void>((resolve) => terminal.write(bytes, resolve));
    const buffer = terminal.buffer.active; const lines: string[] = [];
    for (let index = 0; index < buffer.length; index++) {
      const line = buffer.getLine(index)!;
      const text = line.translateToString(true);
      if (line.isWrapped && lines.length) lines[lines.length - 1] += text;
      else lines.push(text);
    }
    // Join soft-wrapped lines before redaction so split credentials/paths retain context.
    return redactForWire(lines.join('\n'), 64 * 1024).trimEnd();
  } finally { terminal.dispose(); }
}
