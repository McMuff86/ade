/**
 * Right panel: Overview inspects the selected catalog repository; Changes and
 * Files remain bound to the active agent/session workspace. All three use one
 * shared inline detail pane for commit patches, live diffs and file previews.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
} from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { RepositoryCommitSummary } from '../../shared/types';
import { useSelection } from '../stores/selection';
import { useSessions } from '../stores/sessions';
import { ChangesView } from './ChangesView';
import { FilesView } from './FilesView';
import { DiffView } from './DiffView';
import { useWorkspacePanel } from './useWorkspacePanel';
import { RepositoryScopeHeader } from './RepositoryScopeHeader';
import { RepositoryInspector } from './RepositoryInspector';
import './rightpanel.css';

type Tab = 'overview' | 'changes' | 'files';
interface OpenItem {
  kind: 'diff' | 'preview' | 'commit';
  path: string;
  title: string;
  repositoryId?: string;
}

const TABS: readonly Tab[] = ['overview', 'changes', 'files'];

export function RightPanel({ visible }: { visible: boolean }): JSX.Element {
  const agentId = useSelection((s) => s.selectedAgentId);
  const sessionId = useSessions((state) => (
    agentId ? (state.activeByAgent[agentId] ?? null) : null
  ));
  const { status, loading, nonce } = useWorkspacePanel(agentId, sessionId, visible);

  const [tab, setTab] = useState<Tab>('overview');
  const [inspectedRepositoryId, setInspectedRepositoryId] = useState<string | null>(null);
  const [open, setOpen] = useState<OpenItem | null>(null);
  const [content, setContent] = useState<string>('');
  const [truncated, setTruncated] = useState(false);
  const [contentLoading, setContentLoading] = useState(false);
  const reqSeq = useRef(0);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const pendingCommitFocus = useRef<string | null>(null);

  // Close the inline pane when switching agent or tab.
  useEffect(() => {
    setOpen(null);
    returnFocus.current = null;
    pendingCommitFocus.current = null;
  }, [agentId, sessionId, tab, inspectedRepositoryId]);

  const closeInline = useCallback((restoreFocus = true): void => {
    pendingCommitFocus.current = restoreFocus
      ? (returnFocus.current?.dataset['commitSha'] ?? null)
      : null;
    setOpen(null);
    returnFocus.current = null;
  }, []);

  // Opening the split pane remounts the list inside react-resizable-panels.
  // Restore focus only after React has committed the non-split list again.
  useLayoutEffect(() => {
    if (open !== null || !pendingCommitFocus.current) return;
    const commitSha = pendingCommitFocus.current;
    pendingCommitFocus.current = null;
    document.querySelector<HTMLButtonElement>(`[data-commit-sha="${commitSha}"]`)?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeInline();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, closeInline]);

  // Fetch the inline pane content whenever the open item changes.
  useEffect(() => {
    if (!open || (open.kind !== 'commit' && !agentId)) {
      setContent('');
      setTruncated(false);
      return;
    }
    const seq = ++reqSeq.current;
    setContentLoading(true);
    void (async () => {
      try {
        if (open.kind === 'commit') {
          const result = await window.ade.invoke('repository:commitDiff', {
            repositoryId: open.repositoryId!,
            commitSha: open.path,
          });
          if (seq === reqSeq.current) {
            setContent(result.diff);
            setTruncated(result.truncated || result.filesTruncated);
          }
        } else if (open.kind === 'diff') {
          const text = await window.ade.invoke('git:diff', {
            agentId: agentId!,
            sessionId: sessionId ?? undefined,
            path: open.path,
          });
          if (seq === reqSeq.current) {
            setContent(text);
            setTruncated(false);
          }
        } else {
          const res = await window.ade.invoke('fs:read', {
            agentId: agentId!,
            sessionId: sessionId ?? undefined,
            path: open.path,
          });
          if (seq === reqSeq.current) {
            setContent(res.text);
            setTruncated(res.truncated);
          }
        }
      } catch (err) {
        console.error('[ade] inline content fetch failed:', err);
        if (seq === reqSeq.current) {
          setContent('');
          setTruncated(false);
        }
      } finally {
        if (seq === reqSeq.current) setContentLoading(false);
      }
    })();
  }, [open, agentId, sessionId]);

  const toggle = (item: OpenItem): void => {
    returnFocus.current = null;
    setOpen((cur) => (cur && cur.kind === item.kind && cur.path === item.path ? null : item));
  };

  const openCommit = (commit: RepositoryCommitSummary, trigger: HTMLButtonElement): void => {
    if (open?.kind === 'commit' && open.path === commit.sha) {
      closeInline();
      return;
    }
    returnFocus.current = trigger;
    setOpen({
      kind: 'commit',
      path: commit.sha,
      title: `${commit.shortSha} · ${commit.subject}`,
      repositoryId: inspectedRepositoryId!,
    });
  };

  const handleTargetRepositoryChange = useCallback((
    repositoryId: string | null,
    userInitiated: boolean,
  ): void => {
    setInspectedRepositoryId(repositoryId);
    if (userInitiated) setTab('overview');
  }, []);

  const selectTab = (next: Tab): void => setTab(next);

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, current: Tab): void => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = TABS.indexOf(current);
    const next = event.key === 'Home'
      ? TABS[0]!
      : event.key === 'End'
        ? TABS[TABS.length - 1]!
        : TABS[(index + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length]!;
    selectTab(next);
    requestAnimationFrame(() => document.getElementById(`rp-tab-${next}`)?.focus());
  };

  // Keep the preview honest after a context-menu rename/delete.
  const handleMutated = (oldPath: string, newPath: string | null): void => {
    setOpen((cur) => {
      if (!cur || cur.kind !== 'preview') return cur;
      if (cur.path !== oldPath && !cur.path.startsWith(`${oldPath}/`)) return cur;
      if (newPath === null || cur.path !== oldPath) return null;
      return { kind: 'preview', path: newPath, title: newPath.split('/').pop() ?? newPath };
    });
  };

  const listView = tab === 'overview' ? (
    <RepositoryInspector
      repositoryId={inspectedRepositoryId}
      visible={visible}
      nonce={nonce}
      openCommitSha={open?.kind === 'commit' ? open.path : null}
      onOpenCommit={openCommit}
    />
  ) : tab === 'changes' ? (
    <ChangesView
      status={status}
      loading={loading}
      openPath={open?.kind === 'diff' ? open.path : null}
      onOpen={(path) => toggle({ kind: 'diff', path, title: path })}
    />
  ) : (
    <FilesView
      agentId={agentId}
      sessionId={sessionId}
      status={status}
      nonce={nonce}
      openPath={open?.kind === 'preview' ? open.path : null}
      onOpen={(path, title) => toggle({ kind: 'preview', path, title })}
      onMutated={handleMutated}
    />
  );

  const inlinePane = open ? (
    <>
      <div className="rp-inline-head">
        <span className="rp-inline-title" title={open.path}>
          {open.title}
          {truncated ? <span className="rp-trunc"> (truncated)</span> : null}
        </span>
        <button
          type="button"
          className="rp-inline-close"
          onClick={() => closeInline()}
          title="Close"
          aria-label="Close inline preview"
        >
          ×
        </button>
      </div>
      <div className="rp-inline-body">
        {contentLoading ? (
          <div className="ch-note">Loading…</div>
        ) : open.kind === 'diff' || open.kind === 'commit' ? (
          <DiffView text={content} />
        ) : content ? (
          <pre className="rp-preview">{content}</pre>
        ) : open.path === 'MEMORY.md' || open.path === 'USER.md' ? (
          <div className="ch-note">
            No entries yet. The agent maintains this file itself while working:
            MEMORY.md collects its own durable notes (environment, conventions,
            lessons), USER.md the user profile. Entries are separated by a
            &quot;§&quot; line and injected into every new session once saved.
          </div>
        ) : (
          <pre className="rp-preview">(empty file)</pre>
        )}
      </div>
    </>
  ) : null;

  return (
    <div className="rp">
      <RepositoryScopeHeader
        agentId={agentId}
        sessionId={sessionId}
        nonce={nonce}
        status={status}
        onTargetRepositoryChange={handleTargetRepositoryChange}
      />
      <div className="rp-head">
        <div className="rp-tabs" role="tablist" aria-label="Repository panel">
          {TABS.map((item) => (
            <button
              key={item}
              id={`rp-tab-${item}`}
              type="button"
              role="tab"
              aria-selected={tab === item}
              aria-controls={`rp-panel-${item}`}
              tabIndex={tab === item ? 0 : -1}
              className={`rp-tab${tab === item ? ' active' : ''}`}
              onClick={() => selectTab(item)}
              onKeyDown={(event) => handleTabKeyDown(event, item)}
            >
              {item[0]!.toUpperCase() + item.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div
        id={`rp-panel-${tab}`}
        className="rp-body"
        role="tabpanel"
        aria-labelledby={`rp-tab-${tab}`}
      >
        <PanelGroup direction="vertical" autoSaveId="ade:rightpanel:preview">
          {/* Keep the list panel mounted when details open. Besides retaining
              scroll/data state, this preserves the trigger element for
              deterministic focus restoration after Escape. The panel library
              forces `overflow: hidden` inline, so scrolling lives inside. */}
          <Panel id="rp-list" order={1} defaultSize={open ? 55 : 100} minSize={15} className="rp-pane">
            <div className="rp-content">{listView}</div>
          </Panel>
          {open ? (
            <>
            <PanelResizeHandle className="resize-handle-h" />
            <Panel id="rp-preview" order={2} defaultSize={45} minSize={12} maxSize={85} className="rp-pane">
              <div className="rp-inline">{inlinePane}</div>
            </Panel>
            </>
          ) : null}
        </PanelGroup>
      </div>
    </div>
  );
}
