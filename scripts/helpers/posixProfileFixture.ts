import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Isolated executable doubles; production resolves them through its normal PATH.
 * Real PTYs and shell quoting, no provider/model request. */
export function posixProfileFixture(bin: string): void {
  mkdirSync(bin, { recursive: true });
  const file = join(bin, 'profile-fixture.cjs');
  writeFileSync(file, `
const fs = require('node:fs'); const path = require('node:path'); const crypto = require('node:crypto');
const cli = process.argv[2]; const args = process.argv.slice(3); const root = process.env.ADE_PROFILE_FIXTURE_PROOFS;
if (args.includes('--version')) { console.log(cli + ' fixture 1.0'); process.exit(0); }
if (cli === 'codex' && args[0] === 'app-server') {
  const reader = require('node:readline').createInterface({input:process.stdin});
  reader.on('line', line => { const message = JSON.parse(line);
    if (message.method === 'initialize') console.log(JSON.stringify({id:message.id,result:{}}));
    if (message.method === 'config/read') console.log(JSON.stringify(fs.existsSync(path.join(root,'fail-config'))
      ? {id:message.id,error:{message:'fixture unavailable'}}
      : {id:message.id,result:{config:{developer_instructions:'FIXTURE_BASELINE_KEEP'},origins:{}}}));
  }); reader.on('close',()=>process.exit(0));
} else {
  let text = ''; let file = '';
  for (let i=0;i<args.length;i++) {
    if (args[i] === '--append-system-prompt-file') { file=args[++i]; text=fs.readFileSync(file,'utf8'); }
    else if (args[i] === '-c' && args[i+1]?.startsWith('developer_instructions=')) text=JSON.parse(args[++i].slice('developer_instructions='.length));
    else if (args[i] === '--append-system-prompt') text=args[++i];
  }
  const id=crypto.randomUUID(); const inputFile=path.join(root,id+'.input');
  fs.writeFileSync(inputFile,'');
  fs.writeFileSync(path.join(root,id+'.json'),JSON.stringify({cli,args,cwd:process.cwd(),profileText:text,sourcePath:file,inputFile,pid:process.pid}));
  if(process.stdin.isTTY)process.stdin.setRawMode(true);
  process.stdout.write('\\x1b[?2004hADE_PROFILE_CLI_READY\\r\\n');
  process.stdin.on('data', bytes => {
    fs.appendFileSync(inputFile,bytes);
    if (bytes.includes(4) || (process.env.ADE_FIXTURE_EXIT_ON_PASTE === '1' && bytes.includes(Buffer.from('\\x1b[201~')))) process.exit(7);
  }); process.stdin.resume();
}
`);
  const quote = (text: string) => `'${text.replace(/'/g, "'\\''")}'`;
  for (const cli of ['codex', 'claude', 'grok', 'qwen']) {
    writeFileSync(join(bin, cli), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(file)} ${quote(cli)} "$@"\n`, { mode: 0o700 });
  }
}
