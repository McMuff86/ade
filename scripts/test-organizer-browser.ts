import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium, type Browser, type Page } from 'playwright';
import { PNG } from 'pngjs';
import { createRemoteWorkspaceFixture } from './helpers/remoteWorkspaceFixture';
import { mobileTlsProxy } from './helpers/mobileBrowser';
import { BrowserSessions } from '../src/main/remote/BrowserSessions';
import { HostApiServer } from '../src/main/remote/HostApiServer';
import { RemoteAuthorizer } from '../src/main/remote/authorization';
import { loadMobileAssets } from '../src/main/remote/mobileAssets';

const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-organizer-browser-')));
const evidence = resolve('test-results/organizer'); mkdirSync(evidence, { recursive: true });
const fixture = createRemoteWorkspaceFixture(root);
let browser: Browser | undefined; let page: Page | undefined; let server: HostApiServer | undefined;
let proxy: Awaited<ReturnType<typeof mobileTlsProxy>> | undefined; let sessions: BrowserSessions | undefined;
let passed = 0; let failed = 0;
const check = (name: string, ok: boolean) => { if (ok) { passed++; console.log(`  ok  ${name}`); } else { failed++; console.error(`FAIL  ${name}`); } };
async function waitFor(condition: () => boolean, label: string) { const limit = Date.now() + 20_000; while (!condition()) { if (Date.now() > limit) throw new Error(`Timed out: ${label}`); await new Promise(resolve => setTimeout(resolve, 100)); } }
void (async () => {
  const repository = join(root, 'project'); mkdirSync(repository); execFileSync('git', ['init', repository], { stdio: 'ignore' });
  writeFileSync(join(repository, 'README.md'), '# Organizer fixture'); execFileSync('git', ['-C', repository, 'add', '.']);
  execFileSync('git', ['-C', repository, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Fixture'], { stdio: 'ignore' });
  fixture.store.save({ repositories: [{ id: 'repo', name: 'Organizer project', rootPath: repository, commonGitDir: join(repository, '.git'), executionBackend: 'native', verified: true, createdAt: Date.now() }] });
  proxy = await mobileTlsProxy(); sessions = new BrowserSessions(fixture.devices);
  server = new HostApiServer(fixture.application, { port: 0, heartbeatMs: 200, requireDeviceReads: true,
    authorizer: new RemoteAuthorizer('t'.repeat(32), [], undefined, fixture.devices),
    browser: { origin: proxy.origin, sessions, assets: loadMobileAssets(resolve(process.env.ADE_ORGANIZER_ASSETS ?? 'out/mobile')) }, audit: entry => fixture.devices.audit(entry) });
  proxy.target((await server.start()).port);
  browser = await chromium.launch({ args: ['--ignore-certificate-errors', '--host-resolver-rules=MAP ade-mobile.fixture.ts.net 127.0.0.1'] });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, hasTouch: true, ignoreHTTPSErrors: true });
  page = await context.newPage(); page.setDefaultTimeout(20_000);
  const errors: string[] = []; page.on('pageerror', error => { errors.push(error.message); console.error('PAGE:', error.message); });
  await page.goto(sessions.beginPairing(proxy.origin).url);
  await page.getByRole('button', { name: 'Dieses Gerät verbinden', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /^Verbunden$/ }).waitFor();
  await page.getByRole('tab', { name: 'Notizen', exact: true }).click();
  await page.getByText('Am PC unter Einstellungen → Verbundene Geräte', { exact: false }).waitFor();
  check('ungranted device sees a useful personal-data permission state', await page.getByText('Am PC unter Einstellungen → Verbundene Geräte', { exact: false }).isVisible());
  const device = fixture.devices.activeDevices()[0]!.id;
  fixture.devices.setAdminScopes(device, ['organizer:read', 'organizer:write'], { mode: 'all' }); await page.reload();
  await page.getByRole('button', { name: 'Neue Notiz', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Navigation einklappen' }).click();
  check('navigation collapse retains the current page and removes hidden tabs from focus', !await page.getByRole('tab', { name: 'Notizen', exact: true }).isVisible());
  await page.reload(); await page.getByRole('button', { name: 'Navigation ausklappen' }).waitFor();
  check('navigation collapse survives reload without forgetting pairing', fixture.devices.activeDevices().length === 1);
  await page.getByRole('button', { name: 'Navigation ausklappen' }).click();
  await page.getByRole('tab', { name: 'Aufgaben', exact: true }).focus(); await page.keyboard.press('ArrowRight');
  check('keyboard navigation moves between organization tabs', await page.getByRole('tab', { name: 'Notizen', exact: true }).getAttribute('aria-selected') === 'true');
  await page.getByRole('button', { name: 'Neue Notiz', exact: true }).click();
  const title = page.getByLabel('Titel', { exact: true }); await title.fill('Idee für morgen');
  const body = page.getByLabel('Notiztext', { exact: true }); await body.fill('Grösse prüfen – mit Stift skizzieren.');
  // The sheet: drawing happens full-window, the note keeps a preview (docs/SKETCH_UX_PROPOSAL.md §5–§7).
  const draw = page.getByRole('button', { name: 'Zeichnen', exact: true }); await draw.click();
  const sheetDialog = page.getByRole('dialog', { name: 'Skizze', exact: true }); await sheetDialog.waitFor();
  const canvas = sheetDialog.locator('canvas'); const zoom = sheetDialog.locator('output.sketch-sheet-zoom-level');
  check('the sheet opens over the note and focuses the drawing surface', await canvas.evaluate(node => node === document.activeElement) && await zoom.textContent() === '100 %');
  await page.waitForTimeout(300); await page.screenshot({ path: join(evidence, 'sheet-desktop.png') });
  await page.keyboard.press('Shift+ArrowRight'); await page.keyboard.press('Shift+ArrowDown');
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click(); await page.getByRole('button', { name: 'Wiederholen', exact: true }).click();
  await waitFor(() => fixture.organizer.store.index().entries.some(item => item.title === 'Idee für morgen'), 'note synchronized');
  const noteId = fixture.organizer.store.index().entries.find(item => item.title === 'Idee für morgen')!.id;
  await waitFor(() => fixture.organizer.store.detail(noteId)?.document.sketch.strokes.length === 2, 'drawing synchronized');
  check('actual IndexedDB, signed API and sketch history preserve editable strokes', fixture.organizer.store.detail(noteId)?.document.text.includes('Grösse') === true);
  const strokes = () => fixture.organizer.store.detail(noteId)?.document.sketch.strokes.length ?? -1;
  const bounds = (await canvas.boundingBox())!;
  const pen = await context.newCDPSession(page);
  const x = bounds.x + bounds.width * .35; const y = bounds.y + bounds.height * .4; const end = bounds.x + bounds.width * .75;
  await pen.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: .6 });
  await pen.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: end, y, button: 'left', buttons: 1, pointerType: 'pen', force: .8 });
  await pen.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: end, y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' });
  await waitFor(() => strokes() === 3, 'pen stroke saved');
  check('pen pointer draws and persists pressure points', fixture.organizer.store.detail(noteId)!.document.sketch.strokes.at(-1)!.points.some(point => point.pressure > .5 && point.pressure < 1));
  await page.getByRole('button', { name: 'Radierer', exact: true }).click();
  check('the eraser shows its options with the partial mode preselected', await page.getByRole('button', { name: 'Teil einer Linie', exact: true }).getAttribute('aria-pressed') === 'true');
  await page.mouse.click(bounds.x + bounds.width * .55, bounds.y + bounds.height * .4);
  await waitFor(() => strokes() === 4, 'pen stroke split in two');
  const pieces = fixture.organizer.store.detail(noteId)!.document.sketch.strokes.slice(2);
  check('the partial eraser cuts a gap out of the line and keeps both ends editable', pieces.length === 2 && pieces.every(piece => piece.points.length >= 2) && Math.max(...pieces[0]!.points.map(point => point.x)) < Math.min(...pieces[1]!.points.map(point => point.x)));
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click(); await waitFor(() => strokes() === 3, 'partial erase undone');
  await page.getByRole('button', { name: 'Ganze Linie', exact: true }).click();
  await page.mouse.click(bounds.x + bounds.width * .55, bounds.y + bounds.height * .4);
  await waitFor(() => strokes() === 2, 'middle of pen segment erased');
  check('eraser hits the middle of a fast stroke between recorded points', strokes() === 2);
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await waitFor(() => strokes() === 3, 'erased pen stroke restored');
  // Any line width from the slider, remembered per device; pen pressure can be switched off.
  await page.getByRole('button', { name: 'Stift', exact: true }).click();
  await page.getByLabel('Strichstärke', { exact: true }).fill('30'); await canvas.focus(); await page.keyboard.press('Shift+ArrowLeft');
  await waitFor(() => strokes() === 4, 'wide keyboard stroke saved');
  check('the width slider sets any line width and the value is a device preference', fixture.organizer.store.detail(noteId)!.document.sketch.strokes.at(-1)!.width === 30 && JSON.parse(await page.evaluate(() => localStorage.getItem('ade.sketch.preferences') ?? '{}')).width === 30);
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click(); await waitFor(() => strokes() === 3, 'wide stroke undone');
  await page.getByLabel('Strichstärke', { exact: true }).fill('5'); await page.getByLabel('Stiftdruck', { exact: true }).uncheck();
  const flat = { x: bounds.x + bounds.width * .3, y: bounds.y + bounds.height * .7 };
  await pen.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...flat, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: .6 });
  await pen.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: flat.x + 80, y: flat.y, button: 'left', buttons: 1, pointerType: 'pen', force: .9 });
  await pen.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: flat.x + 80, y: flat.y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' });
  await waitFor(() => strokes() === 4, 'pressure-free pen stroke saved');
  check('with pen pressure off every point is recorded at full pressure', fixture.organizer.store.detail(noteId)!.document.sketch.strokes.at(-1)!.points.every(point => point.pressure === 1));
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click(); await waitFor(() => strokes() === 3, 'pressure-free stroke undone'); await page.getByLabel('Stiftdruck', { exact: true }).check();
  // Brushes and opacity travel with the stroke (contract fields), the highlighter starts translucent.
  await page.getByLabel('Stiftart', { exact: true }).selectOption('highlighter');
  check('choosing the highlighter presets a translucent band', await page.getByLabel('Deckkraft', { exact: true }).inputValue() === '35');
  await canvas.focus(); await page.keyboard.press('Shift+ArrowDown'); await waitFor(() => strokes() === 4, 'highlighter stroke saved');
  const marker = fixture.organizer.store.detail(noteId)!.document.sketch.strokes.at(-1)!;
  check('the saved stroke names its brush and opacity', marker.brush === 'highlighter' && marker.opacity === .35);
  await page.getByLabel('Stiftart', { exact: true }).selectOption('pencil'); await page.getByLabel('Deckkraft', { exact: true }).fill('60');
  await canvas.focus(); await page.keyboard.press('Shift+ArrowDown'); await waitFor(() => strokes() === 5, 'pencil stroke saved');
  const pencil = fixture.organizer.store.detail(noteId)!.document.sketch.strokes.at(-1)!;
  check('opacity is a per-stroke value and a device preference', pencil.brush === 'pencil' && pencil.opacity === .6 && JSON.parse(await page.evaluate(() => localStorage.getItem('ade.sketch.preferences') ?? '{}')).opacity === 60);
  await page.getByLabel('Stiftart', { exact: true }).selectOption('pen'); await page.getByLabel('Deckkraft', { exact: true }).fill('100');
  await canvas.focus(); await page.keyboard.press('Shift+ArrowDown'); await waitFor(() => strokes() === 6, 'plain pen stroke saved');
  check('a plain opaque pen stroke keeps the original stroke shape', !('brush' in fixture.organizer.store.detail(noteId)!.document.sketch.strokes.at(-1)!) && !('opacity' in fixture.organizer.store.detail(noteId)!.document.sketch.strokes.at(-1)!));
  for (let i = 0; i < 3; i++) { await page.getByRole('button', { name: 'Rückgängig', exact: true }).click(); }
  await waitFor(() => strokes() === 3, 'brush strokes undone');
  // An erase drag works on a copy and commits once on release: no save per sample, one undo step.
  await page.getByRole('button', { name: 'Radierer', exact: true }).click(); await page.getByRole('button', { name: 'Teil einer Linie', exact: true }).click();
  const dragStart = { x: bounds.x + bounds.width * .45, y: bounds.y + bounds.height * .3 }; const revisionBefore = fixture.organizer.store.detail(noteId)!.revision;
  await pen.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...dragStart, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: .6 });
  for (let step = 1; step <= 6; step++) await pen.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dragStart.x + step * 20, y: dragStart.y + step * (bounds.height * .2 / 6), button: 'left', buttons: 1, pointerType: 'pen', force: .6 });
  await page.waitForTimeout(400);
  check('an erase drag saves nothing while the pen is down', fixture.organizer.store.detail(noteId)!.revision === revisionBefore && strokes() === 3);
  await pen.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: dragStart.x + 120, y: dragStart.y + bounds.height * .2, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' });
  await waitFor(() => strokes() === 4, 'drag erase committed on release');
  check('the pen stroke is cut once where the drag crossed it', strokes() === 4);
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click(); await waitFor(() => strokes() === 3, 'single undo restores the whole drag');
  check('one release is one undo step', strokes() === 3 && fixture.organizer.store.detail(noteId)!.document.sketch.strokes.length === 3);
  await page.getByRole('button', { name: 'Ganze Linie', exact: true }).click(); await page.getByRole('button', { name: 'Stift', exact: true }).click();
  // The pen's side button erases without leaving the pen tool (§4).
  await page.getByRole('button', { name: 'Stift', exact: true }).click();
  const onStroke = { x: bounds.x + bounds.width * .55, y: bounds.y + bounds.height * .4 }; const free = { x: bounds.x + bounds.width * .6, y: bounds.y + bounds.height * .6 };
  await pen.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...onStroke, button: 'right', buttons: 2, clickCount: 1, pointerType: 'pen' });
  await pen.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...onStroke, button: 'right', buttons: 0, clickCount: 1, pointerType: 'pen' });
  await waitFor(() => strokes() === 2, 'side button erased the pen stroke');
  check('the pen side button erases while the pen tool stays selected', strokes() === 2 && await page.getByRole('button', { name: 'Stift', exact: true }).getAttribute('aria-pressed') === 'true');
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click(); await waitFor(() => strokes() === 3, 'side-button erase undone');
  // A hovering pen turns the hand into a hand: the finger that follows leaves no mark.
  await pen.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...free, buttons: 0, pointerType: 'pen' });
  await page.touchscreen.tap(free.x, free.y); await page.waitForTimeout(700);
  check('a finger right after the pen leaves no mark', strokes() === 3);
  check('the input mode is a device preference, not document data', JSON.parse(await page.evaluate(() => localStorage.getItem('ade.sketch.preferences') ?? 'null'))?.penSeen === true
    && !JSON.stringify(fixture.organizer.store.detail(noteId)!.document).includes('penSeen'));
  // Once the device has a pen, one finger pans and two fingers zoom (§5); neither leaves a mark.
  await page.waitForTimeout(1600); const viewBefore = await canvas.getAttribute('data-view');
  await pen.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...free }] });
  await pen.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: free.x + 120, y: free.y + 40 }] });
  await pen.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(300);
  const panned = (await canvas.getAttribute('data-view'))!.split(',').map(Number); const initial = viewBefore!.split(',').map(Number);
  check('one finger pans the sheet without drawing', Math.abs(panned[0]! - initial[0]! - 120) <= 2 && Math.abs(panned[1]! - initial[1]! - 40) <= 2 && await zoom.textContent() === '100 %' && strokes() === 3);
  const centre = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  await pen.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: centre.x - 60, y: centre.y }, { x: centre.x + 60, y: centre.y }] });
  await pen.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: centre.x - 150, y: centre.y }, { x: centre.x + 150, y: centre.y }] });
  await pen.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(300);
  check('two fingers zoom the sheet without drawing', await zoom.textContent() === '250 %' && strokes() === 3);
  await page.getByRole('button', { name: 'Einpassen', exact: true }).click(); await page.waitForTimeout(200);
  check('fit returns to the whole sheet', await zoom.textContent() === '100 %');
  await page.mouse.move(centre.x, centre.y); await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await page.keyboard.up('Control'); await page.waitForTimeout(200);
  check('Ctrl + wheel zooms around the cursor', await zoom.textContent() === '110 %');
  await canvas.focus(); await page.keyboard.press('0'); await page.waitForTimeout(200);
  check('0 fits the sheet from the keyboard', await zoom.textContent() === '100 %');
  await pen.send('Emulation.setDeviceMetricsOverride', { width: 1300, height: 900, deviceScaleFactor: 2, mobile: false }); await page.waitForTimeout(400);
  check('the sheet renders at device resolution', await canvas.evaluate(node => (node as HTMLCanvasElement).width === Math.round(node.clientWidth * window.devicePixelRatio) && window.devicePixelRatio === 2));
  await pen.send('Emulation.clearDeviceMetricsOverride'); await page.setViewportSize({ width: 1400, height: 900 }); await page.waitForTimeout(300);
  // The dot grid is a view-only guide: it appears on the sheet and never in the document or the export.
  const gridPixel = async () => canvas.evaluate(node => { const element = node as HTMLCanvasElement; const [vx, vy, scale] = (element.dataset.view ?? '0,0,1').split(',').map(Number); const dpr = window.devicePixelRatio;
    const data = element.getContext('2d')!.getImageData(Math.round((vx! + 50 * scale!) * dpr), Math.round((vy! + 50 * scale!) * dpr), 1, 1).data; return data[0]! + data[1]! + data[2]!; });
  const plain = await gridPixel();
  await page.getByRole('button', { name: 'Weitere Optionen', exact: true }).click(); await page.getByLabel('Punktraster (nur am Bildschirm)', { exact: true }).check(); await page.waitForTimeout(200);
  const dotted = await gridPixel(); await page.getByLabel('Punktraster (nur am Bildschirm)', { exact: true }).uncheck(); await page.waitForTimeout(200);
  check('the dot grid shows on the sheet only while switched on', plain === 765 && dotted < 740 && await gridPixel() === 765);
  check('the grid is a device preference and never document data', JSON.parse(await page.evaluate(() => localStorage.getItem('ade.sketch.preferences') ?? '{}')).grid === false && !JSON.stringify(fixture.organizer.store.detail(noteId)!.document).includes('grid'));
  // Sheet format: never smaller than the drawing, larger sheets apply and refit, undo restores the size.
  const sheetSize = () => { const sketch = fixture.organizer.store.detail(noteId)!.document.sketch; return `${sketch.width}x${sketch.height}`; };
  await page.getByLabel('Blattformat', { exact: true }).selectOption('portrait'); await page.getByRole('button', { name: 'Blattgrösse übernehmen', exact: true }).click(); await page.waitForTimeout(200);
  check('a sheet smaller than the drawing is refused and names the needed size', /mindestens \d+ × \d+ Punkte/.test(await sheetDialog.getByRole('alert').textContent() ?? '') && sheetSize() === '1600x1000');
  await page.getByLabel('Blattformat', { exact: true }).selectOption('large'); await page.getByRole('button', { name: 'Blattgrösse übernehmen', exact: true }).click();
  await waitFor(() => sheetSize() === '3200x2000', 'large sheet saved'); await page.waitForTimeout(200);
  check('a larger sheet applies within the contract, keeps every stroke and is shown whole', strokes() === 3 && await zoom.textContent() === '100 %' && await page.getByLabel('Breite (Punkte)', { exact: true }).inputValue() === '3200');
  check('applying keeps the focus inside the sheet menu', await page.evaluate(() => !!document.activeElement?.closest('.sketch-sheet-menu')));
  await page.keyboard.press('Escape'); await page.waitForTimeout(100); await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await waitFor(() => sheetSize() === '1600x1000', 'sheet size undone');
  check('undo also covers the sheet size', strokes() === 3 && await zoom.textContent() === '100 %');
  // Asking for finger drawing through the sheet menu: a palm-sized contact is still ignored, a fingertip draws.
  await page.getByRole('button', { name: 'Weitere Optionen', exact: true }).click();
  await page.getByLabel('Eingabe', { exact: true }).selectOption('finger-draws');
  await page.keyboard.press('Escape');
  check('Escape closes the menu first and keeps the sheet open', await sheetDialog.isVisible() && !await page.getByLabel('Eingabe', { exact: true }).isVisible());
  await page.waitForTimeout(1600);
  const sheetBounds = (await canvas.boundingBox())!; const dot = { x: sheetBounds.x + sheetBounds.width * .6, y: sheetBounds.y + sheetBounds.height * .6 };
  await pen.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...dot, radiusX: 30, radiusY: 30, force: .6 }] });
  await pen.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(500);
  check('a palm-sized contact never draws, even when finger drawing is on', strokes() === 3);
  await page.touchscreen.tap(dot.x, dot.y);
  await waitFor(() => strokes() === 4, 'touch dot saved');
  check('touch drawing and undo retain editable pen and touch strokes', fixture.organizer.store.detail(noteId)!.document.sketch.strokes.at(-1)!.points.length === 1);
  await pen.detach();
  // Portrait and tablet layouts: the tool strip moves below the sheet on narrow screens.
  await page.setViewportSize({ width: 600, height: 900 }); await page.waitForTimeout(300); await page.screenshot({ path: join(evidence, 'sheet-portrait.png') });
  const tools = sheetDialog.getByRole('group', { name: 'Zeichenwerkzeuge', exact: true }); const toolsBox = (await tools.boundingBox())!; const portraitCanvas = (await canvas.boundingBox())!;
  check('narrow screens put the tools below the sheet with every tool reachable', toolsBox.y >= portraitCanvas.y + portraitCanvas.height - 1 && toolsBox.width > toolsBox.height
    && await page.getByRole('button', { name: 'Weitere Optionen', exact: true }).isVisible() && ((await page.getByRole('button', { name: 'Weitere Optionen', exact: true }).boundingBox())?.x ?? 999) + 40 <= 600);
  await page.setViewportSize({ width: 1024, height: 768 }); await page.waitForTimeout(300); await page.screenshot({ path: join(evidence, 'sheet-tablet.png') });
  await page.setViewportSize({ width: 1400, height: 900 }); await page.waitForTimeout(300);
  await canvas.focus(); await page.keyboard.press('Escape'); await sheetDialog.waitFor({ state: 'hidden' });
  check('Escape closes the sheet and returns focus to Draw', await draw.evaluate(node => node === document.activeElement));
  check('the note shows the sketch as a preview', await page.getByRole('button', { name: /^Skizze öffnen: 4 Linien$/ }).isVisible());
  // A pen touching the preview opens the sheet and that same stroke continues on it (§7, Phase 3).
  const preview = page.getByRole('button', { name: /^Skizze öffnen/ }); await preview.scrollIntoViewIfNeeded(); const previewBox = (await preview.boundingBox())!;
  const pen2 = await context.newCDPSession(page); const start = { x: previewBox.x + previewBox.width * .3, y: previewBox.y + previewBox.height * .3 };
  await pen2.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: .5 });
  await sheetDialog.waitFor(); await page.waitForTimeout(150);
  await pen2.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x + 160, y: start.y + 20, button: 'left', buttons: 1, pointerType: 'pen', force: .7 });
  await pen2.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x + 260, y: start.y + 60, button: 'left', buttons: 1, pointerType: 'pen', force: .7 });
  await pen2.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: start.x + 260, y: start.y + 60, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' });
  await waitFor(() => strokes() === 5, 'handed-over stroke saved');
  const carried = fixture.organizer.store.detail(noteId)!.document.sketch.strokes.at(-1)!;
  check('a pen touching the preview opens the sheet and keeps drawing the same stroke', await sheetDialog.isVisible() && carried.points.length >= 2 && carried.points[0]!.x < carried.points.at(-1)!.x);
  await pen2.detach(); await page.keyboard.press('Escape'); await sheetDialog.waitFor({ state: 'hidden' });
  const photo = new PNG({ width: 12, height: 10 }); photo.data.fill(220);
  await page.getByLabel('Foto auswählen', { exact: true }).setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG.sync.write(photo) });
  await waitFor(() => fixture.organizer.store.detail(noteId)?.document.images.length === 1, 'photo saved');
  // Diagnostics on the tablet (Settings → Diagnose): a scoped, redacted view of the PC's CLI checks.
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  const settingsDialog = page.getByRole('dialog', { name: 'Einstellungen', exact: true }); const diagnostics = settingsDialog.getByRole('region', { name: 'Diagnose', exact: true });
  await diagnostics.getByText('„CLI-Diagnose ausführen“ für dieses Gerät aktivieren', { exact: false }).waitFor();
  check('without the grant the tablet explains where to enable diagnostics instead of offering a button', !await diagnostics.getByRole('button', { name: 'Diagnose ausführen', exact: true }).isVisible());
  await page.keyboard.press('Escape'); await settingsDialog.waitFor({ state: 'hidden' });
  fixture.devices.setAdminScopes(device, ['organizer:read', 'organizer:write', 'diagnostics:read'], { mode: 'all' });
  fixture.diagnostics.result = { checkedAt: Date.now(), platform: 'win32', items: [{ agentId: 'diag-agent', agentName: 'Fixture agent', runtime: 'codex', label: 'Codex CLI', executionBackend: 'native', command: 'codex', installed: true,
    version: '0.42.0', authStatus: 'authenticated', authDetail: 'Logged in; config at C:\\Users\\adi\\.codex', taskTransport: 'argument', status: 'ready', message: 'Ready to take tasks' }] };
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await diagnostics.getByRole('button', { name: 'Diagnose ausführen', exact: true }).click();
  await diagnostics.getByText('1 von 1', { exact: false }).waitFor();
  const report = await diagnostics.textContent() ?? '';
  check('the granted tablet runs the PC diagnostics and shows the redacted report', report.includes('Fixture agent') && report.includes('0.42.0') && report.includes('[path]') && !report.includes('Users') && fixture.diagnostics.calls.length === 1);
  check('the run-again control replaces the first-run label', await diagnostics.getByRole('button', { name: 'Erneut ausführen', exact: true }).isVisible());
  await diagnostics.scrollIntoViewIfNeeded(); await page.screenshot({ path: join(evidence, 'tablet-diagnostics.png') });
  await page.keyboard.press('Escape'); await settingsDialog.waitFor({ state: 'hidden' });
  check('photo is normalized and remains a selectable sketch background', await page.getByLabel('Foto zum Markieren', { exact: true }).inputValue() === fixture.organizer.store.detail(noteId)?.document.images[0]?.id);
  for (const [button, extension] of [['Text als Markdown', 'md'], ['Skizze als PNG', 'png'], ['Als PDF speichern', 'pdf']]) {
    const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: button!, exact: true }).click(); const download = await downloading;
    const file = join(evidence, `note.${extension}`); await download.saveAs(file); const bytes = readFileSync(file);
    check(`${extension} export downloads a real standalone artifact`, extension === 'md' ? bytes.toString('utf8').includes('Grösse prüfen') : extension === 'png' ? PNG.sync.read(bytes).width === 1600 : bytes.subarray(0, 5).toString() === '%PDF-' && bytes.length > 1000);
  }
  // PNG resolution is a device preference: the raster grows, the document does not.
  await page.getByRole('button', { name: 'Zeichnen', exact: true }).click(); await sheetDialog.waitFor();
  await page.getByRole('button', { name: 'Weitere Optionen', exact: true }).click(); await page.getByLabel('PNG-Auflösung', { exact: true }).selectOption('2');
  await page.keyboard.press('Escape'); await page.waitForTimeout(100); await page.keyboard.press('Escape'); await sheetDialog.waitFor({ state: 'hidden' });
  const downloadingLarge = page.waitForEvent('download'); await page.getByRole('button', { name: 'Skizze als PNG', exact: true }).click(); const largeDownload = await downloadingLarge;
  const largeFile = join(evidence, 'note-2x.png'); await largeDownload.saveAs(largeFile);
  check('PNG export follows the chosen resolution without changing the sheet', PNG.sync.read(readFileSync(largeFile)).width === 3200 && fixture.organizer.store.detail(noteId)!.document.sketch.width === 1600);
  await page.reload(); await page.getByRole('button', { name: /Idee für morgen/ }).click(); await page.getByRole('img', { name: 'foto.png' }).waitFor();
  check('reopened note retains editable text, image and drawing', await body.inputValue() === 'Grösse prüfen – mit Stift skizzieren.' && await page.getByRole('img', { name: 'foto.png' }).isVisible());
  await context.setOffline(true); await page.getByRole('status').filter({ hasText: /^Offline$/ }).waitFor();
  await body.fill('Unterwegs ergänzt'); await page.getByRole('button', { name: 'Zur Liste', exact: true }).click();
  await page.getByRole('button', { name: /Idee für morgen/ }).click();
  check('offline edit survives leaving and reopening the editor', await body.inputValue() === 'Unterwegs ergänzt');
  const hostNote = fixture.organizer.store.detail(noteId)!;
  fixture.organizer.command({ operation: 'put', writerId: randomUUID(), sequence: 1, baseRevision: hostNote.revision, document: { ...hostNote.document, text: 'Gleichzeitig am PC ergänzt' } }, 'desktop');
  await context.setOffline(false); await page.getByRole('button', { name: /Erneut verbinden/ }).click();
  await waitFor(() => fixture.organizer.store.index().entries.some(item => item.conflictOf === noteId), 'offline conflict copy');
  check('reconnection preserves both PC and tablet edits', fixture.organizer.store.detail(noteId)?.document.text === 'Gleichzeitig am PC ergänzt'
    && fixture.organizer.store.index().entries.some(item => fixture.organizer.store.detail(item.id)?.document.text === 'Unterwegs ergänzt'));
  await page.getByRole('button', { name: 'Aufgabe daraus erstellen', exact: true }).click();
  await page.getByRole('heading', { name: 'Aufgaben', exact: true }).waitFor();
  await page.getByLabel('Titel', { exact: true }).fill('Modell prüfen');
  await page.getByRole('button', { name: 'Checklistenpunkt hinzufügen', exact: true }).click();
  await page.getByRole('textbox', { name: 'Checklistenpunkt', exact: true }).fill('Masse kontrollieren');
  await page.getByLabel('Fällig am', { exact: true }).fill('2026-01-01T10:00');
  await page.getByLabel('Erinnerung', { exact: true }).fill('2026-01-01T09:00');
  await waitFor(() => fixture.organizer.store.index().entries.some(item => item.title === 'Modell prüfen' && item.reminderAt !== null), 'task saved');
  check('note converts to a personal task without starting a run', fixture.organizer.store.index().entries.some(item => item.kind === 'task') && fixture.sessions.length === 0 && !!fixture.organizer.store.detail(noteId));
  await page.getByRole('button', { name: 'Erinnerung bestätigen', exact: true }).click();
  await page.getByRole('button', { name: 'Als erledigt markieren', exact: true }).click();
  await page.getByRole('button', { name: 'Zur Liste', exact: true }).click(); await page.getByRole('button', { name: 'Erledigt', exact: true }).click();
  check('completed tasks remain reachable through the explicit filter', await page.getByRole('button', { name: /Modell prüfen/ }).isVisible());
  for (const viewport of [{ width: 1400, height: 900 }, { width: 800, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport); await page.screenshot({ path: join(evidence, `tasks-${viewport.width}.png`) });
    check(`navigation and task list fit viewport ${viewport.width}`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await page.setViewportSize({ width: 1400, height: 900 }); await page.getByRole('button', { name: /Modell prüfen/ }).click();
  await page.getByRole('button', { name: 'An Agenten übergeben', exact: true }).click();
  const dispatch = page.getByRole('dialog', { name: 'Aufgabe an Agenten übergeben', exact: true }); await dispatch.waitFor();
  check('agent handoff is an explicit focused review of project, agent and prompt', await dispatch.evaluate(node => node.contains(document.activeElement))
    && (await dispatch.getByLabel('Auftragstext', { exact: true }).inputValue()).includes('Masse kontrollieren'));
  proxy.loseTaskReplies(true); await dispatch.getByRole('button', { name: 'Auftrag starten', exact: true }).click(); await dispatch.getByRole('alert').waitFor();
  await waitFor(() => fixture.sessions.length === 1, 'one admitted task');
  await dispatch.getByRole('button', { name: 'Schliessen', exact: true }).click(); proxy.loseTaskReplies(false);
  await page.getByRole('button', { name: 'An Agenten übergeben', exact: true }).click();
  await dispatch.getByRole('button', { name: 'Übergabe erneut prüfen', exact: true }).click(); await dispatch.waitFor({ state: 'hidden' });
  check('lost handoff reply reopens and replays exactly one agent run', fixture.sessions.length === 1 && await page.getByRole('button', { name: 'Auftrag 1 öffnen', exact: true }).isVisible());
  await waitFor(() => fixture.organizer.store.index().entries.some(item => item.title === 'Modell prüfen' && fixture.organizer.store.detail(item.id)!.document.runIds.length === 1), 'durable run link');
  check('agent handoff keeps task completion independent', fixture.organizer.store.index().entries.find(item => item.title === 'Modell prüfen')?.done === true);
  await page.getByRole('button', { name: 'Auftrag 1 öffnen', exact: true }).click();
  check('confirmed task link opens the corresponding Graph', await page.getByRole('tab', { name: 'Graph', exact: true }).getAttribute('aria-selected') === 'true');
  const savedDocuments = fixture.organizer.store.index().entries.length;
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.getByRole('button', { name: 'Dieses Gerät lokal trennen', exact: true }).click();
  await page.getByRole('heading', { name: 'Mit deinem PC verbinden', exact: true }).waitFor();
  await page.waitForFunction(async scope => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('ade-organizer-v1', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try { return await new Promise<boolean>((resolve, reject) => { const request = db.transaction('profiles').objectStore('profiles').get(scope); request.onsuccess = () => resolve(JSON.stringify(request.result) === '{"forgotten":true}'); request.onerror = () => reject(request.error); }); } finally { db.close(); }
  }, `mobile:${device}`);
  check('local disconnect removes private drafts while retaining PC documents', fixture.organizer.store.index().entries.length === savedDocuments && fixture.devices.activeDevices().length === 1);
  await page.reload(); await page.getByRole('heading', { name: 'Mit deinem PC verbinden', exact: true }).waitFor();
  check('reload after disconnect cannot reopen the previous personal collection', !await page.getByRole('tab', { name: 'Notizen', exact: true }).count());
  check('no renderer exceptions in personal organizer flow', errors.length === 0);
})().catch(async error => { failed++; console.error(error); await page?.screenshot({ path: join(evidence, 'failure.png') }).catch(() => undefined); }).finally(async () => {
  await browser?.close(); sessions?.dispose(); await server?.stop(); await proxy?.close();
  if (dirname(root) !== realpathSync.native(tmpdir())) throw new Error('Unexpected test root'); rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  console.log(`Organizer browser: ${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
});
