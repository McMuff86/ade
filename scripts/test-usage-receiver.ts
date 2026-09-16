import { OtlpUsageReceiver, projectUsageLogs, type UsageLog } from '../src/main/usage/OtlpUsageReceiver';
import { request as httpRequest } from 'node:http';
let passed = 0;
const check = (name: string, value: boolean) => { if (!value) throw new Error(name); passed++; console.log(`  ok ${name}`); };
const attribute = (key: string, value: string | number) => ({ key, value: typeof value === 'string' ? { stringValue: value } : { intValue: String(value) } });
const logs = (records: object[]) => ({ resourceLogs: [{ resource: { attributes: [attribute('user.email', 'private@example.invalid')] }, scopeLogs: [{ logRecords: records }] }] });
const codex = { body: { stringValue: 'PRIVATE_PROMPT_BODY' }, attributes: [attribute('event.name', 'codex.conversation_starts'), attribute('conversation.id', 'fixture-native-session'), attribute('model', 'gpt-6-astra'), attribute('user.id', 'PRIVATE_USER')] };
const claude = { eventName: 'claude_code.api_request', attributes: [attribute('session.id', 'fixture-session'), attribute('input_tokens', 913), attribute('output_tokens', 18),
  { key: 'cost_usd', value: { doubleValue: 0.001003 } }, attribute('request_id', 'fixture-request'), attribute('tool_parameters', 'PRIVATE_TOOL')] };
const receiver = new OtlpUsageReceiver();
void (async () => {
  const projected = projectUsageLogs(logs([codex, claude]));
  check('Codex conversation name is read from attributes despite a different log body', projected[0]?.name === 'codex.conversation_starts');
  check('OTLP integer strings become exact numbers', projected[1]?.attributes.input_tokens === 913);
  check('OTLP monetary doubles retain their precision', projected[1]?.attributes.cost_usd === 0.001003);
  check('projection discards prompt, user and tool contents', !JSON.stringify(projected).includes('PRIVATE') && !JSON.stringify(projected).includes('private@example'));
  check('unrecognized log kinds are discarded', projectUsageLogs(logs([{ body: { stringValue: 'claude_code.user_prompt' }, attributes: [attribute('input_tokens', 100)] }])).length === 0);
  let rejected = false; try { projectUsageLogs(logs([{ ...codex, attributes: [...codex.attributes, attribute('model', 'other')] }])); } catch { rejected = true; }
  check('duplicate identity attributes are refused', rejected);
  rejected = false; try { projectUsageLogs(logs(Array.from({ length: 513 }, () => codex))); } catch { rejected = true; }
  check('an oversized log batch is refused', rejected);
  const received: UsageLog[][] = []; const registration = await receiver.register(async batch => { received.push(batch); });
  const [header, token] = registration.header.split('=');
  const send = (extra: Record<string, string> = {}, body: unknown = logs([codex, claude])) => fetch(registration.endpoint, { method: 'POST',
    headers: { 'content-type': 'application/json', [header!]: token!, ...extra }, body: JSON.stringify(body) });
  check('receiver binds an ephemeral loopback endpoint', /^http:\/\/127\.0\.0\.1:\d+\/v1\/logs$/.test(registration.endpoint));
  check('wrong per-launch token cannot deliver usage', (await send({ [header!]: '0'.repeat(64) })).status === 403 && received.length === 0);
  check('browser origin cannot use the native receiver', (await send({ origin: 'https://untrusted.example' })).status === 403 && received.length === 0);
  check('browser preflight cannot enable cross-origin telemetry', (await fetch(registration.endpoint, { method: 'OPTIONS' })).status === 403);
  check('gzip is not accepted without the configured bounded decoder', (await send({ 'content-encoding': 'gzip' })).status === 403);
  // Observe the header rejection before uploading. Undici can otherwise reject
  // its still-running body upload with ECONNRESET after the server sends 413.
  const oversizedStatus = await new Promise<number>((resolve, reject) => {
    const request = httpRequest(registration.endpoint, { method: 'POST', headers: {
      'content-type': 'application/json', [header!]: token!, 'content-length': 1024 * 1024 + 1,
    } }, response => { response.resume(); response.on('end', () => { resolve(response.statusCode!); request.destroy(); }); });
    request.on('error', reject); request.setTimeout(5000, () => request.destroy(new Error('Oversized header test timed out')));
    request.flushHeaders();
  });
  check('oversized authenticated declared length is refused with HTTP 413', oversizedStatus === 413 && received.length === 0);
  const oversizedStream = await new Promise<string>((resolve, reject) => {
    const request = httpRequest(registration.endpoint, { method: 'POST', headers: {
      'content-type': 'application/json', [header!]: token!, 'transfer-encoding': 'chunked',
    } }, response => { response.resume(); response.on('end', () => resolve(String(response.statusCode))); });
    request.on('error', (error: NodeJS.ErrnoException) => error.code === 'ECONNRESET' ? resolve(error.code) : reject(error));
    request.setTimeout(5000, () => request.destroy(new Error('Oversized stream test timed out')));
    request.end(JSON.stringify({ extra: 'x'.repeat(1024 * 1024) }));
  });
  check('oversized chunked upload is disconnected before its consumer runs', oversizedStream === 'ECONNRESET' && received.length === 0);
  const accepted = await send();
  check('valid native batch reaches only its registered consumer', accepted.status === 200 && received.length === 1 && received[0]!.length === 2);
  check('successful OTLP acknowledgement contains no projected metadata', await accepted.text() === '{}');
  const otherReceived: UsageLog[][] = []; const other = await receiver.register(async batch => { otherReceived.push(batch); });
  const otherToken = other.header.split('=')[1]!;
  await send({ [header!]: otherToken }, logs([claude]));
  check('two launch tokens keep their source callbacks isolated', received.length === 1 && otherReceived.length === 1);
  registration.release();
  check('released launch token cannot submit a late batch', (await send()).status === 403 && received.length === 1);
  check('final positive second launch still receives its own numeric event', (await send({ [header!]: otherToken }, logs([claude]))).status === 200 && otherReceived.length === 2);
  other.release(); await receiver.close();
  rejected = false; try { await receiver.register(async () => undefined); } catch { rejected = true; }
  check('closed receiver cannot issue a dead endpoint', rejected);
  console.log(`Usage receiver: ${passed} passed, 0 failed`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => receiver.close());
