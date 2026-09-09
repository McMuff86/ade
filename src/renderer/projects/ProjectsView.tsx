import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import type { ProjectDirectoryEntry, ProjectDirectoryView, ProjectWorkspaceView } from '../../shared/remote';
import { ProjectDirectory, ProjectWorkspaceSummary } from './ProjectDirectory';

export function ProjectsView(): JSX.Element {
  const [directory, setDirectory] = useState<ProjectDirectoryView>(); const [workspace, setWorkspace] = useState<ProjectWorkspaceView>();
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const live = useRef(true); const lock = useRef(false); const opener = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => { if (workspace) heading.current?.focus(); }, [workspace]);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const refresh = useCallback(async () => {
    if (lock.current) return; lock.current = true; setBusy(true); setError('');
    try { const result = await window.ade.invoke('project:query', { operation: 'directory' }); if (live.current) setDirectory(result.directory); }
    catch (reason) { if (live.current) setError(String(reason)); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const open = async (entry: ProjectDirectoryEntry, button: HTMLButtonElement) => {
    if (lock.current) return; lock.current = true; opener.current = button; setBusy(true); setError('');
    try {
      const result = await window.ade.invoke('project:command', { operation: 'open', entryId: entry.id });
      if (live.current) setWorkspace(result.workspace);
    } catch (reason) { if (live.current) setError(String(reason)); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  };
  return <section className="project-desktop" aria-label="Projekte">
    <h1 ref={heading} tabIndex={-1}>{workspace ? `Projekt · ${workspace.name}` : 'Projekte'}</h1>
    {workspace ? <><ProjectWorkspaceSummary workspace={workspace} /><button onClick={() => {
      setWorkspace(undefined);
      const target = opener.current?.isConnected ? opener.current : document.getElementById('mode-tab-projects'); target?.focus();
      void refresh();
    }}>Zur Projektübersicht</button></> : <ProjectDirectory directory={directory} busy={busy} error={error} onRefresh={() => void refresh()} onOpen={(entry, button) => void open(entry, button)} />}
  </section>;
}
