import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
/**
 * Bottom dock: a large, read-only view of one task session (readable activity
 * or the raw terminal). Stays mounted with the graph so its height, floating
 * position and raw/readable choice survive closing and reopening.
 */

import { useState } from 'react';
import type { JSX } from 'react';
import { ActivityFeed } from './ActivityFeed';
import { SessionTail } from './SessionTail';
import { I, Ico } from './graphIcons';

export interface DockTarget {
  sessionId?: string;
  taskId?: string;
  title: string;
}

export function GraphDockPanel(props: { target: DockTarget | null; onClose: () => void }): JSX.Element | null {
  useLocale();
  const dock = props.target;
  const [dockRaw, setDockRaw] = useState(false);
  const [dockHeight, setDockHeight] = useState(() => {
    const stored = Number(window.localStorage.getItem('ade.graph.dockHeight'));
    return Number.isFinite(stored) && stored >= 160 ? stored : 360;
  });
  // Null = docked full-width at the bottom; set once the user drags the bar.
  const [dockPos, setDockPos] = useState<{ x: number; y: number; w: number } | null>(() => {
    try {
      return JSON.parse(window.localStorage.getItem('ade.graph.dockPos') ?? 'null') as
        | { x: number; y: number; w: number }
        | null;
    } catch {
      return null;
    }
  });

  const startDockResize = (event: React.PointerEvent): void => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = dockHeight;
    const startPos = dockPos;
    const move = (nextEvent: PointerEvent): void => {
      const next = Math.min(
        Math.max(startHeight + (startY - nextEvent.clientY), 160),
        Math.max(240, window.innerHeight - 200),
      );
      setDockHeight(next);
      // Floating: the handle is the top edge, so keep the bottom edge fixed.
      if (startPos) setDockPos({ ...startPos, y: Math.max(0, startPos.y - (next - startHeight)) });
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDockHeight((height) => {
        window.localStorage.setItem('ade.graph.dockHeight', String(Math.round(height)));
        return height;
      });
      setDockPos((pos) => {
        if (pos) window.localStorage.setItem('ade.graph.dockPos', JSON.stringify(pos));
        return pos;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startDockDrag = (event: React.PointerEvent): void => {
    if ((event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    const panel = (event.currentTarget as HTMLElement).closest('.gdockpanel') as HTMLElement | null;
    const parent = panel?.offsetParent as HTMLElement | null;
    if (!panel || !parent) return;
    const rect = panel.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    const width = rect.width;
    const move = (nextEvent: PointerEvent): void => {
      setDockPos({
        x: Math.max(0, nextEvent.clientX - parentRect.left - offsetX),
        y: Math.max(0, nextEvent.clientY - parentRect.top - offsetY),
        w: width,
      });
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDockPos((pos) => {
        if (pos) window.localStorage.setItem('ade.graph.dockPos', JSON.stringify(pos));
        return pos;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  if (!dock) return null;
  return (
    <div
      className="gdockpanel"
      style={dockPos
        ? { height: dockHeight, left: dockPos.x, top: dockPos.y, width: dockPos.w, right: 'auto', bottom: 'auto' }
        : { height: dockHeight }}
    >
      <div className="gdockpanel-resize" title={translate("Adjust height")} onPointerDown={startDockResize} />
      <div className="gdockpanel-bar" title={translate("Drag the bar to move")} onPointerDown={startDockDrag}>
        <Ico>{I.grip}</Ico>
        <b>{dock.title}</b>
        <span>
          {dock.sessionId
            ? (dockRaw ? translate("Raw terminal · only read") : translate("Live activity · Read only"))
            : translate("Recorded Activity · Read only")}
        </span>
        <span className="gdockpanel-grow" />
        {dockPos && (
          <button
            type="button"
            aria-label={translate("Dock at the bottom again")}
            title={translate("Dock at the bottom again")}
            onClick={() => {
              setDockPos(null);
              window.localStorage.removeItem('ade.graph.dockPos');
            }}
          >
            <Ico>{I.dockDown}</Ico>
          </button>
        )}
        {dock.sessionId && (
          <button
            type="button"
            className="gdockpanel-text"
            aria-pressed={dockRaw}
            title={dockRaw ? translate("Show readable activity") : translate("Show raw terminal output")}
            onClick={() => setDockRaw((raw) => !raw)}
          >
            {dockRaw ? translate("Readable") : translate("Raw")}
          </button>
        )}
        <button type="button" aria-label={translate("Close panel")} title={translate("Close panel")} onClick={props.onClose}><Ico>{I.close}</Ico></button>
      </div>
      {dockRaw && dock.sessionId ? (
        <SessionTail
          sessionId={dock.sessionId}
          rows={22}
          cols={180}
          fontSize={12}
          scrollback={3000}
          fit
          className="gdockpanel-term"
        />
      ) : (
        <ActivityFeed sessionId={dock.sessionId} taskId={dock.taskId} />
      )}
    </div>
  );
}
