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
import { useSessions } from '../stores/sessions';
import { useDiagnostics } from '../stores/diagnostics';
import { TerminalPane } from './TerminalPane';
import './terminal.css';

export function TerminalArea(): JSX.Element {
  const agentId = useSelection((s) => s.selectedAgentId);
  const order = useSessions((s) => (agentId ? s.orderByAgent[agentId] : undefined));
  const active = useSessions((s) => (agentId ? s.activeByAgent[agentId] : null));
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
            <strong>{error.source === 'recovery' ? 'Session recovery failed' : 'Terminal operation failed'}</strong>
            <span>{error.message}</span>
          </div>
          {error.source === 'recovery' ? (
            <button type="button" onClick={() => void hydrate(true)}>Retry</button>
          ) : null}
          <button type="button" onClick={() => showDiagnostics(error.agentId ?? agentId ?? undefined)}>
            Diagnostics
          </button>
          <button type="button" aria-label="Dismiss terminal error" onClick={clearError}>×</button>
        </div>
      ) : null}
      {active && sessions[active]?.status === 'exited' ? (() => {
        const meta = sessions[active];
        const failed = meta.exitReason !== 'cancelled' && (meta.exitCode ?? -1) !== 0;
        const heading = meta.exitReason === 'cancelled'
          ? 'Session cancelled'
          : failed
            ? `Session failed (exit ${meta.exitCode ?? -1})`
            : (meta.kind === 'task' ? 'Task completed' : 'Session ended');
        return (
          <div className={`session-notice${failed ? ' error' : ''}`}>
            <div>
              <strong>{heading}</strong>
              <span>
                {meta.kind === 'task'
                  ? 'Task output remains available until this tab is closed.'
                  : 'Terminal output was preserved.'}
              </span>
            </div>
            {meta.kind === 'interactive' ? (
              <button
                type="button"
                onClick={() => void restartSession(meta.id).catch(() => undefined)}
              >
                Restart
              </button>
            ) : null}
            {failed ? (
              <button type="button" onClick={() => showDiagnostics(meta.agentId)}>Diagnostics</button>
            ) : null}
            <button type="button" onClick={() => void closeSession(meta.id).catch(() => undefined)}>Close</button>
          </div>
        );
      })() : null}
    </div>
  );

  if (!agentId) {
    return (
      <div className="terminal-area terminal-area-empty">
        <span className="terminal-hint">Select an agent</span>
        {notice}
      </div>
    );
  }

  const sessionIds = order ?? [];
  if (sessionIds.length === 0) {
    return (
      <div className="terminal-area terminal-area-empty">
        <span className="terminal-hint">No sessions — press +</span>
        {notice}
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
      {notice}
    </div>
  );
}
