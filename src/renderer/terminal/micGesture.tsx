import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
/**
 * The handover gesture, identical on the tablet voice strip and the desktop
 * prompt dock: tap dictates, holding for LONG_PRESS_MS calls the Computer
 * (Shift+Enter from the keyboard), a ring fills while the finger is down, and
 * the surface shows one handover state (data-state). This is the one place
 * where ADE's interface is allowed to be distinctive (UI plan §5, §6.7).
 */
import { useEffect, useRef, useState, type JSX } from 'react';
import { localizedLabels } from "../../shared/i18n/labels";
import type { PromptNoticeKind, PromptPhase } from './PromptComposer';
import type { ComputerPhase } from './useComputerCall';
import './mic-gesture.css';

export const LONG_PRESS_MS = 550;

export const MicIcon = () => { useLocale(); return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
  <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>); };

/** Microphone label while the Computer call runs. */
export const COMPUTER_LABEL: Record<ComputerPhase, string> = localizedLabels(() => ({
  idle: '', preparing: translate("Microphone …"), listening: translate("Say “Computer”"), finishing: translate("“Computer” detected…"), greeting: translate("Greeting…"), speaking: translate("Computer is replying…"),
}));

/** idle → sending → confirmed; offline and needs-check interrupt the path. */
export type HandoverState = 'idle' | 'sending' | 'confirmed' | 'offline' | 'needs-check';

export function useHandoverState(input: {
  online: boolean;
  phase: PromptPhase;
  notice: string;
  noticeKind: PromptNoticeKind;
  error?: string | null;
  deliveryOpen: boolean;
  recordingOpen: boolean;
}): HandoverState {
  const confirmedNotice = !!input.notice && (input.noticeKind === 'submitted' || input.noticeKind === 'inserted');
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    if (!confirmedNotice) { setConfirmed(false); return; }
    setConfirmed(true);
    const timer = window.setTimeout(() => setConfirmed(false), 2500);
    return () => clearTimeout(timer);
  }, [confirmedNotice, input.notice]);
  if (!input.online) return 'offline';
  if (input.deliveryOpen || input.recordingOpen || !!input.error
    || input.noticeKind === 'recovered' || input.noticeKind === 'pending') return 'needs-check';
  if (input.phase === 'sending') return 'sending';
  return confirmed ? 'confirmed' : 'idle';
}

/**
 * Pointer and keyboard wiring for the microphone button. A long press ends
 * with a click that must be swallowed; when the surface re-laid out under the
 * finger that click never arrives, so the flag is reset right after pointerup.
 */
export function useMicGesture(options: { holdEnabled: boolean; onTap: () => void; onHold: () => void }) {
  const press = useRef<{ timer?: number; long: boolean }>({ long: false });
  const [holding, setHolding] = useState(false);
  const clearPress = (): void => {
    if (press.current.timer) { clearTimeout(press.current.timer); press.current.timer = undefined; }
    setHolding(false);
  };
  const releasePress = (): void => {
    clearPress();
    if (press.current.long) window.setTimeout(() => { press.current.long = false; }, 0);
  };
  useEffect(() => () => { if (press.current.timer) clearTimeout(press.current.timer); }, []);
  return {
    holding,
    props: {
      'data-holding': holding ? 'true' : undefined,
      'aria-keyshortcuts': options.holdEnabled ? 'Shift+Enter' : undefined,
      onClick: (): void => {
        if (press.current.long) { press.current.long = false; return; }
        options.onTap();
      },
      onContextMenu: (event: React.MouseEvent): void => event.preventDefault(),
      onPointerDown: (event: React.PointerEvent): void => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        if (!options.holdEnabled) return;
        press.current.long = false; clearPress(); setHolding(true);
        const onHold = options.onHold;
        press.current.timer = window.setTimeout(() => {
          press.current.timer = undefined; press.current.long = true; setHolding(false); onHold();
        }, LONG_PRESS_MS);
      },
      onPointerUp: releasePress,
      onPointerCancel: releasePress,
      onPointerLeave: releasePress,
      onKeyDown: (event: React.KeyboardEvent): void => {
        if (event.key !== 'Enter' || !event.shiftKey || !options.holdEnabled) return;
        event.preventDefault();
        options.onHold();
      },
    },
  };
}

/** Progress ring drawn around the microphone glyph; fills while holding. */
export function MicRing(): JSX.Element {
  useLocale();
  return (
    <svg className="mic-ring" viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="18" pathLength={100} />
    </svg>
  );
}

/** Screen-reader description of the gesture, referenced by aria-describedby. */
export function MicGestureDescription({ id, hold }: { id: string; hold: boolean }): JSX.Element {
  useLocale();
  return <span id={id} hidden>{hold ? translate("Tap to dictate, hold to call the Computer (keyboard: Shift+Enter).") : translate("Tap to dictate.")}</span>;
}
