import { useEffect, useRef, useState } from 'react';
import type { SessionLaunchChoice, SessionLaunchOptions } from '../../shared/remote';
import { Modal } from '../onboarding/Modal';
import { useAppData } from '../stores/appdata';
import { useSessions } from '../stores/sessions';
import { useSessionLaunch } from '../stores/sessionLaunch';
import { canLaunchChoice, SessionLaunchFields } from './SessionLaunchFields';
import { useSelection } from '../stores/selection';

export function SessionLaunchDialog() {
  const agentId = useSessionLaunch((s) => s.agentId);
  const terminalHome = useSessionLaunch((s) => s.terminalHome);
  return agentId || terminalHome ? <LaunchDialog key={agentId ?? 'home'} agentId={agentId} /> : null;
}
function LaunchDialog({ agentId }: { agentId: string | null }) {
  const agent = useAppData((s) => agentId ? s.agents[agentId] : undefined); const repos = useAppData((s) => s.repositories);
  const [repositoryId, setRepositoryId] = useState(agent?.defaultRepositoryId ?? '');
  const [choice, setChoice] = useState<SessionLaunchChoice>({ mode: 'shell' });
  const [options, setOptions] = useState<SessionLaunchOptions>();
  const [loading, setLoading] = useState(false); const [busy, setBusy] = useState(false); const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState(''); const lock = useRef(false);
  const close = useSessionLaunch((s) => s.close);
  useEffect(() => {
    let live = true; setLoading(true); setOptions(undefined); setError('');
    void window.ade.invoke('session:options', agentId ? { agentId, repositoryId: repositoryId || null } : { terminalHome: true }).then((result) => { if (live) setOptions(result); })
      .catch((reason) => { if (live) setError(reason instanceof Error ? reason.message : 'Startmöglichkeiten konnten nicht geprüft werden.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [agentId, repositoryId, refresh]);
  useEffect(() => { if (agentId && !agent) close(); }, [agentId, agent, close]);
  const launch = async () => {
    if (lock.current || !canLaunchChoice(choice, options)) return;
    lock.current = true; setBusy(true); setError('');
    try {
      if (agentId) await useSessions.getState().createSession(agentId, undefined, undefined, undefined, repositoryId || null, undefined, choice);
      else { await useSessions.getState().createHomeSession(choice); useSelection.getState().setSelectedAgent(null); }
      close();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Sitzung konnte nicht gestartet werden.'); }
    finally { lock.current = false; setBusy(false); }
  };
  return <Modal title="Neue Terminalsitzung" subtitle={agent?.name ?? 'Ohne Agent und Projekt · Benutzerverzeichnis des ADE-Rechners'} onClose={() => { if (!lock.current) close(); }}
    fallbackFocus={() => document.getElementById('new-session') ?? document.getElementById('mode-tab-terminals')}>
    <form onSubmit={(event) => { event.preventDefault(); void launch(); }}>
      {agentId && <div className="field"><label>Projekt<select aria-label="Sitzungsprojekt" value={repositoryId} disabled={busy} onChange={(event) => setRepositoryId(event.target.value)}>
        <option value="">Ohne Projekt · Eigener Workspace</option>{repos.map((repo) => <option key={repo.id} value={repo.id}>{repo.name}</option>)}</select></label></div>}
      <SessionLaunchFields choice={choice} onChange={setChoice} options={options} disabled={busy} loading={loading} />
      {error && <p role="alert">{error}</p>}
      <div className="modal-actions"><button type="button" className="btn" disabled={busy} onClick={close}>Abbrechen</button>
        <button type="button" className="btn" disabled={busy || loading} onClick={() => setRefresh((n) => n + 1)}>Startmöglichkeiten aktualisieren</button>
        <button className="btn primary" disabled={busy || !canLaunchChoice(choice, options)}>{busy ? 'Startet…' : 'Sitzung starten'}</button></div>
    </form>
  </Modal>;
}
