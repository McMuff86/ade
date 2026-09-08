import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import type { MobileTerminalCommand, MobileTerminalInput, MobileTerminalState, SessionLaunchChoice, SessionLaunchOptions } from '../shared/remote';
import { canLaunchChoice, SessionLaunchFields } from '../renderer/sessions/SessionLaunchFields';
import type { MobileHost } from './useMobileHost';
import { MobileClientError } from './client';
import { workspaceError } from './AgentWorkspace';
import { Dialog } from './ui';

export function RemoteTerminalPane({ host, agentId, repositoryId, active }: {
  host: MobileHost; agentId: string; repositoryId: string | null; active: boolean;
}): JSX.Element {
  const [state, setState] = useState<MobileTerminalState>({ terminals: [] });
  const [selected, setSelected] = useState(''); const [text, setText] = useState('');
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ command: MobileTerminalCommand; key: string } | null>(null);
  const [uncertain, setUncertain] = useState<MobileTerminalInput | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [choice, setChoice] = useState<SessionLaunchChoice>({ mode: 'shell' });
  const [options, setOptions] = useState<SessionLaunchOptions>();
  const [loadingOptions, setLoadingOptions] = useState(false); const [optionsRefresh, setOptionsRefresh] = useState(0);
  const lock = useRef(false); const live = useRef(true); const queryVersion = useRef(0);
  const stateRef = useRef(state); stateRef.current = state;
  const input = useRef<HTMLTextAreaElement>(null);
  const query = useCallback(async (id = selected) => {
    const own = ++queryVersion.current;
    const result = await host.request<MobileTerminalState>('/api/v1/terminal/query', 'POST', { agentId, repositoryId, ...(id ? { terminalId: id } : {}) });
    if (live.current && own === queryVersion.current) { setState(result); stateRef.current = result; }
    return result;
  }, [host.request, agentId, repositoryId, selected]);
  useEffect(() => { live.current = true; return () => { live.current = false; queryVersion.current++; }; }, []);
  useEffect(() => {
    if (!active || host.status !== 'online') return;
    let stopped = false; setLoadingOptions(true); setOptions(undefined);
    void host.request<MobileTerminalState>('/api/v1/terminal/query', 'POST', { agentId, repositoryId, options: true })
      .then((result) => { if (!stopped) setOptions(result.launchOptions); })
      .catch((reason) => { if (!stopped) setError(terminalError(reason)); })
      .finally(() => { if (!stopped) setLoadingOptions(false); });
    return () => { stopped = true; };
  }, [active, host.status, host.request, agentId, repositoryId, optionsRefresh]);
  useEffect(() => {
    if (!active || host.status !== 'online') return;
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try { await query(); setError((current) => current.startsWith('Terminalzugriff fehlt.') ? '' : current); }
      catch (reason) { if (!stopped && live.current) { setState({ terminals: [] }); setError(terminalError(reason)); } }
      if (!stopped) timer = setTimeout(() => { if (!document.hidden) void refresh(); else timer = setTimeout(() => void refresh(), 1000); }, 1000);
    };
    void refresh(); return () => { stopped = true; clearTimeout(timer); queryVersion.current++; };
  }, [active, host.status, query, repositoryId]);
  const command = async (operation: MobileTerminalCommand, retry = false) => {
    if (lock.current || host.status !== 'online') return;
    const request = retry && pending ? pending : { command: operation, key: crypto.randomUUID() };
    lock.current = true; setBusy(true); setError(''); setNotice(''); setPending(request);
    try {
      const result = await host.request<{ terminalId: string }>('/api/v1/terminal/command', 'POST', request.command, request.key);
      if (!live.current) return;
      setPending(null); setUncertain(null); setSelected(request.command.operation === 'close' ? '' : result.terminalId);
      await query(request.command.operation === 'close' ? '' : result.terminalId);
      setNotice(request.command.operation === 'release' ? 'Eingabe freigegeben.' : request.command.operation === 'close' ? 'Sitzung beendet.' : 'Terminal ist verbunden.');
      if (request.command.operation === 'claim' || request.command.operation === 'open') input.current?.focus();
    } catch (reason) {
      if (!live.current) return;
      if (reason instanceof MobileClientError && [400, 403, 404, 409, 422].includes(reason.status)) setPending(null);
      setError(terminalError(reason));
    } finally { lock.current = false; if (live.current) setBusy(false); }
  };
  const transmit = async (data: string, clearText = false) => {
    const current = stateRef.current;
    if (lock.current || pending || uncertain || current.inputUncertain || !current.leaseId || !current.selected || current.selected.owner !== 'self' || host.status !== 'online') return;
    if (new TextEncoder().encode(data).length > 2048) { setError('Eingabe auf höchstens 2048 Bytes kürzen.'); return; }
    const request: MobileTerminalInput = { agentId, repositoryId, terminalId: current.selected.id, leaseId: current.leaseId,
      sequence: (current.lastSequence ?? 0) + 1, data, cols: 100, rows: 30 };
    lock.current = true; setBusy(true); setError('');
    try {
      const result = await host.request<{ sequence: number }>('/api/v1/terminal/input', 'POST', request, crypto.randomUUID());
      if (!live.current) return;
      stateRef.current = { ...stateRef.current, lastSequence: result.sequence };
      if (clearText) setText(''); await query(current.selected.id);
    } catch (reason) { if (live.current) { setUncertain(request); setError(terminalError(reason)); } }
    finally { lock.current = false; if (live.current) setBusy(false); }
  };
  const pulse = useRef(transmit); pulse.current = transmit;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => { if (!document.hidden) void pulse.current(''); }, 10_000);
    return () => clearInterval(timer);
  }, [active]);
  const blocked = busy || !!pending || !!uncertain || !!state.inputUncertain || host.status !== 'online';
  const owning = state.selected?.owner === 'self';
  const action = (operation: 'claim' | 'release' | 'close') => command({ operation, agentId, repositoryId, terminalId: selected });
  return <section className="m-remote-terminal" aria-label="Interaktives Terminal">
    <p>Die Sitzung läuft auf deinem PC weiter. Wähle eine bestehende Sitzung oder starte eine neue im ausgewählten Workspace.</p>
    <div className="m-management-actions"><button disabled={blocked} onClick={() => void command({ operation: 'open', mode: 'shell', agentId, repositoryId })}>Shell öffnen</button>
      <button disabled={blocked} onClick={() => void command({ operation: 'open', mode: 'agent', agentId, repositoryId })}>Agent starten</button></div>
    <SessionLaunchFields choice={choice} onChange={setChoice} options={options} disabled={blocked} loading={loadingOptions} />
    <div className="m-management-actions"><button disabled={blocked || !canLaunchChoice(choice, options)}
      onClick={() => void command({ operation: 'open', agentId, repositoryId, ...choice })}>Sitzung starten</button>
      <button disabled={blocked || loadingOptions} onClick={() => setOptionsRefresh((n) => n + 1)}>Startmöglichkeiten aktualisieren</button></div>
    <label>Sitzung<select aria-label="Terminal-Sitzung" disabled={blocked} value={selected} onChange={(event) => { setSelected(event.target.value); setError(''); setState({ terminals: state.terminals }); }}>
      <option value="">Sitzung wählen</option>{state.terminals.map((terminal) => <option key={terminal.id} value={terminal.id}>{terminal.title} · {terminal.status === 'running' ? 'läuft' : 'beendet'}</option>)}</select></label>
    {!state.terminals.length && !error && <p>Keine verfügbaren interaktiven Sitzungen. Verwaltete Aufgaben erscheinen in Work.</p>}
    {error && <p role="alert" className="m-alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {pending && <button disabled={busy || host.status !== 'online'} onClick={() => void command(pending.command, true)}>Terminalaktion erneut prüfen</button>}
    {uncertain && <div className="m-notice"><p>Die letzte Eingabe ist nicht bestätigt. Sie wird nicht automatisch wiederholt.</p>
      <button disabled={busy || host.status !== 'online'} onClick={() => { void query().then((result) => {
        if (result.leaseId === uncertain.leaseId && !result.inputUncertain && (result.lastSequence ?? 0) >= uncertain.sequence) { setUncertain(null); setText(''); setNotice('Eingabe wurde vom PC angenommen.'); }
        else setNotice('Eingabe bleibt unbestätigt. Anzeige prüfen und die Steuerung freigeben, bevor du fortfährst.');
      }).catch((reason) => setError(terminalError(reason))); }}>Eingabestatus prüfen</button></div>}
    {state.selected && <><p role="status">{owning ? 'Du steuerst die Eingabe.' : state.selected.owner === 'other' ? 'Ein anderes Gerät steuert die Eingabe.' : 'Der Desktop steuert die Eingabe.'}</p>
      {state.inputUncertain && <p role="alert">Eine Eingabe konnte nicht sicher an den Prozess übergeben werden. Ausgabe prüfen und die Eingabe freigeben; sie wird nicht wiederholt.</p>}
      <div className="m-management-actions"><button disabled={blocked || owning || state.selected.owner === 'other' || state.selected.status !== 'running'} onClick={() => void action('claim')}>Eingabe übernehmen</button>
        <button disabled={busy || !!pending || !owning || host.status !== 'online'} onClick={() => void action('release')}>Eingabe freigeben</button>
        <button className="m-danger" disabled={blocked || !owning} onClick={() => setConfirmClose(true)}>Sitzung beenden</button></div>
      <pre tabIndex={0} className="m-terminal-screen" aria-label="Terminalanzeige">{state.screen || 'Warte auf Terminalausgabe…'}</pre>
      <form onSubmit={(event) => { event.preventDefault(); void transmit(`${text.replace(/\r?\n/g, '\r')}\r`, true); }}>
        <label>Terminal-Eingabe<textarea ref={input} aria-label="Terminal-Eingabe" value={text} maxLength={2000} disabled={!owning || host.status !== 'online'}
          onChange={(event) => setText(event.target.value)} rows={3} spellCheck={false} autoCapitalize="off" autoCorrect="off" /></label>
        <button disabled={blocked || !owning || !text}>Text und Enter senden</button></form>
      <div className="m-management-actions">{[['Enter', '\r'], ['Tab', '\t'], ['Esc', '\x1b'], ['Ctrl+C', '\x03'], ['↑', '\x1b[A'], ['↓', '\x1b[B'], ['←', '\x1b[D'], ['→', '\x1b[C']].map(([label, data]) =>
        <button key={label} aria-label={`Terminaltaste ${label}`} disabled={blocked || !owning} onClick={() => void transmit(data!)}>{label}</button>)}</div>
    </>}
    <p className="m-field-note">Ausgabe als Text; bekannte Zugangsdaten und Host-Pfade werden ausgeblendet. Ohne Lebenszeichen geht die Eingabe nach 30 Sekunden an den Desktop zurück.</p>
    {confirmClose && <Dialog title="Terminalsitzung beenden" onClose={() => setConfirmClose(false)} fallbackId="workspace-refresh">
      <p>Der laufende Prozess dieser Sitzung wird beendet.</p><button onClick={() => setConfirmClose(false)}>Abbrechen</button>
      <button className="m-danger" onClick={() => { setConfirmClose(false); void action('close'); }}>Beenden bestätigen</button></Dialog>}
  </section>;
}
function terminalError(error: unknown): string {
  return error instanceof MobileClientError && error.code === 'scope_not_granted'
    ? 'Terminalzugriff fehlt. In ADE am PC unter Settings → Verbundene Geräte „Interaktive Terminals steuern“ für dieses Gerät freigeben.' : workspaceError(error);
}
