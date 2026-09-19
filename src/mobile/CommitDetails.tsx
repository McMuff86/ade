import { localizeAppMessage } from '../shared/i18n/appMessages';
import { intlLocale } from '../shared/i18n';
import { t as translate } from "../shared/i18n";
import { localizedLabels } from "../shared/i18n/labels";
import { useLocale } from "../renderer/i18n/language";
import { useEffect, useRef, useState } from 'react';
import type { MobileCommitDetail, MobileWorkspaceOperation, MobileWorkspaceResult } from '../shared/remote';

const status = localizedLabels(() => ({ added: translate("New"), modified: translate("Modified"), deleted: translate("Deleted"), 'type-changed': translate("File type changed") }));
const date = (value: string) => new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'medium', timeStyle: 'long' }).format(new Date(value));

export function CommitDetails({ commit, query, online, errorText }: {
  commit: MobileCommitDetail;
  query: (input: MobileWorkspaceOperation) => Promise<MobileWorkspaceResult>;
  online: boolean;
  errorText: (error: unknown) => string;
}) {
  useLocale();
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
    <p className="m-commit-message">{commit.message || translate("No commit message.")}</p>
    {commit.messageLimited && <p>{translate("Commit message is truncated.")}</p>}
    <dl className="m-commit-metadata">
      <div><dt>{translate("Author")}</dt><dd>{commit.author || translate("Unknown")}</dd></div>
      <div><dt>{translate("Authored")}</dt><dd><time dateTime={commit.authoredAt}>{date(commit.authoredAt)}</time></dd></div>
      <div><dt>{translate("Commit time")}</dt><dd><time dateTime={commit.committedAt}>{date(commit.committedAt)}</time></dd></div>
      <div><dt>{translate("Commit ID")}</dt><dd><code>{commit.sha}</code></dd></div>
      <div><dt>{translate("Comparison base")}</dt><dd>{commit.parents.length ? <><code>{commit.parents[0]}</code>{commit.parents.length > 1 && translate(" · First parent commit (merge)")}</> : translate("First commit · comparison with empty project")}</dd></div>
    </dl>
    <p className="m-commit-stats">{commit.files.length} {commit.limited ? translate("visible ") : ''}{translate("Files ·")}{" "}<span className="m-diff-add">+{commit.additions} {" "}{translate("Lines added")}</span> · <span className="m-diff-delete">−{commit.deletions} {" "}{translate("Lines removed")}</span>
      {commit.binaryFiles > 0 && <> · {commit.binaryFiles} {" "}{translate("Binary files without line counts")}</>}</p>
    {commit.limited && <p>{translate("List and sums refer to the displayed files. Protected or linked files are omitted; maximum 500 files.")}</p>}
    <h4>{translate("Modified files")}</h4>
    {!commit.files.length && <p>{commit.limited ? translate("No file changes visible to this device.") : translate("This commit does not contain any file changes.")}</p>}
    <ul className="m-commit-files">{commit.files.map((file) => <li key={file.path}>
      <button disabled={!online || loading} aria-pressed={selected === file.path} onClick={() => void openFile(file.path)}>
        <strong>{file.path}</strong><span>{status[file.status]} · {file.additions === null || file.deletions === null ? translate("Binary file") : translate("+{{value1}} / −{{value2}} lines", { value1: file.additions, value2: file.deletions })}</span>
      </button>
    </li>)}</ul>
    {loading && <p role="status">{translate("Loading change…")}</p>}
    {error && <div role="alert"><p>{localizeAppMessage(error)}</p><button disabled={!online || loading} onClick={() => void openFile(selected)}>{translate("Reload change")}</button></div>}
    {patch && <section aria-label={translate("Commit file change")}><h4 tabIndex={-1} ref={patchHeading}>{selected}</h4>
      {patch.notice && <p>{localizeAppMessage(patch.notice)}</p>}{patch.limited && <p>{translate("Diff is abbreviated; the row statistic applies to the complete file change.")}</p>}
      {patch.diff && <pre tabIndex={0} aria-label={translate("Commit diff")}>{patch.diff.split('\n').map((line, index) =>
        <span key={index} className={line.startsWith('+') ? 'm-diff-add' : line.startsWith('-') ? 'm-diff-delete' : undefined}>{line}{'\n'}</span>)}</pre>}
    </section>}
  </div>;
}
