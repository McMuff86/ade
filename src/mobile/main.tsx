import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import { createRoot } from 'react-dom/client';
import type { MobileCatalog, MobileCommandResult, MobileHealth, MobileRunSummary, MobileSnapshot } from '../shared/remote';
import { MobileClient, MobileClientError } from './client';
import './mobile.css';

const client = new MobileClient();
const finalStates = new Set(['completed', 'failed', 'cancelled']);
interface PendingCommand { path: string; payload?: unknown; key: string }
const messages: Record<string, string> = {
  pairing_expired: 'Dieser Code ist abgelaufen oder wurde bereits verwendet. In ADE am PC einen neuen Code erstellen.',
  unknown_device: 'Der Gerätezugriff wurde widerrufen oder ist nicht mehr verfügbar. Am PC erneut koppeln.',
  storage_unavailable: 'Der Browser kann den Geräteschlüssel nicht speichern. Privaten Modus verlassen und Gerätespeicher erlauben.',
  rate_limited: 'Zu viele Verbindungsversuche. Bitte eine Minute warten.',
  stale_timestamp: 'Die Gerätezeit weicht ab. Automatische Uhrzeit auf diesem Gerät aktivieren.',
  command_rejected: 'ADE hat den Auftrag abgewiesen. Agent, Repository und Run-Status am PC prüfen.',
  invalid_payload: 'Bitte Eingaben prüfen. ADE konnte diesen Auftrag nicht annehmen.',
};
function errorText(error: unknown): string {
  return error instanceof MobileClientError ? messages[error.code] ?? 'Die Verbindung konnte nicht bestätigt werden. Erneut verbinden.'
    : 'ADE ist gerade nicht erreichbar. Tailscale, Netzwerk und den eingeschalteten PC prüfen.';
}

function MobileApp(): JSX.Element {
  const [paired, setPaired] = useState<boolean | null>(null);
  const [challenge, setChallenge] = useState(() => {
    const code = new URLSearchParams(location.hash.slice(1)).get('pair') ?? '';
    // Remove the one-use material from browser history before any asynchronous work.
    if (location.hash) history.replaceState(null, '', '/');
    return code;
  });
  const [deviceName, setDeviceName] = useState('Mein Mobilgerät');
  const [status, setStatus] = useState<'connecting' | 'online' | 'offline'>('connecting');
  const [catalog, setCatalog] = useState<MobileCatalog | null>(null);
  const [health, setHealth] = useState<MobileHealth | null>(null);
  const [runs, setRuns] = useState<MobileRunSummary[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [repositoryId, setRepositoryId] = useState('');
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [mode, setMode] = useState<'task' | 'run'>('task');
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [minutes, setMinutes] = useState(30);
  const [cost, setCost] = useState('');
  const [lastSeen, setLastSeen] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingCommand | null>(null);
  const pendingRef = useRef<PendingCommand | null>(null);
  const commandBusy = useRef(false);
  const cursor = useRef<number | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const detail = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(true);
  const identityEpoch = useRef(0);
  const focusResult = useRef(false);

  useLayoutEffect(() => {
    if (focusResult.current && !busy) { focusResult.current = false; detail.current?.focus(); }
  }, [busy, runs]);

  useEffect(() => {
    mounted.current = true;
    const consumePairLink = (): void => {
      const code = new URLSearchParams(location.hash.slice(1)).get('pair');
      if (code) { setChallenge(code); history.replaceState(null, '', '/'); }
    };
    window.addEventListener('hashchange', consumePairLink);
    void client.restore().then(setPaired).catch((reason) => { setPaired(false); setError(errorText(reason)); });
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => {
      setNotice('Offline-Appstart ist in diesem Browser nicht verfügbar. Online-Zugriff bleibt möglich.');
    });
    return () => { mounted.current = false; window.removeEventListener('hashchange', consumePairLink); };
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    const epoch = identityEpoch.current;
    const [nextHealth, nextCatalog, nextRuns] = await Promise.all([
      client.request<MobileHealth>('/api/v1/health'), client.request<MobileCatalog>('/api/v1/catalog'),
      client.request<MobileRunSummary[]>('/api/v1/runs'),
    ]);
    if (!mounted.current || epoch !== identityEpoch.current) return;
    setHealth(nextHealth); setCatalog(nextCatalog); setRuns(nextRuns); setLastSeen(Date.now());
    setRepositoryId((current) => nextCatalog.repositories.some((repo) => repo.id === current) ? current : nextCatalog.repositories[0]?.id ?? '');
    setAgentIds((current) => current.filter((id) => nextCatalog.agents.some((agent) => agent.id === id)));
  }, []);

  useEffect(() => {
    if (!paired) return;
    let disposed = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    let refreshing = false;
    const lostAccess = async (reason: unknown): Promise<boolean> => {
      if (reason instanceof MobileClientError && reason.code === 'unknown_device') {
        identityEpoch.current++; pendingRef.current = null; setPending(null); setPrompt(''); setName(''); setSelected(null);
        await client.forget(); setPaired(false); setRuns([]); setCatalog(null); setHealth(null);
        setError(errorText(reason)); return true;
      }
      return false;
    };
    const update = (): void => {
      if (refreshTimer || refreshing) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = undefined; refreshing = true;
        void refresh().catch((reason) => { setStatus('offline'); void lostAccess(reason); }).finally(() => { refreshing = false; });
      }, 150);
    };
    const connect = async (): Promise<void> => {
      if (disposed || document.hidden) return;
      controller?.abort(); controller = new AbortController();
      const ownController = controller;
      setStatus('connecting');
      try {
        await refresh();
        if (disposed || ownController.signal.aborted) return;
        setStatus('online'); attempt = 0;
        await client.stream(cursor.current, ownController.signal, (event, id, data) => {
          if (disposed || ownController.signal.aborted) return;
          cursor.current = id; setStatus('online'); setLastSeen(Date.now());
          if (event === 'snapshot') setRuns((data as MobileSnapshot).runs);
          else update();
        });
      } catch (reason) {
        if (disposed || ownController.signal.aborted) return;
        if (await lostAccess(reason)) return;
        if (reason instanceof MobileClientError && reason.code === 'stale_timestamp') setError(errorText(reason));
      }
      if (!disposed && !ownController.signal.aborted) {
        setStatus('offline');
        timer = setTimeout(() => { void connect(); }, Math.min(30_000, 1500 * 2 ** attempt++) + Math.random() * 500);
      }
    };
    const resume = (): void => {
      if (timer) clearTimeout(timer);
      controller?.abort();
      if (!document.hidden && navigator.onLine) void connect();
      else setStatus('offline');
    };
    window.addEventListener('online', resume); window.addEventListener('offline', resume);
    document.addEventListener('visibilitychange', resume);
    void connect();
    return () => {
      disposed = true; controller?.abort(); clearTimeout(timer); clearTimeout(refreshTimer);
      window.removeEventListener('online', resume); window.removeEventListener('offline', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [paired, generation, refresh]);

  useEffect(() => { if (selected) detail.current?.focus(); }, [selected]);

  const send = async (command: PendingCommand): Promise<void> => {
    if (commandBusy.current || status !== 'online') return;
    commandBusy.current = true; setBusy(true); setError(''); setNotice('');
    const epoch = identityEpoch.current;
    pendingRef.current = command; setPending(command);
    try {
      const result = await client.request<MobileCommandResult>(command.path, 'POST', command.payload, command.key);
      if (epoch !== identityEpoch.current) return;
      pendingRef.current = null; setPending(null);
      setRuns((current) => [result.run, ...current.filter((run) => run.id !== result.run.id)]);
      setSelected(result.run.id); focusResult.current = true;
      if (command.path === '/api/v1/tasks' || command.path === '/api/v1/runs') { setPrompt(''); setName(''); }
      setNotice(result.replayed ? 'Bereits bestätigter Auftrag wiederhergestellt.' : 'ADE hat den Auftrag bestätigt.');
      void refresh().catch(() => undefined);
    } catch (reason) {
      if (epoch !== identityEpoch.current) return;
      if (reason instanceof MobileClientError && [400, 403, 404, 409, 415, 422].includes(reason.status)) {
        pendingRef.current = null; setPending(null);
      }
      setError(errorText(reason));
    } finally { commandBusy.current = false; setBusy(false); }
  };

  const selectedRun = runs.find((run) => run.id === selected);
  const canSubmit = status === 'online' && health?.commands === 'enabled' && !busy && !pending;
  const recentRuns = [...runs].sort((a, b) => b.updatedAt - a.updatedAt);

  return <div className="mobile-app">
    <header className="mobile-header"><a className="brand" href="/" aria-label="ADE Mobile Startseite">ade<span>mobile</span></a>
      <span className={`connection ${status}`} role="status">{paired ? status === 'online' ? 'Verbunden' : status === 'connecting' ? 'Verbinde…' : 'Offline' : 'Privater Zugriff'}</span></header>
    <main>
      <h1 ref={heading} tabIndex={-1}>{paired ? 'Dein Workspace. Überall.' : 'Mit deinem PC verbinden'}</h1>
      <p className="intro">{paired ? 'Aufgaben starten und den Fortschritt deiner Agents verfolgen.' : 'Tailscale auf diesem Gerät verbinden. In ADE am PC unter Einstellungen → Mobiler Zugriff einen Pairing-Code erstellen.'}</p>
      {error && <p className="alert" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      {paired === null ? <p role="status">Geräteverbindung wird geladen…</p> : !paired ? <section className="card pair-card">
        <h2>Gerät koppeln</h2><p>QR-Code am PC scannen oder den einmaligen Code hier einfügen. Er gilt fünf Minuten.</p>
        <form onSubmit={(event) => {
          event.preventDefault(); if (busy) return; setBusy(true); setError('');
          void client.pair(challenge.trim(), deviceName.trim()).then(() => { setChallenge(''); setPaired(true); heading.current?.focus(); })
            .catch((reason) => setError(errorText(reason))).finally(() => setBusy(false));
        }}>
          <label>Gerätename<input value={deviceName} maxLength={80} autoComplete="off" required onChange={(event) => setDeviceName(event.target.value)} /></label>
          <label>Pairing-Code<input value={challenge} onChange={(event) => setChallenge(event.target.value)} maxLength={43} autoComplete="off" autoCapitalize="none" spellCheck={false} required /></label>
          <button className="primary" disabled={busy || !deviceName.trim() || !/^[A-Za-z0-9_-]{43}$/.test(challenge.trim())}>{busy ? 'Wird gekoppelt…' : 'Dieses Gerät verbinden'}</button>
        </form>
      </section> : <>
        <div className="connection-tools"><p>{lastSeen ? `Zuletzt bestätigt: ${new Date(lastSeen).toLocaleTimeString()}` : 'Warte auf den PC…'}</p>
          <button onClick={() => { setError(''); setGeneration((value) => value + 1); }}>Erneut verbinden</button></div>
        {status !== 'online' && <p className="notice">PC eingeschaltet und ADE geöffnet lassen. Tailscale muss auf beiden Geräten verbunden sein. Angezeigte Daten können veraltet sein; Aufträge sind bis zur Verbindung gesperrt.</p>}
        {pending && !busy && <section className="card" aria-label="Unbestätigter Auftrag"><h2>Antwort noch unklar</h2><p>Der Auftrag könnte bereits angenommen worden sein. Ein erneuter Versuch verwendet dieselbe Vorgangs-ID.</p>
          <button disabled={busy || status !== 'online'} onClick={() => { if (pendingRef.current) void send(pendingRef.current); }}>Diesen Auftrag erneut prüfen</button>
          <button disabled={busy} onClick={() => { pendingRef.current = null; setPending(null); setNotice('Prüfe die Run-Liste, bevor du einen neuen Auftrag mit demselben Inhalt sendest.'); }}>Run-Liste selbst prüfen</button>
        </section>}
        <div className="workspace-grid"><section className="card composer"><h2>Neue Arbeit</h2>
          {!catalog ? <p role="status">Projekte und Agents werden geladen…</p> : !catalog.repositories.length || !catalog.agents.length
            ? <p>Am PC zuerst ein Repository und einen Agent in ADE einrichten.</p>
            : <form onSubmit={(event) => {
              event.preventDefault(); if (!canSubmit) return;
              const payload = mode === 'task' ? { agentId: agentIds[0], repositoryId, prompt, ...(name.trim() ? { name: name.trim() } : {}) }
                : { name: name.trim(), goal: prompt, repositoryId,
                  participants: agentIds.map((agentId, index) => ({ agentId, role: index === 0 ? 'orchestrator' : index === 1 ? 'lead' : 'worker',
                    ...(index > 0 ? { teamId: 'mobile-team', teamName: 'Mobile Team' } : {}) })),
                  budget: { maxConcurrentTasks: Math.min(2, agentIds.length), maxTaskMinutes: minutes, maxCostUsd: cost ? Number(cost) : null } };
              void send({ path: mode === 'task' ? '/api/v1/tasks' : '/api/v1/runs', payload, key: crypto.randomUUID() });
            }}>
              <fieldset disabled={busy || !!pending}><legend>Auftragsart</legend><div className="mode-picker">
                <label><input type="radio" name="mode" checked={mode === 'task'} onChange={() => { setMode('task'); setAgentIds((ids) => ids.slice(0, 1)); }} />Einzelaufgabe</label>
                <label><input type="radio" name="mode" checked={mode === 'run'} onChange={() => setMode('run')} />Managed Run</label>
              </div>
              <label>Repository<select aria-label="Repository" value={repositoryId} onChange={(event) => setRepositoryId(event.target.value)} required>
                {catalog.repositories.map((repo) => <option key={repo.id} value={repo.id}>{repo.name}{repo.verified ? '' : ' · ungeprüft'}</option>)}
              </select></label>
              {mode === 'task' ? <label>Agent<select aria-label="Agent" value={agentIds[0] ?? ''} onChange={(event) => setAgentIds([event.target.value])} required>
                <option value="" disabled>Agent wählen</option>{catalog.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.runtime}</option>)}
              </select></label> : <fieldset><legend>Agents · erster gewählter Agent koordiniert</legend>{catalog.agents.map((agent) => <label className="check" key={agent.id}>
                <input type="checkbox" checked={agentIds.includes(agent.id)} onChange={(event) => setAgentIds((ids) => event.target.checked ? [...ids, agent.id] : ids.filter((id) => id !== agent.id))} />
                {agent.name}{agentIds[0] === agent.id ? ' · Koordination' : ''}</label>)}</fieldset>}
              <label>{mode === 'run' ? 'Run-Name' : 'Name (optional)'}<input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required={mode === 'run'} /></label>
              <label>{mode === 'run' ? 'Ziel' : 'Aufgabe'}<textarea aria-label={mode === 'run' ? 'Ziel' : 'Aufgabe'} value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={5} maxLength={mode === 'run' ? 1000 : 8000} required placeholder="Was soll ADE für dich erledigen?" /></label>
              {mode === 'run' && <div className="budget-fields"><label>Minuten pro Aufgabe<input type="number" min={1} max={1440} required value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} /></label>
                <label>Kostenlimit USD (optional)<input type="number" min="0.01" step="0.01" value={cost} onChange={(event) => setCost(event.target.value)} /></label></div>}
              {mode === 'run' && agentIds.length < 2 && <p>Mindestens zwei Agents wählen: Koordination und Umsetzung.</p>}
              <button className="primary" disabled={!canSubmit || !prompt.trim() || (mode === 'run' ? agentIds.length < 2 : !agentIds.length)}>{busy ? 'Wird bestätigt…' : mode === 'task' ? 'Aufgabe starten' : 'Run vorbereiten'}</button>
              </fieldset>
            </form>}
        </section><section className="card runs"><h2>Deine Runs <span className="count">{runs.length}</span></h2>
          {!recentRuns.length && <p>Noch keine Runs. Starte eine Aufgabe oder bereite einen Managed Run vor.</p>}
          <ul className="run-list">{recentRuns.map((run) => <li key={run.id}><button aria-pressed={selected === run.id} onClick={() => setSelected(run.id)}>
            <span><strong>{run.name}</strong><small>{run.repositoryName ?? 'Repository'} · {run.tasks.length} Aufgaben</small></span><span className="pill">{run.status}</span>
          </button></li>)}</ul>
        </section></div>
        {selectedRun && <section className="card run-detail" aria-labelledby="run-detail-title"><h2 id="run-detail-title" ref={detail} tabIndex={-1}>{selectedRun.name}</h2>
          <p>{selectedRun.status} · {selectedRun.phase} · {selectedRun.mode}</p>
          <div className="stats"><span>{selectedRun.tasks.filter((task) => task.status === 'completed').length}/{selectedRun.tasks.length} Aufgaben abgeschlossen</span>
            <span>{selectedRun.pendingApprovalId ? 'Freigabe am PC erforderlich' : 'Keine offene Freigabe'}</span></div>
          <ul className="task-list">{selectedRun.tasks.map((task) => <li key={task.id}><strong>{task.title}</strong><span>{task.phase} · {task.status}</span></li>)}</ul>
          {!selectedRun.tasks.length && <p>Dieser Run hat noch keine Aufgaben.</p>}
          <div className="actions">{selectedRun.status === 'draft' && <button className="primary" disabled={!canSubmit}
            onClick={() => void send({ path: `/api/v1/runs/${selectedRun.id}/start`, key: crypto.randomUUID() })}>Run starten</button>}
            {!finalStates.has(selectedRun.status) && <button disabled={!canSubmit} onClick={() => {
              if (window.confirm('Diesen Run abbrechen? Bereits erstellte Arbeit bleibt in ADE erhalten.')) void send({ path: `/api/v1/runs/${selectedRun.id}/cancel`, key: crypto.randomUUID() });
            }}>Run abbrechen</button>}
          </div><p className="muted">Detaillierte Ergebnisse und Freigaben im ADE-Desktop öffnen.</p>
        </section>}
        <footer><p>Privat über Tailscale · Ausführung auf deinem PC</p><button disabled={busy} onClick={() => {
          identityEpoch.current++; pendingRef.current = null; setPending(null);
          setBusy(true); setPaired(false); setRuns([]); setCatalog(null); setHealth(null); setSelected(null); setPrompt('');
          void client.disconnect().catch(() => undefined).finally(() => { setBusy(false); heading.current?.focus(); });
        }}>Dieses Gerät lokal trennen</button><p>Zum vollständigen Widerruf: Gerät in ADE am PC entfernen.</p></footer>
      </>}
    </main><aside className="install-hint">Als App nutzen: Im Browser „Zum Home-Bildschirm“ oder „App installieren“ wählen.</aside>
  </div>;
}

createRoot(document.getElementById('root')!).render(<MobileApp />);
