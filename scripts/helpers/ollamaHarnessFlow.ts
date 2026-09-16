import { join } from 'node:path';
import type { Locator, Page } from 'playwright';
import type { Agent } from '../../src/shared/types';
import { terminalLauncher } from './terminalControls';

/** Paired tablet -> authenticated host command -> actual profile-specific ConPTY process. */
export async function ollamaHarnessFlow(desktop: Page, page: Page, workspace: Locator, agent: Agent, evidence: string,
  check: (label: string, ok: boolean) => void): Promise<void> {
  await workspace.getByLabel('Workspace-Projekt', { exact: true }).selectOption('');
  await workspace.getByRole('button', { name: 'Terminal', exact: true }).click();
  for (const harness of ['qwen-code', 'codex'] as const) {
    await desktop.evaluate(({ id, name, harness }) => window.ade.invoke('agent:update', { id, name, runtime: 'ollama', permissionMode: 'default',
      ollamaMode: 'coding', ollamaHarness: harness, ollamaModel: 'fixture:large' }), { id: agent.id, name: agent.name, harness });
    await terminalLauncher(workspace);
    await workspace.getByLabel('Sitzung starten mit', { exact: true }).selectOption('agent');
    await workspace.getByRole('button', { name: 'Sitzung starten', exact: true }).click();
    const marker = harness === 'qwen-code' ? 'ADE_SESSION_QWEN_READY' : 'ADE_SESSION_CODEX_READY';
    await workspace.getByLabel('Terminalanzeige', { exact: true }).getByText(marker, { exact: false }).last().waitFor();
    const sessions = (await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions;
    const session = sessions.filter(s => s.agentId === agent.id && s.runtime === 'ollama' && s.launchChoice?.mode === 'agent').at(-1)!;
    const replay = await desktop.evaluate(async id => atob((await window.ade.invoke('pty:attach', { sessionId: id })).replayBase64), session.id);
    check(`paired tablet launches the saved ${harness} coding harness with its pinned model`, replay.includes(marker) && replay.includes('fixture:large')
      && session.launchModel === 'fixture:large' && !session.repositoryId);
    if (harness === 'qwen-code') await page.screenshot({ path: join(evidence, 'ollama-qwen-tablet.png') });
    await desktop.evaluate(id => window.ade.invoke('pty:kill', { sessionId: id }), session.id);
  }
  await desktop.evaluate(({ id, name, runtime, permissionMode, customCommand }) => window.ade.invoke('agent:update', { id, name, runtime, permissionMode, customCommand }), agent);
  check('tablet harness starts preserve the other profile fields', (await desktop.evaluate(async id => (await window.ade.invoke('config:get')).agents.find(a => a.id === id), agent.id))?.customCommand === agent.customCommand);
}
