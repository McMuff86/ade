/**
 * Accessible modal shell: role=dialog + aria-modal, Esc to close, overlay
 * click to close, and focus-trap-lite (focus moves in on open, Tab cycles
 * within the dialog, focus restored to the opener on close).
 */

import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

interface ModalProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  /** Rendered above the title (e.g. a large avatar on the agent card). */
  lead?: ReactNode;
  /** Extra class on the dialog for purpose-specific styling. */
  className?: string;
  /** Stable fallback for flows whose opener can disappear while the dialog is open. */
  fallbackFocus?: () => HTMLElement | null;
}

const FOCUSABLE =
  'a[href], summary, button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * Dialog focus discipline shared by Modal and full-bleed dialogs such as the
 * sketch sheet: focus moves in on mount (the first field, else the dialog),
 * Tab cycles within the dialog, and focus returns to the opener on unmount
 * or to `fallbackFocus` when the opener disappeared. Returns the Tab handler.
 */
export function useDialogFocus(
  dialogRef: RefObject<HTMLElement | null>,
  fallbackFocus?: () => HTMLElement | null,
  initialFocus?: () => HTMLElement | null,
): (e: React.KeyboardEvent) => void {
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    // move focus into the dialog (first field, else the dialog itself)
    const first = initialFocus?.() ?? Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
      .find(node => node.tabIndex >= 0 && node.getClientRects().length > 0);
    (first ?? dialogRef.current)?.focus();

    return () => {
      if (opener?.isConnected && !opener.matches(':disabled')) opener.focus();
      else fallbackFocus?.()?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (e: React.KeyboardEvent): void => {
    if (e.key !== 'Tab') return;
    const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (!nodes || nodes.length === 0) { e.preventDefault(); dialogRef.current?.focus(); return; }
    const list = Array.from(nodes).filter(node => node.tabIndex >= 0 && node.getClientRects().length > 0);
    if (!list.length) { e.preventDefault(); dialogRef.current?.focus(); return; }
    const first = list[0];
    const last = list[list.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };
}

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  lead,
  className,
  fallbackFocus,
}: ModalProps): React.ReactElement {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useRef(`modal-title-${Math.random().toString(36).slice(2)}`).current;
  const trapTab = useDialogFocus(dialogRef, fallbackFocus);

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    trapTab(e);
  };

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={className ? `modal ${className}` : 'modal'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={dialogRef}
        onKeyDown={onKeyDown}
      >
        {lead}
        <h2 id={titleId}>{title}</h2>
        {subtitle ? <div className="modal-sub">{subtitle}</div> : null}
        {children}
      </div>
    </div>
  );
}
