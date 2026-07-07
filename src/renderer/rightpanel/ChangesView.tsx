/**
 * Changes tab: branch header (dot + name, +/- totals, file count) then the
 * changed files grouped by directory, each with per-file +N -M. Clicking a file
 * asks the parent to open its diff in the shared inline pane.
 */

import type { JSX } from 'react';
import type { GitFileChange, GitStatus } from '../../shared/types';

interface ChangesViewProps {
  status: GitStatus | null;
  loading: boolean;
  openPath: string | null;
  onOpen: (path: string) => void;
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '/' : path.slice(0, i);
}
function baseOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

export function ChangesView({ status, loading, openPath, onOpen }: ChangesViewProps): JSX.Element {
  if (!status) {
    return <div className="ch-note">{loading ? 'Loading…' : 'Select an agent.'}</div>;
  }

  if (!status.isRepo) {
    return <div className="ch-note">Not a git repository.</div>;
  }

  const { files } = status;
  const totalAdd = files.reduce((n, f) => n + f.additions, 0);
  const totalDel = files.reduce((n, f) => n + f.deletions, 0);

  // Group by directory, dirs alphabetical, files alphabetical within.
  const groups = new Map<string, GitFileChange[]>();
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const d = dirOf(f.path);
    const arr = groups.get(d);
    if (arr) arr.push(f);
    else groups.set(d, [f]);
  }
  const sortedDirs = [...groups.keys()].sort((a, b) => a.localeCompare(b));

  return (
    <div className="ch-changes">
      <div className="ch-branch">
        <div className="name">{status.branch || '(detached)'}</div>
        <div className="stats">
          <span className="plus">+{totalAdd}</span> <span className="minus">-{totalDel}</span> ·{' '}
          {files.length} {files.length === 1 ? 'file' : 'files'}
        </div>
      </div>

      {files.length === 0 ? (
        <div className="ch-note">No changes yet.</div>
      ) : (
        <div className="ch-scroll">
          {sortedDirs.map((dir) => (
            <div key={dir}>
              <div className="ch-group">{dir}</div>
              {groups.get(dir)!.map((f) => (
                <button
                  key={f.path}
                  className={`ch-file${openPath === f.path ? ' open' : ''}`}
                  onClick={() => onOpen(f.path)}
                  title={f.path}
                >
                  <span className="fname">{baseOf(f.path)}</span>
                  {f.additions ? <span className="plus">+{f.additions}</span> : null}
                  {f.deletions ? <span className="minus">-{f.deletions}</span> : null}
                  {f.state === 'untracked' ? <span className="tag">new</span> : null}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
