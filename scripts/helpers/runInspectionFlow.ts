import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import type { Page } from 'playwright';
import { PNG } from 'pngjs';

const message = 'Bild erstellt.\nDie Ergebnisdatei liegt unter outputs/image.png.\nVollstaendige Abschlussantwort aus einer echten PTY.';
const jsonLine = (value: unknown) => `Console.WriteLine(${JSON.stringify(JSON.stringify(value))});`;
const fixtureImage = new PNG({ width: 320, height: 180 });
for (let y = 0; y < 180; y++) for (let x = 0; x < 320; x++) {
  const offset = (y * 320 + x) * 4; const circle = (x - 160) ** 2 + (y - 90) ** 2 < 50 ** 2;
  fixtureImage.data.set(circle ? [230, 161, 65, 255] : [22, 37 + Math.floor(y / 3), 62 + Math.floor(x / 3), 255], offset);
}
/** Compiled into the disposable test CLI, never into ADE. */
export const inspectionFixtureCode = `
if (cli == "CODEX" && args.Length > 0 && args[0] == "exec") {
  Console.In.ReadToEnd();
  ${jsonLine({ type: 'thread.started', thread_id: 'fixture-thread' })}
  ${jsonLine({ type: 'turn.started' })}
  ${jsonLine({ type: 'item.started', item: { id: 'tool-1', type: 'mcp_tool_call', server: 'fixture', tool: 'imagegen', status: 'in_progress', arguments: { prompt: 'PRIVATE_TASK_SENTINEL' } } })}
  System.Threading.Thread.Sleep(10000);
  Directory.CreateDirectory("outputs");
  File.WriteAllBytes("outputs/image.png", Convert.FromBase64String("${PNG.sync.write(fixtureImage).toString('base64')}"));
  File.WriteAllText("outputs/result.md", "# Result\\nFixture image generated");
  File.WriteAllBytes("outputs/book.xlsx", new byte[] {80,75,3,4,5,6});
  File.WriteAllText("tracked-edit.txt", "after");
  File.Delete("tracked-delete.txt");
  ${jsonLine({ type: 'item.completed', item: { type: 'agent_message', text: message } })}
  ${jsonLine({ type: 'turn.completed', usage: { input_tokens: 20, output_tokens: 30 } })}
  return;
}`;

export async function runInspectionFlow(desktop: Page, page: Page, categoryId: string, repositoryId: string, evidence: string,
  check: (name: string, ok: boolean) => void): Promise<void> {
  await page.keyboard.press('Escape');
  const agent = await desktop.evaluate(async (input) => window.ade.invoke('agent:create', { categoryId: input.categoryId, name: 'Image Agent', runtime: 'codex', permissionMode: 'default', defaultRepositoryId: input.repositoryId }), { categoryId, repositoryId });
  const initial = await desktop.evaluate((input) => window.ade.invoke('workspace:describe', input), { agentId: agent.id });
  writeFileSync(join(initial.workspaceDir, 'tracked-edit.txt'), 'before'); writeFileSync(join(initial.workspaceDir, 'tracked-delete.txt'), 'before');
  await page.getByRole('button', { name: 'Erneut verbinden', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  await page.getByRole('button', { name: 'Neue Aufgabe', exact: true }).click();
  const composer = page.getByRole('dialog', { name: 'Neue Aufgabe', exact: true });
  await composer.getByLabel('Repository', { exact: true }).selectOption(repositoryId);
  await composer.getByLabel('Agent', { exact: true }).selectOption(agent.id);
  await composer.getByLabel('Name (optional)', { exact: true }).fill('Bild und Ergebnis');
  await composer.getByLabel('Aufgabe', { exact: true }).fill('PRIVATE_TASK_SENTINEL');
  await composer.getByRole('button', { name: 'Aufgabe starten', exact: true }).click();
  await composer.waitFor({ state: 'hidden' }); await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Graph', exact: true }).click();
  const node = page.getByTestId('mobile-graph-node');
  await node.filter({ hasText: 'Image Agent' }).waitFor();
  await node.getByText(/Letzte Ausgabe vor/).waitFor();
  check('Graph receives real task CLI output while process runs', await node.innerText().then((text) => text.includes('running')));
  await page.screenshot({ path: join(evidence, 'run-activity.png') });
  await node.focus(); await page.keyboard.press('Enter');
  const panel = page.getByRole('region', { name: 'Run-Aktivität und Ergebnis', exact: true });
  await panel.getByText('Prozess läuft', { exact: false }).waitFor();
  check('keyboard-selected graph node exposes live process state', await panel.isVisible());
  check('activity excludes raw prompt and tool arguments', !(await panel.innerText()).includes('PRIVATE_TASK_SENTINEL'));
  await panel.getByText(/Aufgabe completed/).waitFor();
  await panel.getByRole('button', { name: 'Ergebnis', exact: true }).click();
  await panel.locator('.m-run-answer').getByText('Vollstaendige Abschlussantwort aus einer echten PTY.', { exact: false }).waitFor();
  check('completed task exposes full multiline CLI answer', await panel.locator('.m-run-answer').innerText() === message);
  const task = (await desktop.evaluate(() => window.ade.invoke('run:get'))).tasks.find((item) => item.title.includes('PRIVATE_TASK') || item.title.includes('Bild'))!;
  const sessions = (await desktop.evaluate(() => window.ade.invoke('pty:list'))).sessions;
  const session = sessions.find((item) => item.agentId === agent.id && item.kind === 'task')!;
  const report = await desktop.evaluate((runId) => window.ade.invoke('run:report', { runId }), task.runId);
  check('native PTY result is durable in report and absent from summary', session.status === 'exited' && session.exitCode === 0 && report.tasks[0]?.output?.text === message && !JSON.stringify(task).includes(message));
  const changes = report.tasks[0]?.files;
  check('real PTY captured before and after changes with deleted-file provenance', changes?.source === 'observed' && changes.files.some((file) => file.path === 'outputs/image.png' && file.change === 'created')
    && changes.files.some((file) => file.path === 'tracked-edit.txt' && file.change === 'modified') && changes.files.some((file) => file.path === 'tracked-delete.txt' && file.change === 'deleted'));
  await panel.locator('.m-run-answer').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(evidence, 'run-result.png') });
  await panel.getByRole('button', { name: 'Dateien', exact: true }).click();
  await panel.locator('li').filter({ hasText: 'tracked-delete.txt' }).getByText('Gelöscht', { exact: true }).waitFor();
  check('deleted files remain visible without a download action', await panel.getByRole('button', { name: 'Download vorbereiten: tracked-delete.txt', exact: true }).isDisabled());
  await panel.getByRole('button', { name: 'Bild ansehen: image.png', exact: true }).click();
  const image = panel.getByRole('img', { name: 'Ergebnisdatei image.png', exact: true });
  await image.waitFor(); await image.evaluate((node) => (node as HTMLImageElement).decode());
  check('tablet displays actual authenticated raster image', await image.evaluate((node) => (node as HTMLImageElement).naturalWidth === 320 && (node as HTMLImageElement).src.startsWith('blob:')));
  const downloadEvent = page.waitForEvent('download');
  await panel.getByRole('link', { name: 'Herunterladen: image.png', exact: true }).click();
  const download = await downloadEvent; const path = await download.path();
  check('browser download contains exact workspace PNG bytes', download.suggestedFilename() === 'image.png' && !!path && readFileSync(path).equals(readFileSync(join(session.workspaceDir!, 'outputs/image.png'))));
  await page.screenshot({ path: join(evidence, 'run-image.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.getByRole('button', { name: 'Dateien', exact: true }).click();
  await panel.getByRole('button', { name: 'Bild ansehen: image.png', exact: true }).click();
  await image.waitFor(); await image.evaluate((node) => (node as HTMLImageElement).decode());
  await image.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(evidence, 'run-image-phone.png') });
  check('result inspection fits portrait phone width', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.keyboard.press('Escape');
  check('Escape clears selection and restores graph focus', await node.evaluate((element) => element === document.activeElement));
  await page.reload(); await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  await page.getByRole('tab', { name: 'Graph', exact: true }).click(); await node.click();
  await panel.getByRole('button', { name: 'Ergebnis', exact: true }).click();
  await panel.locator('.m-run-answer').waitFor();
  check('completed result remains accessible after browser reload', await panel.locator('.m-run-answer').innerText() === message);
  await page.keyboard.press('Escape'); await page.setViewportSize({ width: 1365, height: 900 });
  await page.getByRole('button', { name: 'Dateien dieses Runs', exact: true }).click();
  const filesDialog = page.getByRole('dialog', { name: 'Dateien dieses Runs', exact: true });
  await filesDialog.getByRole('button', { name: 'Download vorbereiten: book.xlsx', exact: true }).click();
  check('file lists do not echo auto-derived private task titles', !(await filesDialog.innerText()).includes('PRIVATE_TASK_SENTINEL'));
  const bookEvent = page.waitForEvent('download'); await filesDialog.getByRole('link', { name: 'Herunterladen: book.xlsx', exact: true }).click();
  const book = await bookEvent; const bookPath = await book.path();
  check('direct Graph files download spreadsheet from owning task workspace', !!bookPath && readFileSync(bookPath).equals(readFileSync(join(session.workspaceDir!, 'outputs/book.xlsx'))));
  await filesDialog.getByRole('button', { name: 'Vorschau schliessen', exact: true }).click();
  await page.screenshot({ path: join(evidence, 'run-files-changes.png') });
  await page.keyboard.press('Escape');
  check('direct Graph file dialog restores opener focus', await page.getByRole('button', { name: 'Dateien dieses Runs', exact: true }).evaluate((element) => element === document.activeElement));
  const nativeList = await desktop.evaluate((runId) => window.ade.invoke('run:files', { runId }), task.runId);
  check('desktop file IPC exposes same observed result', nativeList.files.some((file) => file.path === 'outputs/image.png' && file.change === 'created'));
  const devices = await desktop.evaluate(() => window.ade.invoke('remoteDevices:list')); const device = devices.devices.find((item) => item.name === 'Terminal tablet')!;
  await desktop.evaluate(({ deviceId, scopes }) => window.ade.invoke('remoteDevices:setAdminScopes', { deviceId, scopes }),
    { deviceId: device.id, scopes: [...new Set([...(device.adminScopes ?? []), 'projects:write' as const])] });
  await page.getByRole('tab', { name: 'Projekte', exact: true }).click();
  await page.getByRole('button', { name: 'Workspace öffnen: Terminal project', exact: true }).click();
  const project = page.getByRole('dialog', { name: 'Projekt · Terminal project', exact: true });
  await project.getByRole('button', { name: 'Workspace öffnen', exact: true }).click();
  await project.getByRole('button', { name: 'Ergebnisse', exact: true }).click();
  await project.getByRole('button', { name: 'Bild ansehen: image.png', exact: true }).click();
  const projectImage = project.getByRole('img', { name: 'Ergebnisdatei image.png', exact: true });
  await projectImage.waitFor(); await projectImage.evaluate((element) => (element as HTMLImageElement).decode());
  check('project workspace finds run files in original agent worktree', await projectImage.evaluate((element) => (element as HTMLImageElement).naturalWidth === 320) && (await project.innerText()).includes('nicht automatisch'));
  await projectImage.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(evidence, 'project-run-results.png') });
  await desktop.keyboard.press('Escape');
  await desktop.getByRole('tab', { name: 'Projekte view', exact: true }).click();
  await desktop.getByRole('button', { name: 'Workspace öffnen: Terminal project', exact: true }).click();
  await desktop.getByRole('button', { name: 'Ergebnisse', exact: true }).click();
  await desktop.getByRole('button', { name: 'Bild ansehen: image.png', exact: true }).click();
  const desktopImage = desktop.getByRole('img', { name: 'Ergebnisdatei image.png', exact: true });
  await desktopImage.waitFor(); await desktopImage.evaluate((element) => (element as HTMLImageElement).decode());
  check('desktop project results render the same original image', await desktopImage.evaluate((element) => (element as HTMLImageElement).naturalWidth === 320));
  await page.context().setOffline(true);
  await project.getByText('PC nicht verbunden.', { exact: true }).waitFor();
  check('offline project result view releases downloadable image URL', await projectImage.count() === 0);
  await page.context().setOffline(false); await project.getByRole('button', { name: 'Bild ansehen: image.png', exact: true }).waitFor();
  check('final positive control restores project download after reconnect', await project.getByRole('button', { name: 'Download vorbereiten: book.xlsx', exact: true }).isEnabled());
}
