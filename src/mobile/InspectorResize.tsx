import { t as translate } from "../shared/i18n";
import { useLocale } from "../renderer/i18n/language";
import { useRef, useState, type RefObject } from 'react';

const KEY = 'ade-mobile-inspector-width';
export const INSPECTOR_MIN = 280; export const INSPECTOR_MAX = 760; const DEFAULT = 320; const STEP = 24;
/** The work area keeps at least this much room beside the details column. */
const MAIN_MIN = 320; const DIVIDER = 20;
const clamp = (value: number, available?: number) =>
  Math.round(Math.max(INSPECTOR_MIN, Math.min(available ? Math.max(INSPECTOR_MIN, Math.min(INSPECTOR_MAX, available - MAIN_MIN - DIVIDER)) : INSPECTOR_MAX, value)));

/** Width of the run details column in CSS pixels, remembered per device. */
export function useInspectorWidth() {
  const [width, setWidth] = useState<number>(() => {
    try { const saved = Number(localStorage.getItem(KEY)); if (Number.isFinite(saved) && saved > 0) return clamp(saved); }
    catch { /* The default also works without browser storage. */ }
    return DEFAULT;
  });
  const resize = (value: number, available?: number) => setWidth(() => {
    const next = clamp(value, available);
    try { localStorage.setItem(KEY, String(next)); } catch { /* Keep the current layout usable. */ }
    return next;
  });
  return { width, resize };
}

export function InspectorResize({ value, onChange, container }: {
  value: number; onChange: (value: number, available?: number) => void; container: RefObject<HTMLDivElement | null>;
}) {
  useLocale();
  const drag = useRef<{ id: number; x: number; value: number } | null>(null);
  const available = () => container.current?.getBoundingClientRect().width;
  return <div className="m-inspector-resize" role="separator" tabIndex={0} aria-label={translate("Width of the details column")} aria-orientation="vertical"
    aria-controls="run-inspector" aria-valuemin={INSPECTOR_MIN} aria-valuemax={INSPECTOR_MAX} aria-valuenow={value} aria-valuetext={`${value} px`}
    title={translate("Drag or adjust with arrow keys. Home: smallest width, end: largest width.")}
    onKeyDown={(event) => {
      // The column sits on the right: moving the divider left makes it wider.
      let next: number;
      if (event.key === 'ArrowLeft') next = value + STEP;
      else if (event.key === 'ArrowRight') next = value - STEP;
      else if (event.key === 'Home') next = INSPECTOR_MIN;
      else if (event.key === 'End') next = INSPECTOR_MAX;
      else return;
      event.preventDefault(); onChange(next, available());
    }}
    onPointerDown={(event) => {
      if (!event.isPrimary || event.button !== 0) return;
      event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { id: event.pointerId, x: event.clientX, value };
    }}
    onPointerMove={(event) => {
      const start = drag.current;
      if (start?.id === event.pointerId) onChange(start.value - (event.clientX - start.x), available());
    }}
    onPointerUp={(event) => { if (drag.current?.id === event.pointerId) { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); } }}
    onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
  ><span aria-hidden="true">⋮</span></div>;
}
