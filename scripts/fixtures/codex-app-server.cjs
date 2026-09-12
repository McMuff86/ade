// Deterministic protocol peer. No model, shell commands or network access.
const readline = require('node:readline');
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  const ok = (result) => send({ id: message.id, result });
  if (message.method === 'initialize') {
    if (!message.params.capabilities.experimentalApi) throw new Error('experimental protocol not negotiated');
    ok({ userAgent: 'fixture' });
  } else if (message.method === 'thread/start') {
    if (!message.params.config['features.default_mode_request_user_input']) throw new Error('question feature missing');
    ok({ thread: { id: 'thread-1' } });
  } else if (message.method === 'turn/start') {
    ok({ turn: { id: 'turn-1' } });
    send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
    send({ method: 'item/started', params: { threadId: 'thread-1', item: { id: 'tool-1', type: 'commandExecution', command: 'rg shared src',
      commandActions: [{ type: 'search', path: 'src', query: 'shared' }], status: 'inProgress' } } });
    send({ method: 'item/completed', params: { threadId: 'thread-1', item: { id: 'tool-1', type: 'commandExecution', command: 'rg shared src', exitCode: 0,
      commandActions: [{ type: 'search', path: 'src', query: 'shared' }], status: 'completed', aggregatedOutput: 'src/example.ts' } } });
    send({ method: 'item/completed', params: { threadId: 'thread-1', item: { type: 'reasoning', id: 'reason-1', summary: ['A public summary'], content: ['PRIVATE_REASONING_NEVER_EXPORT'] } } });
    if (process.env.ADE_PROTOCOL_FIXTURE === 'unknown-request') {
      send({ id: 9, method: 'item/commandExecution/requestApproval', params: { threadId: 'thread-1' } }); return;
    }
    send({ id: 7, method: 'item/tool/requestUserInput', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'question-tool', isBlocking: true, autoResolutionMs: null,
      questions: [{ id: 'choice', header: 'Farbe', question: 'Welche Farbe soll verwendet werden?', isOther: true, isSecret: false,
        options: [{ label: 'Blau', description: 'Blaue Oberfläche' }, { label: 'Grün', description: 'Grüne Oberfläche' }] }] } });
  } else if (message.id === 7 && message.result) {
    send({ method: 'serverRequest/resolved', params: { threadId: 'thread-1', requestId: 7 } });
    // Same stdout chunk/tick is intentional: answer acknowledgement must settle before task exit.
    send({ method: 'item/completed', params: { threadId: 'thread-1', item: { id: 'response', type: 'agentMessage', text: 'Antwort erhalten: ' + message.result.answers.choice.answers[0] } } });
    send({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread-1', tokenUsage: { total: { inputTokens: 123, outputTokens: 45 } } } });
    send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
  }
});
