import { useLayoutEffect, useRef, type JSX, type ReactNode } from 'react';
import type { RunSummary } from '../shared/types';

export type View = 'overview' | 'projects' | 'work' | 'graph';
export const VIEWS: { id: View; label: string }[] = [{ id: 'overview', label: 'Overview' }, { id: 'projects', label: 'Projekte' }, { id: 'work', label: 'Work' }, { id: 'graph', label: 'Graph' }];
export const finalStates = new Set(['completed', 'failed', 'cancelled']);
export function Icon({ name }: { name: View | 'plus' | 'close' | 'settings' | 'project' | 'refresh' | 'sun' | 'moon' }): JSX.Element {
  const paths: Record<string, ReactNode> = {
    overview: <path d="M4 7h16M4 12h10M4 17h7" />,
    work: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="m8 9 2 2 4-4M8 16h8" /></>,
    graph: <><circle cx="12" cy="5" r="2.4" /><circle cx="5" cy="18" r="2.4" /><circle cx="19" cy="18" r="2.4" /><path d="M12 7.4v4M10.5 13l-4 3M13.5 13l4 3" /></>,
    plus: <path d="M12 5v14M5 12h14" />, close: <path d="m6 6 12 12M6 18 12 6" />,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v4m0 12v4M2 12h4m12 0h4M5 5l3 3m8 8 3 3M5 19l3-3m8-8 3-3" /></>,
    project: <path d="M3 7V5h7l2 3h9v11H3z" />,
    refresh: <><path d="M20 11a8 8 0 1 0-2 7M20 4v7h-7" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2" /></>,
    moon: <path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z" />,
  };
  return <svg className="m-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name === 'projects' ? 'project' : name]}</svg>;
}
export function Status({ status }: { status: string }): JSX.Element {
  return <span className="m-status" data-status={status}>{status}</span>;
}
export function runKindLabel(run: RunSummary): string {
  return run.mode === 'managed' ? 'Managed Run' : run.status === 'draft' ? 'Run-Entwurf' : 'Tasks';
}
export function Chrome({ children }: { children: ReactNode }): JSX.Element {
  return <div className="m-window-bar"><span className="m-traffic" aria-hidden="true"><i /><i /><i /></span>{children}</div>;
}
export function Empty({ children, title }: { children?: ReactNode; title: string }): JSX.Element {
  return <div className="m-empty"><Icon name="graph" /><h2>{title}</h2>{children}</div>;
}
export function reportedTokens(runs: RunSummary[]): string | null {
  const total = runs.reduce((sum, run) => sum + run.usage.inputTokens + run.usage.outputTokens, 0);
  // This DTO has no reporting-completeness bit. Zero cannot prove measured zero usage.
  return total > 0 ? String(total) : null;
}

export function Dialog({ title, children, onClose, fallbackId = 'view-tab-overview', className = '', restoreFocusTo }: {
  title: string; children: ReactNode; onClose: () => void; fallbackId?: string; className?: string; restoreFocusTo?: HTMLElement | null;
}): JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useLayoutEffect(() => {
    // Openers focus themselves on activation: WebKit pointer clicks alone do not
    // identify the opener through activeElement, unlike keyboard activation.
    const opener = restoreFocusTo === undefined ? document.activeElement instanceof HTMLElement ? document.activeElement : null : restoreFocusTo;
    const dialog = ref.current!; dialog.showModal();
    // Prefer the heading so long forms start at the top and mobile keyboards stay closed.
    (dialog.querySelector<HTMLElement>('[data-inspector-heading]') ?? dialog.querySelector<HTMLElement>('[data-dialog-heading]'))?.focus();
    return () => {
      dialog.close();
      const target = opener?.isConnected && opener.matches('button,input,select,textarea,a[href],[tabindex]')
        && !opener.matches(':disabled') && opener.getClientRects().length && !opener.closest('[inert]') ? opener : document.getElementById(fallbackId);
      target?.focus();
    };
  }, [fallbackId]);
  return <dialog ref={ref} className={`m-dialog ${className}`} aria-label={title} onCancel={(event) => { event.preventDefault(); close.current(); }}
    onKeyDown={(event) => {
      if (event.key !== 'Tab') return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex]:not([tabindex="-1"])')]
        .filter((node) => !node.matches(':disabled') && node.getClientRects().length > 0);
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && (!controls.includes(document.activeElement as HTMLElement) || document.activeElement === first)) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}
    onClick={(event) => { if (event.target === ref.current) { const box = ref.current.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close.current(); } }}>
    <div className="m-dialog-head"><h2 tabIndex={-1} data-dialog-heading>{title}</h2><button className="m-icon-button" aria-label={`${title} schliessen`} onClick={onClose}><Icon name="close" /></button></div>
    {children}
  </dialog>;
}
