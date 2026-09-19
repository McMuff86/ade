import { t as translate } from "../shared/i18n";
import type { ConversationDisplayTurn, ConversationPort } from '../renderer/conversation/ConversationPanel';
import type { MobileConversationAnswer, MobileConversationDetail, MobileConversationQuestion, MobileConversationOverview, MobileSupervisionView } from '../shared/remote';
import type { RunQuestion } from '../shared/runQuestions';
import type { MobileHost } from './useMobileHost';
import { MobileClientError } from './client';
import { workspaceError } from './AgentWorkspace';
import { ConversationNotAcceptedError } from '../shared/conversation';

/** Cache only explicit answer details in memory for this device epoch. Metadata
 * is re-authorized on each refresh; changing devices never reuses this port. */
export function mobileConversationPort(host: () => MobileHost, access: (canWrite: boolean) => void): ConversationPort {
  const identity = host().identityVersion; const device = host().deviceId;
  const cached = new Map<string, ConversationDisplayTurn>();
  const current = () => { if (identity !== host().identityVersion || device !== host().deviceId) { cached.clear(); throw new Error(translate("Device connection has been changed.")); } };
  const recordingRequest = async (value: import('../shared/remote').MobileConversationDictationCommand, key?: string) => {
    current();
    try { const result = await host().request<import('../shared/remote').MobileDictationResult>('/api/v1/conversation/dictation', 'POST', value, key); current(); return result; }
    catch (error) { current(); throw new Error(error instanceof MobileClientError && error.code === 'scope_not_granted' ? translate("On the PC, enable dictation, workspace reading and access to all projects for dictation.") : workspaceError(error)); }
  };
  const request = async <T,>(payload: unknown): Promise<T> => {
    current();
    try { const result = await host().request<T>('/api/v1/conversation/query', 'POST', payload); current(); return result; }
    catch (error) { cached.clear(); access(false); throw error; }
  };
  const hydrate = async (id: string, turn: MobileConversationDetail['turns'][number]): Promise<ConversationDisplayTurn> => {
    const key = `${id}:${turn.id}`; const old = cached.get(key); const revision = JSON.stringify(turn);
    if (old?.revision === revision) return old;
    let offset: number | null = 0; let output = ''; let redacted = false;
    while (offset !== null) {
      const page: MobileConversationAnswer = await request({ operation: 'answer', conversationId: id, turnId: turn.id, offset });
      if (page.sha256 !== turn.output.sha256 || page.offset !== offset || page.nextOffset !== null && page.nextOffset <= offset || output.length + page.text.length > 64 * 1024) throw new Error(translate("Response changed during loading. Reload history."));
      output += page.text; offset = page.nextOffset; redacted ||= page.redacted;
      if (offset === null && output.length !== page.total) throw new Error(translate("Response was not fully loaded."));
    }
    const questions: RunQuestion[] = [];
    for (const q of turn.questions) {
      // Answered forms need no private detail on the wire or in a browser cache.
      if (q.status !== 'pending' && q.status !== 'answering') continue;
      const { items, ...summary } = q; const question: RunQuestion = { ...summary, questions: [] };
      for (let item = 0; item < items; item++) {
        const page: MobileConversationQuestion = await request({ operation: 'question', conversationId: id, turnId: turn.id, questionId: q.id, item });
        if (page.questionId !== q.id || page.item !== item || page.total !== items) throw new Error(translate("The question changed while loading."));
        question.questions.push(page.value); redacted ||= page.redacted;
      }
      questions.push(question);
    }
    const value: ConversationDisplayTurn = { ...turn, input: { chars: turn.input.chars }, output, questions, redacted, revision };
    current();
    // At most one conversation's full history in this short-lived port.
    for (const other of cached.keys()) if (!other.startsWith(`${id}:`)) cached.delete(other);
    cached.set(key, value); return value;
  };
  return {
    speech: {
      recover: true,
      load: async () => {
        current(); const result = await host().request<import('../shared/remote').MobileSpeechResult>('/api/v1/speech/query', 'POST', { operation: 'voices', target: { kind: 'default' } }); current();
        if (!result.preferences) throw new Error(translate('Voice settings are not available.'));
        return { voices: result.preferences.voices, selectedVoiceId: result.preferences.effectiveVoiceId };
      },
      generate: async (input, key) => {
        current();
        const result = await host().request<import('../shared/remote').MobileSpeechResult>('/api/v1/speech/command', 'POST', { operation: 'test', target: { kind: 'default' }, ...input }, key); current();
        const playback = await host().request<import('../shared/remote').MobileSpeechResult>('/api/v1/speech/query', 'POST', { operation: 'audio', testId: result.testId }); current();
        if (!playback.audio) throw new Error(translate('Voice test is not available.')); return playback.audio;
      },
    },
    actions: {
      list: async conversationId => {
        current(); try { const value = await host().request<import('../shared/coordinatorActions').CoordinatorActionSummary[]>('/api/v1/conversation/actions/query', 'POST', { operation: 'list', conversationId }); current(); return value; }
        catch (error) { cached.clear(); current(); throw error; }
      },
      detail: async (conversationId, actionId) => {
        current(); const value = await host().request<import('../shared/coordinatorActions').CoordinatorActionDetail>('/api/v1/conversation/actions/query', 'POST', { operation: 'detail', conversationId, actionId }); current(); return value;
      },
      work: async (conversationId, actionId) => {
        current(); const value = await host().request<import('../shared/coordinatorActions').CoordinatorActionWork>('/api/v1/conversation/actions/query', 'POST', { operation: 'work', conversationId, actionId }); current(); return value;
      },
      command: async command => {
        current(); const { commandId, ...input } = command;
        const result = await host().request<import('../shared/coordinatorActions').CoordinatorActionReceipt>('/api/v1/conversation/actions/command', 'POST', input, commandId); current(); return result;
      },
      questions: {
        read: async id => { current(); const value = await host().request<import('../shared/runQuestions').RunQuestionsView>(`/api/v1/runs/${id}/questions`); current(); return value; },
        answer: async (input, key) => { current(); const value = await host().request(`/api/v1/runs/${input.runId}/answers`, 'POST', { taskId: input.taskId, questionId: input.questionId, answers: input.answers }, key); current(); return value; },
      },
    },
    recording: {
      microphone: async () => { current(); },
      prepare: async conversationId => {
        const result = await recordingRequest({ operation: 'prepare', conversationId }, crypto.randomUUID());
        if (!('jobId' in result)) throw new Error(translate("Recording target was not confirmed.")); return result;
      },
      start: async jobId => { await recordingRequest({ operation: 'stream-start', jobId }, `${jobId}-start`); },
      chunk: async (jobId, sequence, audioBase64) => { await recordingRequest({ operation: 'stream-chunk', jobId, sequence, audioBase64 }, `${jobId}:${sequence}`); },
      finish: async jobId => { await recordingRequest({ operation: 'stream-finish', jobId }, `${jobId}-finish`); },
      query: async jobId => { const result = await recordingRequest({ operation: 'query', jobId }); if (!('state' in result)) throw new Error(translate("Dictation status was not confirmed.")); return result.state; },
      cancel: async jobId => { await recordingRequest({ operation: 'cancel', jobId }, `${jobId}-cancel`); },
    },
    list: async () => { const view = await request<MobileConversationOverview>({ operation: 'overview' }); access(view.canWrite); return view.conversations; },
    detail: async id => {
      const detail = await request<MobileConversationDetail>({ operation: 'detail', conversationId: id });
      const turns: ConversationDisplayTurn[] = [];
      for (const turn of detail.turns) {
        const old = cached.get(`${id}:${turn.id}`);
        turns.push(turn === detail.turns.at(-1) ? await hydrate(id, turn) : old?.revision === JSON.stringify(turn) ? old : { ...turn, input: { chars: turn.input.chars }, output: null, questions: [], revision: JSON.stringify(turn) });
      }
      return { ...detail, turns };
    },
    loadTurn: async (id, turnId) => {
      const detail = await request<MobileConversationDetail>({ operation: 'detail', conversationId: id });
      const turn = detail.turns.find(t => t.id === turnId); if (!turn) throw new Error(translate("The message does not exist."));
      return hydrate(id, turn);
    },
    command: async command => {
      current(); const { commandId, ...input } = command;
      try {
        const result = await host().request<import('../shared/conversation').ConversationReceipt>('/api/v1/conversation/command', 'POST', input, commandId);
        current(); return result;
      } catch (error) {
        current();
        if (error instanceof MobileClientError && ['conversation_not_accepted', 'invalid_payload', 'host_busy'].includes(error.code)) throw new ConversationNotAcceptedError(error.message);
        throw error;
      }
    },
    defaultProfile: async () => { current(); const view = await host().request<MobileSupervisionView>('/api/v1/supervision/query', 'POST', { operation: 'overview' }); current(); return view.profile?.id ?? null; },
    subscribe: changed => { const timer = setInterval(() => { if (!document.hidden && host().status === 'online') changed(); }, 1500); return () => { clearInterval(timer); cached.clear(); }; },
    describe: error => error instanceof MobileClientError && error.code === 'scope_not_granted'
      ? translate("For the global ADE conversation, enable workspace reading and access to all projects on the PC. Sending messages also requires run write permissions.")
      : error instanceof MobileClientError ? workspaceError(error) : error instanceof Error ? error.message : translate("Conversation could not be loaded."),
  };
}
