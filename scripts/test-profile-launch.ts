/** Real local shell-to-native argv fixture; never starts a model or accesses a provider. */
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Agent } from '../src/shared/types';
import type { AgentInstructionsSnapshot } from '../src/main/memory/agentInstructions';
import { prepareProfileLaunch, type ProfileLaunchInput } from '../src/main/pty/profileLaunch';

let passed = 0;
function check(name: string, fn: () => void): void { fn(); passed++; console.log(`ok ${name}`); }
const root = mkdtempSync(join(tmpdir(), 'ade-profile-launch-test-'));
const repo = join(root, 'repo'); mkdirSync(repo);
const scratch = join(root, "scratch space ' quote $dollar `tick");
const marker = join(root, 'MUST_NOT_EXIST');
const fixture = join(root, 'argv.cjs');
const output = join(root, 'arguments.json');
writeFileSync(fixture, "require('node:fs').writeFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)), 'utf8');");
const ps = (text: string) => `'${text.replace(/'/g, "''")}'`;
const fixtureCommand = `& ${ps(process.execPath)} ${ps(fixture)} ${ps(output)}`;
const shim = join(root, 'npm-shim.ps1');
writeFileSync(shim, `${fixtureCommand} $args\nexit $LASTEXITCODE\n`, 'utf8');
const content = [
  'PRIVATE PROFILE CONTENT: geometry / tolerance',
  'Double "quotes", single \'quotes\', slash \\, newline next:',
  '\r\nCRLF and tabs\there; ä ö 漢字 😀',
  `$([IO.File]::WriteAllText('${marker.replace(/'/g, "''")}', 'EXECUTED'))`,
  '`tick ${env:PATH} ; | & < > # comment',
  'Escapes: \\n literal; triple quotes """ and \'\'\'; trailing backslash \\',
].join('\n');
const snapshotFor = (text: string): AgentInstructionsSnapshot => ({ file: 'AGENTS.md', content: text, chars: text.length,
  sha256: createHash('sha256').update(text, 'utf8').digest('hex'), profileRevision: null, sources: [] });
const agent: Agent = { id: 'test', categoryId: 'test', name: 'Profile agent', runtime: 'codex', permissionMode: 'default',
  workspaceDir: repo, memoryDir: join(root, 'identity') };
const base: ProfileLaunchInput = { agent, snapshot: snapshotFor(content), command: fixtureCommand,
  scratchRoot: scratch, executionBackend: 'native', platform: 'win32', codexDeveloperInstructions: { mode: 'append-verified', existing: 'Existing developer guidance.' } };

check('unknown Codex baseline fails before any scratch write', () => {
  assert.throws(() => prepareProfileLaunch({ ...base, codexDeveloperInstructions: undefined }), /noch nicht geprüft/);
  assert.equal(existsSync(scratch), false);
});
check('WSL, unsupported native platforms, custom commands and unsupported runtimes fail explicitly', () => {
  assert.throws(() => prepareProfileLaunch({ ...base, executionBackend: 'wsl:Ubuntu' }), /nativ unter Windows/);
  assert.throws(() => prepareProfileLaunch({ ...base, platform: 'linux' }), /nativ unter Windows/);
  assert.throws(() => prepareProfileLaunch({ ...base, agent: { ...agent, customCommand: 'codex --resume' } }), /eigenen Startbefehl/);
  assert.throws(() => prepareProfileLaunch({ ...base, agent: { ...agent, runtime: 'grok' } }), /unterstützten/);
});
check('snapshot integrity, Unicode, duplicate instruction options and Windows argument limit are enforced', () => {
  assert.throws(() => prepareProfileLaunch({ ...base, snapshot: { ...base.snapshot, content: 'changed' } }), /Snapshot ist ungültig/);
  assert.throws(() => prepareProfileLaunch({ ...base, snapshot: snapshotFor('\ud800') }), /Unicode/);
  assert.throws(() => prepareProfileLaunch({ ...base, command: `${fixtureCommand} -c developer_instructions=other` }), /unveränderten/);
  assert.throws(() => prepareProfileLaunch({ ...base, snapshot: snapshotFor('"'.repeat(10_000)) }), /Windows-Aufrufgrenze/);
});
check('scratch cannot be inside identity or actual project workspace', () => {
  assert.throws(() => prepareProfileLaunch({ ...base, scratchRoot: join(repo, 'scratch') }), /ausserhalb/);
  assert.throws(() => prepareProfileLaunch({ ...base, workspaceDir: scratch }), /ausserhalb/);
});

if (process.platform === 'win32') {
  const shells = [join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), 'pwsh.exe'];
  for (const shell of shells) {
    check(`${shell.includes('WindowsPowerShell') ? 'Windows PowerShell 5.1' : 'PowerShell 7'} delivers exact Codex TOML argument`, () => {
      const prepared = prepareProfileLaunch(base);
      try {
        assert.equal(readFileSync(prepared.snapshotPath, 'utf8'), content);
        assert.equal(prepared.command.includes('PRIVATE PROFILE CONTENT'), false);
        const script = join(root, 'launch.ps1'); writeFileSync(script, prepared.command, 'utf8');
        execFileSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { cwd: repo, stdio: 'pipe', timeout: 15_000 });
        const args = JSON.parse(readFileSync(output, 'utf8')) as string[];
        assert.equal(args.length, 2);
        assert.equal(args[0], '-c');
        assert.ok(args[1]!.startsWith('developer_instructions='));
        assert.equal(JSON.parse(args[1]!.slice('developer_instructions='.length)), `Existing developer guidance.\n\n${content}`);
        assert.equal(existsSync(marker), false);
        assert.deepEqual(readdirSync(repo), []);
      } finally { prepared.dispose(); prepared.dispose(); }
      assert.equal(existsSync(prepared.snapshotPath), false);
    });
    check(`${shell.includes('WindowsPowerShell') ? 'Windows PowerShell 5.1' : 'PowerShell 7'} preserves Codex argument through an npm-style shim`, () => {
      const prepared = prepareProfileLaunch({ ...base, command: `& ${ps(shim)}` });
      try {
        const script = join(root, 'launch.ps1'); writeFileSync(script, prepared.command, 'utf8');
        execFileSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { cwd: repo, stdio: 'pipe', timeout: 15_000 });
        const args = JSON.parse(readFileSync(output, 'utf8')) as string[];
        assert.equal(args.length, 2);
        assert.equal(args[0], '-c');
        assert.equal(JSON.parse(args[1]!.slice('developer_instructions='.length)), `Existing developer guidance.\n\n${content}`);
        assert.equal(existsSync(marker), false);
      } finally { prepared.dispose(); }
    });
    check(`${shell.includes('WindowsPowerShell') ? 'Windows PowerShell 5.1' : 'PowerShell 7'} delivers Claude append-file path without exposing contents`, () => {
      const prepared = prepareProfileLaunch({ ...base, agent: { ...agent, runtime: 'claude' } });
      try {
        assert.equal(prepared.command.includes('PRIVATE PROFILE CONTENT'), false);
        const script = join(root, 'launch.ps1'); writeFileSync(script, prepared.command, 'utf8');
        execFileSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { cwd: repo, stdio: 'pipe', timeout: 15_000 });
        const args = JSON.parse(readFileSync(output, 'utf8')) as string[];
        assert.deepEqual(args, ['--append-system-prompt-file', prepared.snapshotPath]);
        assert.equal(readFileSync(args[1]!, 'utf8'), content);
        assert.equal(existsSync(marker), false);
      } finally { prepared.dispose(); }
    });
  }
} else console.log('SKIP Windows native shell transport: requires a Windows host.');

check('snapshots use unique immutable copies and disposal leaves unrelated files', () => {
  const first = prepareProfileLaunch(base); const second = prepareProfileLaunch(base);
  try {
    assert.notEqual(first.snapshotPath, second.snapshotPath);
    const unrelated = join(scratch, 'unrelated.txt'); writeFileSync(unrelated, 'keep');
    first.dispose(); assert.equal(readFileSync(second.snapshotPath, 'utf8'), content);
    assert.equal(readFileSync(unrelated, 'utf8'), 'keep');
  } finally { first.dispose(); second.dispose(); }
});
check('linked scratch storage is rejected before writes', () => {
  const target = join(root, 'link-target'); mkdirSync(target);
  const link = join(root, 'link'); symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => prepareProfileLaunch({ ...base, scratchRoot: link }), /Verknüpfung/);
  assert.deepEqual(readdirSync(target), []);
});
console.log(`RESULT: ${passed} passed, 0 failed; no provider/model calls.`);
