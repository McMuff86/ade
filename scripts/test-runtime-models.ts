import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { CliModelProbe, parseRuntimeModels, RuntimeModelService } from '../src/main/settings/RuntimeModelService';
import { ExecutionBackendService } from '../src/main/execution/ExecutionBackendService';
import { resolveClaudeCommand, resolveLaunchCommand, resolveTaskLaunchCommand } from '../src/shared/runtimes';
import type { RuntimeModelOption } from '../src/shared/runtimeModels';
import { MODEL_FIXTURE_CATALOG, writeModelCliFixtures } from './fixtures/model-clis';

let passed = 0; let failed = 0;
function check(label: string, condition: boolean): void { if (condition) { passed++; console.log(`  ok  ${label}`); } else { failed++; console.error(`FAIL  ${label}`); } }
function rejects(operation: () => unknown): boolean { try { operation(); return false; } catch { return true; } }
const root = mkdtempSync(join(tmpdir(), 'ade-model-catalog-')); const oldPath = process.env['PATH'];
async function main(): Promise<void> {
try {
  const fixture = writeModelCliFixtures(root); process.env['PATH'] = `${fixture.bin}${delimiter}${oldPath ?? ''}`;
  const service = new RuntimeModelService({ envFor: () => ({}) });
  const codex = await service.list({ runtime: 'codex' });
  check('real Codex protocol handshake returns model choices and supported efforts', codex.status === 'ready' && codex.models.length === 2
    && codex.models[1]?.reasoningEfforts?.join() === 'low');
  const grok = await service.list({ runtime: 'grok' });
  check('Grok model command returns only listed choices and its default', grok.status === 'ready' && grok.models[0]?.id === 'grok-fixture-one' && grok.models[0].isDefault);
  const claude = await service.list({ runtime: 'claude' });
  check('Claude auth and initialization return resolved aliases without prompting', claude.status === 'ready'
    && claude.models[0]?.resolvedModel === 'claude-fixture-opus[1m]' && claude.models[1]?.id === 'sonnet');
  check('Ollama uses installed model list', (await service.list({ runtime: 'ollama' })).models[0]?.id === 'local-fixture:latest');
  const events = readFileSync(fixture.events, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { method?: string });
  check('discovery sends only initialization, account and model requests', events.every((event) => !event.method || ['initialize', 'initialized', 'account/read', 'model/list', 'control_request'].includes(event.method)));
  writeFileSync(fixture.state, JSON.stringify({ ...MODEL_FIXTURE_CATALOG, grok: ['grok-refreshed'] }));
  check('a subsequent query reloads the real CLI catalog', (await service.list({ runtime: 'grok' })).models[0]?.id === 'grok-refreshed');
  writeFileSync(fixture.state, JSON.stringify({ ...MODEL_FIXTURE_CATALOG, paginate: true }));
  check('Codex follows bounded model-list pagination', (await service.list({ runtime: 'codex' })).models.length === 2);
  writeFileSync(fixture.state, JSON.stringify({ ...MODEL_FIXTURE_CATALOG, paginate: true, repeatCursor: true }));
  check('repeating cursors fail closed', (await service.list({ runtime: 'codex' })).status === 'unavailable');
  writeFileSync(fixture.state, JSON.stringify({ ...MODEL_FIXTURE_CATALOG, signedOut: true }));
  check('signed-out Codex does not present a model catalog as available', (await service.list({ runtime: 'codex' })).models.length === 0);
  check('signed-out Claude explains the missing login', (await service.list({ runtime: 'claude' })).message.includes('Anmeldung fehlt'));
  writeFileSync(fixture.state, JSON.stringify({ ...MODEL_FIXTURE_CATALOG, failure: true }));
  const denied = await service.list({ runtime: 'grok' });
  check('provider errors never expose stderr, paths or secrets', denied.status === 'unavailable' && !JSON.stringify(denied).includes('sk-fake') && !JSON.stringify(denied).includes('credentials'));
  writeFileSync(fixture.state, JSON.stringify({ ...MODEL_FIXTURE_CATALOG, oversized: true }));
  check('oversized protocol output fails closed', (await service.list({ runtime: 'codex' })).status === 'unavailable');
  writeFileSync(fixture.state, JSON.stringify({ ...MODEL_FIXTURE_CATALOG, hang: true }));
  const short = new RuntimeModelService({ envFor: () => ({}) }, new CliModelProbe(new ExecutionBackendService(), undefined, process.platform, 500));
  check('stalled discovery has a bounded timeout', (await short.list({ runtime: 'codex' })).message.includes('lange gedauert'));
  writeFileSync(fixture.state, JSON.stringify(MODEL_FIXTURE_CATALOG));
  check('final positive control works after refused probes', (await service.list({ runtime: 'codex' })).status === 'ready');

  check('invalid model ids cannot become launch choices', rejects(() => parseRuntimeModels('codex', [{ id: 'bad;whoami' }])));
  check('secret-like model strings are rejected', rejects(() => parseRuntimeModels('codex', [{ id: 'sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ01234567890123456789' }])));
  check('hidden entries are omitted and duplicate ids collapse', parseRuntimeModels('codex', [{ id: 'visible' }, { id: 'hidden', hidden: true }, { id: 'visible' }]).length === 1);
  check('empty and malformed catalogs remain distinct', parseRuntimeModels('codex', []).length === 0 && rejects(() => parseRuntimeModels('codex', {})));
  check('Grok login messages alone are not a model list', rejects(() => parseRuntimeModels('grok', 'You are logged in')));
  check('provider display text is redacted', !JSON.stringify(parseRuntimeModels('codex', [{ id: 'safe', displayName: 'C:\\private\\secret.txt' }])).includes('C:\\'));
  check('catalog row count is bounded', rejects(() => parseRuntimeModels('codex', Array.from({ length: 201 }, (_, i) => ({ id: `m-${i}` })))));
  let calls = 0; let release!: (value: RuntimeModelOption[]) => void; let backendSeen = ''; let secretSeen = '';
  const delayed = new RuntimeModelService({ envFor: () => ({ XAI_API_KEY: 'fixture-secret' }) }, { run: async (_runtime, backend, env) => {
    calls++; backendSeen = backend; secretSeen = env['XAI_API_KEY']!; return new Promise((resolveModels) => { release = resolveModels; });
  } });
  const first = delayed.list({ runtime: 'grok', backend: 'wsl:Ubuntu' }); const second = delayed.list({ runtime: 'grok', backend: 'wsl:Ubuntu' });
  release([{ id: 'grok-fixture', name: 'Fixture', isDefault: true }]); const both = await Promise.all([first, second]);
  check('concurrent requests share one probe in the selected environment', calls === 1 && backendSeen === 'wsl:Ubuntu' && both[0].models.length === 1);
  check('stored credentials reach only the probe environment', secretSeen === 'fixture-secret' && !JSON.stringify(both).includes('fixture-secret'));
  const agent = { runtime: 'claude' as const, permissionMode: 'default' as const, claudeModel: 'opus[1m]' };
  check('Claude context aliases are quoted in interactive launch', resolveLaunchCommand(agent) === "claude --model 'opus[1m]'");
  check('Claude model survives task and managed-adapter command construction', resolveTaskLaunchCommand(agent, 'win32')!.command.includes("--model 'opus[1m]'")
    && resolveClaudeCommand('bypass', agent).includes("--model 'opus[1m]'"));
  check('custom commands keep their explicit precedence', resolveLaunchCommand({ ...agent, customCommand: 'my-wrapper' }) === 'my-wrapper');
  check('Claude model cannot inject shell expressions', rejects(() => resolveLaunchCommand({ ...agent, claudeModel: 'opus$(whoami)' })));
} catch (error) { failed++; console.error(error); }
finally {
  process.env['PATH'] = oldPath;
  if (!resolve(root).startsWith(resolve(tmpdir()) + '\\') && !resolve(root).startsWith(resolve(tmpdir()) + '/')) throw new Error('Unexpected fixture path');
  rmSync(root, { recursive: true, force: true });
}
console.log(`Runtime models: ${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
}
void main();
