/** Host API: the Overview usage figures for a paired device, behind the workspace read grant. */
import { randomUUID } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRemoteWorkspaceFixture } from './helpers/remoteWorkspaceFixture';
import { RemoteApiError, type RemoteCommandContext } from '../src/main/application/AdeApplicationService';
import { BrowserRequestBudget } from '../src/main/remote/BrowserRequestBudget';
import { CHANNEL_POLICY } from '../src/main/ipcPolicy';

const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-remote-usage-')));
let passed = 0; let failed = 0;
const check = (name: string, ok: boolean) => { if (ok) { passed++; console.log(`  ok  ${name}`); } else { failed++; console.error(`FAIL  ${name}`); } };
async function refuses(name: string, action: () => unknown, code: string) { try { await action(); check(name, false); } catch (error) { check(name, error instanceof RemoteApiError && error.code === code); } }

void (async () => {
  const fixture = createRemoteWorkspaceFixture(root); const { devices, application: app, usage } = fixture;
  const secret = 'd'.repeat(40); devices.enroll('tablet', 'Tablet', secret);
  const context = (key: string = randomUUID()): RemoteCommandContext => ({ principal: { id: 'tablet', kind: 'device', proof: 'device-signature', scopes: new Set(devices.activeDevices().find(d => d.id === 'tablet')!.scopes) }, idempotencyKey: key, requestId: 'usage' });
  await refuses('usage needs a workspace read or terminal grant', () => app.usageOverview(context(), {}), 'scope_not_granted');
  devices.setAdminScopes('tablet', ['workspace:read'], { mode: 'all' });
  const result = await app.usageOverview(context(), {});
  check('a granted device receives the overview from the PC probe', usage.calls === 1 && result.providers.length === 2 && result.providers[0]!.account.windows[0]!.usedPercent === 92);
  check('an empty body and a missing body are both accepted', (await app.usageOverview(context(), undefined)).checkedAt === result.checkedAt);
  await refuses('a body with fields is refused', () => app.usageOverview(context(), { agentId: 'a1' }), 'invalid_payload');
  devices.setAdminScopes('tablet', ['terminal:control'], { mode: 'all' });
  check('a terminal-control grant is enough, mirroring the per-terminal usage read', (await app.usageOverview(context(), {})).providers.length === 2);
  const budget = new BrowserRequestBudget(() => 1_000);
  let allowed = 0; for (let i = 0; i < 20; i++) if (budget.permits('usageOverview', 'POST')) allowed++;
  check('the browser budget caps usage probes like diagnostics (12 per minute)', allowed === 12);
  check('the desktop channel is classified as a launch (it may start the Codex account probe)', CHANNEL_POLICY['usage:overview'].effect === 'launch' && CHANNEL_POLICY['usage:overview'].surface === 'desktop');
})().catch((error) => { failed++; console.error(error); }).finally(() => {
  if (dirname(root) !== realpathSync.native(tmpdir())) throw new Error('Unsafe cleanup'); rmSync(root, { recursive: true, force: true });
  console.log(`Remote usage: ${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
});
