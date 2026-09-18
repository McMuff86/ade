import { resolve } from 'node:path';
import { DEFAULT_CONFIG, type AdeConfig } from '../src/shared/types';
import { DEFAULT_SPEECH_TUNING, validSpeechTuning, validSpeechTarget, validSpeechSelection, type SpeechTuning } from '../src/shared/speech';
import { assertIpcPayload } from '../src/main/ipcValidation';
import { FixtureSpeechService as SpeechService } from './helpers/speechSocket';
import { SpeechPreferences } from '../src/main/settings/SpeechPreferences';
import { RemoteSpeechService, validSpeechQuery, validSpeechCommand } from '../src/main/application/RemoteSpeechService';
import { validateCompleteConfig } from '../src/main/config/store';

let passed = 0;
const check = (name: string, ok: boolean) => { if (!ok) throw new Error(name); passed++; console.log(`  ok ${name}`); };
async function refuses(name: string, action: () => unknown) { try { await action(); } catch { check(name, true); return; } throw new Error(name); }
void (async () => {
  const female = 'femaleVoice0000000001'; const projectVoice = 'projectVoice000000001'; const agentVoice = 'agentVoice00000000001';
  const path = resolve('test-results/speech-preferences');
  let config: AdeConfig = { ...structuredClone(DEFAULT_CONFIG), categories: [{id:'category',name:'Team',agents:['agent']}],
    agents: [{id:'agent',categoryId:'category',name:'Designer',role:'CAD',runtime:'codex',permissionMode:'default',workspaceDir:path,memoryDir:path}],
    repositories: [{id:'project',name:'Layout',rootPath:path,commonGitDir:resolve(path,'.git'),executionBackend:'native',verified:true,createdAt:1}] };
  const store = { get: () => config, save: (value: Partial<AdeConfig>) => { config = {...config,...value}; } };
  let omitAgent = false; let generations = 0;
  const engine = new SpeechService(store, () => 'fixture-key', async url => String(url).endsWith('/voices')
    ? Response.json({voices: [female,projectVoice,...omitAgent ? [] : [agentVoice]].map((id,index) => ({voice_id:id,name:id,labels:{gender:index ? 'male' : 'female'}}))})
    : (++generations, new Response(new Uint8Array(512), {headers:{'content-type':'audio/mpeg'}})));
  const prefs = new SpeechPreferences(store, engine); const context = {kind:'agent' as const,agentId:'agent',repositoryId:'project'};
  check('legacy profile uses available female voice', (await prefs.query(context)).effectiveVoiceId === female);
  await prefs.select({target:{kind:'project',repositoryId:'project'},voiceId:projectVoice});
  check('agent inherits explicit project voice', (await prefs.query(context)).effectiveVoiceId === projectVoice && (await prefs.query(context)).source === 'project');
  await prefs.select({target:context,voiceId:agentVoice});
  check('explicit agent voice overrides project', (await prefs.query(context)).effectiveVoiceId === agentVoice && (await prefs.query(context)).source === 'agent');
  await prefs.select({target:{kind:'default'},voiceId:female});
  check('changing global voice preserves specific overrides', (await prefs.query(context)).effectiveVoiceId === agentVoice);
  await prefs.select({target:context,voiceId:null});
  check('resetting agent restores project inheritance', (await prefs.query(context)).selectedVoiceId === null && (await prefs.query(context)).effectiveVoiceId === projectVoice);
  check('agent outside project inherits global voice', (await prefs.query({kind:'agent',agentId:'agent'})).effectiveVoiceId === female);
  const before = JSON.stringify(config);
  await refuses('revocation before save prevents metadata change', () => prefs.select({target:context,voiceId:agentVoice}, () => {throw new Error('revoked');}));
  check('rejected save leaves complete configuration untouched', JSON.stringify(config) === before);
  await refuses('unknown agent is rejected', () => prefs.query({kind:'agent',agentId:'missing'}));
  await refuses('unknown project is rejected', () => prefs.select({target:{kind:'project',repositoryId:'missing'},voiceId:null}));
  await refuses('unavailable voice is rejected before save', () => prefs.select({target:context,voiceId:'missingVoice000000001'}));
  await prefs.select({target:context,voiceId:agentVoice}); omitAgent = true;
  const unavailable = await prefs.query(context,true);
  check('missing saved voice is not silently substituted', unavailable.effectiveVoiceId === agentVoice && !unavailable.voices.some(v => v.id === agentVoice));
  await prefs.select({target:context,voiceId:null});
  validateCompleteConfig(config); check('new preferences pass complete config validation without changing role or runtime', config.agents[0]!.role === 'CAD' && config.agents[0]!.runtime === 'codex');
  check('fresh preference service resolves persisted project selection', (await new SpeechPreferences(store,engine).query(context)).effectiveVoiceId === projectVoice);
  check('targets reject injected paths and prototype properties', !validSpeechTarget({kind:'default',path:'/tmp'}) && !validSpeechTarget(Object.create({kind:'agent',agentId:'agent'})));
  check('selection rejects arbitrary text and extra fields', !validSpeechSelection({target:context,voiceId:female,text:'arbitrary'}));
  check('wire commands reject arbitrary text and malformed IDs', !validSpeechCommand({operation:'test',target:context,voiceId:female,text:'arbitrary'}) && !validSpeechQuery({operation:'audio',testId:'../file'}));
  let now = 1; const remote = new RemoteSpeechService(prefs,engine,() => now);
  const result = await remote.test('tablet',context,female,() => undefined);
  check('test receipt carries only an opaque ID', Object.keys(result).join(',') === 'testId' && generations === 1);
  check('owner can retrieve bounded audio', remote.read('tablet',result.testId,() => undefined).base64.length < 1024);
  await refuses('another device cannot read test audio', () => remote.read('other',result.testId,() => undefined));
  await refuses('removed resource grant blocks existing audio', () => remote.read('tablet',result.testId,() => {throw new Error('revoked');}));
  now += 600_001; await refuses('expired audio cannot trigger another generation', () => remote.read('tablet',result.testId,() => undefined));
  check('expired or denied retrieval consumes no extra provider requests', generations === 1);
  const standard = { kind: 'default' as const };
  check('legacy settings get the slower shared computer default', (await prefs.query(standard)).tuning.speed === 0.85);
  const tuning: SpeechTuning = { speed: 0.8, stability: 0.6, similarityBoost: 0.7, style: 0.2, speakerBoost: false };
  assertIpcPayload('speech:configure', { target: standard, voiceId: female, tuning });
  assertIpcPayload('speech:test', { voiceId: female, tuning });
  await prefs.select({ target: standard, voiceId: female, tuning });
  tuning.speed = 1;
  check('preferences persist a detached snapshot of native tuning', config.settings.speechTuning?.speed === 0.8);
  check('all voice targets observe the same saved global delivery', (await prefs.query(context)).tuning.speed === 0.8 && (await new SpeechPreferences(store, engine).query(standard)).tuning.style === 0.2);
  await prefs.select({ target: standard, voiceId: projectVoice });
  check('voice-only selection preserves saved tuning', config.settings.speechTuning?.speed === 0.8);
  const saved = JSON.stringify(config);
  await refuses('a selected agent cannot change global parameters', () => prefs.select({ target: context, voiceId: female, tuning }));
  await refuses('revoked tuning mutation is rejected before save', () => prefs.select({ target: standard, voiceId: female, tuning }, () => { throw Error('revoked'); }));
  check('rejected tuning writes preserve the complete configuration', JSON.stringify(config) === saved);
  for (const malformed of [null, {}, { ...tuning, speed: 0.69 }, { ...tuning, speed: 1.21 }, { ...tuning, speed: NaN }, { ...tuning, stability: Infinity },
    { ...tuning, style: -0.01 }, { ...tuning, similarityBoost: 1.01 }, { ...tuning, speakerBoost: 'true' }, { ...tuning, pitch: 2 }]) {
    check('native tuning rejects malformed, unsupported or out-of-range settings', !validSpeechTuning(malformed));
    await refuses('IPC rejects invalid preview tuning', () => assertIpcPayload('speech:test', { voiceId: female, tuning: malformed }));
    check('signed command validator rejects invalid tuning', !validSpeechCommand({ operation: 'select', target: standard, voiceId: female, tuning: malformed }));
  }
  await refuses('greeting cannot override saved delivery', () => assertIpcPayload('speech:test', { voiceId: female, preset: 'computer-greeting', tuning }));
  check('native tuning accepts exact provider boundaries', validSpeechTuning({ ...tuning, speed: 0.7, stability: 0, style: 1 }) && validSpeechTuning({ ...tuning, speed: 1.2, stability: 1, similarityBoost: 0 }));
  validateCompleteConfig(config);
  await refuses('complete config validation rejects invalid persisted tuning', () => validateCompleteConfig({ ...config, settings: { ...config.settings, speechTuning: { ...tuning, speed: 2 } } }));
  let request: { voice_settings?: Record<string, unknown> } = {};
  const previewEngine = new SpeechService(store, () => 'fixture-key', async (url, init) => {
    if (String(url).endsWith('/voices')) return Response.json({ voices: [{ voice_id: female }] });
    request = JSON.parse(String(init?.body)); return new Response(new Uint8Array(512), { headers: { 'content-type': 'audio/mpeg' } });
  });
  await previewEngine.test(female, undefined, undefined, 'voice-check', { ...DEFAULT_SPEECH_TUNING, speed: 0.73 });
  check('unsaved preview sends exact native fields without persisting', request.voice_settings?.stability === 0.9 && Object.keys(request.voice_settings).join() === 'stability' && JSON.stringify(config) === saved);
  await previewEngine.test(female, undefined, undefined, 'computer-greeting');
  check('final greeting uses stored delivery after unsaved preview', request.voice_settings?.stability === 0.6 && Object.keys(request.voice_settings).join() === 'stability');
  console.log(`Speech preferences: ${passed} passed, 0 failed`);
})().catch(error => {console.error(error); console.log(`Speech preferences: ${passed} passed, 1 failed`);process.exitCode=1;});
