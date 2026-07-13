/**
 * Right-click menu for entries in the Files tab. Read actions (copy paths,
 * reveal, open) work everywhere; mutations (rename, delete-to-trash) are
 * workspace-only — pinned files living in the agent's memoryDir are protected.
 * Delete is two-step; rename swaps the menu for an inline input.
 */

import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';

export interface ContextTarget {
  x: number;
  y: number;
  /** workspace-relative path (bare filename for pinned agent files) */
  path: string;
  name: string;
  kind: 'file' | 'dir';
  location: 'workspace' | 'memory';
}

interface FileContextMenuProps {
  agentId: string;
  sessionId: string | null;
  target: ContextTarget;
  onClose: () => void;
  onPreview: (path: string, title: string) => void;
  /** newPath null = entry is gone (deleted); otherwise renamed. */
  onMutated: (oldPath: string, newPath: string | null) => void;
}

export function FileContextMenu({
  agentId,
  sessionId,
  target,
  onClose,
  onPreview,
  onMutated,
}: FileContextMenuProps): JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: target.x, top: target.y });
  const [mode, setMode] = useState<'menu' | 'rename'>('menu');
  const [renameValue, setRenameValue] = useState(target.name);
  const [armedDelete, setArmedDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep the menu inside the window once its real size is known.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(target.x, window.innerWidth - rect.width - 4)),
      top: Math.max(4, Math.min(target.y, window.innerHeight - rect.height - 4)),
    });
  }, [target.x, target.y, mode, error]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const request = { agentId, sessionId: sessionId ?? undefined, path: target.path };

  const run = (action: () => Promise<void>): void => {
    setBusy(true);
    setError(null);
    void action()
      .then(() => onClose())
      .catch((err) => {
        setError(err instanceof Error ? err.message.replace(/^.*ade: /, '') : String(err));
        setBusy(false);
        setArmedDelete(false);
      });
  };

  const copyAbsolutePath = (): void => run(async () => {
    const info = await window.ade.invoke('fs:pathInfo', request);
    await window.ade.invoke('clipboard:writeText', { text: info.absolutePath });
  });

  const copyRelativePath = (): void => run(async () => {
    await window.ade.invoke('clipboard:writeText', { text: target.path });
  });

  const reveal = (): void => run(async () => {
    await window.ade.invoke('fs:reveal', request);
  });

  const openDefault = (): void => run(async () => {
    await window.ade.invoke('fs:openPath', request);
  });

  const submitRename = (): void => {
    const newName = renameValue.trim();
    if (!newName || newName === target.name) return onClose();
    run(async () => {
      const result = await window.ade.invoke('fs:rename', { ...request, newName });
      onMutated(target.path, result.path);
    });
  };

  const doDelete = (): void => {
    if (!armedDelete) {
      setArmedDelete(true);
      return;
    }
    run(async () => {
      await window.ade.invoke('fs:delete', request);
      onMutated(target.path, null);
    });
  };

  const mutable = target.location === 'workspace';

  return (
    <>
      <div
        className="ctx-backdrop"
        onMouseDown={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div
        ref={menuRef}
        className="ctx-menu"
        style={{ left: pos.left, top: pos.top }}
        role="menu"
        aria-label={`Actions for ${target.name}`}
      >
        {mode === 'rename' ? (
          <div className="ctx-rename">
            <input
              autoFocus
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitRename();
              }}
              disabled={busy}
              spellCheck={false}
            />
            <button type="button" onClick={submitRename} disabled={busy}>
              OK
            </button>
          </div>
        ) : (
          <>
            {target.kind === 'file' ? (
              <button type="button" className="ctx-item" role="menuitem" disabled={busy}
                onClick={() => { onPreview(target.path, target.name); onClose(); }}>
                Preview
              </button>
            ) : null}
            {target.kind === 'file' ? (
              <button type="button" className="ctx-item" role="menuitem" disabled={busy} onClick={openDefault}>
                Open in default app
              </button>
            ) : null}
            <button type="button" className="ctx-item" role="menuitem" disabled={busy} onClick={reveal}>
              Reveal in Explorer
            </button>
            <div className="ctx-sep" />
            <button type="button" className="ctx-item" role="menuitem" disabled={busy} onClick={copyAbsolutePath}>
              Copy path
            </button>
            <button type="button" className="ctx-item" role="menuitem" disabled={busy} onClick={copyRelativePath}>
              Copy relative path
            </button>
            {mutable ? (
              <>
                <div className="ctx-sep" />
                <button type="button" className="ctx-item" role="menuitem" disabled={busy}
                  onClick={() => setMode('rename')}>
                  Rename…
                </button>
                <button
                  type="button"
                  className={`ctx-item danger${armedDelete ? ' armed' : ''}`}
                  role="menuitem"
                  disabled={busy}
                  onClick={doDelete}
                >
                  {armedDelete ? 'Really delete? (to Recycle Bin)' : 'Delete'}
                </button>
              </>
            ) : (
              <div className="ctx-note">Managed agent file — rename/delete disabled</div>
            )}
          </>
        )}
        {error ? <div className="ctx-error">{error}</div> : null}
      </div>
    </>
  );
}
