import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import type { ProjectDirectoryEntry, ProjectDirectoryView, ProjectWorkspaceQuery, ProjectWorkspaceView } from '../../shared/remote';
import { ProjectDirectory, ProjectWorkspaceSummary } from './ProjectDirectory';
import { ProjectBranches, type PendingBranch } from './ProjectBranches';
import { ProjectTerminal } from './ProjectTerminal';
import { ProjectGitPanel, type PendingProjectFile, type PendingProjectGit } from './ProjectGitPanel';
import { ProjectPublishPanel, type PendingProjectPublish } from './ProjectPublishPanel';
import { ProjectRunResults } from './ProjectRunResults';
import { desktopRunFiles } from '../graph/RunFilesPanel';
import { useSelection } from '../stores/selection';

const query = (input: ProjectWorkspaceQuery) => window.ade.invoke('project:query', input);
const applyBranch = async (previewId: string) => (await window.ade.invoke('project:command', { operation: 'branch-apply', previewId })).workspace;
const applyGit = async (previewId: string) => (await window.ade.invoke('project:command', { operation: 'git-apply', previewId })).git!;
const applyPublish = (previewId: string) => window.ade.invoke('project:command', { operation: 'publish-apply', previewId });
const errorText = (error: unknown) => String(error);

export function ProjectsView(): JSX.Element {
  const [directory, setDirectory] = useState<ProjectDirectoryView>(); const [workspace, setWorkspace] = useState<ProjectWorkspaceView>();
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [createdId, setCreatedId] = useState<string>();
  const selectedId = useSelection((state) => state.projectWorkspaceId);
  const repositoryId = useSelection((state) => state.projectRepositoryId);
  const sessionId = useSelection((state) => state.projectSessionId);
  const [pending, setPending] = useState<PendingBranch | null>(null);
  const [section, setSection] = useState<'terminal' | 'git' | 'results'>('terminal');
  const [gitReceipts, setGitReceipts] = useState<Record<string, PendingProjectGit | null>>({});
  const [fileReceipts, setFileReceipts] = useState<Record<string, PendingProjectFile | null>>({});
  const [publishReceipts, setPublishReceipts] = useState<Record<string, PendingProjectPublish | null>>({});
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
  useEffect(() => { let stopped = false; if (selectedId && selectedId !== workspace?.id) {
    void query({ operation: 'workspace', workspaceId: selectedId }).then((result) => { if (!stopped) setWorkspace(result.workspace); })
      .catch((reason) => { if (!stopped) setError(String(reason)); });
  } return () => { stopped = true; }; }, [selectedId, workspace?.id]);
  const open = async (entry: ProjectDirectoryEntry, button: HTMLButtonElement) => {
    if (lock.current) return; lock.current = true; opener.current = button; setBusy(true); setError('');
    try {
      const result = await window.ade.invoke('project:command', { operation: 'open', entryId: entry.id });
      if (live.current) { setWorkspace(result.workspace); useSelection.getState().setProjectWorkspace(result.workspace.id); }
    } catch (reason) { if (live.current) setError(String(reason)); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  };
  const repositoryEntry = repositoryId ? directory?.entries.find((entry) => entry.repositoryId === repositoryId) : undefined;
  const create = async () => {
    if (lock.current) return; lock.current = true; setBusy(true); setError('');
    try {
      const id = createdId ?? (await window.ade.invoke('project:create', { name: newName.trim() })).repositoryId;
      if (live.current) setCreatedId(id);
      const result = await query({ operation: 'directory' });
      const entry = result.directory?.entries.find((item) => item.repositoryId === id);
      if (!entry) throw new Error('Projekt wurde angelegt. Projektordner aktualisieren und dort öffnen.');
      const opened = await window.ade.invoke('project:command', { operation: 'open', entryId: entry.id });
      if (live.current) { setWorkspace(opened.workspace); useSelection.getState().setProjectWorkspace(opened.workspace.id); setCreatedId(undefined); setNewName(''); }
    } catch (reason) { if (live.current) setError(String(reason)); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  };
  return <section className="project-desktop" aria-label="Projekte">
    <h1 ref={heading} tabIndex={-1}>{workspace ? `Projekt · ${workspace.name}` : 'Projekte'}</h1>
    {workspace ? <><ProjectWorkspaceSummary workspace={workspace} /><button onClick={() => {
      setWorkspace(undefined); useSelection.getState().setProjectWorkspace(null);
      const target = opener.current?.isConnected ? opener.current : document.getElementById('mode-tab-projects'); target?.focus();
      void refresh();
    }}>Zur Projektübersicht</button>
      <ProjectBranches key={workspace.id} workspace={workspace} online canChange query={query} apply={applyBranch} errorText={errorText}
        pending={pending} savePending={(value) => { setPending(value); return true; }} onWorkspace={(value) => { setWorkspace(value); useSelection.getState().setProjectWorkspace(value.id); }} />
      <div className="project-workspace-actions" aria-label="Projektbereich"><button aria-pressed={section === 'terminal'} onClick={() => setSection('terminal')}>Terminal</button><button aria-pressed={section === 'git'} onClick={() => setSection('git')}>Git</button><button aria-pressed={section === 'results'} onClick={() => setSection('results')}>Ergebnisse</button></div>
      {section === 'terminal' ? <ProjectTerminal key={`${workspace.id}:${workspace.branch}:${sessionId ?? ''}`} workspace={workspace} initialSessionId={sessionId ?? undefined} />
        : section === 'results' ? <ProjectRunResults key={workspace.id} workspaceId={workspace.id} query={query} port={desktopRunFiles} online errorText={errorText} />
        : <><ProjectGitPanel key={`${workspace.id}:${workspace.branch}`} workspace={workspace} online canChange canEdit query={query} apply={applyGit} errorText={errorText}
          readFile={(path) => window.ade.invoke('project:fileRead', { projectWorkspaceId: workspace.id, path })}
          saveFile={(input) => window.ade.invoke('project:fileSave', { projectWorkspaceId: workspace.id, path: input.path, text: input.text, revision: input.revision, workspaceVersion: input.workspaceVersion })}
          pending={gitReceipts[workspace.id] ?? null} savePending={(value) => { setGitReceipts((all) => ({ ...all, [workspace.id]: value })); return true; }}
          filePending={fileReceipts[workspace.id] ?? null} saveFilePending={(value) => { setFileReceipts((all) => ({ ...all, [workspace.id]: value })); return true; }}
          onWorkspace={(value) => { if (value.id !== workspace.id || value.branch !== workspace.branch) { setWorkspace(value); useSelection.getState().setProjectWorkspace(value.id); } }} />
          <ProjectPublishPanel key={`publish:${workspace.id}:${workspace.branch}`} workspace={workspace} online canPublish query={query} apply={applyPublish} errorText={errorText}
            pending={publishReceipts[workspace.id] ?? null} savePending={(value) => { setPublishReceipts((all) => ({ ...all, [workspace.id]: value })); return true; }} /></>}
    </> : <><details><summary>Neues Projekt</summary><form className="project-workspace-actions" onSubmit={(event) => { event.preventDefault(); void create(); }}>
      <label>Projektname<input value={newName} maxLength={80} disabled={busy || !!createdId} onChange={(event) => setNewName(event.target.value)} /></label>
      <button disabled={busy || !directory?.configured || !newName.trim()}>{createdId ? 'Angelegtes Projekt öffnen' : 'Projekt anlegen und öffnen'}</button>
      <p>Im eingestellten Projekt-Stammordner, mit Branch main. CLI und optionales Profil danach wählen.</p>
      {!directory?.configured && <p>Unter Settings zuerst den Projekt-Stammordner speichern.</p>}
    </form></details>{repositoryEntry && <section aria-label="Gewähltes Projekt"><h2>{repositoryEntry.name}</h2>
      <button disabled={busy || repositoryEntry.kind !== 'repository'} onClick={(event) => void open(repositoryEntry, event.currentTarget)}>Projekt-Workspace öffnen</button></section>}
      {repositoryId && directory && !repositoryEntry && <p role="status">Das gewählte Projekt ist gerade nicht erreichbar. Projektordner aktualisieren.</p>}
      <ProjectDirectory directory={directory} busy={busy} error={error} onRefresh={() => void refresh()} onOpen={(entry, button) => void open(entry, button)} /></>}
  </section>;
}
