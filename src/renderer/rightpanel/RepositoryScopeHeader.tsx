import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import type { GitStatus, WorkspaceScopeDescriptor } from '../../shared/types';
import { useAppData } from '../stores/appdata';
import { useSessions } from '../stores/sessions';

interface RepositoryScopeHeaderProps {
  agentId: string | null;
  sessionId: string | null;
  nonce: number;
  status: GitStatus | null;
}

function shortPath(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.slice(-3).join('/');
}

function sourceLabel(source: WorkspaceScopeDescriptor['source']): string {
  if (source === 'explicit') return 'This session';
  if (source === 'agent-default') return 'Agent default';
  return 'Portable home';
}

export function RepositoryScopeHeader({
  agentId,
  sessionId,
  nonce,
  status,
}: RepositoryScopeHeaderProps): JSX.Element | null {
  const repositories = useAppData((state) => state.repositories);
  const agents = useAppData((state) => state.agents);
  const importRepository = useAppData((state) => state.importRepository);
  const setAgentDefaultRepository = useAppData((state) => state.setAgentDefaultRepository);
  const createSession = useSessions((state) => state.createSession);
  const [scope, setScope] = useState<WorkspaceScopeDescriptor | null>(null);
  const [targetRepositoryId, setTargetRepositoryId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const targetContext = useRef('');

  const agent = agentId ? agents[agentId] : undefined;
  const locked = scope?.activeLease === true;
  const sortedRepositories = useMemo(
    () => [...repositories].sort((left, right) => left.name.localeCompare(right.name)),
    [repositories],
  );

  useEffect(() => {
    if (!agentId) {
      setScope(null);
      setTargetRepositoryId('');
      targetContext.current = '';
      return;
    }
    let live = true;
    void window.ade.invoke('workspace:describe', { agentId, sessionId: sessionId ?? undefined })
      .then((descriptor) => {
        if (!live) return;
        setScope(descriptor);
        const context = `${agentId}:${sessionId ?? ''}`;
        if (targetContext.current !== context) {
          targetContext.current = context;
          setTargetRepositoryId(descriptor.repositoryId ?? '');
        }
        setError(null);
      })
      .catch((reason) => {
        if (!live) return;
        setScope(null);
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => { live = false; };
  }, [agentId, sessionId, nonce]);

  if (!agentId || !agent) return null;

  const pickRepository = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const picked = await window.ade.invoke('dialog:pickFolder');
      if (!picked.path) return;
      if (!picked.isRepo) throw new Error('The selected folder is not a Git repository.');
      const repository = await importRepository(picked.path);
      setTargetRepositoryId(repository.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const openSession = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await createSession(
        agentId,
        undefined,
        undefined,
        undefined,
        targetRepositoryId || null,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const setDefault = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await setAgentDefaultRepository(agentId, targetRepositoryId || null);
      const descriptor = await window.ade.invoke('workspace:describe', {
        agentId,
        sessionId: sessionId ?? undefined,
      });
      setScope(descriptor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rp-scope" data-testid="repository-scope">
      <div className="rp-scope-title">
        <div>
          <span>Repository scope</span>
          <strong>{scope?.repositoryName ?? 'No repository'}</strong>
        </div>
        <span className="rp-scope-source">{scope ? sourceLabel(scope.source) : 'Loading'}</span>
      </div>
      {scope ? (
        <div className="rp-scope-meta" title={scope.workspaceDir}>
          <span>{status?.branch || scope.branch || (scope.isRepo ? '(detached)' : 'plain workspace')}</span>
          <span>{shortPath(scope.workspaceDir)}</span>
          {scope.isRepo && status ? (
            <span className={status.files.length ? 'rp-scope-dirty' : 'rp-scope-clean'}>
              {status.files.length ? `${status.files.length} changed` : 'Clean'}
            </span>
          ) : null}
          {scope.activeLease ? <span className="rp-scope-lease">Run lease</span> : null}
        </div>
      ) : null}
      <div className="rp-scope-controls">
        <select
          aria-label="Repository for new session"
          value={targetRepositoryId}
          disabled={busy || locked}
          onChange={(event) => setTargetRepositoryId(event.target.value)}
        >
          <option value="">No repository (portable home)</option>
          {sortedRepositories.map((repository) => (
            <option key={repository.id} value={repository.id}>{repository.name}</option>
          ))}
        </select>
        <button type="button" className="btn" disabled={busy || locked} onClick={() => void pickRepository()}>
          Add repo
        </button>
      </div>
      <div className="rp-scope-actions">
        <button type="button" className="btn" disabled={busy || locked} onClick={() => void openSession()}>
          Open new session
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy || locked || (agent.defaultRepositoryId ?? '') === targetRepositoryId}
          onClick={() => void setDefault()}
        >
          {targetRepositoryId ? 'Set agent default' : 'Clear agent default'}
        </button>
      </div>
      {locked ? <div className="rp-scope-lock">This binding is owned by an active managed run.</div> : null}
      {error ? <div className="rp-scope-error">{error}</div> : null}
    </section>
  );
}
