import { useEffect, useRef, useState, type JSX } from 'react';
import type { MobileAdministrationResult, MobileHostState, MobileTerminalState } from '../shared/remote';
import type { MobileHost } from './useMobileHost';
import { useDeviceDraft } from './deviceDrafts';
import { Dialog } from './ui';
import { workspaceError } from './AgentWorkspace';
import { MobileClientError } from './client';

export interface ProjectSession { agentId: string; repositoryId: string; terminalId?: string }
interface StartProgress {
  key: string; name: string; agentId: string; repositoryId: string;
  phase: 'agent' | 'project' | 'workspace' | 'terminal' | 'done'; terminalId?: string;
}
const phases = { agent: 'Codex-Profil vorbereiten', project: 'Projekt anlegen', workspace: 'Workspace vorbereiten', terminal: 'Codex starten', done: 'Sitzung öffnen' };
export function ProjectStart({ host, open, onClose, onOpen, onStarted }: {
  host: MobileHost; open: boolean; onClose: () => void; onOpen: () => void; onStarted: (session: ProjectSession) => void;
}): JSX.Element {
  const [progress, save] = useDeviceDraft<StartProgress | null>(host.deviceId, 'project-start', null);
  const [name, setName] = useState(''); const [agentId, setAgentId] = useState<string>();
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const lock = useRef(false);
  const [rights, setRights] = useState<MobileHostState>();
  useEffect(() => {
    if (!open || host.status !== 'online') return;
    let live = true; setRights(undefined);
    void Promise.all([host.request<MobileHostState>('/api/v1/host'), host.refresh()])
      .then(([value]) => { if (live) setRights(value); }).catch((reason) => { if (live) setError(workspaceError(reason)); });
    return () => { live = false; };
  }, [open, host.status, host.request, host.refresh]);
  const permitted = rights?.capabilities?.includes('catalog:write') && rights.capabilities.includes('terminal:control');
  const owner = useRef(host.deviceId); owner.current = host.deviceId;
  const agents = host.catalog?.agents.filter((agent) => agent.runtime === 'codex' && (!agent.homeExecutionBackend || agent.homeExecutionBackend === 'native')) ?? [];
  const preferred = host.catalog?.projectStart?.agentId;
  const selected = agentId ?? (agents.some((agent) => agent.id === preferred) ? preferred! : agents[0]?.id ?? '');
  const checkpoint = (next: StartProgress) => {
    if (!save(next)) throw new Error('Der Browser kann den Startfortschritt nicht speichern. Gerätespeicher freigeben und erneut prüfen.');
  };
  const start = async () => {
    if (lock.current || host.status !== 'online' || !permitted || !host.catalog?.projectStart?.configured) return;
    lock.current = true; setBusy(true); setError(''); const deviceId = host.deviceId;
    let current = progress ?? { key: crypto.randomUUID(), name: name.trim() || `idee-${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 4)}`,
      agentId: selected, repositoryId: '', phase: selected ? 'project' as const : 'agent' as const };
    try {
      checkpoint(current);
      const invoke = async <T,>(path: string, payload: unknown, stage: string): Promise<T> => {
        if (owner.current !== deviceId) throw new Error('Gerätekopplung hat sich geändert.');
        const result = await host.request<T>(path, 'POST', payload, `${current.key}-${stage}`);
        if (owner.current !== deviceId) throw new Error('Gerätekopplung hat sich geändert.');
        return result;
      };
      if (current.phase === 'agent') {
        const result = await invoke<MobileAdministrationResult>('/api/v1/admin/commands', { operation: 'agent-create', input: {
          name: 'Codex', source: { kind: 'runtime', id: 'codex' } } }, 'agent');
        current = { ...current, agentId: result.created!.id, phase: 'project' }; checkpoint(current);
      }
      if (current.phase === 'project') {
        const availability = await host.request<MobileTerminalState>('/api/v1/terminal/query', 'POST', { agentId: current.agentId, repositoryId: null, options: true });
        if (!availability.launchOptions?.choices.some((choice) => choice.mode === 'codex' && choice.available)) {
          throw new Error('Codex ist auf dem PC in der nativen Umgebung noch nicht verfügbar. Installation und Anmeldung am PC prüfen, danach Start fortsetzen.');
        }
        const result = await invoke<MobileAdministrationResult>('/api/v1/admin/commands', { operation: 'project-create', input: { name: current.name } }, 'project');
        current = { ...current, repositoryId: result.created!.id, phase: 'workspace' }; checkpoint(current);
      }
      if (current.phase === 'workspace') {
        await invoke('/api/v1/admin/commands', { operation: 'workspace-prepare', input: { agentId: current.agentId, repositoryId: current.repositoryId } }, 'workspace');
        current = { ...current, phase: 'terminal' }; checkpoint(current);
      }
      if (current.phase === 'terminal') {
        const result = await invoke<{ terminalId: string }>('/api/v1/terminal/command', { operation: 'open', mode: 'agent', agentId: current.agentId, repositoryId: current.repositoryId }, 'terminal');
        current = { ...current, terminalId: result.terminalId, phase: 'done' }; checkpoint(current);
      }
      await host.refresh();
      if (owner.current !== deviceId) return;
      onStarted({ agentId: current.agentId, repositoryId: current.repositoryId, terminalId: current.terminalId });
      save(null); setName('');
    } catch (reason) { setError(reason instanceof Error && !(reason instanceof MobileClientError) ? reason.message : workspaceError(reason)); }
    finally { lock.current = false; setBusy(false); }
  };
  return <>
    {progress && !open && <p className="m-notice">Projektstart „{progress.name}“ ist noch offen. <button onClick={onOpen}>Projektstart fortsetzen</button></p>}
    {open && <Dialog title="Neues Projekt" onClose={onClose} fallbackId="mobile-title" className="m-project-start">
      <p>Ein eigener Projektordner auf deinem PC, danach direkt mit Codex arbeiten. Alle Projektdateien bleiben dort erhalten.</p>
      {!host.catalog?.projectStart?.configured && <p role="alert">Am PC zuerst Settings → Neue Projekte vom Tablet öffnen, Projekt-Stammordner wählen und Projektstart speichern.</p>}
      <form onSubmit={(event) => { event.preventDefault(); void start(); }}>
        <label>Projektname (optional)<input value={progress?.name ?? name} maxLength={80} disabled={busy || !!progress}
          placeholder="Zum Beispiel gartenplaner" onChange={(event) => setName(event.target.value)} /></label>
        <label>Codex-Profil<select value={progress?.agentId ?? selected} disabled={busy || !!progress} onChange={(event) => setAgentId(event.target.value)}>
          <option value="">Neues Codex-Standardprofil</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
        </select></label>
        <p className="m-field-note">Speicherort: dein am PC eingestellter Projekt-Stammordner. Das gespeicherte Profil bestimmt Modell und Berechtigungen.</p>
        {progress && <p role="status">{phases[progress.phase]} · {progress.name}{progress.repositoryId ? ' · Projekt ist angelegt und bleibt erhalten.' : ''}</p>}
        {error && <p role="alert" className="m-alert">{error}</p>}
        {host.status !== 'online' && <p role="status">PC nicht verbunden. Der Start bleibt gespeichert und wird erst auf deinen Klick fortgesetzt.</p>}
        {!rights && host.status === 'online' && <p role="status">Projektstart und Gerätefreigaben werden geprüft…</p>}
        {rights && !permitted && <p role="alert">Am PC für dieses Tablet Projektverwaltung und interaktive Terminals freigeben.</p>}
        <button className="m-primary" disabled={busy || host.status !== 'online' || !permitted || !host.catalog?.projectStart?.configured}>
          {busy ? 'Projektstart läuft…' : progress ? 'Start fortsetzen' : 'Mit Codex starten'}</button>
      </form>
      {progress && !busy && <button onClick={() => { save(null); setError(''); }}>Startablauf schliessen · erstellte Arbeit behalten</button>}
      <p className="m-field-note">Bei fehlender Freigabe am PC unter Verbundene Geräte die Projektverwaltung und interaktive Terminals erlauben. Dateien lesen hat eine eigene Freigabe.</p>
    </Dialog>}
  </>;
}
