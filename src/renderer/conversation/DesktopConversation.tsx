import { Modal } from '../onboarding/Modal';
import { useAppData } from '../stores/appdata';
import { useMode } from '../stores/mode';
import { ConversationPanel, type ConversationPort } from './ConversationPanel';
import { CONVERSATION_NOT_ACCEPTED, ConversationNotAcceptedError } from '../../shared/conversation';

const port: ConversationPort = {
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
export function DesktopConversation({ onClose, onBack }: { onClose(): void; onBack(): void }) {
  const agents = useAppData(s => s.agents);
  const profiles = Object.values(agents).filter(a => a.runtime === 'codex' && (!a.homeExecutionBackend || a.homeExecutionBackend === 'native') && !a.customCommand?.trim());
  return <Modal title="ADE-Gespräch" onClose={onClose} className="conversation-dialog" fallbackFocus={() => document.getElementById(`mode-tab-${useMode.getState().mode}`)}>
    <ConversationPanel port={port} profiles={profiles} draftScope="desktop" onClose={onClose} onBack={onBack} />
  </Modal>;
}
