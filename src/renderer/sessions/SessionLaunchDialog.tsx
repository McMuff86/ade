import { useEffect, useRef, useState } from 'react';
import type { SessionLaunchChoice, SessionLaunchOptions } from '../../shared/remote';
import { Modal } from '../onboarding/Modal';
import { useAppData } from '../stores/appdata';
import { useSessions } from '../stores/sessions';
import { useSessionLaunch } from '../stores/sessionLaunch';
import { canLaunchChoice, SessionLaunchFields } from './SessionLaunchFields';

export function SessionLaunchDialog() {
  const agentId = useSessionLaunch((s) => s.agentId);
  return agentId ? <LaunchDialog key={agentId} agentId={agentId} /> : null;
}
function LaunchDialog({ agentId }: { agentId: string }) {
  const agent = useAppData((s) => s.agents[agentId]); const repos = useAppData((s) => s.repositories);
  const [repositoryId, setRepositoryId] = useState(agent?.defaultRepositoryId ?? '');
  const [choice, setChoice] = useState<SessionLaunchChoice>({ mode: 'shell' });
  const [options, setOptions] = useState<SessionLaunchOptions>();
  const [loading, setLoading] = useState(false); const [busy, setBusy] = useState(false); const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState(''); const lock = useRef(false);
  const close = useSessionLaunch((s) => s.close);
  useEffect(() => {
    let live = true; setLoading(true); setOptions(undefined); setError('');
    void window.ade.invoke('session:options', { agentId, repositoryId: repositoryId || null }).then((result) => { if (live) setOptions(result); })
      .catch((reason) => { if (live) setError(reason instanceof Error ? reason.message : 'Startmöglichkeiten konnten nicht geprüft werden.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [agentId, repositoryId, refresh]);
  useEffect(() => { if (!agent) close(); }, [agent, close]);
  const launch = async () => {
    if (lock.current || !canLaunchChoice(choice, options)) return;
    lock.current = true; setBusy(true); setError('');
    try {
      await useSessions.getState().createSession(agentId, undefined, undefined, undefined, repositoryId || null, undefined, choice);
      close();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Sitzung konnte nicht gestartet werden.'); }
    finally { lock.current = false; setBusy(false); }
  };
  return <Modal title="Neue Terminalsitzung" subtitle={agent?.name} onClose={() => { if (!lock.current) close(); }}
    fallbackFocus={() => document.getElementById('new-session') ?? document.getElementById('mode-tab-terminals')}>
    <form onSubmit={(event) => { event.preventDefault(); void launch(); }}>
      <div className="field"><label>Projekt<select aria-label="Sitzungsprojekt" value={repositoryId} disabled={busy} onChange={(event) => setRepositoryId(event.target.value)}>
        <option value="">Ohne Projekt · Eigener Workspace</option>{repos.map((repo) => <option key={repo.id} value={repo.id}>{repo.name}</option>)}</select></label></div>
      <SessionLaunchFields choice={choice} onChange={setChoice} options={options} disabled={busy} loading={loading} />
      {error && <p role="alert">{error}</p>}
      <div className="modal-actions"><button type="button" className="btn" disabled={busy} onClick={close}>Abbrechen</button>
        <button type="button" className="btn" disabled={busy || loading} onClick={() => setRefresh((n) => n + 1)}>Startmöglichkeiten aktualisieren</button>
        <button className="btn primary" disabled={busy || !canLaunchChoice(choice, options)}>{busy ? 'Startet…' : 'Sitzung starten'}</button></div>
    </form>
  </Modal>;
}
