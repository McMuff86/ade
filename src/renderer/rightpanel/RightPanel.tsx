/**
 * Right panel (Phase C): Files / Changes tabs over the selected agent's
 * workspace. Changes shows the live git diff; Files shows pinned agent files +
 * the workspace tree. Both open their target in one shared inline pane at the
 * bottom (diff for a change, read-only preview for a file).
 */

import { useEffect, useRef, useState, type JSX } from 'react';
import { useSelection } from '../stores/selection';
import { useSessions } from '../stores/sessions';
import { ChangesView } from './ChangesView';
import { FilesView } from './FilesView';
import { DiffView } from './DiffView';
import { useWorkspacePanel } from './useWorkspacePanel';
import { RepositoryScopeHeader } from './RepositoryScopeHeader';
import './rightpanel.css';

type Tab = 'files' | 'changes';
interface OpenItem {
  kind: 'diff' | 'preview';
  path: string;
  title: string;
}

export function RightPanel({ visible }: { visible: boolean }): JSX.Element {
  const agentId = useSelection((s) => s.selectedAgentId);
  const sessionId = useSessions((state) => (
    agentId ? (state.activeByAgent[agentId] ?? null) : null
  ));
  const { status, loading, nonce } = useWorkspacePanel(agentId, sessionId, visible);

  const [tab, setTab] = useState<Tab>('changes');
  const [open, setOpen] = useState<OpenItem | null>(null);
  const [content, setContent] = useState<string>('');
  const [truncated, setTruncated] = useState(false);
  const [contentLoading, setContentLoading] = useState(false);
  const reqSeq = useRef(0);

  // Close the inline pane when switching agent or tab.
  useEffect(() => setOpen(null), [agentId, sessionId, tab]);

  // Fetch the inline pane content whenever the open item changes.
  useEffect(() => {
    if (!open || !agentId) {
      setContent('');
      setTruncated(false);
      return;
    }
    const seq = ++reqSeq.current;
    setContentLoading(true);
    void (async () => {
      try {
        if (open.kind === 'diff') {
          const text = await window.ade.invoke('git:diff', {
            agentId,
            sessionId: sessionId ?? undefined,
            path: open.path,
          });
          if (seq === reqSeq.current) {
            setContent(text);
            setTruncated(false);
          }
        } else {
          const res = await window.ade.invoke('fs:read', {
            agentId,
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
    setOpen((cur) => (cur && cur.kind === item.kind && cur.path === item.path ? null : item));
  };

  return (
    <div className="rp">
      <RepositoryScopeHeader
        agentId={agentId}
        sessionId={sessionId}
        nonce={nonce}
        status={status}
      />
      <div className="rp-head">
        <div className="rp-tabs">
          <button
            className={`rp-tab${tab === 'files' ? ' active' : ''}`}
            onClick={() => setTab('files')}
          >
            Files
          </button>
          <button
            className={`rp-tab${tab === 'changes' ? ' active' : ''}`}
            onClick={() => setTab('changes')}
          >
            Changes
          </button>
        </div>
      </div>

      <div className="rp-content">
        {tab === 'changes' ? (
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
          />
        )}
      </div>

      {open ? (
        <div className="rp-inline">
          <div className="rp-inline-head">
            <span className="rp-inline-title" title={open.path}>
              {open.title}
              {truncated ? <span className="rp-trunc"> (truncated)</span> : null}
            </span>
            <button className="rp-inline-close" onClick={() => setOpen(null)} title="Close">
              ×
            </button>
          </div>
          <div className="rp-inline-body">
            {contentLoading ? (
              <div className="ch-note">Loading…</div>
            ) : open.kind === 'diff' ? (
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
        </div>
      ) : null}
    </div>
  );
}
