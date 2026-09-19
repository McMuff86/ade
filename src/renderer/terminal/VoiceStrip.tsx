import { localizedState } from '../../shared/i18n/states';
import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { t as translate } from "../../shared/i18n";
import { localizedLabels } from "../../shared/i18n/labels";
import { useLocale } from "../i18n/language";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { DICTATION_MAX_TEXT_CHARS } from '../../shared/dictation';
import { usePromptComposer, type PromptComposerPort, type PromptNoticeKind, type PromptPhase } from './PromptComposer';
import { useComputerCall, type ComputerPhase } from './useComputerCall';
import './voice-strip.css';

const HINT_KEY = 'ade-voice-strip-hint-seen';
const TRANSIENT: PromptNoticeKind[] = ['submitted', 'inserted', 'copied', 'cleared'];
const LONG_PRESS_MS = 550;
const mmss = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
const vibrate = (pattern: number | number[]) => { try { navigator.vibrate?.(pattern); } catch { /* No haptics on this device. */ } };

export const MicIcon = () => { useLocale(); return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
  <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>); };
export const KeyboardIcon = () => { useLocale(); return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
  <rect x="3" y="6" width="18" height="12" rx="2" /><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" /></svg>); };
const SendIcon = () => { useLocale(); return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>); };
const MoreIcon = () => { useLocale(); return (<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="6" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="18" cy="12" r="1.8" /></svg>); };

/** Shared frame so a blocked or empty strip keeps the same footprint as the live one. */
export function VoiceStripFrame({ above, below, children, trailing, phase = 'idle', className = '', sheetOpen = false }: {
  above?: ReactNode; below?: ReactNode; children: ReactNode; trailing?: ReactNode; phase?: PromptPhase; className?: string; sheetOpen?: boolean;
}) {
  useLocale();
  return <section className={`voice-strip ${className}`} aria-label={translate("Voice bar")} data-phase={phase} data-sheet-open={sheetOpen}>
    <div className="voice-strip-above">{above}</div>
    <div className="voice-strip-row">{children}<div className="voice-trailing">{trailing}</div></div>
    <div className="voice-strip-below">{below}</div>
  </section>;
}

function shortNotice(text: string, kind: PromptNoticeKind): string {
  switch (kind) {
    case 'transcribed': return translate("Transcribed · review, then send");
    case 'empty': return translate("No speech detected");
    case 'submitted': return translate("Passed on ✓");
    case 'inserted': return translate("Inserted ✓ · Confirm in the terminal with Enter");
    case 'cancelled': return translate("Recording cancelled");
    case 'recovered': return text.includes(translate("shortened")) ? translate("Intermediately secured and shortened · please check") : translate("Connection interrupted · intermediate secured, please check");
    case 'pending': return translate("Detection is still ongoing · Check later");
    case 'copied': return translate("Copied ✓");
    case 'cleared': return translate("Draft deleted");
    default: return text;
  }
}

const COMPUTER_LABEL: Record<ComputerPhase, string> = localizedLabels(() => ({
  idle: '', preparing: translate("Microphone …"), listening: translate("Say “Computer”"), finishing: translate("“Computer” detected…"), greeting: translate("Greeting…"), speaking: translate("Computer is replying…"),
}));

/** Keep the screen on while the tablet listens or speaks; nothing to release when unsupported. */
function useScreenAwake(wanted: boolean): void {
  useEffect(() => {
    if (!wanted || !('wakeLock' in navigator)) return;
    let sentinel: WakeLockSentinel | undefined; let cancelled = false;
    navigator.wakeLock.request('screen').then(lock => { if (cancelled) void lock.release().catch(() => undefined); else sentinel = lock; }).catch(() => undefined);
    return () => { cancelled = true; void sentinel?.release().catch(() => undefined); };
  }, [wanted]);
}

/** One voice turn without leaving the terminal: speak, read, send. Mount with a
 * key equal to draftKey; the same draft store backs the large editor. */
export function VoiceStrip({ draftKey, online, speechAllowed, port, sendBlockedReason, trailing, onOpenEditor, sheetOpen = false, onSheetSlot }: {
  draftKey: string; online: boolean; speechAllowed: boolean; port: PromptComposerPort; trailing?: ReactNode; onOpenEditor?: () => void;
  sendBlockedReason?: string;
  /** The reply sheet takes the strip's place while open; the slot receives its element. */
  sheetOpen?: boolean; onSheetSlot?: (element: HTMLElement | null) => void;
}) {
  useLocale();
  const composer = usePromptComposer({ draftKey, online, speechAllowed, port, sendBlockedReason });
  const { draft, phase, seconds, maxSeconds, error, notice, noticeKind, storageError, capability, computerBusy } = composer;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null); const menu = useRef<HTMLDivElement>(null);
  const micButton = useRef<HTMLButtonElement>(null);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [hintSeen, setHintSeen] = useState(() => { try { return localStorage.getItem(HINT_KEY) === '1'; } catch { return false; } });
  const [flash, setFlash] = useState(false);
  const computerEnabled = online && speechAllowed && port.computerAllowed !== false && !!port.computerGreeting && !!port.liveRecording
    && phase === 'idle' && !draft.delivery && !draft.recordingJob;
  const record = composer.record;
  const recordRef = useRef(record); recordRef.current = record;
  const computer = useComputerCall(port, {
    enabled: computerEnabled, onBusy: composer.setComputerBusy,
    onSettled: () => requestAnimationFrame(() => micButton.current?.focus({ preventScroll: true })),
    // The greeting ends with "Wähle Diktieren"; the strip does that step itself.
    onGreeted: () => { vibrate(30); void recordRef.current(); },
  });
  useEffect(() => {
    if (!notice || !TRANSIENT.includes(noticeKind)) { setFlash(false); return; }
    setFlash(true); const timer = window.setTimeout(() => setFlash(false), 2500);
    return () => clearTimeout(timer);
  }, [notice, noticeKind]);
  useLayoutEffect(() => { if (menuOpen) menu.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus(); }, [menuOpen]);
  useEffect(() => {
    if (!menuOpen) return;
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node) && event.target !== menuButton.current) setMenuOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [menuOpen]);
  const closeMenu = (restore = true) => { setMenuOpen(false); if (restore) menuButton.current?.focus(); };
  const dismissHint = () => { setHintSeen(true); try { localStorage.setItem(HINT_KEY, '1'); } catch { /* Hint simply returns next time. */ } };

  const listening = phase === 'recording';
  useScreenAwake(listening || phase === 'permission' || phase === 'transcribing' || computer.active);
  const micLabel = computer.active ? COMPUTER_LABEL[computer.phase]
    : phase === 'permission' ? translate("Microphone …") : listening ? translate("Listening · {{value1}}", { value1: mmss(seconds) }) : phase === 'transcribing' ? translate("Transcribing…") : translate("Speak");
  const micPhase = computer.active ? (computer.phase === 'listening' ? 'recording' : computer.phase === 'speaking' ? 'speaking' : 'permission') : phase;
  const micDisabled = computer.active ? false : phase === 'idle' ? !composer.canRecord : !listening;
  const capabilityReason = capability.available ? '' : capability.reason;
  const checking = capabilityReason.startsWith(translate("Checking session target"));
  const reason = phase !== 'idle' || computer.active ? '' : !online ? translate("Offline") : sendBlockedReason || (!speechAllowed ? translate("Dictation permission required") : capability.available ? '' : checking ? translate("Checking session…") : translate("No CLI prompt"));
  const reasonDetail = !online ? translate("The draft can be further edited; speaking and sending need the connection to the PC.")
    : sendBlockedReason ? translate("{{value1}}. The draft remains editable.", { value1: sendBlockedReason })
    : !speechAllowed ? translate("ElevenLabs-Diktat needs its own dictation permission on the PC under Settings → Connected devices.")
    : capability.available ? '' : translate("{{value1}} Complete sign-in and project trust directly in the terminal before handover; the CLI must display its prompt.", { value1: capabilityReason });
  const statusVisible = !!notice && (!TRANSIENT.includes(noticeKind) || flash);
  const duration = maxSeconds >= 120 ? translate("{{value1}} minutes", { value1: maxSeconds / 60 }) : translate("{{value1}} seconds", { value1: maxSeconds });
  const computerVisible = computer.active || !!computer.reply || !!computer.error || !!computer.status;

  // Long press on the microphone calls the Computer; a tap speaks or stops.
  const press = useRef<{ timer?: number; long: boolean }>({ long: false });
  const clearPress = () => { if (press.current.timer) { clearTimeout(press.current.timer); press.current.timer = undefined; } };
  const micClick = () => {
    if (press.current.long) { press.current.long = false; return; }
    if (computer.active) { computer.stop(); return; }
    if (listening) { vibrate([20, 40, 20]); composer.stop(); return; }
    if (phase === 'idle') { vibrate(30); void composer.record(); }
  };

  return <VoiceStripFrame phase={phase} className="voice-strip-live" sheetOpen={sheetOpen} trailing={<>
    {trailing}
    <div className="voice-menu-host">
      <button ref={menuButton} type="button" className="voice-icon-button" data-voice-more aria-label={translate("Other options")} aria-haspopup="menu" aria-expanded={menuOpen}
        onClick={() => setMenuOpen(open => !open)}><MoreIcon /></button>
      {menuOpen && <div ref={menu} role="menu" aria-label={translate("Other options")} className="voice-menu" onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(); return; }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        const items = [...menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
      }}>
        {port.computerGreeting && <button type="button" role="menuitem" disabled={!computerEnabled || computer.active}
          onClick={() => { closeMenu(false); void computer.run(); }}>{translate("Call computer")}</button>}
        {onOpenEditor && <button type="button" role="menuitem" disabled={phase !== 'idle' || computerBusy} onClick={() => { closeMenu(false); onOpenEditor(); }}>{translate("Open in the editor")}</button>}
        {port.copyText && <button type="button" role="menuitem" disabled={!composer.value} onClick={() => { composer.copy(); closeMenu(); }}>{translate("Copy draft")}</button>}
        <button type="button" role="menuitem" disabled={phase !== 'idle' || !!draft.delivery || !composer.value} onClick={() => { composer.clear(); closeMenu(); }}>{translate("Delete the draft")}</button>
        <button type="button" role="menuitem" onClick={() => { setHintSeen(false); closeMenu(); }}>{translate("Show hints")}</button>
      </div>}
    </div>
  </>} above={<>
    <div ref={onSheetSlot} className="voice-sheet-slot" />
    {computerVisible && <div className="voice-computer" role="region" aria-label={translate("Computer")}>
      {computer.reply && <p className="voice-computer-text" aria-label={translate("Computer response")}>{computer.reply.text}</p>}
      <div className="voice-strip-row">
        {computer.status && <span role="status" className="voice-status">{localizedState(computer.status)}</span>}
        {computer.error && <span role="alert" className="voice-alert">{localizeAppMessage(computer.error)}</span>}
        <span style={{ flex: 1 }} />
        {!computer.active && computer.reply && <button type="button" className="voice-quiet" disabled={!computerEnabled} onClick={() => void computer.run(computer.reply)}>{translate("Again")}</button>}
        {!computer.active && <button type="button" className="voice-quiet" onClick={computer.dismiss}>{translate("Hide")}</button>}
      </div>
    </div>}
    {!hintSeen && !computerVisible && <p className="voice-hint" role="note"><span>{port.liveRecording ? translate("Audio goes to ElevenLabs on an ongoing basis.") : translate("Audio goes to ElevenLabs when transcribing.")} {" "}{translate("Recordings last at most")}{" "}{duration}{translate(". The draft stays on this device.")}{port.computerGreeting ? translate(" Long press to call the computer.") : ''}</span>
      <button type="button" className="voice-quiet" onClick={dismissHint}>{translate("Understood")}</button></p>}
    {composer.recordingOpen && <div className="voice-strip-row"><span className="voice-status">{translate("One recording is still open.")}</span>
      <button type="button" className="voice-quiet" disabled={!online} onClick={composer.checkRecording}>{translate("Check recording status")}</button>
      <button type="button" className="voice-quiet" onClick={composer.discardRecording}>{translate("Discard recording")}</button></div>}
    {composer.deliveryOpen && <div className="voice-strip-row"><span role="alert" className="voice-alert">{translate("The previous handover is not confirmed, and before re-sending, check the CLI first.")}</span>
      <button type="button" className="voice-quiet" onClick={composer.acknowledgeDelivery}>{translate("Terminal inspected – continue working on the draft")}</button></div>}
    <div className="voice-draft" data-live={listening || phase === 'transcribing'}>
      <textarea ref={composer.input} aria-label={translate("CLI-prompt draft")} rows={1} maxLength={DICTATION_MAX_TEXT_CHARS} readOnly={composer.readOnly}
        value={composer.value} placeholder={listening ? translate("Speak now…") : translate("Speak or type here…")} spellCheck={false}
        onChange={event => composer.setText(event.target.value)}
        onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && composer.canSend) { event.preventDefault(); void composer.send('submit'); } }} />
    </div>
  </>} below={<>
    {reasonOpen && reasonDetail && <p className="voice-reason-detail">{reasonDetail}</p>}
    {storageError && <p role="alert" className="voice-alert">{storageError}</p>}
    {error && <p role="alert" className="voice-alert">{localizeAppMessage(error)}</p>}
  </>}>
    <button ref={micButton} type="button" className="voice-mic" data-phase={micPhase} aria-pressed={listening || computer.phase === 'listening'} disabled={micDisabled}
      onClick={micClick} onContextMenu={event => event.preventDefault()}
      onPointerDown={event => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        if (!computerEnabled || computer.active || phase !== 'idle') return;
        press.current.long = false; clearPress();
        press.current.timer = window.setTimeout(() => { press.current.timer = undefined; press.current.long = true; vibrate(40); void computer.run(); }, LONG_PRESS_MS);
      }}
      onPointerUp={clearPress} onPointerCancel={clearPress} onPointerLeave={clearPress}>
      <span className="voice-mic-glyph"><MicIcon /></span><span className="voice-mic-label">{micLabel}</span>
    </button>
    {(computer.active || ['permission', 'recording', 'transcribing'].includes(phase)) && <button type="button" className="voice-quiet"
      onClick={() => { if (computer.active) computer.stop(); else composer.cancel(); }}>{translate("Cancel")}</button>}
    {reason && <button type="button" className="voice-reason" aria-expanded={reasonOpen} disabled={!reasonDetail} onClick={() => setReasonOpen(open => !open)}>{reason}</button>}
    {statusVisible && <span role="status" className="voice-status" data-kind={noticeKind} title={localizeAppMessage(notice)}>{shortNotice(notice, noticeKind)}</span>}
    <span style={{ flex: 1 }} />
    <button type="button" className="voice-quiet" disabled={!composer.canSend} onClick={() => void composer.send('insert')}>{translate("Paste")}</button>
    <button type="button" className="voice-quiet voice-send" disabled={!composer.canSend} aria-busy={phase === 'sending'} onClick={() => void composer.send('submit')}>
      {phase === 'sending' ? translate("Sending…") : translate("Send")}<SendIcon /></button>
  </VoiceStripFrame>;
}
