import { linuxKeyringOperation, type KeyringRequest } from './linuxSecretService';

// One request per process. Parent enforces wall-time and reply bounds; never log
// native errors, stdin, argv or environment. There is no CLI secret argument.
let input = Buffer.alloc(0);
process.stdin.on('data', (chunk: Buffer) => {
  if (input.length + chunk.length > 1024) process.exit(1);
  input = Buffer.concat([input, chunk]);
});
process.stdin.on('end', () => {
  try { const request = JSON.parse(input.toString('utf8')) as KeyringRequest; input.fill(0);
    process.stdout.write(JSON.stringify(linuxKeyringOperation(request)) + '\n');
  } catch { process.stdout.write('{"state":"unavailable"}\n'); }
});
