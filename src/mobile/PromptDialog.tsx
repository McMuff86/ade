import { t as translate } from "../shared/i18n";
import { useLocale } from "../renderer/i18n/language";
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MobileDictationResult, MobileDictationTarget, MobileHostState, MobileTerminalState, MobileSpeechResult } from '../shared/remote';
import type { TerminalPromptReceipt } from '../shared/terminalPrompt';
import { PromptComposer, type PromptComposerPort } from '../renderer/terminal/PromptComposer';
import type { MobileHost } from './useMobileHost';
import { Dialog } from './ui';

export type PromptSender = (text: string, mode: 'insert' | 'submit', commandId: string, imageIds?: string[]) => Promise<TerminalPromptReceipt>;

/** Device grants decide which voice actions the strip and editor may offer. */
export function useMobileSpeechGrants(host: MobileHost): { speechAllowed: boolean; computerAllowed: boolean } {
  const [speechAllowed, setSpeechAllowed] = useState(false);
  const [computerAllowed, setComputerAllowed] = useState(false);
  const request = host.request;
  useEffect(() => {
    let stopped = false;
    const load = () => { void request<MobileHostState>('/api/v1/host').then(state => {
      if (!stopped) { setSpeechAllowed(state.capabilities?.includes('dictation:transcribe') === true); setComputerAllowed(state.capabilities?.includes('speech:control') === true); }
    }).catch(() => { if (!stopped) { setSpeechAllowed(false); setComputerAllowed(false); } }); };
    if (host.status === 'online') load();
    const timer = setInterval(load, 5000); return () => { stopped = true; clearInterval(timer); };
  }, [request, host.status]);
  return { speechAllowed, computerAllowed };
}

/** Target-bound port. Remount the owner for a different terminal or lease;
 * microphone callbacks keep the target they were created with. */
export function useMobilePromptPort(host: MobileHost, target: MobileDictationTarget, send: PromptSender, computerAllowed: boolean): PromptComposerPort {
  const sender = useRef(send); sender.current = send;
  const bound = useRef(target).current;
  const request = host.request;
  // Cancellation is safe to repeat. Retain failed cancellations across a
  // disconnect and settle them before requesting another paid stream.
  const pendingCancellations = useRef(new Set<string>());
  return useMemo<PromptComposerPort>(() => {
    const cancelRecording = async (jobId: string) => {
      pendingCancellations.current.add(jobId);
      await request('/api/v1/dictation/command', 'POST', { operation: 'cancel', jobId }, crypto.randomUUID());
      pendingCancellations.current.delete(jobId);
    };
    return {
      capability: async () => {
        const { leaseId: _lease, ...selection } = bound;
        const state = await request<MobileTerminalState>('/api/v1/terminal/query', 'POST', { ...selection, prompt: true });
        return state.leaseId === bound.leaseId && state.promptCapability ? state.promptCapability
          : { available: false, reason: translate("Entry ownership changed. Keep draft and check terminal.") };
      },
      send: (text, mode, key) => sender.current(text, mode, key),
      prepareRecording: async () => {
        for (const jobId of pendingCancellations.current) await cancelRecording(jobId);
        const result = await request<MobileDictationResult>('/api/v1/dictation/command', 'POST', { operation: 'prepare', target: bound }, crypto.randomUUID());
        if (!('jobId' in result)) throw new Error(translate("Recording could not be prepared.")); return result;
      },
      uploadRecording: (jobId, key, bytes) => {
        let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
        return request('/api/v1/dictation/upload', 'POST', { jobId, audioBase64: btoa(binary) }, key);
      },
      readRecording: async jobId => {
        const result = await request<MobileDictationResult>('/api/v1/dictation/command', 'POST', { operation: 'query', jobId });
        if (!('state' in result)) throw new Error(translate("Recording status is missing.")); return result.state;
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
        if (!preferences?.effectiveVoiceId) throw new Error(translate("Under voice output, select a standard voice first."));
        const result = await request<MobileSpeechResult>('/api/v1/speech/command', 'POST', {
          operation: 'test', target, voiceId: preferences.effectiveVoiceId, preset: 'computer-greeting',
        }, crypto.randomUUID());
        const audio = (await request<MobileSpeechResult>('/api/v1/speech/query', 'POST', { operation: 'audio', testId: result.testId })).audio;
        if (!audio) throw new Error(translate("Greetings could not be loaded.")); return audio;
      },
    };
  }, [request, bound, computerAllowed]);
}

/** The large editor: the same draft as the strip, for long prompts and careful rework. */
export function MobilePromptDialog({ host, target, label, send, sendBlockedReason, onClose, fallbackId, restoreFocusTo }: {
  host: MobileHost; target: MobileDictationTarget; label: string; fallbackId: string; onClose: () => void;
  restoreFocusTo?: () => HTMLElement | null; send: PromptSender;
  sendBlockedReason?: string;
}) {
  useLocale();
  const { speechAllowed, computerAllowed } = useMobileSpeechGrants(host);
  const port = useMobilePromptPort(host, target, send, computerAllowed);
  const bound = useRef(target).current;
  return <Dialog title={translate("Prompt and dictation")} onClose={onClose} fallbackId={fallbackId} restoreFocusTo={restoreFocusTo} className="m-prompt-dialog">
    <PromptComposer key={`${host.deviceId}/${bound.terminalId}`} draftKey={`mobile/${host.deviceId}/${bound.terminalId}`}
      targetLabel={label} online={host.status === 'online'} speechAllowed={speechAllowed} sendBlockedReason={sendBlockedReason} port={port} />
  </Dialog>;
}
