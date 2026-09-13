import { resolve } from 'node:path';
import { DEFAULT_CONFIG, type AdeConfig } from '../src/shared/types';
import { validSpeechTarget, validSpeechSelection } from '../src/shared/speech';
import { SpeechService } from '../src/main/settings/SpeechService';
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
  console.log(`Speech preferences: ${passed} passed, 0 failed`);
})().catch(error => {console.error(error); console.log(`Speech preferences: ${passed} passed, 1 failed`);process.exitCode=1;});
