/** Canvas viewport: pan by dragging the background, zoom by wheel or buttons, fit to content. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { zoomViewAt } from '../viewTransform';
import type { Pos } from './graphStore';
import type { RunClusterModel } from './graphModel';
import { CLUSTER_H, GRAPH_SCALE, clusterWidth } from './graphLayout';

export interface GraphViewState {
  x: number;
  y: number;
  scale: number;
}

export interface GraphViewport {
  view: GraphViewState;
  canvasRef: React.RefObject<HTMLDivElement | null>;
  onCanvasPointerDown: (event: React.PointerEvent) => void;
  onWheel: (event: React.WheelEvent) => void;
  zoomBy: (factor: number) => void;
  fitView: () => void;
}

export function useGraphViewport(
  clusters: RunClusterModel[],
  clusterPos: (runId: string) => Pos,
  onBackgroundPointerDown: () => void,
): GraphViewport {
  const [view, setView] = useState<GraphViewState>({ x: 40, y: 10, scale: 0.8 });
  const canvasRef = useRef<HTMLDivElement>(null);

  const panRef = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null);
  const onCanvasPointerDown = (event: React.PointerEvent): void => {
    const target = event.target as HTMLElement;
    if (target.closest('.gcard') || target.closest('.gteam-bar') || target.closest('.gcluster-bar')) return;
    onBackgroundPointerDown();
    panRef.current = { startX: event.clientX, startY: event.clientY, x: view.x, y: view.y };
    canvasRef.current?.classList.add('panning');
    const move = (nextEvent: PointerEvent): void => {
      const pan = panRef.current;
      if (!pan) return;
      setView((current) => ({
        ...current,
        x: pan.x + nextEvent.clientX - pan.startX,
        y: pan.y + nextEvent.clientY - pan.startY,
      }));
    };
    const up = (): void => {
      panRef.current = null;
      canvasRef.current?.classList.remove('panning');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onWheel = (event: React.WheelEvent): void => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    setView((current) => zoomViewAt(current, event.deltaY < 0 ? 1.1 : 0.9, { x: event.clientX - rect.left, y: event.clientY - rect.top }, GRAPH_SCALE));
  };

  const zoomBy = (factor: number): void => setView((current) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return zoomViewAt(current, factor, { x: (rect?.width ?? 800) / 2, y: (rect?.height ?? 600) / 2 }, GRAPH_SCALE);
  });

  const fitView = useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || clusters.length === 0) return;
    let left = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    for (const cluster of clusters) {
      const position = clusterPos(cluster.run.id);
      left = Math.min(left, position.x);
      right = Math.max(right, position.x + clusterWidth(cluster));
      top = Math.min(top, position.y);
      bottom = Math.max(bottom, position.y + CLUSTER_H);
    }
    const padding = 70;
    const width = Math.max(320, right - left);
    const height = Math.max(320, bottom - top);
    const scale = Math.min(1.1, Math.max(0.3, Math.min(
      (rect.width - padding * 2) / width,
      (rect.height - padding * 2 - 60) / height,
    )));
    setView({
      scale,
      x: (rect.width - width * scale) / 2 - left * scale,
      // Centre vertically when there is spare room (large/fullscreen windows),
      // otherwise keep the classic top padding anchor.
      y: Math.max(padding, (rect.height - height * scale) / 2) - top * scale,
    });
  }, [clusters, clusterPos]);

  // Fullscreen toggle / window resize: refit so the content uses the new
  // canvas size instead of staying in the old viewport's corner.
  useEffect(() => {
    let timer: number | undefined;
    const onResize = (): void => {
      window.clearTimeout(timer);
      timer = window.setTimeout(fitView, 160);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', onResize);
    };
  }, [fitView]);

  useEffect(() => {
    const frame = requestAnimationFrame(fitView);
    return () => cancelAnimationFrame(frame);
    // Refit only when the visible cluster set changes, not on every drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clusters.length]);

  return { view, canvasRef, onCanvasPointerDown, onWheel, zoomBy, fitView };
}
