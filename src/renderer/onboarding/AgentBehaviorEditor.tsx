import { useEffect, useRef, useState } from 'react';
import type { AgentBehaviorUpdate, AgentBehaviorView } from '../../shared/agentBehavior';
import { validateAgentBehaviorProfile, MAX_PROFILE_INSTRUCTIONS_CHARS, type AgentBehaviorProfile } from '../../shared/agentProfile';
import './agentBehavior.css';

export interface AgentBehaviorPort {
  load(): Promise<AgentBehaviorView>;
  save(input: AgentBehaviorUpdate, key: string): Promise<unknown>;
}
export function AgentBehaviorEditor({ agentId, port, enabled = true, canEdit = true }: {
  agentId: string; port: AgentBehaviorPort; enabled?: boolean; canEdit?: boolean;
}) {
  const [view, setView] = useState<AgentBehaviorView>();
  const [draft, setDraft] = useState<AgentBehaviorProfile>();
  const [pending, setPending] = useState<{ input: AgentBehaviorUpdate; key: string }>();
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const live = useRef(true); const lock = useRef(false); const currentPort = useRef(port); currentPort.current = port;
  const run = async (operation: () => Promise<void>) => {
    if (lock.current || !enabled) return; lock.current = true; setBusy(true); setError(''); setNotice('');
    try { await operation(); } catch (reason) { if (live.current) setError(reason instanceof Error ? reason.message : 'Profilanweisungen konnten nicht geladen oder gespeichert werden.'); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  };
  const reload = async () => { const result = await currentPort.current.load(); if (live.current) { setView(result); setDraft(result.profile); setPending(undefined); } };
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, [agentId]);
  // Mobile may mount while its host is reconnecting. Load on the first online
  // transition, but never overwrite an existing draft after a later reconnect.
  useEffect(() => { if (enabled && !view) void run(reload); }, [agentId, enabled]);
  const disabled = !enabled || !canEdit || !!view?.redacted || busy || !!pending;
  const dirty = !!draft && !!view && JSON.stringify(draft) !== JSON.stringify(view.profile);
  const pick = async (files: FileList | null) => {
    if (!files || !draft) return;
    await run(async () => {
      const documents = [...draft.documents];
      for (const file of Array.from(files)) {
        if (file.size > 32_000) throw new Error('Eine Markdown-Datei darf höchstens 32.000 UTF-8-Bytes enthalten.');
        const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
        documents.push({ id: crypto.randomUUID(), name: file.name, text });
      }
      const value = validateAgentBehaviorProfile({ ...draft, documents }); if (live.current) setDraft(value);
    });
  };
  const save = () => void run(async () => {
    if (!draft || !view || view.redacted || !canEdit) return;
    const request = pending ?? { input: { agentId, revision: view.revision, profile: validateAgentBehaviorProfile(draft) }, key: crypto.randomUUID() };
    setPending(request);
    try { await currentPort.current.save(request.input, request.key); await reload(); if (live.current) setNotice('Profilanweisungen gespeichert. Neue Sitzungen verwenden diesen Stand.'); }
    catch (reason) {
      if ([400, 403, 404, 409, 422].includes((reason as { status?: number })?.status ?? 0)) setPending(undefined);
      throw reason;
    }
  });
  return <section className="agent-behavior-editor" aria-label="Agent-Verhalten">
    <h3>Arbeitsweise und Anweisungen</h3>
    <p>Diese Anweisungen spezialisieren neue Sitzungen mit Agent-Profil. Repository-Anweisungen bleiben wirksam. Bereits laufende Sitzungen behalten ihren Startstand.</p>
    <p>Interaktive Profilanweisungen unterstützen derzeit native Windows-Starts mit Codex, Claude oder Ollama-Coding über Codex. Andere Laufzeiten und eigene Startbefehle können ein gespeichertes Verhalten noch nicht übernehmen.</p>
    {!enabled && <p role="status">PC nicht verbunden.</p>}
    {!canEdit && <p>Die Gerätefreigabe zum Bearbeiten von Agent-Profilen fehlt.</p>}
    {view?.redacted && <p role="status">Dieses Profil enthält ausgeblendete Inhalte. Zum Bearbeiten am PC öffnen.</p>}
    {draft && <>
      <label>Arbeitsanweisungen<textarea aria-label="Profil-Arbeitsanweisungen" rows={7} maxLength={MAX_PROFILE_INSTRUCTIONS_CHARS} disabled={disabled}
        value={draft.instructions} onChange={event => setDraft({ ...draft, instructions: event.target.value })} /></label>
      <label>Markdown-Dokumente zuweisen<input type="file" accept=".md,text/markdown" multiple disabled={disabled}
        onChange={event => { void pick(event.target.files); event.target.value = ''; }} /></label>
      <p>Bis zu acht Dokumente, je 8.000 Zeichen; insgesamt 24.000 Zeichen. ADE speichert eine Kopie. Änderungen an der ursprünglichen Datei werden erst durch erneutes Zuweisen übernommen.</p>
      {!draft.documents.length && <p>Noch keine Markdown-Dokumente zugewiesen.</p>}
      <ol>{draft.documents.map((document, index) => <li key={document.id}>
        <span>{document.name} · {document.text.length} Zeichen</span>
        <button type="button" disabled={disabled || index === 0} aria-label={`${document.name} nach oben`} onClick={() => {
          const documents = [...draft.documents]; [documents[index - 1], documents[index]] = [documents[index]!, documents[index - 1]!]; setDraft({ ...draft, documents });
        }}>Nach oben</button>
        <button type="button" disabled={disabled} aria-label={`${document.name} entfernen`} onClick={() => setDraft({ ...draft, documents: draft.documents.filter(item => item.id !== document.id) })}>Entfernen</button>
      </li>)}</ol>
      {dirty && <p role="status">Ungespeicherte Änderungen. Vor dem Verlassen dieser Ansicht speichern.</p>}
      <button type="button" disabled={!enabled || !canEdit || !!view?.redacted || busy || !dirty && !pending} onClick={save}>{pending ? 'Profilauftrag erneut prüfen' : 'Profilanweisungen speichern'}</button>
    </>}
    <button type="button" disabled={!enabled || busy} onClick={() => void run(reload)}>{dirty || pending ? 'Entwurf verwerfen und Profil neu laden' : 'Profilanweisungen neu laden'}</button>
    {(dirty || pending) && <button type="button" disabled={!enabled || busy || !canEdit} onClick={() => void run(async () => {
      const latest = await currentPort.current.load();
      if (live.current) { setView(latest); setPending(undefined); setNotice('Aktueller Profilstand geladen. Dein Entwurf bleibt erhalten; Unterschiede prüfen und erst danach speichern.'); }
    })}>Neue Profilbasis laden und Entwurf behalten</button>}
    {busy && <p role="status">Profilanweisungen werden geprüft…</p>}{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {view && <details><summary>Gespeicherten Profilkontext ansehen · {view.revision.slice(0, 12)}</summary>
      <p>Reihenfolge und Prüfsummen der Profilquellen; Repository-Anweisungen liest die CLI zusätzlich.</p>
      <ol>{view.context.sources.map((source, index) => <li key={`${source.kind}:${source.id ?? index}`}>{source.name} · {source.chars} Zeichen · <code>{source.sha256.slice(0, 12)}</code></li>)}</ol>
      <pre aria-label="Gespeicherter Profilkontext">{view.context.text}</pre>
    </details>}
  </section>;
}

export function DesktopAgentBehavior({ agentId }: { agentId: string }) {
  return <AgentBehaviorEditor key={agentId} agentId={agentId} port={{
    load: () => window.ade.invoke('agent:behaviorGet', { agentId }),
    save: input => window.ade.invoke('agent:behaviorSet', input),
  }} />;
}
