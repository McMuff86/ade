import { t as translate } from "../shared/i18n";
import { useLocale } from "../renderer/i18n/language";
import { useRef, useState, type CSSProperties, type RefObject } from 'react';

const KEY = 'ade-mobile-terminal-panel-widths';
const clamp = (value: number) => Math.max(14, Math.min(32, value));
export function useTerminalPanelWidths() {
  const [widths, setWidths] = useState<[number, number]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
      if (Array.isArray(saved) && saved.length === 2 && saved.every((n) => typeof n === 'number' && Number.isFinite(n))) return [clamp(saved[0]), clamp(saved[1])];
    } catch { /* Defaults also work without browser storage. */ }
    return [20, 20];
  });
  const resize = (index: 0 | 1, value: number) => setWidths((previous) => {
    const next: [number, number] = [...previous]; next[index] = clamp(value);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* Keep the current layout usable. */ }
    return next;
  });
  return { widths, resize, style: { '--terminal-agents-width': `${widths[0]}%`, '--terminal-inspector-width': `${widths[1]}%` } as CSSProperties };
}

export function TerminalPanelResize({ side, value, onChange, container }: {
  side: 'agents' | 'inspector'; value: number; onChange: (value: number) => void; container: RefObject<HTMLDivElement | null>;
}) {
  useLocale();
  const drag = useRef<{ id: number; x: number; value: number; width: number } | null>(null);
  const direction = side === 'agents' ? 1 : -1;
  return <div className={`m-terminal-resize m-terminal-resize-${side}`} role="separator" tabIndex={0}
    aria-label={side === 'agents' ? translate("Width of the agent list") : translate("Width of the inspector")} aria-orientation="vertical"
    aria-controls={side === 'agents' ? 'terminal-navigation' : 'terminal-inspector'}
    aria-valuemin={14} aria-valuemax={32} aria-valuenow={Math.round(value)} aria-valuetext={`${Math.round(value)} Prozent`}
    title={translate("Drag or adjust with arrow keys. Home: smallest width, end: largest width.")}
    onKeyDown={(event) => {
      let next: number;
      if (event.key === 'ArrowLeft') next = value - direction * 2;
      else if (event.key === 'ArrowRight') next = value + direction * 2;
      else if (event.key === 'Home') next = 14;
      else if (event.key === 'End') next = 32;
      else return;
      event.preventDefault(); onChange(next);
    }}
    onPointerDown={(event) => {
      if (!event.isPrimary || event.button !== 0) return;
      const width = container.current?.getBoundingClientRect().width;
      if (!width) return;
      event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { id: event.pointerId, x: event.clientX, value, width };
    }}
    onPointerMove={(event) => {
      const start = drag.current;
      if (start?.id === event.pointerId) onChange(start.value + direction * (event.clientX - start.x) / start.width * 100);
    }}
    onPointerUp={(event) => { if (drag.current?.id === event.pointerId) { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); } }}
    onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
  ><span aria-hidden="true">⋮</span></div>;
}
