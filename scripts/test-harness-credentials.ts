/** Focused checks for encrypted, write-only harness API-key storage. */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import {
  HarnessCredentialService,
  isSafeStorageSecure,
  type HarnessKeyEncryptor,
} from '../src/main/settings/HarnessCredentialService';
import { HARNESS_API_KEY_ENV } from '../src/shared/runtimes';
import type { RuntimeId } from '../src/shared/types';
import { assertIpcPayload } from '../src/main/ipcValidation';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${name}`, detail ?? '');
  }
}

/** Reversible fake: marks ciphertext so plaintext leaks are detectable. */
function fakeEncryptor(state: { available: boolean }): HarnessKeyEncryptor {
  return {
    available: () => state.available,
    encrypt: (plain) => Buffer.from(`enc:${Buffer.from(plain, 'utf8').toString('base64')}`, 'utf8'),
    decrypt: (encrypted) => {
      const text = encrypted.toString('utf8');
      if (!text.startsWith('enc:')) throw new Error('fake: not encrypted');
      return Buffer.from(text.slice(4), 'base64').toString('utf8');
    },
  };
}

function run(): void {
  check('Linux rejects plaintext and unknown Electron storage backends',
    !isSafeStorageSecure(true, 'linux', 'basic_text')
      && !isSafeStorageSecure(true, 'linux', 'unknown'));
  check('Linux accepts an OS-backed Electron secret store',
    isSafeStorageSecure(true, 'linux', 'gnome_libsecret'));
  check('non-Linux platforms rely on their native encryption availability',
    isSafeStorageSecure(true, 'win32', 'unknown')
      && !isSafeStorageSecure(false, 'darwin', 'unknown'));

  const scratch = mkdtempSync(join(tmpdir(), 'ade-harness-credentials-'));
  try {
    const state = { available: true };
    const service = new HarnessCredentialService(scratch, fakeEncryptor(state));
    const key = 'xai-focused-test-key-2026';

    service.set('grok', key);
    const afterSet = service.status();
    const filePath = join(scratch, 'ade', 'harness-credentials.json');
    const rawFile = readFileSync(filePath, 'utf8');
    check('a stored key reports boolean status with a timestamp',
      afterSet.find((item) => item.runtime === 'grok')?.hasStoredKey === true
        && Number.isSafeInteger(afterSet.find((item) => item.runtime === 'grok')?.savedAt)
        && afterSet.find((item) => item.runtime === 'claude')?.hasStoredKey === false);
    check('the credential file never contains plaintext key material',
      !rawFile.includes(key) && rawFile.includes('"grok"'));
    check('status objects never carry key material',
      !JSON.stringify(afterSet).includes(key));

    check('envFor exposes the key only as the matching harness variable',
      JSON.stringify(service.envFor('grok')) === JSON.stringify({ XAI_API_KEY: key })
        && Object.keys(service.envFor('claude')).length === 0
        && Object.keys(service.envFor('shell')).length === 0
        && Object.keys(service.envFor('custom')).length === 0);

    service.clear('grok');
    service.clear('grok');
    check('clearing a key is durable and repeat-safe',
      service.status().every((item) => !item.hasStoredKey)
        && Object.keys(service.envFor('grok')).length === 0);

    const invalidKeys = ['', ' ', 'with space', 'tab\tkey', 'nul\0key', 'x'.repeat(513)];
    const allInvalidRejected = invalidKeys.every((candidate) => {
      try {
        service.set('grok', candidate);
        return false;
      } catch (error) {
        return !(error instanceof Error && candidate.trim() && error.message.includes(candidate));
      }
    });
    let unsupportedRejected = false;
    try {
      service.set('shell', key);
    } catch {
      unsupportedRejected = true;
    }
    check('malformed keys and keyless harnesses are rejected without echoing the key',
      allInvalidRejected && unsupportedRejected);

    state.available = false;
    let unavailableRejected = false;
    try {
      service.set('grok', key);
    } catch (error) {
      unavailableRejected = error instanceof Error && error.message.includes('unavailable');
    }
    check('missing OS encryption fails closed instead of storing plaintext',
      unavailableRejected && service.status().every((item) => !item.hasStoredKey));
    state.available = true;

    writeFileSync(filePath, '{ not json', 'utf8');
    const corrupted = new HarnessCredentialService(scratch, fakeEncryptor(state));
    check('a corrupted credential file degrades to empty status, not a crash',
      corrupted.status().every((item) => !item.hasStoredKey));
    corrupted.set('gemini', 'gemini-key-after-corruption');
    check('storage recovers after corruption',
      corrupted.status().find((item) => item.runtime === 'gemini')?.hasStoredKey === true);

    writeFileSync(filePath, JSON.stringify({
      version: 1,
      credentials: { grok: { encrypted: Buffer.from('garbage').toString('base64'), savedAt: 1 } },
    }), 'utf8');
    const undecryptable = new HarnessCredentialService(scratch, fakeEncryptor(state));
    check('an undecryptable record fails closed to an empty launch environment',
      undecryptable.status().find((item) => item.runtime === 'grok')?.hasStoredKey === true
        && Object.keys(undecryptable.envFor('grok')).length === 0);

    check('every keyed harness maps to one uppercase environment variable',
      Object.values(HARNESS_API_KEY_ENV).every((name) => /^[A-Z][A-Z0-9_]+$/.test(name ?? '')));

    const serviceValue = 'elevenlabs-focused-value-2026';
    service.set('grok', key);
    service.setServiceKey('ELEVENLABS_API_KEY', serviceValue, 'all');
    service.setServiceKey('CLAUDE_ONLY_TOKEN', 'claude-scoped-value', ['claude']);
    const serviceStatus = service.serviceKeyStatus();
    const serviceRaw = readFileSync(filePath, 'utf8');
    check('service keys report value-free status with their scope',
      serviceStatus.length === 2
        && serviceStatus[0]?.name === 'CLAUDE_ONLY_TOKEN'
        && JSON.stringify(serviceStatus[0]?.scope) === JSON.stringify(['claude'])
        && serviceStatus[1]?.name === 'ELEVENLABS_API_KEY'
        && serviceStatus[1]?.scope === 'all'
        && !JSON.stringify(serviceStatus).includes(serviceValue));
    check('service key values never persist as plaintext',
      !serviceRaw.includes(serviceValue) && !serviceRaw.includes('claude-scoped-value'));
    const shellEnv = service.envFor('shell');
    const claudeEnv = service.envFor('claude');
    const grokEnv = service.envFor('grok');
    check('session env merges scoped service keys with the harness API key',
      shellEnv['ELEVENLABS_API_KEY'] === serviceValue
        && shellEnv['CLAUDE_ONLY_TOKEN'] === undefined
        && claudeEnv['ELEVENLABS_API_KEY'] === serviceValue
        && claudeEnv['CLAUDE_ONLY_TOKEN'] === 'claude-scoped-value'
        && grokEnv['ELEVENLABS_API_KEY'] === serviceValue
        && grokEnv['XAI_API_KEY'] === key);
    state.available = false;
    check('stored secrets are not decrypted when secure storage becomes unavailable',
      Object.keys(service.envFor('grok')).length === 0
        && Object.keys(service.envFor('claude')).length === 0);
    state.available = true;
    service.clearServiceKey('CLAUDE_ONLY_TOKEN');
    service.clearServiceKey('CLAUDE_ONLY_TOKEN');
    check('clearing a service key is durable and repeat-safe',
      service.serviceKeyStatus().length === 1
        && service.envFor('claude')['CLAUDE_ONLY_TOKEN'] === undefined);

    const invalidServiceKeys: Array<[string, string, 'all' | RuntimeId[]]> = [
      ['PATH', 'value', 'all'],
      ['ADE_TASK_PROMPT', 'value', 'all'],
      ['ANTHROPIC_API_KEY', 'value', 'all'],
      ['NODE_OPTIONS', 'value', 'all'],
      ['lowercase_name', 'value', 'all'],
      ['AB', 'value', 'all'],
      ['GOOD_NAME', 'has space', 'all'],
      ['GOOD_NAME', 'value', []],
    ];
    const allServiceRejected = invalidServiceKeys.every(([name, value, scope]) => {
      try {
        service.setServiceKey(name, value, scope);
        return false;
      } catch {
        return true;
      }
    });
    check('reserved, malformed and unscoped service keys are rejected', allServiceRejected);
    service.clear('grok');
    service.clearServiceKey('ELEVENLABS_API_KEY');

    let validAccepted = true;
    try {
      assertIpcPayload('harness:status', undefined);
      assertIpcPayload('harness:diagnose', undefined);
      assertIpcPayload('harness:setKey', { runtime: 'grok', apiKey: key });
      assertIpcPayload('harness:clearKey', { runtime: 'claude' });
      assertIpcPayload('harness:setServiceKey', {
        name: 'ELEVENLABS_API_KEY', value: 'v', scope: 'all',
      });
      assertIpcPayload('harness:setServiceKey', {
        name: 'ELEVENLABS_API_KEY', value: 'v', scope: ['claude', 'shell'],
      });
      assertIpcPayload('harness:clearServiceKey', { name: 'ELEVENLABS_API_KEY' });
      assertIpcPayload('harness:login', { agentId: 'agent', runtime: 'claude' });
      assertIpcPayload('harness:login', { agentId: 'agent', runtime: 'grok' });
    } catch {
      validAccepted = false;
    }
    type HarnessChannel = 'harness:setKey' | 'harness:clearKey'
      | 'harness:setServiceKey' | 'harness:clearServiceKey' | 'harness:login';
    const invalidPayloads: Array<[HarnessChannel, unknown]> = [
      ['harness:setKey', { runtime: 'shell', apiKey: key }],
      ['harness:setKey', { runtime: 'openclaw', apiKey: key }],
      ['harness:setKey', { runtime: 'grok', apiKey: 'with space' }],
      ['harness:setKey', { runtime: 'grok', apiKey: '' }],
      ['harness:setKey', { runtime: 'grok', apiKey: key, extra: true }],
      ['harness:setKey', { runtime: 'grok' }],
      ['harness:clearKey', { runtime: 'ollama' }],
      ['harness:clearKey', { runtime: 'grok', apiKey: key }],
      ['harness:setServiceKey', { name: 'lower_case', value: 'v', scope: 'all' }],
      ['harness:setServiceKey', { name: 'GOOD_NAME', value: 'v', scope: [] }],
      ['harness:setServiceKey', { name: 'GOOD_NAME', value: 'v', scope: ['openclaw'] }],
      ['harness:setServiceKey', { name: 'GOOD_NAME', value: 'with space', scope: 'all' }],
      ['harness:setServiceKey', { name: 'GOOD_NAME', value: 'v' }],
      ['harness:clearServiceKey', { name: 'GOOD_NAME', value: 'v' }],
      ['harness:login', { agentId: 'agent', runtime: 'ollama' }],
      ['harness:login', { agentId: 'agent', runtime: 'shell' }],
      ['harness:login', { agentId: 'agent' }],
    ];
    const allPayloadsRejected = invalidPayloads.every(([channel, payload]) => {
      try {
        assertIpcPayload(channel, payload);
        return false;
      } catch {
        return true;
      }
    });
    check('harness IPC accepts only keyed runtimes and printable write-only keys',
      validAccepted && allPayloadsRejected);
  } finally {
    const safeRoot = resolve(tmpdir());
    const safeScratch = resolve(scratch);
    if (dirname(safeScratch) === safeRoot
        && basename(safeScratch).startsWith('ade-harness-credentials-')
        && safeScratch.startsWith(`${safeRoot}${sep}`)) {
      rmSync(safeScratch, { recursive: true, force: true });
    }
  }
  console.log(`\n${failed ? 'FAILED' : 'PASSED'} - ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

run();
