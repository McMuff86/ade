import { createHash } from 'node:crypto';
import { Terminal, type IBufferCell } from '@xterm/headless';
import type { MobileTerminalFrame } from '../../shared/remote';
import { redactForWire } from '../errors';

const CSI = '\x1b[';
const safeText = (text: string) => redactForWire(text, 256 * 1024).replace(/[\x00-\x1f\x7f-\x9f]/g, '');
function style(cell: IBufferCell): string {
  const codes = [0];
  if (cell.isBold()) codes.push(1); if (cell.isDim()) codes.push(2); if (cell.isItalic()) codes.push(3);
  if (cell.isUnderline()) codes.push(4); if (cell.isInverse()) codes.push(7);
  if (cell.isInvisible()) codes.push(8); if (cell.isStrikethrough()) codes.push(9);
  for (const [prefix, rgb, palette, color] of [[38, cell.isFgRGB(), cell.isFgPalette(), cell.getFgColor()],
    [48, cell.isBgRGB(), cell.isBgPalette(), cell.getBgColor()]] as const) {
    if (rgb) codes.push(prefix, 2, (color >> 16) & 255, (color >> 8) & 255, color & 255);
    else if (palette) codes.push(prefix, 5, color & 255);
  }
  return `${CSI}${codes.join(';')}m`;
}

/** Stateful main-side display. Raw OSC/DCS/clipboard sequences never reach the browser. */
export class RemoteTerminalDisplay {
  private readonly terminal: Terminal;
  private cursorVisible = true;
  private disposed = false;
  private pendingBytes = 0;
  private overflow = false;
  constructor(cols: number, rows: number) {
    this.terminal = new Terminal({ cols, rows, scrollback: 200, allowProposedApi: true });
    for (const final of ['h', 'l']) this.terminal.parser.registerCsiHandler({ prefix: '?', final }, (params) => {
      if (params.includes(25)) this.cursorVisible = final === 'h'; return false;
    });
  }
  write(bytes: Buffer): void {
    if (this.disposed || this.overflow) return;
    if (this.pendingBytes + bytes.length > 2 * 1024 * 1024) { this.overflow = true; return; }
    this.pendingBytes += bytes.length;
    this.terminal.write(bytes, () => { this.pendingBytes -= bytes.length; });
  }
  resize(cols: number, rows: number): void {
    if (!this.disposed) this.terminal.resize(Math.min(500, cols), Math.min(200, rows));
  }
  dispose(): void { if (this.disposed) return; this.disposed = true; this.terminal.dispose(); }
  async snapshot(): Promise<{ screen: string; frame: MobileTerminalFrame }> {
    if (this.disposed) throw new Error('Terminal ist nicht mehr verfügbar.');
    if (this.overflow) throw new Error('Terminalausgabe ist zu umfangreich. Am Desktop weiterarbeiten oder eine neue Sitzung öffnen.');
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Terminalanzeige konnte nicht rechtzeitig aktualisiert werden.')), 2500);
      this.terminal.write('', () => { clearTimeout(timer); resolve(); });
    });
    if (this.disposed) throw new Error('Terminal ist nicht mehr verfügbar.');
    const term = this.terminal; const buffer = term.buffer.active;
    const cols = Math.min(240, term.cols); const rows = Math.min(100, term.rows);
    const logical: string[] = []; const originals: string[] = []; const safeRows = new Map<number, string>();
    for (let index = 0; index < buffer.length;) {
      const first = index; let original = buffer.getLine(index)!.translateToString(true); index++;
      while (index < buffer.length && buffer.getLine(index)!.isWrapped) original += buffer.getLine(index++)!.translateToString(true);
      const safe = safeText(original); logical.push(safe); originals.push(original);
      if (safe !== original) {
        // Never reuse cells from a redacted logical line: they may contain secret fragments.
        for (let at = first; at < index; at++) safeRows.set(at, at === first ? safe.slice(0, cols) : '');
      }
    }
    // Credential syntax can span hard newlines too. If contextual redaction changes
    // line boundaries, suppress styled cells and rebuild from the complete safe text.
    const fullText = redactForWire(originals.join('\n'), 2 * 1024 * 1024).replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, '');
    if (fullText !== logical.join('\n')) {
      const lines = fullText.split('\n');
      for (let row = 0; row < rows; row++) safeRows.set(buffer.baseY + row, lines[row]?.slice(0, cols) ?? '');
    }
    const prefix = `${CSI}?25l${CSI}0m${CSI}?7l${CSI}2J`;
    let ansi = prefix; let plain = prefix;
    for (let row = 0; row < rows; row++) {
      const index = buffer.baseY + row; const line = buffer.getLine(index);
      ansi += `${CSI}${row + 1};1H`;
      plain += `${CSI}${row + 1};1H`;
      if (safeRows.has(index)) { ansi += `${CSI}0m${safeRows.get(index)}`; plain += safeRows.get(index); continue; }
      let lastStyle = '';
      for (let col = 0; line && col < cols; col++) {
        const cell = line.getCell(col)!; if (cell.getWidth() === 0) continue;
        const nextStyle = style(cell); if (lastStyle !== nextStyle) { ansi += nextStyle; lastStyle = nextStyle; }
        const text = cell.getChars().replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0, 16) || ' ';
        ansi += text; plain += text;
      }
    }
    const modes = term.modes;
    if (Buffer.byteLength(JSON.stringify(ansi)) > 300 * 1024) ansi = plain;
    if (Buffer.byteLength(JSON.stringify(ansi)) > 300 * 1024) throw new Error('Terminalanzeige ist zu umfangreich. Am Desktop weiterarbeiten.');
    ansi += `${CSI}0m${CSI}?7h${CSI}${Math.min(rows, buffer.cursorY + 1)};${Math.min(cols, buffer.cursorX + 1)}H`;
    for (const [mode, enabled] of [[1, modes.applicationCursorKeysMode], [66, modes.applicationKeypadMode],
      [2004, modes.bracketedPasteMode], [25, this.cursorVisible]] as const) ansi += `${CSI}?${mode}${enabled ? 'h' : 'l'}`;
    const revision = createHash('sha256').update(ansi).digest('hex');
    return { screen: fullText.slice(-64 * 1024).trimEnd(), frame: { cols, rows, ansi, revision } };
  }
}

export async function remoteTerminalScreen(bytes: Buffer, cols: number, rows: number): Promise<string> {
  const display = new RemoteTerminalDisplay(cols, rows);
  try { display.write(bytes); return (await display.snapshot()).screen; } finally { display.dispose(); }
}
