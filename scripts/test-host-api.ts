import { request } from 'node:http';
import { connect } from 'node:net';
import { AdeApplicationService } from '../src/main/application/AdeApplicationService';
import { HostApiServer } from '../src/main/remote/HostApiServer';
import { consumeHostApiConfig, parseHostApiConfig } from '../src/main/remote/hostApiConfig';
import { DEFAULT_CONFIG, type AdeConfig, type RunSummary } from '../src/shared/types';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ok  ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${label}`, detail ?? '');
  }
}

function rejects(label: string, operation: () => unknown, message: RegExp): void {
  try {
    operation();
    check(label, false, 'operation unexpectedly succeeded');
  } catch (error) {
    check(label, message.test(error instanceof Error ? error.message : String(error)), error);
  }
}

const disabled = parseHostApiConfig({});
check('host API is disabled by default', disabled.enabled === false);

const token = 't'.repeat(32);
const enabled = parseHostApiConfig({
  ADE_HOST_API_ENABLED: '1',
  ADE_HOST_API_TOKEN: token,
  ADE_HOST_API_PORT: '4318',
});
check('explicit opt-in produces a loopback-only config',
  enabled.enabled === true
    && enabled.host === '127.0.0.1'
    && enabled.port === 4318
    && enabled.token === token);

const consumedEnv: Record<string, string | undefined> = {
  ADE_HOST_API_ENABLED: '1',
  ADE_HOST_API_TOKEN: token,
};
const consumed = consumeHostApiConfig(consumedEnv);
check('host API startup consumes the token before child processes can inherit it',
  consumed.enabled && !('ADE_HOST_API_TOKEN' in consumedEnv));

rejects(
  'enabled host API requires a strong token',
  () => parseHostApiConfig({ ADE_HOST_API_ENABLED: '1', ADE_HOST_API_TOKEN: 'short' }),
  /token/i,
);
rejects(
  'enabled host API accepts only bounded URL-safe ASCII token material',
  () => parseHostApiConfig({
    ADE_HOST_API_ENABLED: '1',
    ADE_HOST_API_TOKEN: ' '.repeat(32),
  }),
  /token/i,
);
rejects(
  'enabled host API rejects control characters in token material',
  () => parseHostApiConfig({
    ADE_HOST_API_ENABLED: '1',
    ADE_HOST_API_TOKEN: `${'t'.repeat(31)}\n`,
  }),
  /token/i,
);
rejects(
  'enabled host API rejects non-ASCII token material',
  () => parseHostApiConfig({
    ADE_HOST_API_ENABLED: '1',
    ADE_HOST_API_TOKEN: 'ü'.repeat(32),
  }),
  /token/i,
);
rejects(
  'enabled host API rejects oversized token material',
  () => parseHostApiConfig({
    ADE_HOST_API_ENABLED: '1',
    ADE_HOST_API_TOKEN: 't'.repeat(129),
  }),
  /token/i,
);
rejects(
  'enabled host API rejects invalid ports',
  () => parseHostApiConfig({
    ADE_HOST_API_ENABLED: '1',
    ADE_HOST_API_TOKEN: token,
    ADE_HOST_API_PORT: '70000',
  }),
  /port/i,
);

const config: AdeConfig = {
  ...structuredClone(DEFAULT_CONFIG),
  repositories: [{
    id: 'repo-1',
    name: 'ADE',
    rootPath: '/home/secret/projects/ade',
    commonGitDir: '/home/secret/projects/ade/.git',
    executionBackend: 'wsl:Ubuntu',
    verified: true,
    createdAt: 1,
  }],
  agents: [{
    id: 'agent-1',
    categoryId: 'category-1',
    name: 'Builder',
    role: 'Implementation',
    runtime: 'codex',
    permissionMode: 'bypass',
    customCommand: 'dangerous --token secret-value',
    workspaceDir: '/home/secret/workspace',
    homeWorkspaceDir: '/home/secret/home',
    homeExecutionBackend: 'wsl:Ubuntu',
    defaultRepositoryId: 'repo-1',
    memoryDir: '/home/secret/memory',
    dashboardUrl: 'https://dashboard.invalid/?token=secret-value',
  }],
};
const runSummary: RunSummary = {
  id: 'run-1',
  name: 'Safe run',
  goal: 'Implement a bounded feature',
  status: 'running',
  mode: 'managed',
  phase: 'working',
  repositoryId: 'repo-1',
  repositoryName: 'ADE',
  branch: 'ade/run-1',
  teams: [],
  participants: [],
  tasks: [],
  budget: { maxConcurrentTasks: 1, maxInputTokens: null, maxOutputTokens: null, maxCostUsd: null, maxApprovals: 1 },
  usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, approvals: 0, unreportedCostTasks: 0 },
  pendingApprovalId: null,
  pausedTeamIds: [],
  createdAt: 1,
  updatedAt: 2,
  seqCursor: 7,
};
const application = new AdeApplicationService(
  { get: () => config },
  { summarize: () => [runSummary] },
  { status: () => ({ active: 1, queued: 2, maxActive: 4 }) },
);
const health = application.health();
check('application health reports API version and bounded queue state',
  health.apiVersion === 1
    && health.status === 'ready'
    && health.queue.active === 1
    && health.queue.queued === 2
    && health.queue.maxActive === 4);
const catalog = application.catalog();
check('mobile catalog keeps stable repository and agent selection fields',
  catalog.repositories[0]?.id === 'repo-1'
    && catalog.repositories[0]?.name === 'ADE'
    && catalog.repositories[0]?.executionBackend === 'wsl:Ubuntu'
    && catalog.agents[0]?.id === 'agent-1'
    && catalog.agents[0]?.defaultRepositoryId === 'repo-1'
    && catalog.agents[0]?.runtime === 'codex');
const serializedCatalog = JSON.stringify(catalog);
check('mobile catalog excludes paths, commands, dashboard tokens and memory locations',
  !serializedCatalog.includes('/home/secret')
    && !serializedCatalog.includes('dangerous')
    && !serializedCatalog.includes('secret-value')
    && !serializedCatalog.includes('rootPath')
    && !serializedCatalog.includes('memoryDir'));
check('application run projection delegates to the sanitized summary contract',
  application.runs()[0]?.id === 'run-1'
    && application.runs()[0]?.seqCursor === 7);

interface HttpResult {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function httpRequest(
  port: number,
  path: string,
  options: { method?: string; token?: string; hostHeader?: string; origin?: string } = {},
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port,
      path,
      method: options.method ?? 'GET',
      headers: {
        host: options.hostHeader ?? `127.0.0.1:${port}`,
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...(options.origin ? { origin: options.origin } : {}),
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.once('error', reject);
    req.end();
  });
}

function rawHttpRequest(port: number, target: string, token: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    let response = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => {
      socket.end(
        `GET ${target} HTTP/1.1\r\n`
        + `Host: 127.0.0.1:${port}\r\n`
        + `Authorization: Bearer ${token}\r\n`
        + 'Connection: close\r\n\r\n',
      );
    });
    socket.on('data', (chunk: string) => { response += chunk; });
    socket.on('error', reject);
    socket.on('close', () => resolve(response));
  });
}

async function testHttpAdapter(): Promise<void> {
  const server = new HostApiServer(application, token, 0);
  const address = await server.start();
  try {
    check('HTTP adapter binds only the IPv4 loopback interface',
      address.host === '127.0.0.1' && address.port > 0, address);

    const unauthorized = await httpRequest(address.port, '/api/v1/catalog');
    check('HTTP adapter rejects missing authorization before returning catalog data',
      unauthorized.status === 401
        && !unauthorized.body.includes('repo-1')
        && !unauthorized.body.includes('agent-1'));

    const wrongBearer = await httpRequest(address.port, '/api/v1/catalog', {
      token: 'x'.repeat(32),
    });
    check('HTTP adapter rejects incorrect bearer values', wrongBearer.status === 401);

    const wrongHost = await httpRequest(address.port, '/api/v1/health', {
      token,
      hostHeader: 'attacker.invalid',
    });
    check('HTTP adapter rejects untrusted Host headers', wrongHost.status === 400);

    const unknownOrigin = await httpRequest(address.port, '/api/v1/health', {
      token,
      origin: 'https://attacker.invalid',
    });
    check('HTTP adapter rejects browser origins until paired PWA origins exist',
      unknownOrigin.status === 403);

    const healthResponse = await httpRequest(address.port, '/api/v1/health', { token });
    check('authenticated health endpoint returns bounded JSON with defensive headers',
      healthResponse.status === 200
        && JSON.parse(healthResponse.body).queue.active === 1
        && healthResponse.headers['cache-control'] === 'no-store'
        && healthResponse.headers['x-content-type-options'] === 'nosniff'
        && healthResponse.headers['access-control-allow-origin'] === undefined);

    const catalogResponse = await httpRequest(address.port, '/api/v1/catalog', { token });
    check('authenticated catalog endpoint returns the mobile-safe projection',
      catalogResponse.status === 200
        && JSON.parse(catalogResponse.body).repositories[0]?.id === 'repo-1'
        && !catalogResponse.body.includes('/home/secret'));

    const runsResponse = await httpRequest(address.port, '/api/v1/runs', { token });
    check('authenticated runs endpoint returns sanitized run summaries',
      runsResponse.status === 200
        && JSON.parse(runsResponse.body)[0]?.id === 'run-1');

    const mutation = await httpRequest(address.port, '/api/v1/runs', { method: 'POST', token });
    check('HTTP adapter exposes no mutating method', mutation.status === 405);

    const unknown = await httpRequest(address.port, '/api/v1/unknown', { token });
    check('HTTP adapter rejects unknown endpoint paths', unknown.status === 404);

    const queryAlias = await httpRequest(address.port, '/api/v1/health?view=full', { token });
    check('HTTP adapter rejects query aliases of exact endpoint paths', queryAlias.status === 404);

    const dotSegment = await httpRequest(address.port, '/api/v1/../v1/health', { token });
    const encodedDotSegment = await httpRequest(
      address.port,
      '/api/v1/%2e%2e/v1/health',
      { token },
    );
    check('HTTP adapter matches only exact raw endpoint paths without URL normalization',
      dotSegment.status === 404 && encodedDotSegment.status === 404);

    const malformedTarget = await rawHttpRequest(address.port, 'http://[::1', token);
    const absoluteTarget = await rawHttpRequest(
      address.port,
      `http://127.0.0.1:${address.port}/api/v1/health`,
      token,
    );
    check('HTTP adapter rejects malformed absolute request targets without crashing Electron',
      malformedTarget.startsWith('HTTP/1.1 400'));
    check('HTTP adapter rejects valid absolute-form request targets',
      absoluteTarget.startsWith('HTTP/1.1 400'));
  } finally {
    await server.stop();
  }
}

async function testResponseBounds(): Promise<void> {
  const oversizedApplication = new AdeApplicationService(
    { get: () => config },
    { summarize: () => Array.from({ length: 4_000 }, () => runSummary) },
    { status: () => ({ active: 0, queued: 0, maxActive: 4 }) },
  );
  const server = new HostApiServer(oversizedApplication, token, 0);
  const address = await server.start();
  try {
    const response = await httpRequest(address.port, '/api/v1/runs', { token });
    check('HTTP adapter fails closed instead of returning an unbounded JSON snapshot',
      response.status === 503
        && JSON.parse(response.body).error === 'response_too_large'
        && !response.body.includes('run-1'));
  } finally {
    await server.stop();
  }
}

async function testErrorRedaction(): Promise<void> {
  const failingApplication = new AdeApplicationService(
    { get: () => { throw new Error('failed at /home/secret/token-value'); } },
    { summarize: () => [] },
    { status: () => ({ active: 0, queued: 0, maxActive: 4 }) },
  );
  const server = new HostApiServer(failingApplication, token, 0);
  const address = await server.start();
  try {
    const response = await httpRequest(address.port, '/api/v1/catalog', { token });
    check('HTTP adapter redacts application failures instead of leaking paths or secrets',
      response.status === 500
        && JSON.parse(response.body).error === 'internal_error'
        && !response.body.includes('/home/secret')
        && !response.body.includes('token-value'));
  } finally {
    await server.stop();
  }
}

async function testStartStopRace(): Promise<void> {
  const server = new HostApiServer(application, token, 0);
  const start = server.start();
  const stop = server.stop();
  const outcome = await Promise.race([
    Promise.allSettled([start, stop]).then((results) => ({ kind: 'settled' as const, results })),
    new Promise<{ kind: 'timeout' }>((resolve) => {
      setTimeout(() => resolve({ kind: 'timeout' }), 1_000);
    }),
  ]);
  try {
    check('concurrent app shutdown cleanly fences an in-flight host API start',
      outcome.kind === 'settled'
        && outcome.results.every((result) => result.status === 'fulfilled'), outcome);
  } finally {
    await server.stop().catch(() => undefined);
  }
}

void (async () => {
  await testHttpAdapter();
  await testResponseBounds();
  await testErrorRedaction();
  await testStartStopRace();
})()
  .catch((error) => {
    failed += 1;
    console.error('FAIL  HTTP adapter test crashed', error);
  })
  .finally(() => {
    console.log(`\nHost API: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  });
