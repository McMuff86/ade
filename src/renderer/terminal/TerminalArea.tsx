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
import { TerminalPane } from './TerminalPane';
import './terminal.css';

export function TerminalArea(): JSX.Element {
  const agentId = useSelection((s) => s.selectedAgentId);
  const order = useSessions((s) => (agentId ? s.orderByAgent[agentId] : undefined));
  const active = useSessions((s) => (agentId ? s.activeByAgent[agentId] : null));

  if (!agentId) {
    return (
      <div className="terminal-area terminal-area-empty">
        <span className="terminal-hint">Select an agent</span>
      </div>
    );
  }

  const sessionIds = order ?? [];
  if (sessionIds.length === 0) {
    return (
      <div className="terminal-area terminal-area-empty">
        <span className="terminal-hint">No sessions — press +</span>
      </div>
    );
  }

  return (
    <div className="terminal-area">
      {sessionIds.map((sessionId) => (
        <div
          key={sessionId}
          className="terminal-pane-wrap"
          style={{ display: sessionId === active ? 'block' : 'none' }}
        >
          <TerminalPane sessionId={sessionId} active={sessionId === active} />
        </div>
      ))}
    </div>
  );
}
