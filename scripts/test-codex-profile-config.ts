/** Local fake JSON-RPC protocol only by default. --real optionally reads installed CLI config without starting a thread. */
import { strict as assert } from 'node:assert';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nativeLaunchEnv } from '../src/main/pty/nativeLaunchEnv';
import { CODEX_PROFILE_CONFIG_STDERR_BYTES, CODEX_PROFILE_CONFIG_STDOUT_BYTES,
  projectCodexProfileConfig, readCodexProfileConfig, type CodexProfileConfigResult } from '../src/main/pty/CodexProfileConfig';

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> { await fn(); passed++; console.log(`ok ${name}`); }
const root = mkdtempSync(join(tmpdir(), 'ade-codex-config-test-'));
const cwd = root;
const env: NodeJS.ProcessEnv = { ...process.env, ADE_PROFILE_FIXTURE_SENTINEL: 'expected' };
const instructions = 'Existing "developer" text\nwith $dollar, `tick and Unicode ä 漢字.';

function fixture(body: string): { launch(): ChildProcessWithoutNullStreams; child(): ChildProcessWithoutNullStreams | undefined } {
  const file = join(root, `fixture-${++fixtureSequence}.cjs`);
  writeFileSync(file, body);
  let process: ChildProcessWithoutNullStreams | undefined;
  return { launch: () => process = spawn(globalThis.process.execPath, [file], { cwd, env, windowsHide: true, stdio: 'pipe' }), child: () => process };
}
let fixtureSequence = 0;
function protocol(result: unknown, beforeReply = ''): string {
  return `const fs=require('node:fs');const r=require('node:readline').createInterface({input:process.stdin});let phase=0;const log=[];
r.on('line',line=>{const m=JSON.parse(line);log.push(m);fs.writeFileSync(${JSON.stringify(join(root, 'requests.json'))},JSON.stringify(log));
if(m.method==='initialize'&&phase===0){phase=1;console.log(JSON.stringify({id:m.id,result:{userAgent:'fixture'}}));}
else if(m.method==='initialized'&&phase===1)phase=2;
else if(m.method==='config/read'&&phase===2&&m.params.cwd===process.cwd()&&m.params.includeLayers===false&&process.env.ADE_PROFILE_FIXTURE_SENTINEL==='expected'){
phase=3;${beforeReply};console.log(JSON.stringify({id:m.id,result:${JSON.stringify(result)}}));}
else process.exit(8);});`;
}
async function probe(body: string, timeoutMs = 2000): Promise<CodexProfileConfigResult> {
  const test = fixture(body); return readCodexProfileConfig({ cwd, env, launch: test.launch, timeoutMs });
}

void (async () => {
  await check('projection exposes only exact developer text, never unrelated config or origins', () => {
    assert.deepEqual(projectCodexProfileConfig({ config: { developer_instructions: instructions, api_key: 'PRIVATE_SECRET' }, origins: { credential: 'PRIVATE_PATH' }, layers: ['PRIVATE_LAYER'] }),
      { status: 'verified', developerInstructions: instructions });
  });
  await check('explicit null and schema-confirmed absence remain distinct from unknown response', () => {
    for (const config of [{ developer_instructions: null }, {}]) assert.deepEqual(projectCodexProfileConfig({ config, origins: {} }), { status: 'verified', developerInstructions: null });
    for (const invalid of [null, [], {}, { config: {} }, { config: [], origins: {} }, { config: {}, origins: { developer_instructions: {} } },
      { config: { developer_instructions: false }, origins: {} }, { config: { developer_instructions: 'x'.repeat(32_001) }, origins: {} },
      { config: { developer_instructions: '\0' }, origins: {} }]) assert.equal(projectCodexProfileConfig(invalid).status, 'unavailable');
    assert.deepEqual(projectCodexProfileConfig({ config: { developer_instructions: '' }, origins: {} }), { status: 'verified', developerInstructions: '' });
  });
  await check('stdio handshake reads config with exact launch cwd and env, without any other request', async () => {
    assert.deepEqual(await probe(protocol({ config: { developer_instructions: instructions }, origins: {} })), { status: 'verified', developerInstructions: instructions });
    const requests = JSON.parse(readFileSync(join(root, 'requests.json'), 'utf8')) as Array<{ method: string }>;
    assert.deepEqual(requests.map((item) => item.method), ['initialize', 'initialized', 'config/read']);
  });
  await check('explicit null and absence are preserved through real stdio framing', async () => {
    assert.deepEqual(await probe(protocol({ config: { developer_instructions: null }, origins: {} })), { status: 'verified', developerInstructions: null });
    assert.deepEqual(await probe(protocol({ config: {}, origins: {} })), { status: 'verified', developerInstructions: null });
  });
  await check('provider errors and malformed output fail closed without leaking details', async () => {
    for (const body of ["console.log('PRIVATE_SECRET malformed');", "console.log(JSON.stringify({id:1,error:{message:'PRIVATE_SECRET C:/private/path'}}));", protocol({ config: {} }),
      protocol({ config: {}, origins: {} }, "console.log(JSON.stringify({id:2,error:{message:'PRIVATE_SECRET C:/private/path'}}))")]) {
      const result = await probe(body); assert.equal(result.status, 'unavailable');
      assert.equal(JSON.stringify(result).includes('PRIVATE_SECRET'), false);
      assert.equal(JSON.stringify(result).includes('C:/private/path'), false);
    }
  });
  await check('fragmented UTF-8 and newline-delimited replies preserve exact instruction text', async () => {
    const response = JSON.stringify({ id: 2, result: { config: { developer_instructions: instructions }, origins: {} } });
    const body = `const r=require('node:readline').createInterface({input:process.stdin});r.on('line',line=>{const m=JSON.parse(line);
      if(m.method==='initialize')console.log(JSON.stringify({id:1,result:{}}));
      if(m.method==='config/read'){const b=Buffer.from(${JSON.stringify(response + '\n')});for(let i=0;i<b.length;i++)setTimeout(()=>process.stdout.write(b.subarray(i,i+1)),i);}});`;
    assert.deepEqual(await probe(body), { status: 'verified', developerInstructions: instructions });
  });
  await check('stdout and stderr floods are bounded even without newline framing', async () => {
    assert.equal((await probe(`process.stdout.write('x'.repeat(${CODEX_PROFILE_CONFIG_STDOUT_BYTES + 1}));setInterval(()=>{},1000);`)).status, 'unavailable');
    assert.equal((await probe(`process.stderr.write('x'.repeat(${CODEX_PROFILE_CONFIG_STDERR_BYTES + 1}));setInterval(()=>{},1000);`)).status, 'unavailable');
  });
  await check('unexpected server requests and wrong response IDs cannot authorize an empty baseline', async () => {
    assert.equal((await probe("console.log(JSON.stringify({id:'request',method:'exec',params:{}}));")).status, 'unavailable');
    assert.equal((await probe("console.log(JSON.stringify({id:2,result:{config:{},origins:{}}}));")).status, 'unavailable');
  });
  await check('deadline closes and kills an owned process ignoring stdin EOF', async () => {
    const test = fixture('process.stdin.resume();setInterval(()=>{},1000);');
    const result = await readCodexProfileConfig({ cwd, env, launch: test.launch, timeoutMs: 100 });
    assert.equal(result.status, 'unavailable');
    const child = test.child()!;
    await new Promise<void>((resolve, reject) => {
      if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
      const timer = setTimeout(() => reject(new Error('Owned fixture process was not terminated.')), 6000);
      child.once('close', () => { clearTimeout(timer); resolve(); });
    });
  });
  await check('invalid cwd and timeout fail before child launch', async () => {
    let launches = 0;
    const launch = () => { launches++; throw new Error('must not launch'); };
    assert.equal((await readCodexProfileConfig({ cwd: 'relative', env, launch })).status, 'unavailable');
    assert.equal((await readCodexProfileConfig({ cwd, env, launch, timeoutMs: 60_000 })).status, 'unavailable');
    assert.equal(launches, 0);
  });
  await check('native Linux environment removes Bash startup hooks without changing PATH or caller', () => {
    const original = { PATH: '/fixture', HOME: '/home/fixture', BASH_ENV: '/bad', ENV: '/bad', SHELLOPTS: 'xtrace', BASHOPTS: 'extdebug', BASH_XTRACEFD: '1', 'BASH_FUNC_codex%%': 'bad' };
    assert.deepEqual(nativeLaunchEnv(original, 'linux'), { PATH: '/fixture', HOME: '/home/fixture' });
    assert.deepEqual(nativeLaunchEnv(original, 'win32'), original);
    assert.equal(original.BASH_ENV, '/bad');
  });
  if (process.platform === 'linux') await check('native probe kills a remaining group after its launcher exits', async () => {
    const childPid = join(root, 'descendant.pid');
    const script = join(root, 'orphan.cjs');
    writeFileSync(script, `const cp=require('node:child_process');const fs=require('node:fs');
      const child=cp.spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});
      fs.writeFileSync(${JSON.stringify(childPid)},String(child.pid));process.exit(0);`);
    const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
    writeFileSync(join(root, 'codex'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)}\n`, { mode: 0o700 });
    assert.equal((await readCodexProfileConfig({ cwd, env: { ...env, PATH: `${root}:${env.PATH}` }, timeoutMs: 1000 })).status, 'unavailable');
    assert.ok(existsSync(childPid));
    const pid = Number(readFileSync(childPid, 'utf8'));
    const alive = () => { try { return !readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]!.startsWith('Z'); } catch { return false; } };
    const deadline = Date.now() + 4000;
    while (alive() && Date.now() < deadline) await new Promise(done => setTimeout(done, 25));
    assert.equal(alive(), false);
  });
  if (process.argv.includes('--real')) {
    const result = await readCodexProfileConfig({ cwd: process.cwd(), env: { ...process.env } });
    console.log(`Real installed CLI: status=${result.status}${result.status === 'verified' ? `, instructions=${result.developerInstructions === null ? 'absent' : 'present'}, chars=${result.developerInstructions?.length ?? 0}` : ''}`);
    assert.equal(result.status, 'verified', 'Installed CLI did not provide a verified config projection.');
  }
  console.log(`RESULT: ${passed} passed, 0 failed; no model requests.`);
})().catch(() => { console.error('FAIL Codex profile configuration test (details withheld to protect configuration).'); process.exitCode = 1; });
