import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
/**
 * TerminalArea — the panes of the currently selected agent (Phase B1).
 *
 * All of the selected agent's sessions stay mounted so switching tabs is
 * instant (scrollback + xterm state are preserved); only the active one is
 * visible, the rest are hidden with CSS. Switching agents unmounts the old
 * agent's panes — those sessions replay their ring buffer on return.
 */

import type { JSX } from 'react';
import { useSelection } from '../stores/selection';
import { useSessions, TERMINAL_HOME_GROUP } from '../stores/sessions';
import { useSessionLaunch } from '../stores/sessionLaunch';
import { useDiagnostics } from '../stores/diagnostics';
import { TerminalPane } from './TerminalPane';
import './terminal.css';

export function TerminalArea(): JSX.Element {
  useLocale();
  const agentId = useSelection((s) => s.selectedAgentId);
  const order = useSessions((s) => s.orderByAgent[agentId ?? TERMINAL_HOME_GROUP]);
  const active = useSessions((s) => s.activeByAgent[agentId ?? TERMINAL_HOME_GROUP]);
  const sessions = useSessions((s) => s.sessions);
  const error = useSessions((s) => s.error);
  const hydrate = useSessions((s) => s.hydrate);
  const clearError = useSessions((s) => s.clearError);
  const closeSession = useSessions((s) => s.closeSession);
  const restartSession = useSessions((s) => s.restartSession);
  const showDiagnostics = useDiagnostics((s) => s.show);

  const notice = (
    <div className="session-notices" aria-live="polite">
      {error ? (
        <div className="session-notice error">
          <div>
            <strong>{error.source === 'recovery' ? translate("Session recovery failed") : translate("Terminal operation failed")}</strong>
            <span>{error.message}</span>
          </div>
          {error.source === 'recovery' ? (
            <button type="button" onClick={() => void hydrate(true)}>{translate("Retry")}</button>
          ) : null}
          <button
            type="button"
            onClick={() => showDiagnostics(error.agentId ?? agentId ?? undefined, error.sessionId)}
          >
            {translate("Diagnostics [44696167]")}</button>
          <button type="button" aria-label={translate("Dismiss terminal error")} onClick={clearError}>×</button>
        </div>
      ) : null}
      {active && sessions[active]?.status === 'exited' ? (() => {
        const meta = sessions[active];
        const failed = meta.exitReason !== 'cancelled' && (meta.exitCode ?? -1) !== 0;
        const heading = meta.exitReason === 'cancelled'
          ? translate("Session cancelled")
          : failed
            ? `Session failed (exit ${meta.exitCode ?? -1})`
            : (meta.kind === 'task' ? translate("Task completed") : translate("Session ended [53657373]"));
        return (
          <div className={`session-notice${failed ? ' error' : ''}`}>
            <div>
              <strong>{heading}</strong>
              <span>
                {meta.kind === 'task'
                  ? translate("Task output remains available until this tab is closed.")
                  : translate("Terminal output was preserved.")}
              </span>
            </div>
            {meta.kind === 'interactive' ? (
              <button
                type="button"
                onClick={() => void restartSession(meta.id).catch(() => undefined)}
              >
                {translate("Restart")}</button>
            ) : null}
            {failed ? (
              <button type="button" onClick={() => showDiagnostics(meta.agentId, meta.id)}>{translate("Diagnostics [44696167]")}</button>
            ) : null}
            <button type="button" onClick={() => void closeSession(meta.id).catch(() => undefined)}>{translate("Close [436c6f73]")}</button>
          </div>
        );
      })() : null}
    </div>
  );

  if (!agentId && !order?.length) {
    return (
      <div className="terminal-area terminal-area-empty">
        <span className="terminal-hint">{translate("Open terminal without agent and project or select an agent on the left.")}</span>
        <button className="btn primary" onClick={() => useSessionLaunch.getState().open(null)}>{translate("Open terminal")}</button>
        {localizeAppMessage(notice)}
      </div>
    );
  }

  const sessionIds = order ?? [];
  if (sessionIds.length === 0) {
    return (
      <div className="terminal-area terminal-area-empty">
        <span className="terminal-hint">{translate("No sessions — press +")}</span>
        {localizeAppMessage(notice)}
      </div>
    );
  }

  return (
    <div className="terminal-area">
      {sessionIds.map((sessionId) => (
        <div
          key={sessionId}
          id={`session-panel-${sessionId}`}
          role="tabpanel"
          aria-labelledby={`session-tab-${sessionId}`}
          className="terminal-pane-wrap"
          style={{ display: sessionId === active ? 'block' : 'none' }}
        >
          <TerminalPane sessionId={sessionId} active={sessionId === active} />
        </div>
      ))}
      {localizeAppMessage(notice)}
    </div>
  );
}
