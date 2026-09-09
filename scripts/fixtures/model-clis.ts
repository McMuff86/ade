import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const MODEL_FIXTURE_CATALOG = {
  codex: [
    { id: 'gpt-5.6-sol', model: 'gpt-5.6-sol', displayName: 'Codex fixture Sol', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'high' }, { reasoningEffort: 'xhigh' }], defaultReasoningEffort: 'high' },
    { id: 'codex-fixture-fast', model: 'codex-fixture-fast', displayName: 'Codex fixture Fast', supportedReasoningEfforts: [{ reasoningEffort: 'low' }], defaultReasoningEffort: 'low' },
  ],
  grok: ['grok-fixture-one', 'grok-fixture-two'],
  claude: [{ value: 'default', resolvedModel: 'claude-fixture-opus[1m]', displayName: 'Claude fixture Default' },
    { value: 'sonnet', resolvedModel: 'claude-fixture-sonnet', displayName: 'Claude fixture Sonnet' }],
  ollama: ['local-fixture:latest'],
};

/** Isolated CLI processes; a model inference or unexpected command fails the fixture. */
export function writeModelCliFixtures(root: string): { bin: string; state: string; events: string } {
  const bin = join(root, 'model-bin'); mkdirSync(bin, { recursive: true });
  const state = join(bin, 'models.json'); const events = join(bin, 'events.jsonl'); const script = join(bin, 'models.cjs');
  writeFileSync(state, JSON.stringify(MODEL_FIXTURE_CATALOG));
  writeFileSync(script, String.raw`
const fs=require('node:fs'); const readline=require('node:readline'); const path=require('node:path');
const runtime=process.argv[2]; const args=process.argv.slice(3);
const state=JSON.parse(fs.readFileSync(path.join(__dirname,'models.json'),'utf8'));
const event=(value)=>fs.appendFileSync(path.join(__dirname,'events.jsonl'),JSON.stringify({runtime,...value})+'\n');
const send=(value)=>process.stdout.write(JSON.stringify(value)+'\n');
event({args});
if(args.includes('--version')) { console.log('9.9.9 fixture'); process.exit(0); }
if(runtime==='codex' && args[0]==='login') { process.exit(state.signedOut?1:0); }
if(runtime==='claude' && args[0]==='auth') { if(args[1]==='login')console.log('CLAUDE_LOGIN_FIXTURE_OK');else send({loggedIn:!state.signedOut,authMethod:'claude.ai Subscription Fixture'});process.exit(0); }
if(state.failure) { console.error('provider rejected sk-fake-secret-not-for-renderer C:\\private\\credentials');process.exit(1); }
if(runtime==='grok' && args[0]==='models' && state.grokUnavailable)process.exit(1);
if(runtime==='grok') { if(args[0]!=='models'){console.log('GROK_KEY='+process.env.XAI_API_KEY);console.log('GROK_ARGS='+args.join(' '));process.exit(0);}console.log('Available models:'); for(const [i,m] of state.grok.entries())console.log('  '+(i?' - ':' * ')+m+(i?'':' (default)'));process.exit(0); }
if(runtime==='ollama') { console.log('NAME ID SIZE MODIFIED');for(const m of state.ollama)console.log(m+' abc 1 GB now');process.exit(0); }
if(runtime==='claude' && (!args.includes('--no-session-persistence')||!args.includes('--strict-mcp-config')||!args.includes('{"disableAllHooks":true}')))process.exit(91);
const rl=readline.createInterface({input:process.stdin}); let initialized=false;
rl.on('line',(line)=>{const msg=JSON.parse(line);event({method:msg.method||msg.type});
 if(state.hang)return;
 if(state.oversized){process.stdout.write('x'.repeat(1100000));return;}
 if(runtime==='claude') { if(msg.type!=='control_request'||msg.request.subtype!=='initialize')process.exit(92);
   send({type:'control_response',response:{request_id:msg.request_id,subtype:'success',response:{models:state.claude}}});return; }
 if(msg.method==='initialize'){initialized=true;send({id:msg.id,result:{}});return;}
 if(!initialized)process.exit(93);
 if(msg.method==='initialized')return;
 if(msg.method==='account/read'){send({id:msg.id,result:{requiresOpenaiAuth:true,account:state.signedOut?null:{type:'fixture'}}});return;}
 if(msg.method!=='model/list')process.exit(94);
 if(state.paginate && !msg.params.cursor)send({id:msg.id,result:{data:state.codex.slice(0,1),nextCursor:'next'}});
 else send({id:msg.id,result:{data:state.paginate?state.codex.slice(1):state.codex,nextCursor:state.repeatCursor?'next':null}});
});
`);
  const quote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;
  for (const runtime of ['codex', 'grok', 'claude', 'ollama']) {
    const file = join(bin, process.platform === 'win32' ? `${runtime}.cmd` : runtime);
    writeFileSync(file, process.platform === 'win32'
      ? `@echo off\r\n"${process.execPath}" "${script}" ${runtime} %*\r\n`
      : `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)} ${runtime} "$@"\n`);
    if (process.platform !== 'win32') chmodSync(file, 0o755);
  }
  return { bin, state, events };
}
