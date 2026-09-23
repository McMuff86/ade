/**
 * Pan/zoom view math shared by the graph canvas and the sketch sheet. A view
 * maps content coordinates to screen pixels: screen = content * scale + (x, y).
 * Pure functions, so the rules are unit-testable and identical on both surfaces.
 */

export interface ViewTransform { x: number; y: number; scale: number }
export interface ScaleBounds { min: number; max: number }
export interface Size { width: number; height: number }
export interface Point { x: number; y: number }

export const clampScale = (scale: number, bounds: ScaleBounds): number => Math.min(bounds.max, Math.max(bounds.min, scale));

/** Zoom by `factor`, keeping the screen point `at` over the same content point. */
export function zoomViewAt(view: ViewTransform, factor: number, at: Point, bounds: ScaleBounds): ViewTransform {
  const scale = clampScale(view.scale * factor, bounds); const ratio = scale / view.scale;
  return { scale, x: at.x - (at.x - view.x) * ratio, y: at.y - (at.y - view.y) * ratio };
}

export const panView = (view: ViewTransform, dx: number, dy: number): ViewTransform => ({ ...view, x: view.x + dx, y: view.y + dy });

/** Centre `content` inside `viewport` with `padding` on every side; the scale is the largest that fits. */
export function fitView(content: Size, viewport: Size, padding: number, bounds?: ScaleBounds): ViewTransform {
  const raw = Math.min((viewport.width - padding * 2) / content.width, (viewport.height - padding * 2) / content.height);
  const scale = bounds ? clampScale(raw, bounds) : Math.max(raw, Number.EPSILON);
  return { scale, x: (viewport.width - content.width * scale) / 2, y: (viewport.height - content.height * scale) / 2 };
}

/** Keep at least `visible` (fraction) of the content, or of the viewport when the content is larger, on screen per axis. */
export function clampView(view: ViewTransform, content: Size, viewport: Size, visible = .25): ViewTransform {
  const width = content.width * view.scale; const height = content.height * view.scale;
  const keepX = visible * Math.min(width, viewport.width); const keepY = visible * Math.min(height, viewport.height);
  return { ...view, x: Math.min(viewport.width - keepX, Math.max(keepX - width, view.x)), y: Math.min(viewport.height - keepY, Math.max(keepY - height, view.y)) };
}

export const toContentPoint = (view: ViewTransform, screen: Point): Point => ({ x: (screen.x - view.x) / view.scale, y: (screen.y - view.y) / view.scale });

/** Two fingers moved from (a0, b0) to (a1, b1): scale about the old midpoint, then follow the midpoint. */
export function pinchView(view: ViewTransform, a0: Point, b0: Point, a1: Point, b1: Point, bounds: ScaleBounds): ViewTransform {
  const before = Math.hypot(b0.x - a0.x, b0.y - a0.y); const after = Math.hypot(b1.x - a1.x, b1.y - a1.y);
  const from = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 }; const to = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
  const zoomed = before > 0 && after > 0 ? zoomViewAt(view, after / before, from, bounds) : view;
  return panView(zoomed, to.x - from.x, to.y - from.y);
}
