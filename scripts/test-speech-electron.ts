import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication } from 'playwright';
import { mainEntry } from './helpers/buildOutput';

let passed = 0; let app: ElectronApplication | undefined;
const check = (name: string, ok: boolean) => { if (!ok) throw new Error(name); passed++; console.log(`  ok ${name}`); };
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ade-speech-electron-')));
void (async () => {
  const launcher = join(root, 'launch.cjs'); const female = 'EXAVITQu4vr4xnSDxMaL'; const male = 'CwhRBWXzGAHq8TQ4Fs17';
  writeFileSync(launcher, `const fs = require('node:fs'); const original = global.fetch;
global.fetch = async (url, init) => {
  if (!String(url).startsWith('https://api.elevenlabs.io/')) return original(url, init);
  if (fs.existsSync(${JSON.stringify(join(root, 'reject'))})) return new Response('private-key-value', {status: 401});
  if (String(url).endsWith('/voices')) return Response.json({ voices: [
    {voice_id:'${male}',name:'Roger',labels:{gender:'male'}}, {voice_id:'${female}',name:'Sarah',labels:{gender:'female'}}] });
  fs.writeFileSync(${JSON.stringify(join(root, 'request.json'))}, init.body);
  return new Response(fs.readFileSync(${JSON.stringify(resolve('scripts/fixtures/speech-silence.mp3'))}), {headers:{'content-type':'audio/mpeg'}});
};
require(${JSON.stringify(resolve('scripts/fixtures/dialogue-speech.cjs'))}).install();
require(${JSON.stringify(mainEntry())});`);
  app = await electron.launch({ executablePath: require('electron') as string, args: [launcher], env: { ...process.env, ADE_USER_DATA_DIR: join(root, 'profile'), ADE_HOST_API_ENABLED: '0', NODE_ENV: 'test' } });
  const page = await app.firstWindow(); page.setDefaultTimeout(20000);
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).focus();
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  const topics = page.getByRole('navigation', { name: 'Einstellungsbereiche', exact: true });
  const firstTopic = topics.getByRole('button', { name: 'Allgemein', exact: true });
  const voiceTopic = topics.getByRole('button', { name: 'Stimme', exact: true });
  await firstTopic.waitFor();
  check('settings open as a wide dialog with focus on the first topic', await firstTopic.evaluate(node => node === document.activeElement)
    && ((await page.getByRole('dialog', { name: 'Einstellungen', exact: true }).boundingBox())?.width ?? 0) >= 720);
  check('the topic navigation lists every topic in order', (await topics.getByRole('button').allTextContents()).map(text => text.trim()).join(',') === 'Allgemein,Betrieb und Start,Tablet und Geräte,Projekte,Harnesses und Schlüssel,Stimme');
  await page.keyboard.press('End');
  check('End moves to the last topic', await voiceTopic.evaluate(node => node === document.activeElement));
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  check('arrow keys move through the topics', await topics.getByRole('button', { name: 'Betrieb und Start', exact: true }).evaluate(node => node === document.activeElement));
  await voiceTopic.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement?.textContent === 'Stimme' && document.activeElement.tagName === 'H3');
  await page.waitForFunction(() => [...document.querySelectorAll('[aria-label="Einstellungsbereiche"] button')].find(node => node.textContent === 'Stimme')?.getAttribute('aria-current') === 'true');
  check('Enter on a topic scrolls to it, focuses its heading and marks it current', true);
  await firstTopic.focus();
  await page.keyboard.press('Shift+Tab');
  check('reverse Tab from the first topic stays inside the modal', await page.getByRole('button', { name: 'Schließen', exact: true }).evaluate(node => node === document.activeElement));
  await page.keyboard.press('Tab');
  check('modal Tab wraps back to the first topic', await firstTopic.evaluate(node => node === document.activeElement));
  const section = page.getByRole('region', { name: 'Sprachausgabe', exact: true });
  await section.getByRole('button', { name: 'Stimmen laden', exact: true }).click();
  await section.getByRole('alert').filter({ hasText: 'ElevenLabs-Key fehlt' }).waitFor();
  check('missing-key state explains configuration without crashing settings', true);
  await page.evaluate(() => window.ade.invoke('harness:setServiceKey', { name: 'ELEVENLABS_API_KEY', value: 'private-key-value', scope: 'all' }));
  await section.getByRole('button', { name: 'Stimmen laden', exact: true }).click();
  await section.getByLabel('Stimme', { exact: true }).waitFor();
  check('voice selector defaults to female on a clean profile', await section.getByLabel('Stimme', { exact: true }).inputValue() === '');
  await section.getByLabel('Stimme', { exact: true }).selectOption(male);
  await section.getByText('Stimmenauswahl gespeichert.', { exact: true }).waitFor();
  check('selection persists through main IPC', (await page.evaluate(() => window.ade.invoke('config:get'))).settings.speechVoiceId === male);
  await section.getByLabel('Stimme', { exact: true }).selectOption(female);
  await section.getByRole('button', { name: 'Stimme testen', exact: true }).focus();
  await page.keyboard.press('Enter');
  await section.getByText('Stimmtest vollständig abgespielt.', { exact: true }).waitFor();
  check('sandboxed renderer plays the valid MP3 through production CSP', await section.locator('audio').evaluate(node => (node as HTMLAudioElement).ended && (node as HTMLAudioElement).duration > 0));
  check('fixed text reaches provider and key stays out of renderer', JSON.parse(readFileSync(join(root, 'request.json'), 'utf8')).language_code === 'de' && !(await page.content()).includes('private-key-value'));
  await section.getByRole('button', { name: 'Wiedergabe stoppen', exact: true }).click();
  check('stop resets audio position', await section.locator('audio').evaluate(node => (node as HTMLAudioElement).paused && (node as HTMLAudioElement).currentTime === 0));
  writeFileSync(join(root, 'reject'), '1');
  await section.getByRole('button', { name: 'Stimme testen', exact: true }).click();
  await section.getByRole('alert').filter({ hasText: 'ElevenLabs-Sprachausgabe unterbrochen' }).waitFor();
  check('provider permission error is useful and credential-free', !(await section.innerText()).includes('private-key-value'));
  await page.setViewportSize({ width: 960, height: 650 });
  check('speech settings fit narrow desktop without horizontal overflow', await section.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
  mkdirSync(resolve('test-results/speech'), { recursive: true });
  await page.screenshot({ path: resolve('test-results/speech/settings.png') });
  await section.getByRole('button', { name: 'Stimme testen', exact: true }).focus();
  await page.keyboard.press('Escape');
  await section.waitFor({ state: 'hidden' });
  check('closing settings restores opener focus', await page.getByRole('button', { name: 'Einstellungen', exact: true }).evaluate(node => node === document.activeElement));
  unlinkSync(join(root, 'reject'));
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await voiceTopic.click();
  await section.getByRole('button', { name: 'Stimmen laden', exact: true }).click();
  check('female voice survives closing settings', await section.getByLabel('Stimme', { exact: true }).inputValue() === female);
  check('computer stability default appears in the settings', await section.getByRole('slider', { name: 'Stabilität', exact: true }).inputValue() === '0.9');
  check('model is visible without pronunciation notes or unsupported controls', (await section.innerText()).includes('Eleven v3') && !(await section.innerText()).includes('Aussprachevorgabe') && await section.getByRole('slider').count() === 1);
  await section.getByRole('slider', { name: 'Stabilität', exact: true }).fill('0.6');

  await section.getByRole('button', { name: 'Stimme testen', exact: true }).click();
  await section.getByText('Stimmtest vollständig abgespielt.', { exact: true }).waitFor();
  const preview = JSON.parse(readFileSync(join(root, 'request.json'), 'utf8')).voice_settings;
  check('unsaved voice preview uses native provider parameters', preview.stability === 0.6 && Object.keys(preview).join() === 'stability');
  check('preview does not save parameters', !(await page.evaluate(() => window.ade.invoke('config:get'))).settings.speechTuning);
  await section.getByRole('button', { name: 'Parameter speichern', exact: true }).click();
  await section.getByText('Stimmparameter gespeichert. Gilt auf PC und Tablet.', { exact: true }).waitFor();
  await page.evaluate(() => window.ade.invoke('speech:test', { voiceId: 'EXAVITQu4vr4xnSDxMaL', preset: 'computer-greeting' }));
  check('Computer greeting uses the saved stability', JSON.parse(readFileSync(join(root, 'request.json'), 'utf8')).voice_settings.stability === 0.6);
  await page.getByRole('button', { name: 'Schließen', exact: true }).click(); await section.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await voiceTopic.click();
  await section.getByRole('button', { name: 'Stimmen laden', exact: true }).click();
  check('saved stability survives reopening settings', await section.getByRole('slider', { name: 'Stabilität', exact: true }).inputValue() === '0.6');
  await section.getByRole('button', { name: 'Ruhiger Computer', exact: true }).click();
  check('preset is a reversible draft', await section.getByRole('slider', { name: 'Stabilität', exact: true }).inputValue() === '0.9' && (await page.evaluate(() => window.ade.invoke('config:get'))).settings.speechTuning?.stability === 0.6);
  await section.getByRole('button', { name: 'Änderungen verwerfen', exact: true }).click();
  check('discard restores saved parameters', await section.getByRole('slider', { name: 'Stabilität', exact: true }).inputValue() === '0.6');
  await page.setViewportSize({ width: 960, height: 650 });
  check('voice topic with tuning fits narrow desktop', await section.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
  await page.screenshot({ path: resolve('test-results/speech/voice-tab.png') });

  // Conversations sit in the title bar navigation, after the rooms; the studio head switches the default voice and speaks it.
  await page.getByRole('button', { name: 'Schließen', exact: true }).click(); await section.waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 1280, height: 800 });
  const conversations = page.locator('#desktop-supervision');
  const [entryBox, graphBox] = [await conversations.boundingBox(), await page.getByRole('tab', { name: 'Graph', exact: true }).boundingBox()];
  check('desktop conversations entry sits in the title bar navigation after the rooms', await page.locator('.titlebar .appnav #desktop-supervision').count() === 1
    && !!entryBox && !!graphBox && Math.abs(entryBox.y - graphBox.y) < 4 && entryBox.x > graphBox.x && await conversations.getAttribute('aria-haspopup') === 'dialog'
    && await page.locator('.titlebar-session #desktop-supervision').count() === 0);
  await conversations.click(); await page.locator('#conversation-mode-casual').click();
  const casual = page.getByRole('dialog', { name: 'Plaudern & Stimme', exact: true });
  const studio = casual.getByRole('region', { name: 'Stimmenstudio', exact: true });
  const picker = studio.getByLabel('Standardstimme', { exact: true }); await picker.waitFor();
  check('desktop studio head shows the saved default voice', await picker.inputValue() === female);
  await studio.getByRole('group', { name: 'Beispielsätze', exact: true }).getByRole('button', { name: 'Geschichte', exact: true }).click();
  await picker.selectOption(male);
  await studio.getByText('Roger ist jetzt die Standardstimme', { exact: false }).waitFor();
  const defaultPreview = studio.getByLabel('Hörprobe der Standardstimme', { exact: true });
  const played = await defaultPreview.evaluate(node => new Promise<boolean>(done => { const audio = node as HTMLAudioElement; if (audio.ended || !audio.paused) done(true); else { audio.addEventListener('play', () => done(true), { once: true }); setTimeout(() => done(false), 15_000); } }));
  check('the new default voice plays by itself', played);
  const spoken = JSON.parse(readFileSync(join(root, 'request.json'), 'utf8'));
  const saved = (await page.evaluate(() => window.ade.invoke('config:get'))).settings;
  check('desktop head switch saves the default and keeps the saved delivery', saved.speechVoiceId === male && saved.speechTuning?.stability === 0.6);
  check('desktop default preview speaks the chosen sentence with v3 and the saved stability', spoken.model_id === 'eleven_v3' && String(spoken.text).startsWith('Es war einmal') && spoken.voice_settings.stability === 0.6);
  await page.screenshot({ path: resolve('test-results/speech/voice-studio.png') });
  // Saving disables the focused chip, and the browser then drops focus to
  // <body> — at random, so force it: the dialog must stay keyboard-reachable.
  const strand = () => page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); return document.activeElement === document.body; });
  const stranded = await strand();
  await page.keyboard.press('Tab');
  check('Tab from a stranded <body> returns focus into the open dialog', stranded
    && await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')));
  const strandedAgain = await strand();
  await page.keyboard.press('Escape');
  check('Escape closes the dialog even after focus fell to <body>', strandedAgain
    && await casual.waitFor({ state: 'hidden', timeout: 5_000 }).then(() => true, () => false));
  await casual.waitFor({ state: 'hidden' });
  check('closing the studio returns focus to the conversations entry', await conversations.evaluate(node => node === document.activeElement));
  console.log(`Speech Electron: ${passed} passed, 0 failed`);
})().catch(error => { console.error(error); console.log(`Speech Electron: ${passed} passed, 1 failed`); process.exitCode = 1; })
  .finally(async () => { await app?.close(); if (dirname(root) !== realpathSync.native(tmpdir())) throw new Error('Unexpected speech fixture path'); rmSync(root, { recursive: true, force: true }); });
