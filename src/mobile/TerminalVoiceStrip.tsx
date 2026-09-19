import { t as translate } from "../shared/i18n";
import { useLocale } from "../renderer/i18n/language";
import { useRef, useState, type ReactNode } from 'react';
import type { MobileDictationTarget } from '../shared/remote';
import { VoiceStrip, VoiceStripFrame } from '../renderer/terminal/VoiceStrip';
import { MobilePromptDialog, useMobilePromptPort, useMobileSpeechGrants, type PromptSender } from './PromptDialog';
import type { MobileHost } from './useMobileHost';

/** Tablet adapter: the strip under the terminal, or its blocked frame when the
 * tablet does not own input. The large editor replaces the strip while open so
 * exactly one composer writes the shared draft. */
export function TerminalVoiceStrip({ host, target, label, send, fallbackId, trailing, blocked, sendBlockedReason, sheetOpen, onSheetSlot }: {
  host: MobileHost; target: MobileDictationTarget; label: string; fallbackId: string; send: PromptSender;
  trailing?: ReactNode; blocked?: { reason: string; action?: ReactNode };
  sendBlockedReason?: string;
  sheetOpen?: boolean; onSheetSlot?: (element: HTMLElement | null) => void;
}) {
  useLocale();
  const { speechAllowed, computerAllowed } = useMobileSpeechGrants(host);
  const port = useMobilePromptPort(host, target, send, computerAllowed);
  const [editorOpen, setEditorOpen] = useState(false);
  const strip = useRef<HTMLDivElement>(null);
  // Listening to a reply needs no input ownership: the sheet slot stays available in the blocked frame.
  if (blocked) return <VoiceStripFrame trailing={trailing} sheetOpen={sheetOpen} above={<div ref={onSheetSlot} className="voice-sheet-slot" />}>
    <span className="voice-status">{blocked.reason}</span>{blocked.action}</VoiceStripFrame>;
  if (editorOpen) return <>
    <VoiceStripFrame trailing={trailing}><span className="voice-status">{translate("Draft open in the editor.")}</span></VoiceStripFrame>
    <MobilePromptDialog host={host} target={target} label={label} send={send} sendBlockedReason={sendBlockedReason} fallbackId={fallbackId} restoreFocusTo={() => null}
      onClose={() => { setEditorOpen(false); requestAnimationFrame(() => strip.current?.querySelector<HTMLElement>('[data-voice-more]')?.focus()); }} />
  </>;
  return <div ref={strip} style={{ display: 'contents' }}>
    <VoiceStrip draftKey={`mobile/${host.deviceId}/${target.terminalId}`} online={host.status === 'online'} speechAllowed={speechAllowed}
      port={port} sendBlockedReason={sendBlockedReason} trailing={trailing} onOpenEditor={() => setEditorOpen(true)} sheetOpen={sheetOpen} onSheetSlot={onSheetSlot} />
  </div>;
}
