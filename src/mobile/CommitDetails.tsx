import { useEffect, useRef, useState } from 'react';
import type { MobileCommitDetail, MobileWorkspaceOperation, MobileWorkspaceResult } from '../shared/remote';

const status = { added: 'Neu', modified: 'Geändert', deleted: 'Gelöscht', 'type-changed': 'Dateityp geändert' };
const date = (value: string) => new Intl.DateTimeFormat('de-CH', { dateStyle: 'medium', timeStyle: 'long' }).format(new Date(value));

export function CommitDetails({ commit, query, online, errorText }: {
  commit: MobileCommitDetail;
  query: (input: MobileWorkspaceOperation) => Promise<MobileWorkspaceResult>;
  online: boolean;
  errorText: (error: unknown) => string;
}) {
  const [selected, setSelected] = useState('');
  const [patch, setPatch] = useState<MobileWorkspaceResult | null>(null);
  const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const version = useRef(0); const patchHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => () => { version.current++; }, []);
  useEffect(() => { if (patch) patchHeading.current?.focus(); }, [patch]);
  const openFile = async (path: string) => {
    const own = ++version.current; setSelected(path); setPatch(null); setLoading(true); setError('');
    try {
      const result = await query({ operation: 'commit-file', sha: commit.sha, path });
      if (own === version.current) setPatch(result);
    } catch (reason) { if (own === version.current) setError(errorText(reason)); }
    finally { if (own === version.current) setLoading(false); }
  };
  return <div className="m-commit-details">
    <p className="m-commit-message">{commit.message || 'Keine Commit-Nachricht.'}</p>
    {commit.messageLimited && <p>Commit-Nachricht ist gekürzt.</p>}
    <dl className="m-commit-metadata">
      <div><dt>Autor</dt><dd>{commit.author || 'Unbekannt'}</dd></div>
      <div><dt>Verfasst</dt><dd><time dateTime={commit.authoredAt}>{date(commit.authoredAt)}</time></dd></div>
      <div><dt>Commit-Zeitpunkt</dt><dd><time dateTime={commit.committedAt}>{date(commit.committedAt)}</time></dd></div>
      <div><dt>Commit-ID</dt><dd><code>{commit.sha}</code></dd></div>
      <div><dt>Vergleichsbasis</dt><dd>{commit.parents.length ? <><code>{commit.parents[0]}</code>{commit.parents.length > 1 && ' · Erster Eltern-Commit (Merge)'}</> : 'Erster Commit · Vergleich mit leerem Projekt'}</dd></div>
    </dl>
    <p className="m-commit-stats">{commit.files.length} {commit.limited ? 'sichtbare ' : ''}Dateien · <span className="m-diff-add">+{commit.additions} Zeilen hinzugefügt</span> · <span className="m-diff-delete">−{commit.deletions} Zeilen entfernt</span>
      {commit.binaryFiles > 0 && <> · {commit.binaryFiles} Binärdateien ohne Zeilenzählung</>}</p>
    {commit.limited && <p>Liste und Summen beziehen sich auf die angezeigten Dateien. Geschützte oder verknüpfte Dateien werden ausgelassen; maximal 500 Dateien.</p>}
    <h4>Geänderte Dateien</h4>
    {!commit.files.length && <p>{commit.limited ? 'Keine für dieses Gerät sichtbaren Dateiänderungen.' : 'Dieser Commit enthält keine Dateiänderungen.'}</p>}
    <ul className="m-commit-files">{commit.files.map((file) => <li key={file.path}>
      <button disabled={!online || loading} aria-pressed={selected === file.path} onClick={() => void openFile(file.path)}>
        <strong>{file.path}</strong><span>{status[file.status]} · {file.additions === null || file.deletions === null ? 'Binärdatei' : `+${file.additions} / −${file.deletions} Zeilen`}</span>
      </button>
    </li>)}</ul>
    {loading && <p role="status">Änderung wird geladen…</p>}
    {error && <div role="alert"><p>{error}</p><button disabled={!online || loading} onClick={() => void openFile(selected)}>Änderung erneut laden</button></div>}
    {patch && <section aria-label="Commit-Dateiänderung"><h4 tabIndex={-1} ref={patchHeading}>{selected}</h4>
      {patch.notice && <p>{patch.notice}</p>}{patch.limited && <p>Diff ist gekürzt; die Zeilenstatistik gilt für die vollständige Dateiänderung.</p>}
      {patch.diff && <pre tabIndex={0} aria-label="Commit-Diff">{patch.diff.split('\n').map((line, index) =>
        <span key={index} className={line.startsWith('+') ? 'm-diff-add' : line.startsWith('-') ? 'm-diff-delete' : undefined}>{line}{'\n'}</span>)}</pre>}
    </section>}
  </div>;
}
