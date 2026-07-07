/**
 * Right-panel data hook: git status for the selected agent, plus the refresh
 * model that keeps it honest without a manual button.
 *
 * Refetch on: (a) selected agent changes, (b) window regains focus, (c) every
 * 5s while the panel is visible AND a session of the selected agent is running
 * (skipped while document.hidden), (d) after any pty:exit.
 *
 * `nonce` bumps on every refresh so sibling views (Files tree / agent files)
 * can re-pull their own data off the same cadence.
 */

import { useEffect, useRef, useState } from 'react';
import type { GitStatus } from '../../shared/types';
import { useSessions } from '../stores/sessions';

const POLL_MS = 5000;

interface WorkspacePanel {
  status: GitStatus | null;
  loading: boolean;
  nonce: number;
  refresh: () => void;
}

export function useWorkspacePanel(agentId: string | null, visible: boolean): WorkspacePanel {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);

  // Whether the selected agent has at least one running session (drives polling).
  const hasRunningSession = useSessions((s) => {
    if (!agentId) return false;
    const ids = s.orderByAgent[agentId] ?? [];
    return ids.some((id) => s.sessions[id]?.status === 'running');
  });

  const reqSeq = useRef(0);

  const fetchStatus = useRef(async (id: string | null): Promise<void> => {
    if (!id) {
      setStatus(null);
      return;
    }
    const seq = ++reqSeq.current;
    setLoading(true);
    try {
      const res = await window.ade.invoke('git:status', { agentId: id });
      if (seq === reqSeq.current) setStatus(res);
    } catch (err) {
      console.error('[ade] git:status failed:', err);
      if (seq === reqSeq.current) setStatus(null);
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }).current;

  const refresh = (): void => {
    setNonce((n) => n + 1);
    void fetchStatus(agentId);
  };

  // (a) selected agent changes → immediate refetch.
  useEffect(() => {
    void fetchStatus(agentId);
    setNonce((n) => n + 1);
  }, [agentId, fetchStatus]);

  // (b) window regains focus.
  useEffect(() => {
    if (!agentId) return;
    const onFocus = (): void => {
      if (document.hidden) return;
      void fetchStatus(agentId);
      setNonce((n) => n + 1);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [agentId, fetchStatus]);

  // (c) 5s poll while visible + a session is running (and the doc isn't hidden).
  useEffect(() => {
    if (!agentId || !visible || !hasRunningSession) return;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void fetchStatus(agentId);
      setNonce((n) => n + 1);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [agentId, visible, hasRunningSession, fetchStatus]);

  // (d) after any pty:exit → refetch (the agent may have just written files).
  useEffect(() => {
    if (!agentId) return;
    const off = window.ade.on('pty:exit', () => {
      void fetchStatus(agentId);
      setNonce((n) => n + 1);
    });
    return off;
  }, [agentId, fetchStatus]);

  return { status, loading, nonce, refresh };
}
