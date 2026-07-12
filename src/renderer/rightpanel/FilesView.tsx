/**
 * Files tab: a pinned "Agent files" section (MEMORY/USER/CLAUDE/AGENTS that
 * exist) on top, then the workspace tree with lazy-expanding directories.
 * Clicking a file asks the parent to preview it in the shared inline pane;
 * files with pending git changes show their +/- next to the name.
 */

import { useEffect, useMemo, useState, type JSX } from 'react';
import type { AgentFile, FsTreeNode, GitStatus } from '../../shared/types';

interface FilesViewProps {
  agentId: string | null;
  sessionId: string | null;
  status: GitStatus | null;
  nonce: number;
  openPath: string | null;
  onOpen: (path: string, title: string) => void;
}

interface Counts {
  additions: number;
  deletions: number;
}

export function FilesView({
  agentId,
  sessionId,
  status,
  nonce,
  openPath,
  onOpen,
}: FilesViewProps): JSX.Element {
  const [childrenByPath, setChildrenByPath] = useState<Record<string, FsTreeNode[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pinned, setPinned] = useState<AgentFile[]>([]);

  // Pending +/- by path, from git status.
  const counts = useMemo(() => {
    const m = new Map<string, Counts>();
    for (const f of status?.files ?? []) {
      m.set(f.path, { additions: f.additions, deletions: f.deletions });
    }
    return m;
  }, [status]);

  // Root tree on agent change.
  useEffect(() => {
    if (!agentId) {
      setChildrenByPath({});
      setExpanded(new Set());
      return;
    }
    let live = true;
    void (async () => {
      try {
        const root = await window.ade.invoke('fs:tree', {
          agentId,
          sessionId: sessionId ?? undefined,
          path: '',
        });
        if (live) {
          setChildrenByPath({ '': root.children ?? [] });
          setExpanded(new Set());
        }
      } catch (err) {
        console.error('[ade] fs:tree(root) failed:', err);
      }
    })();
    return () => {
      live = false;
    };
  }, [agentId, sessionId]);

  // Pinned agent files on agent change + on each refresh nonce.
  useEffect(() => {
    if (!agentId) {
      setPinned([]);
      return;
    }
    let live = true;
    void (async () => {
      try {
        const files = await window.ade.invoke('fs:agentFiles', {
          agentId,
          sessionId: sessionId ?? undefined,
        });
        if (live) setPinned(files);
      } catch (err) {
        console.error('[ade] fs:agentFiles failed:', err);
      }
    })();
    return () => {
      live = false;
    };
  }, [agentId, sessionId, nonce]);

  const toggleDir = async (path: string): Promise<void> => {
    const next = new Set(expanded);
    if (next.has(path)) {
      next.delete(path);
      setExpanded(next);
      return;
    }
    next.add(path);
    setExpanded(next);
    if (!childrenByPath[path] && agentId) {
      try {
        const node = await window.ade.invoke('fs:tree', {
          agentId,
          sessionId: sessionId ?? undefined,
          path,
        });
        setChildrenByPath((prev) => ({ ...prev, [path]: node.children ?? [] }));
      } catch (err) {
        console.error('[ade] fs:tree(expand) failed:', err);
      }
    }
  };

  const renderNodes = (nodes: FsTreeNode[], depth: number): JSX.Element[] =>
    nodes.map((node) => {
      const pad = { paddingLeft: `${8 + depth * 12}px` };
      if (node.kind === 'dir') {
        const isOpen = expanded.has(node.path);
        return (
          <div key={node.path}>
            <button className="fs-row fs-dir" style={pad} onClick={() => void toggleDir(node.path)}>
              <span className="fs-caret">{isOpen ? '▾' : '▸'}</span>
              <span className="fs-name">{node.name}</span>
            </button>
            {isOpen ? renderNodes(childrenByPath[node.path] ?? [], depth + 1) : null}
          </div>
        );
      }
      const c = counts.get(node.path);
      return (
        <button
          key={node.path}
          className={`fs-row fs-file${openPath === node.path ? ' open' : ''}`}
          style={pad}
          onClick={() => onOpen(node.path, node.path)}
          title={node.path}
        >
          <span className="fs-name">{node.name}</span>
          {c?.additions ? <span className="plus">+{c.additions}</span> : null}
          {c?.deletions ? <span className="minus">-{c.deletions}</span> : null}
        </button>
      );
    });

  const root = childrenByPath[''] ?? [];

  return (
    <div className="fs-view">
      {pinned.length > 0 ? (
        <div className="fs-section">
          <div className="fs-section-head">Agent files</div>
          {pinned.map((f) => {
            const c = counts.get(f.path);
            return (
              <button
                key={f.path}
                className={`fs-row fs-file${openPath === f.path ? ' open' : ''}`}
                style={{ paddingLeft: '8px' }}
                onClick={() => onOpen(f.path, f.name)}
                title={`${f.name} (${f.location})`}
              >
                <span className="fs-name">{f.name}</span>
                <span className="fs-location">{f.location === 'memory' ? 'global' : 'workspace'}</span>
                {c?.additions ? <span className="plus">+{c.additions}</span> : null}
                {c?.deletions ? <span className="minus">-{c.deletions}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="fs-section">
        {pinned.length > 0 ? <div className="fs-section-head">Workspace</div> : null}
        {root.length === 0 ? (
          <div className="ch-note">Empty workspace.</div>
        ) : (
          renderNodes(root, 0)
        )}
      </div>
    </div>
  );
}
