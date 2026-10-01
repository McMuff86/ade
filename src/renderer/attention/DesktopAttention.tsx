import { useRef, useState } from 'react';
import { AttentionPanel } from './AttentionPanel';
import { openCliSession } from '../work/openCliSession';
import { useMode } from '../stores/mode';
import { useRuns } from '../stores/runs';
import { useSelection } from '../stores/selection';
import { DesktopSupervision } from '../supervision/DesktopSupervision';
import { RunReportPanel } from '../graph/RunReportPanel';
import '../graph/graph.css';

export function DesktopAttention() {
  const [supervision, setSupervision] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const cursor = useRuns(state => state.seqCursor);
  const fallback = useRef<HTMLDivElement>(null);
  return <div className="desktop-attention" ref={fallback} tabIndex={-1}>
    <AttentionPanel identity="desktop" query={() => window.ade.invoke('attention:get')} onOpen={async (target, current) => {
      if (target.kind === 'session') await openCliSession(target.id, current);
      else if (target.kind === 'run') {
        await useRuns.getState().refresh();
        if (!current()) return;
        if (!useRuns.getState().runs.some(run => run.id === target.id)) throw new Error('Work unavailable.');
        useRuns.getState().setActiveRun(target.id); setReport(target.id);
      } else if (target.kind === 'project') {
        useSelection.getState().openProjectRepository(target.id); useMode.getState().setMode('projects');
      } else setSupervision(target.id);
    }} />
    {supervision && <DesktopSupervision repositoryId={supervision} onClose={() => setSupervision(null)} />}
    {report && <RunReportPanel runId={report} seqCursor={cursor} fallbackFocusRef={fallback} onClose={() => setReport(null)} />}
  </div>;
}
