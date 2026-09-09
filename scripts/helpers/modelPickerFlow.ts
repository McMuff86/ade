import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Page } from 'playwright';
import { exportWorkspaceBundle } from '../../src/main/portability/WorkspaceBundleExporter';
import { parseSerializedWorkspaceBundle, serializeWorkspaceBundle } from '../../src/shared/workspaceBundle';
import { MODEL_FIXTURE_CATALOG } from '../fixtures/model-clis';

export async function exerciseModelPicker(page: Page, state: string, configPath: string,
  check: (label: string, condition: boolean, detail?: unknown) => void): Promise<void> {
  const setState = (extra: Record<string, unknown> = {}) => writeFileSync(state, JSON.stringify({ ...MODEL_FIXTURE_CATALOG, ...extra }));
  await page.locator('.add-agent').first().click({ force: true });
  let dialog = page.getByRole('dialog', { name: 'New agent', exact: true }); await dialog.waitFor();
  check('new agent model selector receives dialog focus', await dialog.evaluate((node) => node.contains(document.activeElement)));
  await dialog.locator('#agent-repository').selectOption('');
  await dialog.locator('#agent-name').fill('Model Picker Fixture');
  await dialog.locator('#agent-codex-model option[value="codex-fixture-fast"]').waitFor({ state: 'attached' });
  check('new agent shows the CLI model catalog as a select', await dialog.locator('#agent-codex-model').evaluate((node) => node.tagName === 'SELECT'));
  await dialog.locator('#agent-codex-model').selectOption('codex-fixture-fast');
  check('selecting a Codex model adjusts to its supported reasoning levels', await dialog.locator('#agent-codex-reasoning').inputValue() === 'low'
    && await dialog.locator('#agent-codex-reasoning option').count() === 1);
  await dialog.getByRole('button', { name: 'Create agent', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  let config = await page.evaluate(() => window.ade.invoke('config:get')); let agent = config.agents.find((item) => item.name === 'Model Picker Fixture')!;
  check('new model selection persists through real IPC and config writes', agent.codexModel === 'codex-fixture-fast' && agent.codexReasoningEffort === 'low');
  await page.getByRole('button', { name: 'Agent settings for Model Picker Fixture', exact: true }).click({ force: true });
  dialog = page.getByRole('dialog', { name: 'Agent settings', exact: true }); await dialog.waitFor();
  check('edit dialog restores the chosen model', await dialog.locator('#edit-agent-codex-model').inputValue() === 'codex-fixture-fast');
  setState({ codex: [MODEL_FIXTURE_CATALOG.codex[0]] });
  await dialog.getByRole('button', { name: 'Modelle aktualisieren', exact: true }).click();
  await dialog.getByText('Die ausgewählte Modell-ID bleibt erhalten.', { exact: false }).waitFor();
  check('catalog removal preserves the stored model with an explicit unconfirmed label', await dialog.locator('#edit-agent-codex-model').inputValue() === 'codex-fixture-fast'
    && (await dialog.locator('#edit-agent-codex-model option:checked').textContent())!.includes('nicht bestätigt'));
  setState({ failure: true }); await dialog.getByRole('button', { name: 'Modelle aktualisieren', exact: true }).click();
  await dialog.getByText('Modelle konnten nicht bestätigt werden.', { exact: false }).waitFor();
  check('failed catalog fetch has recovery guidance without dropping the profile', await dialog.locator('#edit-agent-codex-model').inputValue() === 'codex-fixture-fast');
  setState(); await dialog.locator('#edit-agent-runtime').selectOption('grok');
  await dialog.locator('#edit-agent-grok-model option[value="grok-fixture-two"]').waitFor({ state: 'attached' });
  await dialog.locator('#edit-agent-grok-model').selectOption('grok-fixture-two');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  config = await page.evaluate(() => window.ade.invoke('config:get')); agent = config.agents.find((item) => item.id === agent.id)!;
  check('Grok selection is persisted and the old Codex pin is cleared', agent.grokModel === 'grok-fixture-two' && !agent.codexModel);
  await page.getByRole('button', { name: 'Agent settings for Model Picker Fixture', exact: true }).click({ force: true }); await dialog.waitFor();
  await dialog.locator('#edit-agent-runtime').selectOption('claude');
  await dialog.locator('#edit-agent-claude-model option[value="sonnet"]').waitFor({ state: 'attached' });
  check('Claude choices display resolved provider model names', (await dialog.locator('#edit-agent-claude-model').textContent())!.includes('claude-fixture-sonnet'));
  await dialog.locator('#edit-agent-claude-model').selectOption('sonnet');
  check('Claude model selection reaches the real launch command preview', (await dialog.locator('#edit-agent-cmd').getAttribute('placeholder'))!.includes("--model 'sonnet'"));
  const evidence = resolve('test-results/models'); mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: join(evidence, 'claude-model-picker.png') });
  await dialog.getByRole('button', { name: 'Save', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  const onDisk = JSON.parse(readFileSync(configPath, 'utf8')) as typeof config;
  check('Claude model is durably stored in the user profile', onDisk.agents.find((item) => item.id === agent.id)?.claudeModel === 'sonnet');
  const template = await page.evaluate((id) => window.ade.invoke('agentTemplate:create', { sourceAgentId: id, name: 'Model Picker Template' }), agent.id);
  const spawned = await page.evaluate(({ templateId, categoryId }) => window.ade.invoke('agentTemplate:spawn', { templateId, categoryId, name: 'Model Template Copy', defaultRepositoryId: null }),
    { templateId: template.id, categoryId: agent.categoryId });
  check('Claude model survives template creation and spawning', template.claudeModel === 'sonnet' && spawned.claudeModel === 'sonnet');
  config = await page.evaluate(() => window.ade.invoke('config:get'));
  const exported = exportWorkspaceBundle(config, { sourcePlatform: process.platform as 'win32' | 'linux' | 'darwin', includeMemory: false, includePhotos: false });
  const bundle = parseSerializedWorkspaceBundle(serializeWorkspaceBundle(exported.bundle));
  check('portable bundle round-trips Claude models for agents and templates', bundle.agents.some((item) => item.claudeModel === 'sonnet') && bundle.agentTemplates.some((item) => item.claudeModel === 'sonnet'));
  await page.getByRole('button', { name: 'Agent settings for Model Picker Fixture', exact: true }).click({ force: true }); await dialog.waitFor();
  check('reopened Claude profile retains the chosen alias', await dialog.locator('#edit-agent-claude-model').inputValue() === 'sonnet');
  await dialog.locator('#edit-agent-claude-model').focus(); await page.keyboard.press('Tab');
  check('model picker remains keyboard navigable', await dialog.evaluate((node) => node.contains(document.activeElement)));
  await dialog.locator('#edit-agent-claude-model').selectOption('');
  check('an inherited Claude setting does not add a model override', !(await dialog.locator('#edit-agent-cmd').getAttribute('placeholder'))!.includes('--model'));
  await dialog.getByRole('button', { name: 'Save', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  check('clearing the ADE model pin restores CLI inheritance on disk', !(JSON.parse(readFileSync(configPath, 'utf8')) as typeof config).agents.find((item) => item.id === agent.id)?.claudeModel);
  await page.getByRole('button', { name: 'Agent settings for Model Picker Fixture', exact: true }).click({ force: true }); await dialog.waitFor();
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  check('closing model settings restores its opener', await page.getByRole('button', { name: 'Agent settings for Model Picker Fixture', exact: true }).evaluate((node) => node === document.activeElement));
  await page.evaluate(async ({ agentId, spawnedId, templateId }) => {
    await window.ade.invoke('agent:delete', { id: spawnedId }); await window.ade.invoke('agent:delete', { id: agentId });
    await window.ade.invoke('agentTemplate:delete', { id: templateId });
  }, { agentId: agent.id, spawnedId: spawned.id, templateId: template.id });
  await page.locator('.agent-row', { hasText: 'E2E Shell' }).click();
}
