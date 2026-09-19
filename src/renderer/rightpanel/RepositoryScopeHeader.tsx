import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import type { GitStatus, WorkspaceScopeDescriptor } from '../../shared/types';
import {
  NATIVE_EXECUTION_BACKEND,
  type ExecutionBackendId,
} from '../../shared/executionBackends';
import type { WslDistributionInfo } from '../../shared/ipc';
import { useAppData } from '../stores/appdata';
import { useSessions } from '../stores/sessions';

interface RepositoryScopeHeaderProps {
  agentId: string | null;
  sessionId: string | null;
  nonce: number;
  status: GitStatus | null;
  onTargetRepositoryChange: (repositoryId: string | null, userInitiated: boolean) => void;
}

function shortPath(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.slice(-3).join('/');
}

function sourceLabel(source: WorkspaceScopeDescriptor['source']): string {
  if (source === 'explicit') return translate("This session");
  if (source === 'agent-default') return translate("Agent default");
  return translate("Portable home");
}

export function RepositoryScopeHeader({
  agentId,
  sessionId,
  nonce,
  status,
  onTargetRepositoryChange,
}: RepositoryScopeHeaderProps): JSX.Element | null {
  useLocale();
  const repositories = useAppData((state) => state.repositories);
  const agents = useAppData((state) => state.agents);
  const importRepository = useAppData((state) => state.importRepository);
  const setAgentDefaultRepository = useAppData((state) => state.setAgentDefaultRepository);
  const createSession = useSessions((state) => state.createSession);
  const [scope, setScope] = useState<WorkspaceScopeDescriptor | null>(null);
  const [targetRepositoryId, setTargetRepositoryId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removeArmed, setRemoveArmed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** Rare scope management actions stay behind one compact disclosure. */
  const [actionsOpen, setActionsOpen] = useState(false);
  /** null = hidden; string = explicit native/WSL path entry. */
  const [manualPath, setManualPath] = useState<string | null>(null);
  const [importBackend, setImportBackend] = useState<ExecutionBackendId>(NATIVE_EXECUTION_BACKEND);
  const [wslDistributions, setWslDistributions] = useState<WslDistributionInfo[]>([]);
  const [wslSupported, setWslSupported] = useState<boolean | null>(null);
  const targetContext = useRef('');
  const hostPlatform = typeof navigator === 'undefined' ? '' : navigator.platform;
  const windowsHost = /^Win/i.test(hostPlatform);
  const nativeHostLabel = windowsHost
    ? translate("Native Windows")
    : /^Mac/i.test(hostPlatform) ? translate("Native macOS") : translate("Native Linux");
  const nativePathPlaceholder = windowsHost ? translate("C:\\repos\\project") : translate("/home/name/project");

  const agent = agentId ? agents[agentId] : undefined;
  const locked = scope?.activeLease === true;
  const sortedRepositories = useMemo(
    () => [...repositories].sort((left, right) => left.name.localeCompare(right.name)),
    [repositories],
  );

  // The disclosure survives the 5s workspace poll (nonce); it resets only
  // when the user actually moves to another agent or session context.
  useEffect(() => {
    setActionsOpen(false);
    setManualPath(null);
  }, [agentId, sessionId]);

  useEffect(() => {
    setRemoveArmed(false);
    setNotice(null);
    if (!agentId) {
      setScope(null);
      setTargetRepositoryId('');
      targetContext.current = '';
      onTargetRepositoryChange(null, false);
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
          const repositoryId = descriptor.repositoryId ?? '';
          setTargetRepositoryId(repositoryId);
          onTargetRepositoryChange(repositoryId || null, false);
        }
        setError(null);
      })
      .catch((reason) => {
        if (!live) return;
        setScope(null);
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => { live = false; };
  }, [agentId, sessionId, nonce, onTargetRepositoryChange]);

  useEffect(() => {
    let live = true;
    void window.ade.invoke('wsl:list')
      .then((result) => {
        if (live) {
          setWslSupported(result.supported);
          setWslDistributions(result.distributions);
        }
      })
      .catch(() => {
        if (live) {
          setWslSupported(false);
          setWslDistributions([]);
        }
      });
    return () => { live = false; };
  }, []);

  if (!agentId || !agent) return null;

  const importManualPath = async (): Promise<void> => {
    const path = (manualPath ?? '').trim();
    if (!path) return;
    setBusy(true);
    setError(null);
    try {
      const repository = await importRepository(path, undefined, importBackend);
      setTargetRepositoryId(repository.id);
      onTargetRepositoryChange(repository.id, true);
      setManualPath(null);
      setNotice(translate("Repository \"{{value1}}\" imported.", { value1: repository.name }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const pickRepository = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const picked = await window.ade.invoke('dialog:pickFolder');
      if (!picked.path) return;
      if (!picked.isRepo) throw new Error(translate("The selected folder is not a Git repository."));
      const repository = await importRepository(picked.path, undefined, NATIVE_EXECUTION_BACKEND);
      setTargetRepositoryId(repository.id);
      onTargetRepositoryChange(repository.id, true);
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

  const removeWorktree = async (): Promise<void> => {
    if (!scope?.workspaceBindingId) return;
    if (!removeArmed) {
      setRemoveArmed(true);
      return;
    }
    setRemoveArmed(false);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await window.ade.invoke('workspace:removeBinding', {
        workspaceBindingId: scope.workspaceBindingId,
      });
      setNotice(result.branchDeleted
        ? `Worktree removed; merged branch ${result.branch} deleted.`
        : `Worktree removed; branch ${result.branch} kept (unmerged commits).`);
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
          <span>{translate("Active session scope")}</span>
          <strong>{scope?.repositoryName ?? 'No repository'}</strong>
        </div>
        <span className="rp-scope-source">{scope ? sourceLabel(scope.source) : translate("Loading")}</span>
      </div>
      {scope ? (
        <div className="rp-scope-meta" title={scope.workspaceDir}>
          <span>{status?.branch || scope.branch || (scope.isRepo ? '(detached)' : 'plain workspace')}</span>
          <span>{shortPath(scope.workspaceDir)}</span>
          <span className="rp-scope-backend">
            {scope.executionBackend === NATIVE_EXECUTION_BACKEND
              ? translate("Native")
              : `WSL · ${scope.executionBackend.slice('wsl:'.length)}`}
          </span>
          {scope.isRepo && status ? (
            <span className={status.files.length ? 'rp-scope-dirty' : 'rp-scope-clean'}>
              {status.files.length ? `${status.files.length} changed` : translate("Clean")}
            </span>
          ) : null}
          {scope.activeLease ? <span className="rp-scope-lease">{translate("Run lease")}</span> : null}
        </div>
      ) : null}
      {scope ? (
        // The line above abbreviates to the last three segments, which for a
        // managed worktree is all separator and no answer. "Where does this
        // agent actually work" deserves the whole path, selectable and
        // copyable, not a tooltip.
        <div className="rp-scope-path">
          <span className="rp-scope-path-label">{translate("Workspace")}</span>
          <code data-testid="scope-workspace-path">{scope.workspaceDir}</code>
          <button
            className="rp-scope-path-copy"
            title={translate("Copy path [50666164]")}
            aria-label={translate("Copy working directory: {{value1}}", { value1: scope.workspaceDir })}
            onClick={() => void window.ade.invoke('clipboard:writeText', { text: scope.workspaceDir })
              .then(() => setNotice(translate("Working directory copied.")))
              .catch(() => undefined)}
          >
            {translate("Copy")}</button>
        </div>
      ) : null}
      <div className="rp-scope-controls">
        <select
          aria-label={translate("Repository for new session")}
          value={targetRepositoryId}
          disabled={busy || locked}
          onChange={(event) => {
            const repositoryId = event.target.value;
            setTargetRepositoryId(repositoryId);
            onTargetRepositoryChange(repositoryId || null, true);
          }}
        >
          <option value="">{translate("No repository (portable home)")}</option>
          {sortedRepositories.map((repository) => (
            <option key={repository.id} value={repository.id}>
              {repository.name}{repository.executionBackend === NATIVE_EXECUTION_BACKEND
                ? ''
                : ` · WSL ${repository.executionBackend.slice('wsl:'.length)}`}
            </option>
          ))}
        </select>
        <button type="button" className="btn" disabled={busy || locked} onClick={() => void openSession()}>
          {translate("Open new session")}</button>
        <button
          type="button"
          className={`btn rp-scope-toggle${actionsOpen ? ' open' : ''}`}
          aria-expanded={actionsOpen}
          aria-controls="rp-scope-manage"
          aria-label={translate("Scope and session actions")}
          title={translate("Add repositories, set the agent default or remove the worktree")}
          onClick={() => {
            setActionsOpen((current) => {
              if (current) {
                setManualPath(null);
                setRemoveArmed(false);
              }
              return !current;
            });
          }}
        >
          ⋯
        </button>
      </div>
      {actionsOpen ? (
        <div className="rp-scope-manage" id="rp-scope-manage">
          <div className="rp-scope-actions">
            <button type="button" className="btn" disabled={busy || locked} onClick={() => void pickRepository()}>
              {translate("Add repo")}</button>
            <button
              type="button"
              className="btn"
              disabled={busy || locked}
              title={translate("Enter the repository path directly and explicitly choose the execution backend")}
              onClick={() => setManualPath((current) => (current === null ? '' : null))}
            >
              {translate("Path …")}</button>
            <button
              type="button"
              className="btn"
              disabled={busy || locked || (agent.defaultRepositoryId ?? '') === targetRepositoryId}
              onClick={() => void setDefault()}
            >
              {targetRepositoryId ? translate("Set agent default") : translate("Clear agent default")}
            </button>
            {scope?.workspaceBindingId ? (
              <button
                type="button"
                className={`btn${removeArmed ? ' rp-scope-remove-armed' : ''}`}
                disabled={busy || locked}
                title={translate("Remove this agent's worktree from disk. Refused while sessions, tasks or uncommitted changes exist; a fresh worktree is created on next use.")}
                onClick={() => void removeWorktree()}
              >
                {removeArmed ? translate("Really remove?") : translate("Remove worktree")}
              </button>
            ) : null}
          </div>
          {manualPath !== null && (
            <div className="rp-scope-controls">
              <select
                aria-label={translate("Execution backend")}
                value={importBackend}
                disabled={busy}
                onChange={(event) => setImportBackend(event.target.value as ExecutionBackendId)}
              >
                <option value={NATIVE_EXECUTION_BACKEND}>{nativeHostLabel}</option>
                {wslDistributions.map((distribution) => (
                  // Availability is advisory only: a cold WSL VM can miss the
                  // probe window, and the import itself reports real failures.
                  <option key={distribution.backend} value={distribution.backend}>
                    {translate("WSL ·")}{" "}{distribution.name}{distribution.available ? '' : ' (unavailable?)'}
                  </option>
                ))}
              </select>
              <input
                type="text"
                aria-label={translate("Repository path")}
                placeholder={importBackend === NATIVE_EXECUTION_BACKEND
                  ? nativePathPlaceholder
                  : translate("/home/name/project")}
                value={manualPath}
                disabled={busy}
                onChange={(event) => setManualPath(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') void importManualPath(); }}
              />
              <button
                type="button"
                className="btn"
                disabled={busy || manualPath.trim().length === 0}
                onClick={() => void importManualPath()}
              >
                {translate("Import")}</button>
            </div>
          )}
          {manualPath !== null && windowsHost && wslSupported === false ? (
            <div className="rp-scope-notice">
              {translate("WSL is not available. Install/enable WSL2, then reopen ADE to use a Linux backend.")}</div>
          ) : null}
          {manualPath !== null && windowsHost && wslSupported === true && wslDistributions.length === 0 ? (
            <div className="rp-scope-notice">{translate("No WSL distributions were found.")}</div>
          ) : null}
        </div>
      ) : null}
      {locked ? <div className="rp-scope-lock">{translate("This binding is owned by an active managed run.")}</div> : null}
      {notice ? <div className="rp-scope-notice">{localizeAppMessage(notice)}</div> : null}
      {error ? <div className="rp-scope-error">{localizeAppMessage(error)}</div> : null}
    </section>
  );
}
