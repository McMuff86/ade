import { intlLocale } from '../shared/i18n';
import { t as translate } from "../shared/i18n";
import { useLocale } from "../renderer/i18n/language";
import { useEffect, useRef, useState, type JSX } from 'react';
import type { MobileRunSummary } from '../shared/remote';
import { Avatar } from '../renderer/rail/Avatar';
import { runtimeVisual } from '../renderer/graph/runtimeGlyphs';
import { Empty, Status, finalStates } from './ui';

const KEY = 'ade-mobile-graph-layout';
// All multiples of the 8 px snap, so a box starts on the grid it later moves on.
const BOX_WIDTH = 216; const BOX_HEIGHT = 192; const GAP = 24; const PAD = 32; const STEP = 24;
const DAY_MS = 24 * 60 * 60 * 1000;
type Layout = Record<string, { x: number; y: number }>;

/** A manual run with exactly one agent is one job; everything else is a team run. */
const isJob = (run: MobileRunSummary): boolean => run.mode !== 'managed' && run.participants.length === 1;
const clock = (at: number): string => new Date(at).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' });
export type JobLabels = Record<string, string>;
const LABEL_CHARS = 60;
/** First line of a prompt typed on this device, bounded. It is kept on the device and never requested from the host. */
export function jobLabelFrom(prompt: string): string {
  const line = (prompt.trim().split(/\r?\n/, 1)[0] ?? '').replace(/\s+/g, ' ').trim();
  return line.length > LABEL_CHARS ? `${line.slice(0, LABEL_CHARS).trimEnd()}…` : line;
}
export function rememberJobLabel(labels: JobLabels, runId: string, prompt: string): JobLabels {
  const label = jobLabelFrom(prompt); if (!label) return labels;
  const entries = Object.entries({ ...labels, [runId]: label });
  return Object.fromEntries(entries.slice(Math.max(0, entries.length - 100)));
}
/**
 * The host sends automatic job names without content. A job submitted from
 * this device shows its own first prompt line; any other one names the agent
 * and its start time.
 */
export function runLabel(run: MobileRunSummary, labels: JobLabels = {}): string {
  if (run.name !== 'Single task') return run.name;
  return labels[run.id] ?? (run.participants[0] ? `${run.participants[0].agentName} · ${clock(run.createdAt)}` : run.name);
}
/** Open work plus what ended within the last day, running first, then most recent. */
export function overviewRuns(runs: MobileRunSummary[], now = Date.now()): MobileRunSummary[] {
  return runs.filter((run) => !finalStates.has(run.status) || now - run.updatedAt < DAY_MS)
    .sort((a, b) => Number(finalStates.has(a.status)) - Number(finalStates.has(b.status)) || b.updatedAt - a.updatedAt);
}
function readLayout(): Layout {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
    return Object.fromEntries(Object.entries(saved as Record<string, unknown>).filter(([, value]) => {
      const point = value as { x?: unknown; y?: unknown } | null;
      return !!point && typeof point.x === 'number' && typeof point.y === 'number' && Number.isFinite(point.x) && Number.isFinite(point.y);
    }).slice(0, 200)) as Layout;
  } catch { return {}; }
}

/**
 * Every job as its own box. Positions are a per-device arrangement: a box is
 * moved by its handle (drag or arrow keys); tapping the box opens its details.
 */
export function GraphOverview({ runs, labels, selectedRunId, onOpenJob, onOpenRun }: {
  runs: MobileRunSummary[]; labels: JobLabels; selectedRunId: string | null;
  onOpenJob(run: MobileRunSummary): void; onOpenRun(run: MobileRunSummary): void;
}): JSX.Element {
  useLocale();
  const [layout, setLayout] = useState<Layout>(readLayout);
  const [columns, setColumns] = useState(3);
  const scroller = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; runId: string; x: number; y: number; startX: number; startY: number } | null>(null);
  useEffect(() => {
    const node = scroller.current; if (!node) return;
    const measure = () => setColumns(Math.max(1, Math.floor((node.clientWidth - PAD * 2 + GAP) / (BOX_WIDTH + GAP))));
    measure(); const observer = new ResizeObserver(measure); observer.observe(node); return () => observer.disconnect();
  }, []);
  const save = (next: Layout) => { try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* The arrangement still works for this visit. */ } };
  const place = (runId: string, x: number, y: number) => setLayout((previous) => {
    const next = { ...previous, [runId]: { x: Math.max(0, Math.round(x / 8) * 8), y: Math.max(0, Math.round(y / 8) * 8) } };
    save(next); return next;
  });
  if (!runs.length) return <div className="m-graph" data-testid="mobile-graph-overview"><Empty title={translate("All jobs")}><p>{translate("No open jobs and none finished in the last 24 hours.")}</p></Empty></div>;
  const positions = runs.map((run, index) => layout[run.id]
    ?? { x: PAD + (index % columns) * (BOX_WIDTH + GAP), y: PAD + Math.floor(index / columns) * (BOX_HEIGHT + GAP) });
  const width = Math.max(...positions.map((point) => point.x)) + BOX_WIDTH + PAD;
  const height = Math.max(...positions.map((point) => point.y)) + BOX_HEIGHT + PAD + 60;
  return <div className="m-graph" data-testid="mobile-graph-overview">
    <div className="m-graph-activity-bar"><span>{translate("All jobs")} · {translate("Open jobs and those finished in the last 24 hours")}</span>
      <div className="m-graph-action-group"><button disabled={!runs.some((run) => layout[run.id])} onClick={() => { setLayout({}); save({}); }}>{translate("Reset arrangement")}</button></div></div>
    <div className="m-graph-scroll" ref={scroller} tabIndex={0} aria-label={translate("Overview of all jobs; scroll to pan")}>
      <div className="m-overview-canvas" style={{ width, height }}>
        {runs.map((run, index) => {
          const point = positions[index]!; const label = runLabel(run, labels); const job = isJob(run);
          const participant = run.participants[0]; const visual = job && participant?.runtime ? runtimeVisual(participant.runtime) : null;
          const Glyph = visual?.Glyph; const running = run.tasks.some((task) => task.status === 'running');
          return <div className="m-overview-box" data-testid="graph-overview-box" data-run-id={run.id} data-selected={selectedRunId === run.id} key={run.id} style={{ left: point.x, top: point.y, width: BOX_WIDTH }}>
            <button type="button" className="m-overview-handle" aria-label={translate("Move box: {{value1}}", { value1: label })} title={translate("Drag, or use the arrow keys to move this box.")}
              onKeyDown={(event) => {
                const delta = event.key === 'ArrowLeft' ? [-STEP, 0] : event.key === 'ArrowRight' ? [STEP, 0] : event.key === 'ArrowUp' ? [0, -STEP] : event.key === 'ArrowDown' ? [0, STEP] : null;
                if (!delta) return;
                event.preventDefault(); place(run.id, point.x + delta[0]!, point.y + delta[1]!);
              }}
              onPointerDown={(event) => {
                if (!event.isPrimary || event.button !== 0) return;
                event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
                drag.current = { id: event.pointerId, runId: run.id, x: event.clientX, y: event.clientY, startX: point.x, startY: point.y };
              }}
              onPointerMove={(event) => {
                const start = drag.current;
                if (start?.id === event.pointerId && start.runId === run.id) place(run.id, start.startX + event.clientX - start.x, start.startY + event.clientY - start.y);
              }}
              onPointerUp={(event) => { if (drag.current?.id === event.pointerId) { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); } }}
              onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
              <span aria-hidden="true">⠿</span><span>{job ? run.repositoryName ?? translate("No project") : translate("Team run · {{value1}} agents", { value1: run.participants.length })}</span></button>
            <button type="button" className="m-overview-open" aria-pressed={selectedRunId === run.id}
              aria-label={job ? translate("Open job: {{value1}}", { value1: label }) : translate("Open run: {{value1}}", { value1: label })}
              onClick={(event) => { event.currentTarget.focus(); if (job) onOpenJob(run); else onOpenRun(run); }}>
              <span className="m-node-glyph" style={{ color: visual?.color }}>{Glyph ? <Glyph /> : <Avatar name={participant?.agentName ?? run.name} size={38} />}</span>
              <strong>{label}</strong><Status status={running ? 'running' : run.status} />
              <small>{job ? `${participant!.agentName} · ${visual?.label ?? 'Agent'}` : run.repositoryName ?? translate("No project")}</small>
              <small>{translate("Started")} {clock(run.createdAt)}</small>
              {job && run.tasks.length > 1 && <small>{translate("{{value1}} tasks in this job", { value1: run.tasks.length })}</small>}
            </button>
          </div>;
        })}
      </div>
    </div>
  </div>;
}
