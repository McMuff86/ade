import { DEFAULT_SKETCH_PREFERENCES, PALM_CONTACT_PX, PEN_NEAR_MS, SKETCH_INKS, SKETCH_PREFERENCES_KEY, SKETCH_WIDTHS, fingerNavigates, inkFor, nearestWidth, readSketchPreferences, sheetPointerRole, sketchPointerRole, writeSketchPreferences, type SketchInputState, type SketchPointerFacts } from '../src/renderer/organizer/sketchInput';
import { clampView, fitView, pinchView, toContentPoint, zoomViewAt } from '../src/renderer/viewTransform';
import { contentExtent, erasePartial, eraseStroke, exportScalesFor, sheetFormatFor, sheetSizeVerdict } from '../src/renderer/organizer/sketchErase';
import type { SketchStroke } from '../src/shared/organizer';
let passed = 0; let failed = 0;
function check(name: string, ok: boolean): void { if (ok) { passed++; console.log(`  ok  ${name}`); } else { failed++; console.error(`FAIL  ${name}`); } }
const facts = (partial: Partial<SketchPointerFacts>): SketchPointerFacts => ({ pointerType: 'touch', button: 0, buttons: 1, width: 8, height: 8, ...partial });
const state = (partial: Partial<SketchInputState>): SketchInputState => ({ mode: 'auto', penSeen: false, lastPenAt: Number.NEGATIVE_INFINITY, penDown: false, ...partial });
const pen = facts({ pointerType: 'pen' }); const mouse = facts({ pointerType: 'mouse' });

check('pen tip draws in every mode', (['auto', 'pen-draws', 'finger-draws'] as const).every(mode => sketchPointerRole(state({ mode }), pen, 0) === 'draw'));
check('pen barrel button erases while held', sketchPointerRole(state({}), facts({ pointerType: 'pen', button: 2, buttons: 2 }), 0) === 'erase');
check('pen eraser end erases', sketchPointerRole(state({}), facts({ pointerType: 'pen', button: 5, buttons: 32 }), 0) === 'erase');
check('mouse left draws, other mouse buttons are ignored', sketchPointerRole(state({}), mouse, 0) === 'draw' && sketchPointerRole(state({}), facts({ pointerType: 'mouse', button: 1, buttons: 4 }), 0) === 'ignore');
check('finger draws on a device that never saw a pen', sketchPointerRole(state({}), facts({}), 0) === 'draw');
check('finger stops drawing once the device has seen a pen (auto)', sketchPointerRole(state({ penSeen: true }), facts({}), 0) === 'ignore' && fingerNavigates(state({ penSeen: true })));
check('finger draws again when the person asks for it', sketchPointerRole(state({ mode: 'finger-draws', penSeen: true }), facts({}), 60_000) === 'draw' && !fingerNavigates(state({ mode: 'finger-draws', penSeen: true })));
check('pen-draws mode ignores the finger even without a pen seen', sketchPointerRole(state({ mode: 'pen-draws' }), facts({}), 0) === 'ignore' && fingerNavigates(state({ mode: 'pen-draws' })));
check('a hovering pen protects the hand for the near window', sketchPointerRole(state({ mode: 'finger-draws', lastPenAt: 10_000 }), facts({}), 10_000 + PEN_NEAR_MS - 1) === 'ignore'
  && sketchPointerRole(state({ mode: 'finger-draws', lastPenAt: 10_000 }), facts({}), 10_000 + PEN_NEAR_MS) === 'draw');
check('a pen in contact blocks touch regardless of timestamps', sketchPointerRole(state({ mode: 'finger-draws', penDown: true }), facts({}), 99_999) === 'ignore');
check('a palm-sized contact never draws, in any mode', (['auto', 'pen-draws', 'finger-draws'] as const).every(mode => sketchPointerRole(state({ mode }), facts({ width: PALM_CONTACT_PX + 1 }), 0) === 'ignore'
  && sketchPointerRole(state({ mode }), facts({ height: 40, width: 4 }), 0) === 'ignore'));
check('a fingertip-sized contact is not a palm', sketchPointerRole(state({ mode: 'finger-draws' }), facts({ width: PALM_CONTACT_PX, height: PALM_CONTACT_PX }), 0) === 'draw');
check('touch without a button value still draws', sketchPointerRole(state({ mode: 'finger-draws' }), facts({ button: -1, buttons: 0 }), 0) === 'draw');

const memory = new Map<string, string>(); const store = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); } };
check('missing preferences fall back to defaults', JSON.stringify(readSketchPreferences(store)) === JSON.stringify(DEFAULT_SKETCH_PREFERENCES) && JSON.stringify(readSketchPreferences(undefined)) === JSON.stringify(DEFAULT_SKETCH_PREFERENCES));
const full = { mode: 'pen-draws' as const, penSeen: true, color: '#2155d6', width: 11, toolsSide: 'right' as const, hintSeen: true, grid: true, pressure: false, eraserMode: 'stroke' as const, eraserSize: 40, exportScale: 2 };
writeSketchPreferences(store, full);
check('preferences round-trip through storage', JSON.stringify(readSketchPreferences(store)) === JSON.stringify({ ...full, color: '#2155D6' }));
memory.set(SKETCH_PREFERENCES_KEY, JSON.stringify({ color: '#123456', width: 7 }));
check('a colour outside the palette falls back to ink while any whole line width within 1–40 is kept', readSketchPreferences(store).color === SKETCH_INKS[0].value && readSketchPreferences(store).width === 7);
memory.set(SKETCH_PREFERENCES_KEY, JSON.stringify({ width: 0.5, eraserMode: 'stroke', eraserSize: 40, exportScale: 3, pressure: false }));
check('eraser mode, eraser size, export scale and pressure round-trip and a fractional width falls back', JSON.stringify([readSketchPreferences(store).width, readSketchPreferences(store).eraserMode, readSketchPreferences(store).eraserSize, readSketchPreferences(store).exportScale, readSketchPreferences(store).pressure]) === JSON.stringify([5, 'stroke', 40, 3, false]));
memory.set(SKETCH_PREFERENCES_KEY, JSON.stringify({ eraserMode: 'lines', eraserSize: 999, exportScale: 9 }));
check('unknown eraser mode, size and scale fall back to partial, 36 and 1', JSON.stringify([readSketchPreferences(store).eraserMode, readSketchPreferences(store).eraserSize, readSketchPreferences(store).exportScale]) === JSON.stringify(['partial', 36, 1]));
memory.set(SKETCH_PREFERENCES_KEY, JSON.stringify({ mode: 'everything', penSeen: 'yes', color: 'red', width: 'wide', toolsSide: 'top', hintSeen: 1, grid: 'yes' }));
check('invalid stored fields fall back field by field', JSON.stringify(readSketchPreferences(store)) === JSON.stringify(DEFAULT_SKETCH_PREFERENCES));
memory.set(SKETCH_PREFERENCES_KEY, '{not json');
check('corrupt storage falls back instead of throwing', JSON.stringify(readSketchPreferences(store)) === JSON.stringify(DEFAULT_SKETCH_PREFERENCES));
memory.set(SKETCH_PREFERENCES_KEY, 'x'.repeat(401));
check('oversized storage is ignored', JSON.stringify(readSketchPreferences(store)) === JSON.stringify(DEFAULT_SKETCH_PREFERENCES));
const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
writeSketchPreferences(throwing, DEFAULT_SKETCH_PREFERENCES);
check('a blocked store only loses the convenience', JSON.stringify(readSketchPreferences(throwing)) === JSON.stringify(DEFAULT_SKETCH_PREFERENCES));

// Sheet roles: a finger pans where the preview would ignore it; the middle mouse button and Space + drag pan.
check('on the sheet a navigating finger pans instead of being ignored', sheetPointerRole(state({ penSeen: true }), facts({}), 0) === 'pan' && sketchPointerRole(state({ penSeen: true }), facts({}), 0) === 'ignore');
check('a palm never pans either', sheetPointerRole(state({ penSeen: true }), facts({ width: 40 }), 0) === 'ignore');
check('a finger right after the pen neither draws nor pans', sheetPointerRole(state({ penSeen: true, lastPenAt: 500 }), facts({}), 600) === 'ignore');
check('middle mouse button pans, Space + left button pans, plain left button draws', sheetPointerRole(state({}), facts({ pointerType: 'mouse', button: 1, buttons: 4 }), 0) === 'pan'
  && sheetPointerRole(state({}), mouse, 0, { spaceHeld: true }) === 'pan' && sheetPointerRole(state({}), mouse, 0) === 'draw');
check('palette lookup is case-insensitive and widths snap', inkFor('#2155d6')?.id === 'blue' && inkFor('#000000') === undefined && nearestWidth(3) === 2 && nearestWidth(8) === 5 && nearestWidth(40) === 11 && SKETCH_WIDTHS.length === 3);

// View math shared with the graph.
const sheet = { width: 1600, height: 1000 }; const port = { width: 1200, height: 700 };
const fitted = fitView(sheet, port, 24);
check('fit centres the sheet with the padding on the limiting axis', Math.abs(fitted.scale - (700 - 48) / 1000) < 1e-9 && Math.abs(fitted.y - 24) < 1e-9 && Math.abs(fitted.x - (1200 - 1600 * fitted.scale) / 2) < 1e-9);
const zoomed = zoomViewAt(fitted, 2, { x: 600, y: 350 }, { min: fitted.scale * .5, max: fitted.scale * 6 });
const before = toContentPoint(fitted, { x: 600, y: 350 }); const after = toContentPoint(zoomed, { x: 600, y: 350 });
check('zooming keeps the content under the cursor in place', Math.abs(zoomed.scale - fitted.scale * 2) < 1e-9 && Math.abs(before.x - after.x) < 1e-6 && Math.abs(before.y - after.y) < 1e-6);
check('zoom respects the scale bounds', zoomViewAt(fitted, 100, { x: 0, y: 0 }, { min: 1, max: 4 }).scale === 4 && zoomViewAt(fitted, 0.0001, { x: 0, y: 0 }, { min: 1, max: 4 }).scale === 1);
const pinched = pinchView(fitted, { x: 500, y: 350 }, { x: 700, y: 350 }, { x: 400, y: 400 }, { x: 800, y: 400 }, { min: .01, max: 100 });
check('a pinch doubles the scale around the old midpoint and follows the new one', Math.abs(pinched.scale - fitted.scale * 2) < 1e-9 && Math.abs(toContentPoint(pinched, { x: 600, y: 400 }).x - before.x) < 1e-6);
const far = clampView({ ...fitted, x: 5000, y: -5000 }, sheet, port);
check('the view is clamped so a quarter of the sheet stays visible', far.x <= port.width - .25 * Math.min(sheet.width * fitted.scale, port.width) + 1e-9 && far.y >= .25 * Math.min(sheet.height * fitted.scale, port.height) - sheet.height * fitted.scale - 1e-9);
check('a view already inside the limits is left alone', JSON.stringify(clampView(fitted, sheet, port)) === JSON.stringify(fitted));

// Erasing: a part of a line or the whole line; sheet formats within the contract.
let ids = 0; const nextId = () => `piece-${++ids}`;
const line = (points: [number, number][], width = 4, id = 'line'): SketchStroke => ({ id, color: '#1F1D1A', width, points: points.map(([x, y]) => ({ x, y, pressure: 1 })) });
const xs = (stroke: SketchStroke) => stroke.points.map(point => Math.round(point.x));
const twoPoint = erasePartial([line([[0, 0], [100, 0]])], { x: 50, y: 0 }, 10, nextId);
check('a two-point line erased in the middle keeps both ends, cut at the eraser edge', twoPoint.length === 2 && JSON.stringify(xs(twoPoint[0]!)) === '[0,38]' && JSON.stringify(xs(twoPoint[1]!)) === '[62,100]' && twoPoint.every(piece => piece.id.startsWith('piece-')));
const five = erasePartial([line([[0, 0], [25, 0], [50, 0], [75, 0], [100, 0]])], { x: 50, y: 0 }, 10, nextId);
check('points inside the eraser disappear and the crossing segments are trimmed to the edge', five.length === 2 && JSON.stringify(xs(five[0]!)) === '[0,25,38]' && JSON.stringify(xs(five[1]!)) === '[62,75,100]');
const untouched = [line([[0, 0], [100, 0]])];
check('a miss leaves the strokes untouched, by reference', erasePartial(untouched, { x: 50, y: 40 }, 10, nextId)[0] === untouched[0]);
check('erasing at one end shortens the line to a single piece', (() => { const result = erasePartial([line([[0, 0], [100, 0]])], { x: 100, y: 0 }, 10, nextId); return result.length === 1 && JSON.stringify(xs(result[0]!)) === '[0,88]'; })());
check('a dot is removed when hit and kept when missed', erasePartial([line([[10, 10]])], { x: 12, y: 10 }, 5, nextId).length === 0 && erasePartial([line([[10, 10]])], { x: 40, y: 10 }, 5, nextId).length === 1);
check('the line width widens the eraser reach', erasePartial([line([[0, 0], [100, 0]], 20)], { x: 50, y: 18 }, 10, nextId).length === 2 && erasePartial([line([[0, 0], [100, 0]], 2)], { x: 50, y: 18 }, 10, nextId).length === 1);
const stacked = [line([[0, 0], [100, 0]], 4, 'below'), line([[0, 5], [100, 5]], 4, 'above')];
check('whole-line erasing removes the topmost hit line only', eraseStroke(stacked, { x: 50, y: 4 }, 3).map(item => item.id).join() === 'below' && eraseStroke(stacked, { x: 50, y: 60 }, 3).length === 2);
check('the whole-line tolerance never falls below the line width', eraseStroke([line([[0, 0], [100, 0]], 30)], { x: 50, y: 25 }, 2).length === 0);
check('content extent includes half the line width', JSON.stringify(contentExtent([line([[0, 0], [100, 40]], 10)])) === JSON.stringify({ width: 105, height: 45 }) && JSON.stringify(contentExtent([])) === JSON.stringify({ width: 0, height: 0 }));
check('sheet size verdict: range, content, ok', sheetSizeVerdict(100, 1000, []).ok === false && sheetSizeVerdict(1600.5, 1000, []).ok === false
  && JSON.stringify(sheetSizeVerdict(1000, 1600, [line([[0, 0], [1200, 100]])])) === JSON.stringify({ ok: false, reason: 'content', width: 1202, height: 102 }) && sheetSizeVerdict(4096, 4096, [line([[0, 0], [1200, 100]])]).ok === true);
check('sheet formats resolve by exact size and export scales stay below 8192 px', sheetFormatFor(1600, 1000) === 'landscape' && sheetFormatFor(1601, 1000) === 'custom' && JSON.stringify(exportScalesFor(1600, 1000)) === '[1,2,3]' && JSON.stringify(exportScalesFor(3200, 2000)) === '[1,2]' && JSON.stringify(exportScalesFor(4096, 4096)) === '[1,2]' && JSON.stringify(exportScalesFor(4097, 100)) === '[1]');

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
