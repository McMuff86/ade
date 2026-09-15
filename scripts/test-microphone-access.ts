import { MicrophoneAccess } from '../src/main/settings/MicrophoneAccess';

let passed = 0;
function check(name: string, ok: boolean) { if (!ok) throw new Error(name); passed++; console.log(`  ok ${name}`); }
try {
  let now = 1000; let trusted = true;
  const access = new MicrophoneAccess((id, url) => trusted && id === 1 && url === 'file:///ade/index.html', () => now);
  const details = { isMainFrame: true, requestingUrl: 'file:///ade/index.html', mediaType: 'audio' };
  check('microphone is denied before user opens recording', !access.allows(1, 'media', details));
  access.grant(1);
  check('explicit window action permits audio permission check', access.allows(1, 'media', details));
  check('explicit window action permits audio-only request', access.allows(1, 'media', { ...details, mediaType: undefined, mediaTypes: ['audio'] }));
  check('camera is denied', !access.allows(1, 'media', { ...details, mediaType: 'video' }));
  check('combined microphone and camera are denied', !access.allows(1, 'media', { ...details, mediaType: undefined, mediaTypes: ['audio', 'video'] }));
  check('conflicting permission descriptions cannot allow video', !access.allows(1, 'media', { ...details, mediaTypes: ['audio', 'video'] }));
  check('unknown media is denied', !access.allows(1, 'media', { ...details, mediaType: 'unknown' }));
  check('subframe recording is denied', !access.allows(1, 'media', { ...details, isMainFrame: false }));
  check('another window cannot use recording permission', !access.allows(2, 'media', details));
  check('foreign URL in same window is denied', !access.allows(1, 'media', { ...details, requestingUrl: 'https://example.invalid/' }));
  check('screen capture and unrelated permissions stay denied', !access.allows(1, 'display-capture', details) && !access.allows(1, 'clipboard-read', details));
  trusted = false; check('unregistered renderer loses permission immediately', !access.allows(1, 'media', details)); trusted = true;
  now += 30_000; check('unused microphone permission expires', !access.allows(1, 'media', details));
  access.grant(1); access.revoke(1); check('cancellation revokes microphone permit', !access.allows(1, 'media', details));
  access.grant(1); check('final positive permission works after negative controls', access.allows(1, 'media', details));
  console.log(`Microphone access: ${passed} passed, 0 failed`);
} catch (error) { console.error(error); console.log(`Microphone access: ${passed} passed, 1 failed`); process.exitCode = 1; }
