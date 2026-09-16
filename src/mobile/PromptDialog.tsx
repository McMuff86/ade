import { useEffect, useMemo, useRef, useState } from 'react';
import type { MobileDictationResult, MobileDictationTarget, MobileHostState, MobileTerminalState, MobileSpeechResult } from '../shared/remote';
import type { TerminalPromptReceipt } from '../shared/terminalPrompt';
import { PromptComposer, type PromptComposerPort } from '../renderer/terminal/PromptComposer';
import type { MobileHost } from './useMobileHost';
import { Dialog } from './ui';

export function MobilePromptDialog({ host, target, label, send, onClose, fallbackId, restoreFocusTo }: {
  host: MobileHost; target: MobileDictationTarget; label: string; fallbackId: string; onClose: () => void;
  restoreFocusTo?: () => HTMLElement | null;
  send(text: string, mode: 'insert' | 'submit', commandId: string): Promise<TerminalPromptReceipt>;
}) {
  const [speechAllowed, setSpeechAllowed] = useState(false);
  const [computerAllowed, setComputerAllowed] = useState(false);
  const sender = useRef(send); sender.current = send;
  // Parent remounts for a different terminal/lease; microphone callbacks keep this target.
  const bound = useRef(target).current;
  const request = host.request;
  // Cancellation is safe to repeat. Retain failed cancellations across a
  // disconnect and settle them before requesting another paid stream.
  const pendingCancellations = useRef(new Set<string>());
  const cancelRecording = async (jobId: string) => {
    pendingCancellations.current.add(jobId);
    await request('/api/v1/dictation/command', 'POST', { operation: 'cancel', jobId }, crypto.randomUUID());
    pendingCancellations.current.delete(jobId);
  };
  useEffect(() => {
    let stopped = false;
    const load = () => { void request<MobileHostState>('/api/v1/host').then(state => {
      if (!stopped) { setSpeechAllowed(state.capabilities?.includes('dictation:transcribe') === true); setComputerAllowed(state.capabilities?.includes('speech:control') === true); }
    }).catch(() => { if (!stopped) { setSpeechAllowed(false); setComputerAllowed(false); } }); };
    if (host.status === 'online') load();
    const timer = setInterval(load, 5000); return () => { stopped = true; clearInterval(timer); };
  }, [request, host.status]);
  const port = useMemo<PromptComposerPort>(() => ({
    capability: async () => {
      const { leaseId: _lease, ...selection } = bound;
      const state = await request<MobileTerminalState>('/api/v1/terminal/query', 'POST', { ...selection, prompt: true });
      return state.leaseId === bound.leaseId && state.promptCapability ? state.promptCapability
        : { available: false, reason: 'Eingabebesitz geändert. Entwurf behalten und Terminal prüfen.' };
    },
    send: (text, mode, key) => sender.current(text, mode, key),
    prepareRecording: async () => {
      for (const jobId of pendingCancellations.current) await cancelRecording(jobId);
      const result = await request<MobileDictationResult>('/api/v1/dictation/command', 'POST', { operation: 'prepare', target: bound }, crypto.randomUUID());
      if (!('jobId' in result)) throw new Error('Aufnahme konnte nicht vorbereitet werden.'); return result;
    },
    uploadRecording: (jobId, key, bytes) => {
      let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
      return request('/api/v1/dictation/upload', 'POST', { jobId, audioBase64: btoa(binary) }, key);
    },
    readRecording: async jobId => {
      const result = await request<MobileDictationResult>('/api/v1/dictation/command', 'POST', { operation: 'query', jobId });
      if (!('state' in result)) throw new Error('Aufnahmestatus fehlt.'); return result.state;
    },
    cancelRecording,
    liveRecording: {
      start: jobId => request('/api/v1/dictation/command', 'POST', { operation: 'stream-start', jobId }, crypto.randomUUID()),
      push: (jobId, sequence, bytes) => {
        let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
        return request('/api/v1/dictation/command', 'POST', { operation: 'stream-chunk', jobId, sequence, audioBase64: btoa(binary) }, `${jobId}:${sequence}`);
      },
      finish: jobId => request('/api/v1/dictation/command', 'POST', { operation: 'stream-finish', jobId }, crypto.randomUUID()),
    },
    copyText: text => navigator.clipboard.writeText(text),
    computerAllowed,
    computerGreeting: async () => {
      const target = { kind: 'default' } as const;
      const preferences = (await request<MobileSpeechResult>('/api/v1/speech/query', 'POST', { operation: 'voices', target })).preferences;
      if (!preferences?.effectiveVoiceId) throw new Error('Unter Sprachausgabe zuerst eine Standardstimme wählen.');
      const result = await request<MobileSpeechResult>('/api/v1/speech/command', 'POST', {
        operation: 'test', target, voiceId: preferences.effectiveVoiceId, preset: 'computer-greeting',
      }, crypto.randomUUID());
      const audio = (await request<MobileSpeechResult>('/api/v1/speech/query', 'POST', { operation: 'audio', testId: result.testId })).audio;
      if (!audio) throw new Error('Begrüssung konnte nicht geladen werden.'); return audio;
    },
  }), [request, bound, computerAllowed]);
  return <Dialog title="Prompt und Diktat" onClose={onClose} fallbackId={fallbackId} restoreFocusTo={restoreFocusTo} className="m-prompt-dialog">
    <PromptComposer key={`${host.deviceId}/${bound.terminalId}`} draftKey={`mobile/${host.deviceId}/${bound.terminalId}`}
      targetLabel={label} online={host.status === 'online'} speechAllowed={speechAllowed} port={port} />
  </Dialog>;
}
