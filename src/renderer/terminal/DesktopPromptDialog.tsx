import { useEffect, useMemo, useRef } from 'react';
import { PromptComposer, type PromptComposerPort } from './PromptComposer';

export function DesktopPromptDialog({ sessionId, label, onClose, focusTerminal, fallbackFocus }: {
  sessionId: string; label: string; onClose: () => void; focusTerminal: () => void; fallbackFocus: () => HTMLElement | null;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const titleId = `prompt-title-${sessionId}`;
  useEffect(() => {
    const panel = panelRef.current;
    const opener = document.activeElement as HTMLElement | null;
    panel?.scrollIntoView({ block: 'nearest' });
    panel?.querySelector('textarea')?.focus();
    return () => {
      // Switching sessions or navigating elsewhere already establishes focus.
      // Only restore it when closing this panel would otherwise lose it.
      if (document.activeElement !== document.body && !panel?.contains(document.activeElement)) return;
      const target = opener?.isConnected && opener.getClientRects().length && !opener.matches(':disabled')
        ? opener : fallbackFocus();
      target?.focus({ preventScroll: true });
    };
  }, []);
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
    liveRecording: {
      start: jobId => window.ade.invoke('dictation:streamStart', { jobId }),
      push: (jobId, sequence, bytes) => {
        let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
        return window.ade.invoke('dictation:streamChunk', { jobId, sequence, audioBase64: btoa(binary) });
      },
      finish: jobId => window.ade.invoke('dictation:streamFinish', { jobId }),
    },
  }), [sessionId]);
  return <section ref={panelRef} id={`prompt-panel-${sessionId}`} className="desktop-prompt-panel"
    role="dialog" aria-labelledby={titleId} tabIndex={-1} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
    }}>
    <header className="desktop-prompt-header">
      <h2 id={titleId}>Prompt und Diktat</h2>
      <div className="desktop-prompt-tools">
        <button type="button" onClick={focusTerminal}>Zum Terminal</button>
        <button type="button" onClick={onClose} title="Escape">Schliessen</button>
      </div>
    </header>
    <div className="desktop-prompt-body">
    <PromptComposer key={sessionId} draftKey={`desktop/${sessionId}`} targetLabel={label} online speechAllowed port={port} />
    </div>
  </section>;
}
