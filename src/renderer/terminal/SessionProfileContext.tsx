import { useEffect, useRef, useState } from 'react';
import type { SessionProfileContext as ProfileContext } from '../../shared/agentBehavior';

/** Metadata only. The saved profile text is inspected explicitly in its editor. */
export function SessionProfileContext({ context, readRevision, readText }: {
  context?: ProfileContext; readRevision: () => Promise<string>; readText: () => Promise<string | null>;
}) {
  const [revision, setRevision] = useState<string>(); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [text, setText] = useState<string>();
  const live = useRef(true);
  useEffect(() => { live.current = true; setRevision(undefined); setText(undefined); setError(''); return () => { live.current = false; }; }, [context?.digest]);
  if (!context) return null;
  return <details className="session-profile-context"><summary>Profil beim Start · {context.profileName}</summary>
    <p>Profilanweisungen übergeben · {new Date(context.capturedAt).toLocaleString()} · <code>{context.digest.slice(0, 12)}</code></p>
    <p>Dieser Stand bleibt für die Sitzung erhalten. Die Anzeige bestätigt die Übergabe, nicht das Befolgen durch das Modell.</p>
    <ul>{context.sources.map((source, index) => <li key={`${source.kind}:${source.id ?? index}`}>{source.name} · {source.chars} Zeichen · <code>{source.sha256.slice(0, 12)}</code></li>)}</ul>
    <button type="button" disabled={busy} onClick={() => {
      setBusy(true); setError(''); void readRevision().then(value => { if (live.current) setRevision(value); })
        .catch(() => { if (live.current) setError('Aktueller Profilstand konnte nicht geprüft werden.'); })
        .finally(() => { if (live.current) setBusy(false); });
    }}>{busy ? 'Profilstand wird geprüft…' : 'Mit gespeichertem Profil vergleichen'}</button>
    {revision && <p role="status">{revision === (context.profileDigest ?? context.digest) ? 'Gespeichertes Profil entspricht dem Startstand.' : 'Das gespeicherte Profil wurde geändert. Eine neue Sitzung starten, um den neuen Stand zu verwenden.'}</p>}
    <button type="button" disabled={busy} onClick={() => {
      setBusy(true); setError(''); void readText().then(value => { if (live.current) {
        if (value === null) setError('Der eingefrorene Profiltext ist nicht mehr verfügbar.'); else setText(value);
      } }).catch(() => { if (live.current) setError('Der Profiltext konnte nicht geladen werden.'); })
        .finally(() => { if (live.current) setBusy(false); });
    }}>Übergebene Anweisungen ansehen</button>
    {text !== undefined && <pre aria-label="Übergebene Profilanweisungen" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 320, overflow: 'auto' }}>{text}</pre>}
    {error && <p role="alert">{error}</p>}
  </details>;
}
