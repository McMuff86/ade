import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import type { IntegrationCommand, IntegrationDiff, IntegrationPreview, IntegrationQuery, IntegrationReport, IntegrationResult, IntegrationSource } from '../../shared/remote';
import './integration-review.css';

export interface PendingIntegration { key: string; command: IntegrationCommand }
interface Props {
  repositoryId: string;
  online: boolean;
  canChange: boolean;
  canTest: boolean;
  query: (input: IntegrationQuery) => Promise<IntegrationResult>;
  command: (input: IntegrationCommand, key: string) => Promise<IntegrationResult>;
  errorText: (error: unknown) => string;
  certainError: (error: unknown) => boolean;
  pending: PendingIntegration | null;
  savePending: (pending: PendingIntegration | null) => boolean;
  onWorkspace: (id: string) => void;
  onBack: () => void;
}
const phases: Record<IntegrationReport['phase'], string> = { preparing: 'Wird vorbereitet', review: 'In Prüfung', testing: 'Tests laufen', ready: 'Tests bestanden', integrated: 'Übernommen', interrupted: 'Unterbrochen' };
const checkStatus = { pending: 'Wartet', running: 'Läuft', passed: 'Bestanden', failed: 'Fehlgeschlagen' };
/** Same user-visible workflow for desktop IPC and signed mobile requests. */
export function IntegrationReview(props: Props): JSX.Element {
  const { repositoryId, query, command, online, canChange, canTest, pending, savePending, errorText, certainError, onWorkspace, onBack } = props;
  const [sources, setSources] = useState<IntegrationSource[]>([]); const [reviews, setReviews] = useState<NonNullable<IntegrationResult['reviews']>>([]);
  const [sourceId, setSourceId] = useState(''); const [preview, setPreview] = useState<IntegrationPreview>(); const [report, setReport] = useState<IntegrationReport>();
  const [paths, setPaths] = useState<string[]>([]); const [diff, setDiff] = useState<IntegrationDiff>();
  const [busy, setBusy] = useState(false); const [loaded, setLoaded] = useState(false); const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false); const [message, setMessage] = useState('');
  const live = useRef(true); const lock = useRef(false); const heading = useRef<HTMLHeadingElement>(null);
  const current = useRef(props); current.current = props;
  useLayoutEffect(() => { heading.current?.focus(); }, [preview?.id, report?.id]);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => { setConfirmed(false); }, [report?.revision]);
  const apply = useCallback((result: IntegrationResult) => {
    if (!live.current) return;
    if (result.sources) { setSources(result.sources); setLoaded(true); }
    if (result.reviews) setReviews(result.reviews);
    if (result.preview) { setPreview(result.preview); setPaths(result.preview.files.filter((file) => file.suggested).map((file) => file.path)); setReport(undefined); setDiff(undefined); }
    if (result.report) { setReport(result.report); setPreview(undefined); setDiff(undefined); setMessage((value) => value || `feat: geprüfte Änderungen aus ${result.report!.sourceName}`); }
    if (result.diff) setDiff(result.diff);
  }, []);
  const perform = async (action: () => Promise<IntegrationResult>) => {
    if (lock.current || !online) return;
    lock.current = true; setBusy(true); setError('');
    try { apply(await action()); } catch (reason) { if (live.current) setError(errorText(reason)); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  };
  useEffect(() => {
    if (!online) return; let disposed = false;
    setBusy(true); setError('');
    void query({ operation: 'sources', repositoryId }).then((result) => { if (!disposed) apply(result); })
      .catch((reason) => { if (!disposed) setError(current.current.errorText(reason)); })
      .finally(() => { if (!disposed) setBusy(false); });
    return () => { disposed = true; };
  }, [repositoryId, query, online, apply]);
  useEffect(() => {
    if (!online || report?.phase !== 'testing') return;
    let disposed = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await query({ operation: 'report', integrationId: report.id });
        if (!disposed) apply(result);
      } catch (reason) { if (!disposed) setError(current.current.errorText(reason)); }
      finally { if (!disposed) timer = setTimeout(() => { void poll(); }, 2000); }
    };
    timer = setTimeout(() => { void poll(); }, 1000);
    return () => { disposed = true; clearTimeout(timer); };
  }, [online, report?.id, report?.phase, query, apply]);
  const send = async (input: IntegrationCommand, retry = false) => {
    if (pending && !retry) return;
    const selected = retry && pending ? pending : { key: crypto.randomUUID(), command: input };
    await perform(async () => {
      if (!savePending(selected)) throw new Error('Die Anfrage konnte auf diesem Gerät nicht gesichert werden. Speicher freigeben und erneut versuchen.');
      try { const result = await command(selected.command, selected.key); savePending(null); return result; }
      catch (reason) { if (certainError(reason)) savePending(null); throw reason; }
    });
  };
  const disabled = busy || !online || !!pending;
  return <section className="integration-review" aria-label="Änderungen übernehmen" aria-busy={busy}>
    <h3 ref={heading} tabIndex={-1}>Änderungen geprüft übernehmen</h3>
    <p>Ausgewählte Änderungen einer älteren Arbeitskopie auf dem aktuellen Branch des Hauptrepositories vorbereiten. ADE sichert die Auswahl und erstellt eine separate Arbeitskopie.</p>
    <div className="integration-actions"><button type="button" className="btn" onClick={onBack}>Zum Git-Abgleich</button>
      <button type="button" className="btn" disabled={busy || !online} onClick={() => void perform(() => query({ operation: 'sources', repositoryId }))}>Quellen und Berichte aktualisieren</button></div>
    {!online && <p role="status">Keine Verbindung zum ADE-Rechner. Zum Fortsetzen erneut verbinden.</p>}
    {busy && <p role="status">ADE prüft den aktuellen Stand…</p>}
    {error && <p className="integration-error" role="alert">{error}</p>}
    {pending && <div className="integration-notice"><p>Die letzte Anfrage ist noch nicht bestätigt. Dieselbe Anfrage erneut prüfen.</p>
      <button type="button" className="btn" disabled={busy || !online} onClick={() => void send(pending.command, true)}>Anfrage erneut prüfen</button></div>}
    {!canChange && <p>Für Vorbereiten und Übernehmen am PC die Git-Verwaltungsrechte und den Zugriff auf alle Projekte freigeben.</p>}
    <label>Quell-Workspace<select aria-label="Quell-Workspace" value={sourceId} disabled={disabled} onChange={(event) => { setSourceId(event.target.value); setPreview(undefined); setReport(undefined); setConfirmed(false); setDiff(undefined); }}>
      <option value="">Arbeitskopie auswählen</option>{sources.map((source) => <option value={source.id} key={source.id}>{source.name} · {source.branch}</option>)}</select></label>
    <button type="button" className="btn" disabled={disabled || !sourceId} onClick={() => void perform(() => query({ operation: 'preview', repositoryId, sourceId }))}>Änderungen prüfen</button>
    {loaded && !sources.length && <p>Keine zusätzliche erreichbare Arbeitskopie dieses Projekts gefunden. Einen Agent-Workspace oder Projekt-Worktree anlegen.</p>}
    {!!reviews.length && <details open={!preview && !report}><summary>Gespeicherte Übernahmen ({reviews.length})</summary><ul className="integration-reviews">{reviews.map((review) => <li key={review.id}>
      <button type="button" className="btn" disabled={disabled} onClick={() => void perform(() => query({ operation: 'report', integrationId: review.id }))}>{review.sourceName} · {phases[review.phase]} · {review.id.slice(0, 8)}</button></li>)}</ul></details>}
    {preview && <div className="integration-preview">
      <h4>{preview.sourceName} → {preview.projectName} · {preview.targetBranch}</h4>
      <p>{preview.ownCommits} eigene Commits · {preview.behind} Commits hinter dem Ziel. Der Vergleich beruht auf der gemeinsamen Git-Basis; die fachliche Prüfung bleibt erforderlich.</p>
      <p>Quelle <code>{preview.sourceHead.slice(0, 12)}</code> · Ziel <code>{preview.targetHead.slice(0, 12)}</code></p>
      {!!preview.blockers.length && <ul className="integration-notice">{preview.blockers.map((blocker, index) => <li key={index}>{blocker}</li>)}</ul>}
      {!preview.files.length && <p>Keine eigenen oder lokalen Änderungen gegenüber der gemeinsamen Basis.</p>}
      {!!preview.files.length && <fieldset disabled={disabled}><legend>Dateien für die Sicherung auswählen</legend><ul className="integration-files">{preview.files.map((file) => <li key={file.path}>
        <label><input type="checkbox" aria-label={`Übernehmen: ${file.path}`} disabled={!file.selectable} checked={paths.includes(file.path)}
          onChange={(event) => setPaths((before) => event.target.checked ? [...before, file.path] : before.filter((path) => path !== file.path))} /><span>{file.path}</span></label>
        <span>{file.kind === 'new' ? 'Neu' : file.kind === 'deleted' ? 'Gelöscht' : 'Geändert'} · {file.local ? 'Lokal geändert' : 'Committet'}</span>
        {file.notice && <p>{file.notice}</p>}<button type="button" className="btn" onClick={() => void perform(() => query({ operation: 'diff', previewId: preview.id, path: file.path }))}>Vergleich: {file.path}</button>
      </li>)}</ul></fieldset>}
      {diff && <section aria-label={`Dateivergleich ${diff.path}`}><h4>{diff.path}</h4>{diff.limited && <p>Vorschau gekürzt. Vollständige Datei in der Arbeitskopie prüfen.</p>}
        <div className="integration-diff">{[['Gemeinsame Basis', diff.base], ['Ausgewählte Quelle', diff.source], ['Aktuelles Ziel', diff.target]].map(([title, text]) => <div key={title}><strong>{title}</strong><pre tabIndex={0}>{text || '(Datei leer oder nicht vorhanden)'}</pre></div>)}</div></section>}
      <button type="button" className="btn primary" disabled={disabled || !canChange || !!preview.blockers.length || !paths.length} onClick={() => void send({ operation: 'prepare', previewId: preview.id, paths })}>Auswahl sichern und Arbeitskopie vorbereiten</button>
    </div>}
    {report && <section className="integration-report" aria-label="Übernahmebericht"><h4>{report.sourceName} → {report.projectName} · {report.targetBranch}</h4>
      <p role="status">{phases[report.phase]} · {report.branch}</p>
      <p>Zielbasis <code>{report.targetHead.slice(0, 12)}</code> · Quelle <code>{report.sourceHead.slice(0, 12)}</code></p>
      <div className="integration-actions"><button type="button" className="btn" disabled={disabled} onClick={() => void perform(() => query({ operation: 'report', integrationId: report.id }))}>Bericht aktualisieren</button>
        {report.workspaceId && <button type="button" className="btn" disabled={disabled} onClick={() => onWorkspace(report.workspaceId!)}>Arbeitskopie öffnen</button>}</div>
      {!!report.blockers.length && <ul className="integration-notice">{report.blockers.map((blocker, index) => <li key={index}>{blocker}</li>)}</ul>}
      <ul className="integration-files">{report.files.map((file) => <li key={file.path}>{file.path}{file.conflict && <strong> · Konflikt</strong>}</li>)}</ul>
      <p>In der Arbeitskopie kannst du Dateien anpassen und Konflikte im Bereich Git auflösen. Diesen Bericht findest du danach wieder unter „Gespeicherte Übernahmen“.</p>
      <h4>Projektprüfungen</h4><p>{report.checkNotice}</p>
      {!canTest && <p>Zum Starten der Prüfungen zusätzlich die Terminal-Steuerung für dieses Gerät freigeben.</p>}
      {report.checks.map((check, index) => <details key={index} open={check.status === 'failed'}><summary>{check.label} · {checkStatus[check.status]}</summary><pre tabIndex={0}>{check.output || 'Noch keine Ausgabe.'}</pre></details>)}
      {report.phase !== 'integrated' && <><button type="button" className="btn" disabled={disabled || !canTest || report.phase === 'testing' || !!report.blockers.length || !report.workspaceId}
        onClick={() => void send({ operation: 'test', integrationId: report.id })}>Projektprüfungen starten</button>
        <label>Commit-Nachricht<input aria-label="Commit-Nachricht für Übernahme" maxLength={2000} value={message} disabled={disabled} onChange={(event) => setMessage(event.target.value)} /></label>
        <label className="integration-confirm"><input type="checkbox" checked={confirmed} disabled={disabled || !report.tested || !!report.blockers.length}
          onChange={(event) => setConfirmed(event.target.checked)} />Änderungen und erforderliche manuelle Prüfungen kontrolliert. Diesen Stand in {report.targetBranch} übernehmen.</label>
        <button type="button" className="btn primary" disabled={disabled || !canChange || !report.tested || !!report.blockers.length || !confirmed || !message.trim()}
          onClick={() => void send({ operation: 'integrate', integrationId: report.id, revision: report.revision, message: message.trim() })}>Geprüften Stand übernehmen</button></>}
      {report.phase === 'integrated' && <p role="status">Übernommen als <code>{report.integratedCommit?.slice(0, 12)}</code>. Der ursprüngliche Workspace bleibt erhalten. Zum Veröffentlichen den Hauptworkspace im Bereich Projekte öffnen.</p>}
    </section>}
  </section>;
}
