/**
 * TabStrip — session tabs of the selected agent (Phase B1), per the mockup:
 * rounded top tabs, a copper inset top line on the active tab, a running (●) /
 * exited (○) status glyph as TEXT (no emojis), an × close, and a trailing +
 * that opens a new session. No Open/Run/model-picker buttons (SPEC).
 */

import type { JSX } from 'react';
import { useSelection } from '../stores/selection';
import { useSessions } from '../stores/sessions';
import '../terminal/terminal.css';

export function TabStrip(): JSX.Element | null {
  const agentId = useSelection((s) => s.selectedAgentId);
  const sessions = useSessions((s) => s.sessions);
  const order = useSessions((s) => (agentId ? s.orderByAgent[agentId] : undefined));
  const active = useSessions((s) => (agentId ? s.activeByAgent[agentId] : null));
  const createSession = useSessions((s) => s.createSession);
  const closeSession = useSessions((s) => s.closeSession);
  const setActive = useSessions((s) => s.setActive);

  if (!agentId) return null;

  const sessionIds = order ?? [];

  return (
    <div className="tabstrip" role="tablist">
      {sessionIds.map((id) => {
        const meta = sessions[id];
        if (!meta) return null;
        const isActive = id === active;
        const running = meta.status === 'running';
        return (
          <button
            key={id}
            role="tab"
            aria-selected={isActive}
            className={isActive ? 'tab active' : 'tab'}
            onClick={() => setActive(agentId, id)}
            title={meta.title}
          >
            <span className={running ? 'status running' : 'status exited'}>
              {running ? '●' : '○'}
            </span>
            <span className="tab-title">{meta.title}</span>
            <span
              className="close"
              role="button"
              aria-label="Close session"
              title="Close session"
              onClick={(e) => {
                e.stopPropagation();
                void closeSession(id);
              }}
            >
              {'×'}
            </span>
          </button>
        );
      })}
      <button
        className="tab-add"
        title="New session"
        aria-label="New session"
        onClick={() => void createSession(agentId)}
      >
        +
      </button>
      <span className="spacer" />
    </div>
  );
}
