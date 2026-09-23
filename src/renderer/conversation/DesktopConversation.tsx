import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
import { Modal } from '../onboarding/Modal';
import { useAppData } from '../stores/appdata';
import { useMode } from '../stores/mode';
import { ConversationPanel, type ConversationPort } from './ConversationPanel';
import { CONVERSATION_NOT_ACCEPTED, ConversationNotAcceptedError } from '../../shared/conversation';
import { desktopRunQuestions } from '../graph/RunQuestionsPanel';
import type { CoordinatorActionDetail, CoordinatorActionSummary, CoordinatorActionWork } from '../../shared/coordinatorActions';
import type { ConversationMode } from '../../shared/conversation';

const port: ConversationPort = {
  speech: { load: () => window.ade.invoke('speech:voices'), generate: input => window.ade.invoke('speech:test', input),
    select: async (voiceId, tuning) => { await window.ade.invoke('speech:configure', { target: { kind: 'default' }, voiceId, tuning }); } },
  actions: {
    list: async conversationId => await window.ade.invoke('conversation:actionsQuery', { operation: 'list', conversationId }) as CoordinatorActionSummary[],
    detail: async (conversationId, actionId) => await window.ade.invoke('conversation:actionsQuery', { operation: 'detail', conversationId, actionId }) as CoordinatorActionDetail,
    work: async (conversationId, actionId) => await window.ade.invoke('conversation:actionsQuery', { operation: 'work', conversationId, actionId }) as CoordinatorActionWork,
    command: input => window.ade.invoke('conversation:actionsCommand', input), questions: desktopRunQuestions,
  },
  recording: {
    microphone: allow => window.ade.invoke('dictation:microphone', { allow }),
    prepare: conversationId => window.ade.invoke('conversation:dictationPrepare', { conversationId }),
    start: jobId => window.ade.invoke('dictation:streamStart', { jobId }),
    chunk: (jobId, sequence, audioBase64) => window.ade.invoke('dictation:streamChunk', { jobId, sequence, audioBase64 }),
    finish: jobId => window.ade.invoke('dictation:streamFinish', { jobId }),
    query: jobId => window.ade.invoke('dictation:query', { jobId }),
    cancel: jobId => window.ade.invoke('dictation:cancel', { jobId }),
  },
  list: () => window.ade.invoke('conversation:get'),
  detail: conversationId => window.ade.invoke('conversation:detail', { conversationId }),
  command: async command => {
    try { return await window.ade.invoke('conversation:command', command); }
    catch (error) {
      if (error instanceof Error && error.message.includes(CONVERSATION_NOT_ACCEPTED)) throw new ConversationNotAcceptedError(error.message.split(CONVERSATION_NOT_ACCEPTED).slice(1).join(CONVERSATION_NOT_ACCEPTED));
      throw error;
    }
  },
  defaultProfile: async () => (await window.ade.invoke('supervision:get')).profile?.id ?? null,
  subscribe: changed => window.ade.on('conversation:changed', changed),
  describe: error => error instanceof Error ? error.message : String(error),
};
export function DesktopConversation({ onClose, onBack, mode = 'project' }: { onClose(): void; onBack(): void; mode?: ConversationMode }) {
  useLocale();
  const agents = useAppData(s => s.agents);
  const profiles = Object.values(agents).filter(a => a.runtime === 'codex' && (!a.homeExecutionBackend || a.homeExecutionBackend === 'native') && !a.customCommand?.trim());
  return <Modal title={mode === 'casual' ? translate('Chat & voice') : translate("ADE conversation")} onClose={onClose} className="conversation-dialog" fallbackFocus={() => document.getElementById('desktop-supervision') ?? document.getElementById(`mode-tab-${useMode.getState().mode}`)}>
    <ConversationPanel key={mode} mode={mode} port={port} profiles={profiles} draftScope={mode === 'casual' ? 'desktop:casual' : 'desktop'} onClose={onClose} onBack={onBack} />
  </Modal>;
}
