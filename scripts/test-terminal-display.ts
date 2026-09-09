import { Terminal } from '@xterm/headless';
import { RemoteTerminalDisplay } from '../src/main/application/RemoteTerminalScreen';
import { TerminalInputQueue } from '../src/mobile/TerminalInputQueue';
import { mobileDashboard } from '../src/main/dashboard/mobileDashboard';
let passed = 0; let failed = 0;
const check = (label: string, ok: boolean) => { if (ok) { passed++; console.log(`  ok  ${label}`); } else { failed++; console.error(`FAIL  ${label}`); } };
const wait = (ms = 25) => new Promise<void>((resolve) => setTimeout(resolve, ms));
void (async () => {
  const display = new RemoteTerminalDisplay(40, 10); const browser = new Terminal({ cols: 40, rows: 10, allowProposedApi: true });
  try {
    display.write(Buffer.from('\x1b[?1049h\x1b[2J\x1b[3;5H\x1b[38;2;12;34;56mMENU\x1b[5;7H\x1b[?1h\x1b[?2004h'));
    const first = await display.snapshot(); await new Promise<void>((resolve) => browser.write(first.frame.ansi, resolve));
    const cell = browser.buffer.active.getLine(2)!.getCell(4)!;
    check('alternate screen preserves absolute placement and RGB color', cell.getChars() === 'M' && cell.getFgColor() === 0x0c2238);
    check('cursor and application keyboard modes survive safe projection', browser.buffer.active.cursorX === 6 && browser.buffer.active.cursorY === 4 && browser.modes.applicationCursorKeysMode && browser.modes.bracketedPasteMode);
    check('unchanged display has stable revision', first.frame.revision === (await display.snapshot()).frame.revision);
    display.write(Buffer.from('\x1b[5;7Hnext')); check('incremental chunks retain previous TUI state', (await display.snapshot()).screen.includes('MENU'));
    display.write(Buffer.from('\x1b[?1049l\x1b[2J\x1b[HPS C:\\private\\workspace>\r\napi_key=sensitive\r\n\x1b]52;c;U0VDUkVU\x07\x1b]8;;https://bad.invalid/token\x07LINK\x1b]8;;\x07'));
    const safe = await display.snapshot(); const wire = JSON.stringify(safe);
    check('frame and transcript redact paths and secrets', !/private|sensitive/.test(wire) && wire.includes('[path]'));
    check('OSC clipboard and hyperlink payloads never leave main', !/U0VDUkVU|bad.invalid/.test(wire) && !safe.frame.ansi.includes('\x1b]'));
    display.resize(20, 6); display.write(Buffer.from('\x1b[2J\x1b[Hapi_key=abcdefghijklmnopqrstuvwxyz\r\nREADY'));
    const wrapped = await display.snapshot();
    check('wrapped credentials are redacted across cell rows', !JSON.stringify(wrapped).includes('abcdef') && wrapped.screen.includes('READY'));
    check('resize updates wire dimensions', wrapped.frame.cols === 20 && wrapped.frame.rows === 6);
    display.write(Buffer.from('\x1b[2J\x1b[Hapi_key=\r\nHARD_NEWLINE_SECRET'));
    check('hard newline credential values cannot bypass frame redaction', !JSON.stringify(await display.snapshot()).includes('HARD_NEWLINE_SECRET'));
    await new Promise<void>((resolve) => browser.write(safe.frame.ansi, resolve));
    check('redacted frame stays interpretable', browser.buffer.active.getLine(0)!.translateToString(true).includes('[path]'));
  } finally { display.dispose(); browser.dispose(); }
  const dense = new RemoteTerminalDisplay(240, 100);
  try {
    let output = '\x1b[?7l';
    for (let row = 1; row <= 100; row++) { output += `\x1b[${row};1H`; for (let col = 0; col < 240; col++) output += `\x1b[38;2;${col};${row};123mX`; }
    dense.write(Buffer.from(output)); const bounded = await dense.snapshot();
    check('dense styles fall back within the host response budget', Buffer.byteLength(JSON.stringify(bounded)) < 512 * 1024 && !bounded.frame.ansi.includes('38;2;') && bounded.frame.ansi.includes('XXX'));
  } finally { dense.dispose(); }
  const flood = new RemoteTerminalDisplay(40, 10); flood.write(Buffer.alloc(2 * 1024 * 1024 + 1, 65));
  try { await flood.snapshot(); check('output backlog fails closed', false); } catch (error) { check('output backlog fails closed', error instanceof Error && error.message.includes('umfangreich')); } finally { flood.dispose(); }
  for (const [label, url] of [['Hermes', 'https://host.tail123.ts.net:9443/login'], ['OpenClaw', 'https://host.tail123.ts.net:8443/'], ['profile', 'https://host.tail123.ts.net:9443/sessions?profile=general']]) {
    check(`${label} private dashboard is projected`, mobileDashboard({ dashboardUrl: url })?.url === url);
  }
  for (const url of ['http://localhost:8443', 'https://user:pass@host.ts.net', 'https://host.ts.net/#token=secret', 'https://host.ts.net/?token=secret', 'https://public.invalid/', 'https://host.ts.net/%61pi_key=secret', 'https://host.ts.net/?profile=%0Atoken']) {
    check('unsafe or non-private dashboard fails closed', !mobileDashboard({ dashboardUrl: url })?.url);
  }
  check('dashboard commands are not sent or executed', !mobileDashboard({ dashboardCommand: 'mint-secret' })?.url);
  const writes: string[] = []; let inflight = 0; let peak = 0;
  const queue = new TerminalInputQueue(async (data) => { peak = Math.max(peak, ++inflight); await wait(); writes.push(data); inflight--; return 'accepted'; }, () => undefined, 1);
  queue.enqueue('a'); queue.enqueue('b'); await wait(5); queue.enqueue('c'); await wait(100);
  check('rapid typing is coalesced, ordered and serialized', writes.join('') === 'abc' && peak === 1);
  writes.length = 0; queue.enqueue('😀'.repeat(600)); await wait(100);
  check('UTF-8 chunks stay bounded without splitting characters', writes.join('') === '😀'.repeat(600) && writes.every((data) => Buffer.byteLength(data) <= 2048));
  queue.clear(); let attempts = 0;
  const lost = new TerminalInputQueue(async () => { attempts++; return 'failed'; }, () => undefined, 1);
  lost.enqueue('never retry'); await wait(80); check('uncertain transport is never retried automatically', attempts === 1); lost.clear();
  let overflows = 0; const bounded = new TerminalInputQueue(async () => { attempts++; return 'accepted'; }, () => { overflows++; }, 1);
  bounded.enqueue('x'.repeat(8193)); await wait(); check('oversized paste is discarded before sending', overflows === 1 && attempts === 1);
  bounded.enqueue('old lease'); bounded.clear(); await wait(); check('ownership change discards unsent keys', attempts === 1);
  bounded.enqueue('new lease'); await wait(); check('final positive control accepts fresh input', attempts === 2); bounded.clear();
  let sentAt = 0; const started = performance.now();
  const responsive = new TerminalInputQueue(async () => { sentAt = performance.now(); return 'accepted'; }, () => undefined);
  responsive.enqueue('x'); await wait(80);
  check('direct keys leave the default buffer within 80 ms', sentAt > started && sentAt - started < 80); responsive.clear();
})().catch((error) => { failed++; console.error(error); }).finally(() => { console.log(`Terminal display: ${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0; });
