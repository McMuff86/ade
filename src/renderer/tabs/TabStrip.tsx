/**
 * TabStrip — session tabs of the selected agent (Phase B1), per the mockup:
 * rounded top tabs, a copper inset top line on the active tab, a running (●) /
 * exited (○) status glyph as TEXT (no emojis), an × close, and a trailing +
 * that opens a new session. No Open/Run/model-picker buttons (SPEC).
 */

import { useState, type JSX } from 'react';
import { useAppData } from '../stores/appdata';
import { useSelection } from '../stores/selection';
import { useSessions } from '../stores/sessions';
import { SHORTCUTS } from '../keyboard/useSessionShortcuts';
import '../terminal/terminal.css';

export function TabStrip(): JSX.Element | null {
  const agentId = useSelection((s) => s.selectedAgentId);
  const agent = useAppData((s) => (agentId ? s.agents[agentId] : undefined));
  const sessions = useSessions((s) => s.sessions);
  const order = useSessions((s) => (agentId ? s.orderByAgent[agentId] : undefined));
  const active = useSessions((s) => (agentId ? s.activeByAgent[agentId] : null));
  const createSession = useSessions((s) => s.createSession);
  const closeSession = useSessions((s) => s.closeSession);
  const setActive = useSessions((s) => s.setActive);
  const [dashboardBusy, setDashboardBusy] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);

  if (!agentId) return null;

  const hasDashboard = Boolean(agent?.dashboardCommand?.trim() || agent?.dashboardUrl?.trim());
  const openDashboard = async (): Promise<void> => {
    if (dashboardBusy) return;
    setDashboardBusy(true);
    setDashboardError(null);
    try {
      await window.ade.invoke('agent:openDashboard', { agentId });
    } catch (error) {
      console.error('[ade] open dashboard failed:', error);
      setDashboardError(error instanceof Error ? error.message : String(error));
    } finally {
      setDashboardBusy(false);
    }
  };

  const sessionIds = order ?? [];
  const activateAndFocus = (id: string): void => {
    setActive(agentId, id);
    requestAnimationFrame(() => document.getElementById(`session-tab-${id}`)?.focus());
  };

  return (
    <div className="tabstrip" role="tablist" aria-label="Terminal sessions">
      {sessionIds.map((id) => {
        const meta = sessions[id];
        if (!meta) return null;
        const isActive = id === active;
        const running = meta.status === 'running';
        return (
          <div key={id} className={isActive ? 'tab active' : 'tab'}>
            <button
              id={`session-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`session-panel-${id}`}
              aria-label={`${meta.title}, ${running ? 'running' : `exited with code ${meta.exitCode ?? 'unknown'}`}`}
              className="tab-select"
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActive(agentId, id)}
              onKeyDown={(event) => {
                let index: number | null = null;
                if (event.key === 'ArrowLeft') index = (sessionIds.indexOf(id) - 1 + sessionIds.length) % sessionIds.length;
                else if (event.key === 'ArrowRight') index = (sessionIds.indexOf(id) + 1) % sessionIds.length;
                else if (event.key === 'Home') index = 0;
                else if (event.key === 'End') index = sessionIds.length - 1;
                else if (event.key === 'Delete') {
                  event.preventDefault();
                  void closeSession(id).catch(() => undefined);
                  return;
                }
                if (index === null) return;
                event.preventDefault();
                const next = sessionIds[index];
                if (next) activateAndFocus(next);
              }}
              title={meta.title}
            >
              <span className={running ? 'status running' : 'status exited'} aria-hidden="true">
                {running ? '●' : '○'}
              </span>
              <span className="tab-title">{meta.title}</span>
            </button>
            <button
              type="button"
              className="close"
              aria-label={`Close ${meta.title}`}
              title={`Close session (${SHORTCUTS.closeSession})`}
              tabIndex={isActive ? 0 : -1}
              onClick={(event) => {
                event.stopPropagation();
                void closeSession(id).catch(() => undefined);
              }}
            >
              ×
            </button>
          </div>
        );
      })}
      <button
        className="tab-add"
        title={`New session (${SHORTCUTS.newSession})`}
        aria-label="New session"
        onClick={() => void createSession(agentId).catch(() => undefined)}
      >
        +
      </button>
      <span className="spacer" />
      {dashboardError ? (
        <span className="tab-dashboard-error" role="alert" title={dashboardError}>
          Dashboard failed
        </span>
      ) : null}
      {hasDashboard ? (
        <button
          type="button"
          className="tab-dashboard"
          disabled={dashboardBusy}
          title={agent?.dashboardTarget === 'external'
            ? 'Open the agent dashboard in the browser'
            : 'Open the agent dashboard in an ADE window'}
          onClick={() => void openDashboard()}
        >
          {dashboardBusy ? 'Dashboard…' : 'Dashboard ↗'}
        </button>
      ) : null}
    </div>
  );
}
