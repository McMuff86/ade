import type { MobileCommitDetail, MobileCommitFile } from '../../shared/remote';
import { redactForWire } from '../errors';
import { RemoteApiError } from './AdeApplicationService';

export const validCommitSha = (value: unknown): value is string => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
type Git = (args: string[]) => Promise<string>;
function reject(message: string): never { throw new RemoteApiError(422, 'command_rejected', message); }
const comparison = (commit: Pick<MobileCommitDetail, 'sha' | 'parents'>) => commit.parents.length ? [commit.parents[0]!, commit.sha] : ['--root', commit.sha];

/** Fixed Git argv, immutable object ids and an allowlist of safe regular-file changes. */
export async function readCommitDetail(git: Git, sha: string, safePath: (path: string) => void): Promise<MobileCommitDetail> {
  if (!validCommitSha(sha)) throw new RemoteApiError(400, 'invalid_payload');
  try { await git(['merge-base', '--is-ancestor', sha, 'HEAD']); }
  catch { reject('Dieser Commit gehört nicht zum Verlauf des ausgewählten Workspace oder ist nicht mehr verfügbar.'); }
  const metadata = (await git(['show', '--no-patch', '--format=%H%x00%P%x00%an%x00%aI%x00%cI%x00%B', sha, '--'])).split('\0');
  const [id, parentText, author, authoredAt, committedAt, ...body] = metadata;
  const parents = (parentText ?? '').split(' ').filter(Boolean);
  if (id !== sha || parents.some((parent) => !validCommitSha(parent)) || !Number.isFinite(Date.parse(authoredAt ?? ''))
    || !Number.isFinite(Date.parse(committedAt ?? ''))) reject('Commit-Metadaten konnten nicht gelesen werden.');
  const message = body.join('\0').trimEnd();
  const base = ['diff-tree', '-r', '--no-commit-id', '--no-renames', '--no-ext-diff', '--no-textconv'];
  const revisions = comparison({ sha, parents });
  const [raw, stats] = await Promise.all([
    git([...base, '--raw', '--no-abbrev', '-z', ...revisions, '--']),
    git([...base, '--numstat', '-z', ...revisions, '--']),
  ]);
  const counts = new Map<string, { additions: number | null; deletions: number | null }>();
  for (const record of stats.split('\0').filter(Boolean)) {
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(record);
    if (!match) reject('Commit-Dateistatistik konnte nicht gelesen werden.');
    counts.set(match[3]!, { additions: match[1] === '-' ? null : Number(match[1]), deletions: match[2] === '-' ? null : Number(match[2]) });
  }
  const files: MobileCommitFile[] = []; let limited = false;
  const records = raw.split('\0').filter(Boolean);
  for (let index = 0; index < records.length; index += 2) {
    const match = /^:(\d{6}) (\d{6}) [a-f0-9]+ [a-f0-9]+ ([AMDT])$/.exec(records[index]!);
    const path = records[index + 1];
    if (!match || !path || !counts.has(path)) reject('Commit-Dateiliste konnte nicht gelesen werden.');
    if (files.length >= 500 || ![match[1], match[2]].every((mode) => ['000000', '100644', '100755'].includes(mode!))) { limited = true; continue; }
    try { safePath(path); } catch { limited = true; continue; }
    const status = ({ A: 'added', M: 'modified', D: 'deleted', T: 'type-changed' } as const)[match[3] as 'A' | 'M' | 'D' | 'T'];
    files.push({ path, status, ...counts.get(path)! });
  }
  return { sha, parents, author: redactForWire(author ?? '', 200), authoredAt: authoredAt!, committedAt: committedAt!,
    message: redactForWire(message, 8000), messageLimited: message.length > 8000, files, limited,
    additions: files.reduce((sum, file) => sum + (file.additions ?? 0), 0),
    deletions: files.reduce((sum, file) => sum + (file.deletions ?? 0), 0),
    binaryFiles: files.filter((file) => file.additions === null || file.deletions === null).length };
}

export async function readCommitPatch(git: Git, commit: MobileCommitDetail, path: string): Promise<{ diff: string; limited: boolean; notice?: string }> {
  const file = commit.files.find((item) => item.path === path);
  if (!file) reject('Diese Datei ist für die Commit-Ansicht nicht verfügbar.');
  if (file.additions === null || file.deletions === null) return { diff: '', limited: false, notice: 'Binärdatei geändert. Eine Textdiff-Ansicht und Zeilenzählung sind dafür nicht verfügbar.' };
  const raw = await git(['diff-tree', '-r', '--no-commit-id', '--no-renames', '--no-ext-diff', '--no-textconv', '--no-color',
    '--src-prefix=a/', '--dst-prefix=b/', '--unified=3', '-p', ...comparison(commit), '--', path]);
  return { diff: redactForWire(raw, 64 * 1024), limited: raw.length > 64 * 1024,
    ...(!raw ? { notice: 'Keine Textänderung vorhanden.' } : {}) };
}
