import { t as translate } from "../../shared/i18n";
import { createHash } from 'node:crypto';
import { Terminal, type IBufferCell } from '@xterm/headless';
import type { MobileTerminalFrame } from '../../shared/remote';
import { redactForWire } from '../errors';

const CSI = '\x1b[';
const safeText = (text: string) => redactForWire(text, 256 * 1024).replace(/[\x00-\x1f\x7f-\x9f]/g, '');
const safeTranscript = (text: string) => redactForWire(text, 2 * 1024 * 1024).replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, '');

/** A caret inside hidden text stays at the boundary of the complete redaction.
 * Never insert a marker into raw text before redaction: that can split a secret. */
function safeCaret(text: string, prefix: string): number {
  let offset = 0;
  while (offset < text.length && offset < prefix.length && text[offset] === prefix[offset]) offset++;
  if (offset && /[\uD800-\uDBFF]/.test(text[offset - 1]!)) offset--;
  return offset;
}

/** Use the same terminal cell widths/wrapping as the browser, including wide and
 * combining characters. Only already-redacted text enters this temporary screen. */
async function projectSafeText(text: string, caret: number | undefined, cols: number, rows: number) {
  const term = new Terminal({ cols, rows, scrollback: 1000, allowProposedApi: true, convertEol: true });
  let cursor: { row: number; col: number } | undefined;
  try {
    term.parser.registerCsiHandler({ prefix: '?', final: 'z' }, () => {
      cursor = { row: term.buffer.active.baseY + term.buffer.active.cursorY, col: Math.min(cols - 1, term.buffer.active.cursorX) }; return true;
    });
    await new Promise<void>((resolve) => term.write(caret === undefined ? text : `${text.slice(0, caret)}${CSI}?7777z${text.slice(caret)}`, resolve));
    const buffer = term.buffer.active;
    // Keep the input caret visible even when a prediction extends below it.
    const start = cursor ? Math.min(buffer.baseY, Math.max(0, cursor.row - rows + 1)) : buffer.baseY;
    return { lines: Array.from({ length: rows }, (_, row) => buffer.getLine(start + row)?.translateToString(true) ?? ''),
      cursor: cursor && { row: cursor.row - start, col: cursor.col } };
  } finally { term.dispose(); }
}
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
  private version = 0;
  private cached?: { version: number; value: { screen: string; frame: MobileTerminalFrame } };
  constructor(cols: number, rows: number) {
    this.terminal = new Terminal({ cols, rows, scrollback: 1000, allowProposedApi: true });
    for (const final of ['h', 'l']) this.terminal.parser.registerCsiHandler({ prefix: '?', final }, (params) => {
      if (params.includes(25)) this.cursorVisible = final === 'h'; return false;
    });
  }
  write(bytes: Buffer): void {
    if (this.disposed || this.overflow) return;
    if (this.pendingBytes + bytes.length > 2 * 1024 * 1024) { this.overflow = true; return; }
    this.pendingBytes += bytes.length;
    this.terminal.write(bytes, () => { this.pendingBytes -= bytes.length; this.version++; });
  }
  resize(cols: number, rows: number): void {
    if (!this.disposed && (this.terminal.cols !== Math.min(500, cols) || this.terminal.rows !== Math.min(200, rows))) {
      this.terminal.resize(Math.min(500, cols), Math.min(200, rows)); this.version++;
    }
  }
  dispose(): void { if (this.disposed) return; this.disposed = true; this.terminal.dispose(); }
  /** Pending output may disable paste; never authorize using a stale mode. */
  acceptsBracketedPaste(): boolean {
    return !this.disposed && !this.overflow && this.pendingBytes === 0 && this.terminal.modes.bracketedPasteMode;
  }
  async snapshot(): Promise<{ screen: string; frame: MobileTerminalFrame }> {
    if (this.disposed) throw new Error(translate("The terminal is no longer available."));
    if (this.overflow) throw new Error(translate("Terminal output is too large. Continue working on the desktop or open a new session."));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(translate("Terminal display could not be updated in time."))), 2500);
      this.terminal.write('', () => { clearTimeout(timer); resolve(); });
    });
    if (this.disposed) throw new Error(translate("The terminal is no longer available."));
    if (this.cached?.version === this.version && this.pendingBytes === 0) return this.cached.value;
    const term = this.terminal; const buffer = term.buffer.active;
    const version = this.version; const baseY = buffer.baseY;
    const cols = Math.min(240, term.cols); const rows = Math.min(100, term.rows);
    let cursor = { row: Math.min(rows - 1, buffer.cursorY), col: Math.min(cols - 1, buffer.cursorX) };
    const cursorLine = baseY + buffer.cursorY;
    const logical: string[] = []; const originals: string[] = [];
    const changed: Array<{ start: number; end: number; text: string; caret?: number }> = [];
    let originalCaret = 0; let originalLength = 0;
    for (let index = 0; index < buffer.length;) {
      const first = index; let original = ''; let caret: number | undefined;
      do {
        const line = buffer.getLine(index)!;
        const wraps = !!buffer.getLine(index + 1)?.isWrapped;
        let part = line.translateToString(!wraps);
        if (index === cursorLine) {
          const before = line.translateToString(false, 0, buffer.cursorX);
          caret = original.length + before.length;
          // A shell prompt normally ends in a space; retain it up to the caret.
          if (before.length > part.length) part = before;
        }
        original += part; index++;
      } while (index < buffer.length && buffer.getLine(index)!.isWrapped);
      const safe = safeText(original); logical.push(safe); originals.push(original);
      if (caret !== undefined) originalCaret = originalLength + caret;
      originalLength += original.length + 1;
      if (safe !== original && index > baseY && first < baseY + rows) {
        // Never reuse cells from a redacted logical line: they may contain secret fragments.
        changed.push({ start: Math.max(first, baseY), end: Math.min(index, baseY + rows), text: safe,
          caret: caret === undefined ? undefined : safeCaret(safe, safeText(original.slice(0, caret))) });
      }
    }
    // Credential syntax can span hard newlines too. If contextual redaction changes
    // line boundaries, suppress styled cells and rebuild from the complete safe text.
    const originalText = originals.join('\n'); const fullText = safeTranscript(originalText);
    const contextual = fullText !== logical.join('\n');
    const prefix = `${CSI}?25l${CSI}0m${CSI}?7l${CSI}2J`;
    const styledRows: string[] = []; const plainRows: string[] = [];
    for (let row = 0; row < rows; row++) {
      const index = baseY + row; const line = buffer.getLine(index);
      let ansi = ''; let plain = '';
      if (contextual || changed.some((group) => index >= group.start && index < group.end)) { styledRows.push(''); plainRows.push(''); continue; }
      let lastStyle = '';
      for (let col = 0; line && col < cols; col++) {
        const cell = line.getCell(col)!; if (cell.getWidth() === 0) continue;
        const nextStyle = style(cell); if (lastStyle !== nextStyle) { ansi += nextStyle; lastStyle = nextStyle; }
        const text = cell.getChars().replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0, 16) || ' ';
        ansi += text; plain += text;
      }
      styledRows.push(ansi); plainRows.push(plain);
    }
    // Capture live modes/cells before asynchronous projection. New PTY output
    // invalidates this version and will be projected by the following snapshot.
    const modes = term.modes; const cursorVisible = this.cursorVisible;
    if (contextual) {
      const projected = await projectSafeText(fullText, safeCaret(fullText, safeTranscript(originalText.slice(0, originalCaret))), cols, rows);
      for (let row = 0; row < rows; row++) { styledRows[row] = `${CSI}0m${projected.lines[row]}`; plainRows[row] = projected.lines[row]!; }
      if (projected.cursor) cursor = projected.cursor;
    } else {
      const projected = await Promise.all(changed.map(async (group) => ({ group, projection: await projectSafeText(group.text, group.caret, cols, group.end - group.start) })));
      for (const { group, projection } of projected) {
        for (let row = 0; row < projection.lines.length; row++) {
          styledRows[group.start - baseY + row] = `${CSI}0m${projection.lines[row]}`; plainRows[group.start - baseY + row] = projection.lines[row]!;
        }
        if (projection.cursor) cursor = { row: group.start - baseY + projection.cursor.row, col: projection.cursor.col };
      }
    }
    if (this.disposed) throw new Error(translate("The terminal is no longer available."));
    let ansi = prefix + styledRows.map((line, row) => `${CSI}${row + 1};1H${line}`).join('');
    const plain = prefix + plainRows.map((line, row) => `${CSI}${row + 1};1H${line}`).join('');
    if (Buffer.byteLength(JSON.stringify(ansi)) > 300 * 1024) ansi = plain;
    if (Buffer.byteLength(JSON.stringify(ansi)) > 300 * 1024) throw new Error(translate("Terminal display is too extensive. Continue working on the desktop."));
    ansi += `${CSI}0m${CSI}?7h${CSI}${cursor.row + 1};${cursor.col + 1}H`;
    for (const [mode, enabled] of [[1, modes.applicationCursorKeysMode], [66, modes.applicationKeypadMode],
      [2004, modes.bracketedPasteMode], [25, cursorVisible]] as const) ansi += `${CSI}?${mode}${enabled ? 'h' : 'l'}`;
    const revision = createHash('sha256').update(ansi).digest('hex');
    const value = { screen: fullText.slice(-64 * 1024).trimEnd(), frame: { cols, rows, ansi, revision } };
    this.cached = { version, value }; return value;
  }
}

export async function remoteTerminalScreen(bytes: Buffer, cols: number, rows: number): Promise<string> {
  const display = new RemoteTerminalDisplay(cols, rows);
  try { display.write(bytes); return (await display.snapshot()).screen; } finally { display.dispose(); }
}
