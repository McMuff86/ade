import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { DICTATION_MAX_TEXT_CHARS } from '../../shared/dictation';
import { usePromptComposer, type PromptComposerPort, type PromptNoticeKind, type PromptPhase } from './PromptComposer';
import { ComputerVoiceTest } from './ComputerVoiceTest';
import './voice-strip.css';

const HINT_KEY = 'ade-voice-strip-hint-seen';
const TRANSIENT: PromptNoticeKind[] = ['submitted', 'inserted', 'copied', 'cleared'];
const mmss = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

export const MicIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
  <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>;
export const KeyboardIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
  <rect x="3" y="6" width="18" height="12" rx="2" /><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" /></svg>;
const SendIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
const MoreIcon = () => <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="6" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="18" cy="12" r="1.8" /></svg>;

/** Shared frame so a blocked or empty strip keeps the same footprint as the live one. */
export function VoiceStripFrame({ above, below, children, trailing, phase = 'idle', className = '' }: {
  above?: ReactNode; below?: ReactNode; children: ReactNode; trailing?: ReactNode; phase?: PromptPhase; className?: string;
}) {
  return <section className={`voice-strip ${className}`} aria-label="Sprachleiste" data-phase={phase}>
    <div className="voice-strip-above">{above}</div>
    <div className="voice-strip-row">{children}<div className="voice-trailing">{trailing}</div></div>
    <div className="voice-strip-below">{below}</div>
  </section>;
}

function shortNotice(text: string, kind: PromptNoticeKind): string {
  switch (kind) {
    case 'transcribed': return 'Erkannt · prüfen, dann senden';
    case 'empty': return 'Keine Sprache erkannt';
    case 'submitted': return 'Übergeben ✓';
    case 'inserted': return 'Eingefügt ✓ · im Terminal mit Enter bestätigen';
    case 'cancelled': return 'Aufnahme abgebrochen';
    case 'recovered': return text.includes('gekürzt') ? 'Zwischenstand gesichert und gekürzt · bitte prüfen' : 'Verbindung unterbrochen · Zwischenstand gesichert, bitte prüfen';
    case 'pending': return 'Erkennung läuft noch · später prüfen';
    case 'copied': return 'Kopiert ✓';
    case 'cleared': return 'Entwurf gelöscht';
    default: return text;
  }
}

/** One voice turn without leaving the terminal: speak, read, send. Mount with a
 * key equal to draftKey; the same draft store backs the large editor. */
export function VoiceStrip({ draftKey, online, speechAllowed, port, trailing, onOpenEditor }: {
  draftKey: string; online: boolean; speechAllowed: boolean; port: PromptComposerPort; trailing?: ReactNode; onOpenEditor?: () => void;
}) {
  const composer = usePromptComposer({ draftKey, online, speechAllowed, port });
  const { draft, phase, seconds, maxSeconds, error, notice, noticeKind, storageError, capability, computerBusy } = composer;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null); const menu = useRef<HTMLDivElement>(null);
  const [computerOpen, setComputerOpen] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [hintSeen, setHintSeen] = useState(() => { try { return localStorage.getItem(HINT_KEY) === '1'; } catch { return false; } });
  const [flash, setFlash] = useState(false);
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
  const micLabel = phase === 'permission' ? 'Mikrofon…' : listening ? `Hört zu · ${mmss(seconds)}` : phase === 'transcribing' ? 'Wird erkannt…' : 'Sprechen';
  const micDisabled = phase === 'idle' ? !composer.canRecord : !listening;
  const capabilityReason = capability.available ? '' : capability.reason;
  const checking = capabilityReason.startsWith('Sitzungsziel wird geprüft');
  const reason = phase !== 'idle' ? '' : !online ? 'Offline' : !speechAllowed ? 'Diktat nicht freigegeben' : capability.available ? '' : checking ? 'Sitzung wird geprüft…' : 'Kein CLI-Prompt';
  const reasonDetail = !online ? 'Der Entwurf kann weiter bearbeitet werden; Sprechen und Senden brauchen die Verbindung zum PC.'
    : !speechAllowed ? 'ElevenLabs-Diktat braucht die eigene Diktat-Freigabe am PC unter Settings → Verbundene Geräte.'
    : capability.available ? '' : `${capabilityReason} Vor der Übergabe Anmeldung und Projektvertrauen direkt im Terminal abschliessen; die CLI muss ihren Eingabeprompt anzeigen.`;
  const statusVisible = !!notice && (!TRANSIENT.includes(noticeKind) || flash);
  const duration = maxSeconds >= 120 ? `${maxSeconds / 60} Minuten` : `${maxSeconds} Sekunden`;
  const computerEnabled = online && speechAllowed && port.computerAllowed !== false && phase === 'idle' && !draft.delivery && !draft.recordingJob;

  return <VoiceStripFrame phase={phase} className="voice-strip-live" trailing={<>
    {trailing}
    <div className="voice-menu-host">
      <button ref={menuButton} type="button" className="voice-icon-button" aria-label="Weitere Optionen" aria-haspopup="menu" aria-expanded={menuOpen}
        onClick={() => setMenuOpen(open => !open)}><MoreIcon /></button>
      {menuOpen && <div ref={menu} role="menu" aria-label="Weitere Optionen" className="voice-menu" onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(); return; }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        const items = [...menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
      }}>
        {port.computerGreeting && <button type="button" role="menuitem" disabled={!computerOpen && !computerEnabled}
          onClick={() => { setComputerOpen(open => !open); closeMenu(); }}>{computerOpen ? 'Computer ausblenden' : 'Computer rufen'}</button>}
        {onOpenEditor && <button type="button" role="menuitem" disabled={phase !== 'idle' || computerBusy} onClick={() => { closeMenu(false); onOpenEditor(); }}>Im Editor öffnen</button>}
        {port.copyText && <button type="button" role="menuitem" disabled={!composer.value} onClick={() => { composer.copy(); closeMenu(); }}>Entwurf kopieren</button>}
        <button type="button" role="menuitem" disabled={phase !== 'idle' || !!draft.delivery || !composer.value} onClick={() => { composer.clear(); closeMenu(); }}>Entwurf löschen</button>
        <button type="button" role="menuitem" onClick={() => { setHintSeen(false); closeMenu(); }}>Hinweise anzeigen</button>
      </div>}
    </div>
  </>} above={<>
    {computerOpen && port.computerGreeting && <div className="voice-strip-computer">
      <ComputerVoiceTest port={port} onBusy={composer.setComputerBusy} enabled={computerEnabled} />
      <button type="button" className="voice-quiet" disabled={computerBusy} onClick={() => setComputerOpen(false)}>Computer ausblenden</button>
    </div>}
    {!hintSeen && !computerOpen && <p className="voice-hint" role="note"><span>{port.liveRecording ? 'Audio geht beim Sprechen laufend an ElevenLabs.' : 'Audio geht beim Transkribieren an ElevenLabs.'} Aufnahmen dauern höchstens {duration}. Der Entwurf bleibt auf diesem Gerät.</span>
      <button type="button" className="voice-quiet" onClick={dismissHint}>Verstanden</button></p>}
    {composer.recordingOpen && <div className="voice-strip-row"><span className="voice-status">Eine Aufnahme ist noch offen.</span>
      <button type="button" className="voice-quiet" disabled={!online} onClick={composer.checkRecording}>Status der Aufnahme prüfen</button>
      <button type="button" className="voice-quiet" onClick={composer.discardRecording}>Aufnahme verwerfen</button></div>}
    {composer.deliveryOpen && <div className="voice-strip-row"><span role="alert" className="voice-alert">Die vorige Übergabe ist nicht bestätigt. Vor erneutem Senden zuerst die CLI prüfen.</span>
      <button type="button" className="voice-quiet" onClick={composer.acknowledgeDelivery}>Terminal geprüft – Entwurf weiterbearbeiten</button></div>}
    <div className="voice-draft" data-live={listening || phase === 'transcribing'}>
      <textarea ref={composer.input} aria-label="CLI-Promptentwurf" rows={1} maxLength={DICTATION_MAX_TEXT_CHARS} readOnly={composer.readOnly}
        value={composer.value} placeholder={listening ? 'Sprich jetzt …' : 'Sprechen oder hier tippen …'} spellCheck={false}
        onChange={event => composer.setText(event.target.value)}
        onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && composer.canSend) { event.preventDefault(); void composer.send('submit'); } }} />
    </div>
  </>} below={<>
    {reasonOpen && reasonDetail && <p className="voice-reason-detail">{reasonDetail}</p>}
    {storageError && <p role="alert" className="voice-alert">{storageError}</p>}
    {error && <p role="alert" className="voice-alert">{error}</p>}
  </>}>
    <button type="button" className="voice-mic" data-phase={phase} aria-pressed={listening} disabled={micDisabled}
      onClick={() => { if (listening) composer.stop(); else void composer.record(); }}>
      <span className="voice-mic-glyph"><MicIcon /></span><span className="voice-mic-label">{micLabel}</span>
    </button>
    {['permission', 'recording', 'transcribing'].includes(phase) && <button type="button" className="voice-quiet" onClick={composer.cancel}>Abbrechen</button>}
    {reason && <button type="button" className="voice-reason" aria-expanded={reasonOpen} disabled={!reasonDetail} onClick={() => setReasonOpen(open => !open)}>{reason}</button>}
    {statusVisible && <span role="status" className="voice-status" data-kind={noticeKind} title={notice}>{shortNotice(notice, noticeKind)}</span>}
    <span style={{ flex: 1 }} />
    <button type="button" className="voice-quiet" disabled={!composer.canSend} onClick={() => void composer.send('insert')}>Einfügen</button>
    <button type="button" className="voice-quiet voice-send" disabled={!composer.canSend} aria-busy={phase === 'sending'} onClick={() => void composer.send('submit')}>
      {phase === 'sending' ? 'Übergeben…' : 'Senden'}<SendIcon /></button>
  </VoiceStripFrame>;
}
