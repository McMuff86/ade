import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { prepareProtectedProgram } from '../src/main/pty/ProtectedProgram';
import { TerminalPromptDelivery } from '../src/main/pty/TerminalPromptDelivery';
import { ProtectedPromptWriter } from '../src/main/pty/ProtectedPromptWriter';
import { validTerminalPrompt, type TerminalPromptCapability, type TerminalPromptRequest } from '../src/shared/terminalPrompt';

let passed = 0;
function check(name: string, ok: boolean) { if (!ok) throw new Error(name); passed++; console.log(`  ok ${name}`); }
async function refuses(name: string, operation: () => unknown, reason: RegExp) {
  try { await operation(); } catch (error) { check(name, reason.test(String(error))); return; }
  throw new Error(`${name}: unexpectedly allowed`);
}
void (async () => {
  let permitted = true; let available: TerminalPromptCapability = { available: true }; let ambiguous = false;
  const writes: string[] = []; const authorize = () => { if (!permitted) throw new Error('ownership lost'); };
  const delivery = new TerminalPromptDelivery({ capability: () => available, write: (_id, text) => {
    if (!available.available) throw new Error('process exited');
    writes.push(text); if (ambiguous) throw new Error('write uncertain');
  } });
  const request = (overrides: Partial<TerminalPromptRequest> = {}): TerminalPromptRequest => ({ sessionId: 'sfixture', commandId: randomUUID(), text: 'Prüfe\r\nden Code.', mode: 'insert', ...overrides });
  const inserted = request();
  check('insert brackets the entire multiline prompt without Enter', (await delivery.deliver(inserted, authorize)).accepted
    && writes[0] === '\x1b[200~Prüfe\nden Code.\x1b[201~');
  check('same command replay does not write again', (await delivery.deliver(inserted, authorize)).replayed && writes.length === 1);
  await refuses('same command cannot change the draft text', () => delivery.deliver({ ...inserted, text: 'changed' }, authorize), /anderer|anderen/);
  await refuses('same command cannot turn insert into submit', () => delivery.deliver({ ...inserted, mode: 'submit' }, authorize), /anderer|anderen/);
  await delivery.deliver(request({ mode: 'submit', text: 'Zweite Aufgabe' }), authorize);
  check('submit requests exactly one Enter after the closing paste marker', writes[1] === '\x1b[200~Zweite Aufgabe\x1b[201~\r');
  permitted = false;
  await refuses('loss of input ownership refuses a new prompt', () => delivery.deliver(request(), authorize), /ownership lost/);
  await refuses('revocation also blocks receipt replay', () => delivery.deliver(inserted, authorize), /ownership lost/); permitted = true;
  available = { available: false, reason: 'CLI ended or unsupported' };
  await refuses('ended or unprotected CLI refuses without a write', () => delivery.deliver(request(), authorize), /ended/);
  check('all refused requests left the terminal unchanged', writes.length === 2);
  available = { available: true }; ambiguous = true;
  const uncertain = request();
  await refuses('write failure is not reported as accepted', () => delivery.deliver(uncertain, authorize), /uncertain/);
  ambiguous = false;
  await refuses('ambiguous write cannot be retried', () => delivery.deliver(uncertain, authorize), /unbekannt/);
  check('ambiguous prompt was attempted only once', writes.length === 3);
  for (const data of [request({ text: '\x1b[201~\runsafe' }), request({ sessionId: '../session' }), request({ commandId: 'bad' }), { ...request(), argv: [] }]) {
    check('invalid prompt contract is refused', !validTerminalPrompt(data));
  }
  let calls = 0;
  await refuses('ownership change at final validation prevents write', () => delivery.deliver(request(), () => { if (++calls === 2) throw new Error('changed owner'); }), /changed owner/);
  check('final positive delivery succeeds after negative controls', (await delivery.deliver(request(), authorize)).accepted && writes.length === 4);

  const pieces: string[] = []; let release!: () => void; let targetAlive = true;
  const writer = new ProtectedPromptWriter({ check: () => { if (!targetAlive) throw new Error('CLI ended'); }, write: (_id, bytes) => { pieces.push(bytes); } },
    () => new Promise(done => { release = done; }));
  const payload = '\x1b[200~Mehrzeilig\nPrüfen\x1b[201~\r';
  let pendingWrite = writer.write('sone', payload, authorize);
  await Promise.resolve();
  check('submit holds a per-terminal lock and writes only the bracketed paste initially', writer.busy('sone') && pieces.join('') === payload.slice(0, -1));
  await refuses('second prompt cannot interleave during settle', () => writer.write('sone', payload, authorize), /läuft/);
  await writer.write('stwo', 'independent', authorize);
  check('another terminal remains independently writable', pieces.at(-1) === 'independent');
  release(); await pendingWrite;
  check('settled submit writes one separate Enter and releases the lock', pieces.at(-1) === '\r' && !writer.busy('sone'));
  pieces.length = 0; pendingWrite = writer.write('sone', payload, authorize); await Promise.resolve(); permitted = false; release();
  await refuses('revocation after paste prevents delayed Enter', () => pendingWrite, /ownership lost/);
  check('partial paste remains unsubmitted after revocation', pieces.join('') === payload.slice(0, -1) && !writer.busy('sone')); permitted = true;
  pieces.length = 0; pendingWrite = writer.write('sone', payload, authorize); await Promise.resolve(); targetAlive = false; release();
  await refuses('CLI exit during settle prevents delayed Enter', () => pendingWrite, /CLI ended/);
  targetAlive = true; pieces.length = 0; await writer.write('sone', payload.slice(0, -1), authorize);
  check('final positive insertion has no delayed submit or held lock', pieces.length === 1 && !writer.busy('sone'));

  const root = mkdtempSync(join(tmpdir(), 'ade-protected-program-'));
  const marker = join(root, 'must-not-execute.txt');
  const platform = process.platform === 'win32' ? 'win32' : 'posix';
  const program = await prepareProtectedProgram(platform === 'win32'
    ? "[void][Console]::ReadLine(); [Console]::WriteLine('CLI_EXIT')" : "IFS= read -r ade_fixture; printf 'CLI_EXIT\\n'", platform, async value => value);
  try {
    if (platform === 'win32') check('protected Windows wrapper cannot return to an interactive PowerShell', !program.args!.includes('-NoExit') && program.args!.includes('-NoProfile'));
    else check('protected POSIX wrapper replaces its bootstrap shell', program.initialCommand!.startsWith('exec /bin/bash '));
    const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn(platform === 'win32' ? 'powershell.exe' : '/bin/bash', platform === 'win32' ? program.args! : ['-c', program.initialCommand!], { windowsHide: true, stdio: 'pipe' });
      let output = ''; child.stdout.on('data', value => { output = (output + String(value)).slice(-10_000); });
      child.stderr.resume(); child.stdin.on('error', () => undefined);
      const timer = setTimeout(() => { child.kill(); reject(new Error('protected wrapper remained alive after CLI ended')); }, 15_000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', code => { clearTimeout(timer); resolve({ code, output }); });
      const quoted = `'${marker.replace(/'/g, platform === 'win32' ? "''" : "'\\''")}'`;
      // Keep stdin open. A surviving interactive shell could execute the second line.
      child.stdin.write(`CLI_LINE\n${platform === 'win32' ? `Set-Content -LiteralPath ${quoted} -Value SHOULD_NOT_RUN` : `printf SHOULD_NOT_RUN > ${quoted}`}\n`);
    });
    check('real host wrapper exits while trailing stdin stays unexecuted', result.code === 0 && result.output.includes('CLI_EXIT') && !existsSync(marker));
  } finally {
    program.dispose(); if (existsSync(marker)) unlinkSync(marker); rmdirSync(root);
  }
  console.log(`Terminal prompt: ${passed} passed, 0 failed`);
})().catch(error => { console.error(error); console.log(`Terminal prompt: ${passed} passed, 1 failed`); process.exitCode = 1; });
