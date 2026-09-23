/**
 * Sketch input roles: who may draw on the sheet — pen, finger or mouse — and
 * when a touch contact is a resting hand. Pure functions over pointer facts so
 * the rules are unit-testable without a browser; the editor owns the state.
 *
 * Rules (docs/SKETCH_UX_PROPOSAL.md §4):
 *  - A pen near the sheet (hovering or down) turns every touch contact into
 *    navigation for PEN_NEAR_MS. Windows Ink reports hover moves, so the hand
 *    is protected before the pen touches the glass.
 *  - A touch contact wider than PALM_CONTACT_PX is a palm and never draws.
 *  - Once a device has seen a pen, the finger stops drawing in mode `auto` and
 *    moves the sheet instead (on the sheet: pan; in a page: scroll).
 *  - The pen's eraser end or barrel button erases while held.
 * Mode, "pen seen", ink, width and tool side are device preferences, never document data.
 */

export type SketchInputMode = 'auto' | 'pen-draws' | 'finger-draws';
import { SKETCH_BRUSHES, type SketchBrush } from '../../shared/organizer';
export const SKETCH_INPUT_MODES: readonly SketchInputMode[] = ['auto', 'pen-draws', 'finger-draws'];
export type SheetPointerRole = 'draw' | 'erase' | 'pan' | 'ignore';
export type SketchPointerRole = Exclude<SheetPointerRole, 'pan'>;

export const PEN_NEAR_MS = 1500;
export const PALM_CONTACT_PX = 24;

/** The fixed ink palette; every value is `#rrggbb` as the organizer contract requires. */
export const SKETCH_INKS = [
  { id: 'ink', value: '#1F1D1A' }, { id: 'blue', value: '#2155D6' }, { id: 'copper', value: '#A96B22' },
  { id: 'red', value: '#C14B42' }, { id: 'green', value: '#2F8A5D' }, { id: 'grey', value: '#7C838E' },
  /** Marker yellow: the natural highlighter colour; reads as a translucent band over ink. */
  { id: 'yellow', value: '#F2C200' },
] as const;
export type SketchInkId = typeof SKETCH_INKS[number]['id'];
export const SKETCH_WIDTHS = [2, 5, 11] as const;
export const inkFor = (value: string): typeof SKETCH_INKS[number] | undefined => SKETCH_INKS.find(ink => ink.value.toLowerCase() === value.toLowerCase());
export const nearestWidth = (width: number): number => SKETCH_WIDTHS.reduce((best, item) => Math.abs(item - width) < Math.abs(best - width) ? item : best, SKETCH_WIDTHS[1] as number);
const integerIn = (value: unknown, min: number, max: number): value is number => Number.isInteger(value) && (value as number) >= min && (value as number) <= max;

export interface SketchPointerFacts {
  pointerType: string; button: number; buttons: number; width: number; height: number;
}
export interface SketchInputState {
  mode: SketchInputMode;
  /** This device has reported a pen pointer at least once. */
  penSeen: boolean;
  /** Timestamp of the last pen event (hover or contact), or -Infinity. */
  lastPenAt: number;
  /** A pen pointer is currently in contact. */
  penDown: boolean;
}

const isPen = (facts: SketchPointerFacts): boolean => facts.pointerType === 'pen';
/** Barrel button (buttons bit 2) or eraser end (button 5 / buttons bit 32). */
export const penErases = (facts: SketchPointerFacts): boolean => isPen(facts) && (facts.button === 5 || (facts.buttons & 32) !== 0 || (facts.buttons & 2) !== 0);
export const isPalm = (facts: SketchPointerFacts): boolean => facts.pointerType === 'touch' && (facts.width > PALM_CONTACT_PX || facts.height > PALM_CONTACT_PX);
export const penNear = (state: SketchInputState, now: number): boolean => state.penDown || now - state.lastPenAt < PEN_NEAR_MS;
/** Whether finger contacts are navigation (page scroll in the note, pan/zoom on the sheet). */
export const fingerNavigates = (state: SketchInputState): boolean => state.mode === 'pen-draws' || (state.mode === 'auto' && state.penSeen);

/** Role of a new pointer on the full sheet, where a finger may also pan and the middle mouse button or Space + drag pans. */
export function sheetPointerRole(state: SketchInputState, facts: SketchPointerFacts, now: number, options: { spaceHeld?: boolean } = {}): SheetPointerRole {
  if (isPen(facts)) return penErases(facts) ? 'erase' : facts.button === 0 ? 'draw' : 'ignore';
  if (facts.pointerType === 'touch') {
    if (isPalm(facts) || penNear(state, now)) return 'ignore';
    if (fingerNavigates(state)) return 'pan';
    return facts.button === 0 || facts.button === -1 ? 'draw' : 'ignore';
  }
  if (facts.button === 1) return 'pan';
  return facts.button === 0 ? options.spaceHeld ? 'pan' : 'draw' : 'ignore';
}

/** Role in a surface without navigation of its own (the embedded preview): a navigating finger is simply ignored. */
export function sketchPointerRole(state: SketchInputState, facts: SketchPointerFacts, now: number): SketchPointerRole {
  const role = sheetPointerRole(state, facts, now); return role === 'pan' ? 'ignore' : role;
}

/** Device preferences for the sketch tools; storage failures fall back to defaults. */
export interface SketchPreferences {
  mode: SketchInputMode; penSeen: boolean; color: string; width: number; toolsSide: 'left' | 'right'; hintSeen: boolean; grid: boolean;
  /** Pen pressure modulates the line width. */
  pressure: boolean;
  eraserMode: 'stroke' | 'partial'; eraserSize: number;
  /** PNG export raster per sheet point. */
  exportScale: number;
  /** Brush family for new strokes and their opacity in percent (5–100). */
  brush: import('../../shared/organizer').SketchBrush; opacity: number;
}
export const SKETCH_PREFERENCES_KEY = 'ade.sketch.preferences';
export const DEFAULT_SKETCH_PREFERENCES: SketchPreferences = { mode: 'auto', penSeen: false, color: SKETCH_INKS[0].value, width: 5, toolsSide: 'left', hintSeen: false, grid: false, pressure: true, eraserMode: 'partial', eraserSize: 36, exportScale: 1, brush: 'pen', opacity: 100 };
/** Storage for device preferences; a blocked or missing store only loses the convenience. */
export const sketchPreferenceStorage = (): SketchPreferenceStorage | undefined => { try { return typeof window === 'undefined' ? undefined : window.localStorage; } catch { return undefined; } };
export interface SketchPreferenceStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }

export function readSketchPreferences(storage: SketchPreferenceStorage | undefined): SketchPreferences {
  try {
    const raw = storage?.getItem(SKETCH_PREFERENCES_KEY); if (!raw || raw.length > 600) return { ...DEFAULT_SKETCH_PREFERENCES };
    const value = JSON.parse(raw) as Partial<SketchPreferences> | null;
    if (!value || typeof value !== 'object') return { ...DEFAULT_SKETCH_PREFERENCES };
    return {
      mode: SKETCH_INPUT_MODES.includes(value.mode as SketchInputMode) ? value.mode as SketchInputMode : 'auto',
      penSeen: value.penSeen === true,
      color: typeof value.color === 'string' && inkFor(value.color) ? inkFor(value.color)!.value : DEFAULT_SKETCH_PREFERENCES.color,
      width: integerIn(value.width, 1, 40) ? value.width : DEFAULT_SKETCH_PREFERENCES.width,
      toolsSide: value.toolsSide === 'right' ? 'right' : 'left',
      hintSeen: value.hintSeen === true,
      grid: value.grid === true,
      pressure: value.pressure !== false,
      eraserMode: value.eraserMode === 'stroke' ? 'stroke' : 'partial',
      eraserSize: integerIn(value.eraserSize, 8, 120) ? value.eraserSize : DEFAULT_SKETCH_PREFERENCES.eraserSize,
      exportScale: integerIn(value.exportScale, 1, 3) ? value.exportScale : 1,
      brush: (SKETCH_BRUSHES as readonly unknown[]).includes(value.brush) ? value.brush as SketchBrush : 'pen',
      opacity: integerIn(value.opacity, 5, 100) ? value.opacity : 100,
    };
  } catch { return { ...DEFAULT_SKETCH_PREFERENCES }; }
}

export function writeSketchPreferences(storage: SketchPreferenceStorage | undefined, value: SketchPreferences): void {
  try { storage?.setItem(SKETCH_PREFERENCES_KEY, JSON.stringify(value)); } catch { /* a blocked store only loses the convenience */ }
}
