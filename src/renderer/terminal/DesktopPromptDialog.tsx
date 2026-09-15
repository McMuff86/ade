import { useMemo } from 'react';
import { Modal } from '../onboarding/Modal';
import { PromptComposer, type PromptComposerPort } from './PromptComposer';

export function DesktopPromptDialog({ sessionId, label, onClose, fallbackFocus }: {
  sessionId: string; label: string; onClose: () => void; fallbackFocus: () => HTMLElement | null;
}) {
  const port = useMemo<PromptComposerPort>(() => ({
    capability: () => window.ade.invoke('terminal:promptQuery', { sessionId }),
    send: (text, mode, commandId) => window.ade.invoke('terminal:promptSend', { sessionId, text, mode, commandId }),
    prepareRecording: () => window.ade.invoke('dictation:prepare', { sessionId }),
    uploadRecording: (jobId, key, bytes) => {
      let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
      return window.ade.invoke('dictation:submit', { jobId, key, audioBase64: btoa(binary) });
    },
    readRecording: jobId => window.ade.invoke('dictation:query', { jobId }),
    cancelRecording: jobId => window.ade.invoke('dictation:cancel', { jobId }),
    permitMicrophone: () => window.ade.invoke('dictation:microphone', { allow: true }),
    revokeMicrophone: () => window.ade.invoke('dictation:microphone', { allow: false }),
    copyText: text => window.ade.invoke('clipboard:writeText', { text }),
  }), [sessionId]);
  return <Modal title="Prompt und Diktat" onClose={onClose} fallbackFocus={fallbackFocus} className="prompt-dialog">
    <PromptComposer key={sessionId} draftKey={`desktop/${sessionId}`} targetLabel={label} online speechAllowed port={port} />
    <div className="modal-actions"><button type="button" onClick={onClose}>Schliessen</button></div>
  </Modal>;
}
