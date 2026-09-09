import type { JSX } from 'react';
import type { MobileAgentSummary } from '../shared/remote';

export function DashboardLink({ agent }: { agent: MobileAgentSummary }): JSX.Element | null {
  if (!agent.dashboard) return null;
  return agent.dashboard.url ? <a className="m-dashboard-link" href={agent.dashboard.url} target="_blank"
    rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={`Web-Dashboard für ${agent.name}`}>
    Web-Dashboard ↗</a> : <span className="m-field-note">{agent.dashboard.notice}</span>;
}
