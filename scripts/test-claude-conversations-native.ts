/** Opt-in native evidence, separate from deterministic repository verification.
 * Uses no project tools, plugins or MCP servers. Never resumes an arbitrary
 * existing user session; only the UUID created by this acceptance driver. */
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { redactedErrorDetail } from '../src/main/errors';

const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-native-claude-')));
const evidence = resolve('test-results/main-agent-planning'); mkdirSync(evidence, { recursive: true });
const executable = process.platform === 'win32' ? execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-Command claude -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source'],
  { encoding: 'utf8', windowsHide: true, timeout: 10000 }).trim() : 'claude';
const id = randomUUID();
function turn(prompt: string, resume: boolean): Promise<{ text: string; model: string; sessionId: string; noTools: boolean }> {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--safe-mode', '--restricted', '--tools', '', '--strict-mcp-config',
      '--mcp-config', '{"mcpServers":{}}', '--permission-mode', 'plan', '--permission-prompts', 'none', resume ? '--resume' : '--session-id', id];
    // Direct executable spawn preserves literal empty --tools; no shell parser.
    const child = spawn(executable, args, { cwd: root, env: process.env, windowsHide: true, stdio: 'pipe' });
    let output = ''; let stderr = ''; let failure = '';
    const stop = (reason: string) => { if (failure) return; failure = reason; child.kill(); };
    const timeout = setTimeout(() => stop('Native Claude acceptance exceeded 90 seconds'), 90_000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { if (failure) return; output += chunk; if (Buffer.byteLength(output) > 2 * 1024 * 1024) stop('Native Claude output exceeded limit'); });
    child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-8000); });
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('close', code => {
      clearTimeout(timeout);
      try {
        if (failure || code !== 0) throw new Error(failure || redactedErrorDetail(stderr) || `Claude exited ${code}`);
        const events = output.trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
        const init = events.find(event => event.type === 'system' && event.subtype === 'init'); const result = events.findLast(event => event.type === 'result');
        if (!init || !result || result.is_error || result.session_id !== id || init.session_id !== id || typeof result.result !== 'string' || typeof init.model !== 'string') throw new Error('Claude did not confirm the expected native conversation result');
        const noTools = Array.isArray(init.tools) && init.tools.length === 0 && !events.some(event => {
          const message = event.message as { content?: Array<{ type: string }> } | undefined;
          return message?.content?.some(item => item.type === 'tool_use');
        });
        resolve({ text: result.result, model: init.model, sessionId: id, noTools });
      } catch (error) { reject(error); }
    });
    child.stdin.end(prompt + '\n', 'utf8');
  });
}
void (async () => {
  const version = execFileSync(executable, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 10000 }).trim();
  execFileSync('git', ['init', '--quiet', root], { windowsHide: true, timeout: 10000 });
  const marker = 'ADE_CLAUDE_' + randomUUID();
  const first = await turn(`Remember this exact marker in this conversation: ${marker}. Reply only RECORDED.`, false);
  console.log('Native Claude first conversation result confirmed.');
  const second = await turn('Return only the exact marker from my previous message.', true);
  if (!second.text.includes(marker) || second.sessionId !== first.sessionId) throw new Error('Claude native resume did not retain this exact conversation context');
  if (!first.noTools || !second.noTools) throw new Error('Claude probe did not confirm an empty native tool inventory');
  if (first.model !== second.model) throw new Error('Claude model changed during the continuation probe');
  writeFileSync(join(evidence, 'claude-native-conversation.json'), JSON.stringify({ at: new Date().toISOString(), version, platform: process.platform,
    requestedModel: null, observedModel: second.model, permissionMode: 'plan', safeMode: true, restricted: true, tools: [], native: true,
    checks: { firstTurn: true, processRestartSameConversationAndContext: true, emptyToolInventory: true },
    limitation: 'Native CLI continuation probe only; no ADE Claude conversation adapter or workspace scope validation implemented.' }, null, 2));
  console.log(`Native Claude conversations: 3 passed, 0 failed (${version}; observed ${second.model})`);
})().catch(error => { console.error(redactedErrorDetail(error)); process.exitCode = 1; }).finally(() => {
  if (dirname(root) !== realpathSync.native(tmpdir())) throw new Error('Unexpected acceptance workspace');
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
