import { assertCoordinatorCodexConfig, assertCoordinatorCodexThread, assertCoordinatorCodexVersion, COORDINATOR_CODEX_OVERRIDES, COORDINATOR_DISABLED_FEATURES } from '../src/main/pty/CoordinatorCodexPolicy';

let passed = 0; let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) throw new Error(label); passed++; console.log(`  ok  ${label}`); };
const rejects = (fn: () => void) => { try { fn(); return false; } catch { return true; } };
const config = () => ({ config: { features: { ...Object.fromEntries(COORDINATOR_DISABLED_FEATURES.map(name => [name, false])), code_mode_host: true } as Record<string, boolean>, mcp_servers: {}, agents: { enabled: false },
  web_search: 'disabled', sandbox_mode: 'read-only', approval_policy: 'never' } });
try {
  assertCoordinatorCodexVersion({ userAgent: 'codex_cli_rs/0.154.0' }); assertCoordinatorCodexConfig(config());
  check('verified native version and effective feature configuration pass', true);
  check('unknown protocol version is refused', rejects(() => assertCoordinatorCodexVersion({ userAgent: 'codex_cli_rs/0.155.0' })));
  for (const name of COORDINATOR_DISABLED_FEATURES) {
    const changed = config(); changed.config.features[name] = true;
    check(`enabled ${name} fails before a conversation turn`, rejects(() => assertCoordinatorCodexConfig(changed)));
  }
  check('missing effective config is not interpreted as disabled defaults', rejects(() => assertCoordinatorCodexConfig({ config: {} })));
  const withoutHost = config(); withoutHost.config.features.code_mode_host = false;
  check('native host for dynamic ADE tools must remain explicitly enabled', rejects(() => assertCoordinatorCodexConfig(withoutHost)));
  check('inherited MCP server is refused', rejects(() => assertCoordinatorCodexConfig({ config: { ...config().config, mcp_servers: { unexpected: {} } } })));
  check('explicitly enabled inherited MCP server is refused', rejects(() => assertCoordinatorCodexConfig({ config: { ...config().config, mcp_servers: { unexpected: { enabled: true } } } })));
  check('only explicitly disabled inherited MCP entries are accepted', !rejects(() => assertCoordinatorCodexConfig({ config: { ...config().config, mcp_servers: { inherited: { enabled: false } } } })));
  check('inherited writable sandbox is refused', rejects(() => assertCoordinatorCodexConfig({ config: { ...config().config, sandbox_mode: 'danger-full-access' } })));
  check('native thread must confirm no network in its read-only sandbox', rejects(() => assertCoordinatorCodexThread({ sandbox: { type: 'readOnly', networkAccess: true }, approvalPolicy: 'never' })));
  check('native thread cannot override the configured read-only policy', rejects(() => assertCoordinatorCodexThread({ sandbox: { type: 'dangerFullAccess' }, approvalPolicy: 'never' })));
  check('fixed launch overrides retain read-only configuration', COORDINATOR_CODEX_OVERRIDES.includes('sandbox_mode=read-only'));
  assertCoordinatorCodexThread({ sandbox: { type: 'readOnly', networkAccess: false }, approvalPolicy: 'never' });
  check('final positive native thread contract follows negative controls', true);
} catch (error) { failed++; console.error(error); }
console.log(`Coordinator Codex policy: ${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
