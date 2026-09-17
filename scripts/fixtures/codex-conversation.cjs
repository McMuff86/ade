// Deterministic multi-turn peer; native CLI evidence has a separate driver.
const { createInterface } = require('node:readline');
const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { createHash } = require('node:crypto');
const file = join(process.cwd(), 'fixture-thread.json');
let state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { id: 'thread-' + createHash('sha256').update(process.cwd()).digest('hex').slice(0, 32), cwd: process.cwd(), turn: 0, secret: '' };
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
const event = (method, params) => send({ method, params: { threadId: state.id, ...params } });
const tools = new Map();
const questions = new Map();
const finish = (id, text, status = 'completed') => {
  event('item/completed', { turnId: id, item: { id: 'answer-' + id, type: 'agentMessage', text } });
  event('turn/completed', { turn: { id, status } });
};
createInterface({ input: process.stdin }).on('line', line => {
  const m = JSON.parse(line); const ok = result => send({ id: m.id, result });
  if (m.method === 'initialize') ok({ userAgent: 'codex_cli_rs/0.154.0' });
  if (m.method === 'config/read') ok({ config: JSON.parse(process.env.ADE_COORDINATOR_CONFIG || '{}') });
  if (m.method === 'thread/read') ok({ thread: { id: state.id, cwd: process.env.ADE_WRONG_WORKSPACE || state.cwd } });
  if (m.method === 'thread/start' || m.method === 'thread/resume') {
    writeFileSync(file, JSON.stringify(state));
    ok({ thread: { id: state.id, cwd: state.cwd, sessionId: 'live-' + process.pid }, model: 'fixture-observed', reasoningEffort: 'high',
      sandbox: { type: m.params.sandbox === 'read-only' && !process.env.ADE_WRONG_SANDBOX ? 'readOnly' : 'dangerFullAccess', networkAccess: false }, approvalPolicy: 'never' });
  }
  if (m.method === 'turn/start') {
    const id = 'turn-' + ++state.turn; const prompt = m.params.input[0].text;
    if (prompt.startsWith('remember:')) state.secret = prompt.slice(9);
    writeFileSync(file, JSON.stringify(state));
    ok({ turn: { id } }); event('turn/started', { turn: { id } });
    if (state.turn > 1) {
      finish('turn-' + (state.turn - 1), 'STALE_MUST_NOT_ENTER_NEXT_ANSWER');
      send({ method: 'item/completed', params: { threadId: 'wrong-thread', turnId: id, item: { type: 'agentMessage', text: 'WRONG_PROJECT' } } });
    }
    if (prompt.startsWith('prepare-handoff:') || prompt.startsWith('prepare-task:')) {
      const handoff = prompt.startsWith('prepare-handoff:');
      const request = { id: 'tool-request-' + id, method: 'item/tool/call', params: { threadId: state.id, turnId: id, callId: 'call-' + id,
        tool: handoff ? 'ade_prepare_handoff' : 'ade_prepare_task', arguments: JSON.parse(prompt.slice(handoff ? 16 : 13)) } };
      tools.set(request.id, id); send(request);
    } else if (prompt.includes('ADE_TABLET_PROJECT_TASK')) {
      const requestId = 'task-question-' + id; questions.set(requestId, id);
      send({ id: requestId, method: 'item/tool/requestUserInput', params: { threadId: state.id, turnId: id, isBlocking: true,
        questions: [{ id: 'choice', header: 'Projektentscheidung', question: 'Welchen Text soll die Ergebnisdatei enthalten?', isOther: true, isSecret: false, options: null }] } });
    } else if (prompt === 'long-answer') {
      finish(id, 'Beginning of complete answer\n' + '語😀'.repeat(6000) + '\nC:\\Private\\project\nFinal sentence of complete answer');
    } else if (prompt === 'projects') {
      const request = { id: 'tool-request-' + id, method: 'item/tool/call', params: { threadId: state.id, turnId: id, callId: 'call-' + id, tool: 'ade_projects', arguments: { offset: 0 } } };
      tools.set(request.id, id); send(request);
    } else if (prompt === 'question') {
      const requestId = 'question-' + id; questions.set(requestId, id);
      send({ id: requestId, method: 'item/tool/requestUserInput', params: { threadId: state.id, turnId: id, isBlocking: true,
        questions: [{ id: 'choice', header: 'Richtung', question: 'Womit beginnen?', isOther: true, isSecret: false, options: null }] } });
    } else if (prompt.startsWith('tool')) {
      const request = { id: 'tool-request-' + id, method: 'item/tool/call', params: { threadId: state.id, turnId: id, callId: 'call-' + id, tool: 'ade_test', arguments: { operation: prompt } } };
      tools.set(request.id, id); send(request); if (prompt === 'tool-duplicate') send(request);
    } else if (prompt !== 'hold') setTimeout(() => { finish(id, prompt === 'recall' ? state.secret : 'Recorded'); finish(id, 'DUPLICATE'); }, 30);
  }
  if (!m.method && tools.has(m.id)) { const id = tools.get(m.id); tools.delete(m.id); finish(id, m.result?.contentItems?.[0]?.text || 'Tool failed'); }
  if (!m.method && questions.has(m.id)) {
    const id = questions.get(m.id); questions.delete(m.id); event('serverRequest/resolved', { requestId: m.id });
    if (String(m.id).startsWith('task-question-')) {
      const answer = m.result?.answers?.choice?.answers?.[0] || 'NO_ANSWER'; writeFileSync(join(process.cwd(), 'tablet-result.txt'), answer);
      setTimeout(() => finish(id, 'ADE_CODEX_TASK_DONE: ' + answer), 100);
    } else setTimeout(() => finish(id, 'Antwort empfangen'), 30);
  }
  if (m.method === 'turn/interrupt') { ok({}); finish(m.params.turnId, 'Partial', 'interrupted'); }
});
