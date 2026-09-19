import { localizeAppMessage } from '../shared/i18n/appMessages';
import { t as translate } from "../shared/i18n";
import { useLocale } from "../renderer/i18n/language";
import type { JSX } from 'react';
import type { MobileAgentSummary } from '../shared/remote';

export function DashboardLink({ agent }: { agent: MobileAgentSummary }): JSX.Element | null {
  useLocale();
  if (!agent.dashboard) return null;
  return agent.dashboard.url ? <a className="m-dashboard-link" href={agent.dashboard.url} target="_blank"
    rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={translate("Web dashboard for {{value1}}", { value1: agent.name })}>
    {translate("Web dashboard ↗")}</a> : <span className="m-field-note">{localizeAppMessage(agent.dashboard.notice)}</span>;
}
