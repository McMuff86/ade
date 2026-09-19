import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
import { useEffect, useRef, useState } from 'react';
import { ConversationRecording, type ConversationRecordingPort, type ConversationRecordingView } from './ConversationRecording';
import type { ConversationDrafts } from './conversationDrafts';
import { LiveDictationRecorder } from '../terminal/LiveDictationRecorder';

export function ConversationVoice({ id, drafts, port, enabled, onApply, purpose = 'conversation', maxApplyChars = Infinity }: {
  id: string; drafts: ConversationDrafts; port: ConversationRecordingPort; enabled: boolean; onApply(text: string): void | Promise<void>; purpose?: 'conversation' | 'organizer'; maxApplyChars?: number;
}) {
  useLocale();
  const controller = useRef<ConversationRecording | null>(null);
  const [view, setView] = useState<ConversationRecordingView>({ phase: 'idle', error: '' });
  const region = useRef<HTMLDivElement>(null);
  const [applying, setApplying] = useState(false); const [applyError, setApplyError] = useState(''); const applyingRef = useRef(false);
  useEffect(() => {
    const recording = new ConversationRecording(id, drafts, port, () => new LiveDictationRecorder(), setView);
    controller.current = recording; setView(recording.snapshot());
    return () => { controller.current = null; recording.dispose(); };
  }, [id, drafts, port, enabled]);
  // A lost connection/authority must release the microphone immediately. A new
  // mount on restoration exposes its saved preview and never restarts capture.
  useEffect(() => { if (!enabled) { controller.current?.dispose(); controller.current = null; } }, [enabled]);
  const act = (action: () => void) => { region.current?.focus(); action(); };
  const active = ['preparing', 'recording', 'transcribing', 'checking'].includes(view.phase);
  const apply = async () => {
    const recording = controller.current; const preview = recording?.snapshot().value;
    if (!recording || !preview || applyingRef.current || preview.text.length > maxApplyChars) return;
    applyingRef.current = true; setApplying(true); setApplyError('');
    try {
      if (purpose === 'organizer') { await onApply(preview.text); recording.discard(); }
      else { const text = recording.apply(); if (text !== undefined) await onApply(text); }
    }
    catch (reason) { setApplyError(reason instanceof Error ? reason.message : translate("Text could not be saved. The dictation preview is preserved.")); }
    finally { applyingRef.current = false; setApplying(false); }
  };
  return <div className="conversation-voice" role="group" aria-label={translate("Dictation for ADE")} ref={region} tabIndex={-1}>
    <p className="conversation-note">{purpose === 'organizer' ? translate("Dictation through ElevenLabs. Check the text and take it to the task or note. When you switch, the recording ends. Up to five minutes per dictation.") : translate("Dictation via ElevenLabs. The text remains for review here; Send to ADE starts the message. When you switch, the recording ends. Up to five minutes per dictation.")}</p>
    {view.phase === 'idle' && <button type="button" disabled={!enabled} onClick={() => act(() => { void controller.current?.start(); })}>{purpose === 'organizer' ? translate("Dictate text") : translate("Dictate the message")}</button>}
    {view.phase === 'preparing' && <p role="status">{translate("Microphone and dictation are being prepared…")}</p>}
    {view.phase === 'recording' && <><p role="status">{translate("The microphone is recording…")}</p><button type="button" onClick={() => act(() => controller.current?.stop())}>{translate("Stop recording")}</button></>}
    {view.phase === 'transcribing' && <p role="status">{translate("Finishing dictation…")}</p>}
    {view.phase === 'checking' && <p role="status">{translate("Checking previous dictation…")}</p>}
    {view.value && <>
      <label>{translate("Dictation preview")}<textarea aria-label={translate("Dictation preview")} readOnly rows={3} value={view.value.text} /></label>
      {!active && <p role="status">{view.value.complete ? translate("Dictation completed. Review and insert the text.") : translate("Incomplete dictation. Check previous part; add missing words.")}</p>}
      {!active && <div className="conversation-controls">
        <button type="button" disabled={!enabled || applying || !view.value.text.trim() || view.value.text.length > maxApplyChars} onClick={() => act(() => { void apply(); })}>{applying ? translate("Saving text…") : purpose === 'organizer' ? translate("Insert dictation") : translate("Insert dictation into message")}</button>
        <button type="button" disabled={!enabled || applying} onClick={() => act(() => { void controller.current?.recover(); })}>{translate("Check previous dictation")}</button>
        <button type="button" disabled={!enabled || applying} onClick={() => act(() => controller.current?.discard())}>{translate("Discard dictation")}</button>
      </div>}
    </>}
    {view.error && <p role="alert">{localizeAppMessage(view.error)}</p>}
    {view.value && view.value.text.length > maxApplyChars && <p role="status">{translate("For this dictation, the space in the text box is not enough: shorten text or copy the preview into a new note.")}</p>}
    {applyError && <p role="alert">{applyError}</p>}
  </div>;
}
