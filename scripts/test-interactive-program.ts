import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareProgram, programWrapper, ProgramSignalReader, type ProgramSignal } from '../src/main/pty/InteractiveProgram';
import { canReuseLaunch, sessionStateLabel } from '../src/shared/sessionState';

let passed = 0;
const check = (label: string, ok: boolean): void => { if (!ok) throw new Error(label); console.log(`  ok  ${label}`); passed++; };
const nonce = '1234567890abcdef1234567890abcdef';
const start = `\x1b]777;ade-cli;${nonce};start\x07`;
const end = `\x1b]777;ade-cli;${nonce};end;7\x07`;
const root = mkdtempSync(join(tmpdir(), 'ade-program-test-'));
void (async () => {
  for (const size of [1, 2, 7, 53, 4096]) {
    const events: ProgramSignal[] = []; const reader = new ProgramSignalReader(nonce, (event) => events.push(event));
    const data = `before${start}\x1b[31mHallo ü 🌱${end}after`; let result = '';
    for (let at = 0; at < data.length; at += size) result += reader.push(data.slice(at, at + size));
    result += reader.flush();
    check(`chunk size ${size} preserves all output and emits exactly running/exit 7`, result === 'before\x1b[31mHallo ü 🌱after'
      && events.length === 2 && events[0]?.status === 'running' && events[1]?.status === 'exited' && events[1].exitCode === 7);
  }
  const events: ProgramSignal[] = []; const reader = new ProgramSignalReader(nonce, (event) => events.push(event));
  reader.push(end); reader.push(start + start + end + start + end);
  check('out-of-order end and duplicate signals cannot regress a completed invocation', events.length === 2 && events[1]?.status === 'exited');
  const foreign = start.replace(nonce, 'f'.repeat(32));
  check('foreign escape sequences are never interpreted as this invocation', reader.push(foreign) === foreign && events.length === 2);
  const invalid = end.replace('end;7', 'end;9999999999');
  check('malformed lifecycle data remains output instead of a false exit', reader.push(invalid) === invalid);
  const incomplete = start.slice(0, -1) + 'x'.repeat(5000);
  check('unterminated candidate cannot withhold an unbounded amount of output', reader.push(incomplete).length > 4900);
  const partial = '\x1b]777;ade'; reader.push(partial);
  check('final partial escape is recoverable without inventing a status', reader.flush() === partial);
  const interrupted: ProgramSignal[] = [];
  new ProgramSignalReader(nonce, (event) => interrupted.push(event)).push(start + start.replace(';start', ';unknown'));
  check('interrupted shell control flow reports unknown without inventing an exit code', interrupted.length === 2 && interrupted[1]?.status === 'unknown');

  const shell = { title: 'Shell', status: 'running' as const, launchMode: 'shell' };
  const ended = { title: 'Claude Code', status: 'running' as const, launchMode: 'claude', program: { status: 'exited' as const, exitCode: 0 } };
  check('shell and ended CLI have different truthful labels', sessionStateLabel(shell) === 'Terminal offen'
    && sessionStateLabel(ended) === 'Claude Code beendet · Terminal offen');
  check('unknown legacy CLI is never described as running', sessionStateLabel({ ...shell, title: 'Claude', launchMode: 'agent' }).includes('unbekannt'));
  check('only a live matching invocation or plain shell can be reused', canReuseLaunch(shell, 'shell') && !canReuseLaunch(ended, 'claude')
    && canReuseLaunch({ ...ended, program: { status: 'running' } }, 'claude')
    && !canReuseLaunch({ ...ended, program: { status: 'running' } }, 'codex')
    && !canReuseLaunch({ ...ended, program: undefined }, 'claude'));

  const platform = process.platform === 'win32' ? 'win32' : 'posix';
  const command = platform === 'win32' ? "& $env:ComSpec /d /c 'echo FIXTURE_OUTPUT& exit /b 7'" : "printf 'FIXTURE_OUTPUT\\n'; exit 7";
  const path = join(root, platform === 'win32' ? 'fixture.ps1' : 'fixture.sh');
  writeFileSync(path, programWrapper(command, platform, nonce));
  const output = execFileSync(platform === 'win32' ? 'powershell.exe' : '/bin/bash', platform === 'win32'
    ? ['-NoLogo', '-NoProfile', '-File', path] : [path], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  const actual: ProgramSignal[] = []; const parsed = new ProgramSignalReader(nonce, (event) => actual.push(event)).push(output);
  check('real host shell reports child exit 7 while wrapper completes', parsed.includes('FIXTURE_OUTPUT') && actual[0]?.status === 'running'
    && actual[1]?.status === 'exited' && actual[1].exitCode === 7);
  const prepared = await prepareProgram(command, platform, async (file) => file);
  check('launch arguments never embed the CLI command', !JSON.stringify(prepared).includes('FIXTURE_OUTPUT'));
  prepared.dispose(); prepared.dispose();
  let failedFile = '';
  try { await prepareProgram(command, platform, async (file) => { failedFile = file; throw new Error('translation fixture'); }); } catch { /* expected */ }
  check('failed backend translation removes only its own launch script', !!failedFile && !existsSync(failedFile));
  console.log(`Interactive program: ${passed} passed, 0 failed`);
})().catch((error) => { console.error(error); console.log(`Interactive program: ${passed} passed, 1 failed`); process.exitCode = 1; })
  .finally(() => rmSync(root, { recursive: true, force: true }));
