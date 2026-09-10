import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { ProjectPublication, ProjectPublishAction, ProjectPublishPreview, ProjectPublishStatus, ProjectPullRequest } from '../../shared/projectPublish';
import { validProjectPublishAction } from '../../shared/projectPublish';
import { validProjectRemote } from '../../shared/projectGit';
import { validProjectBranchName } from '../../shared/projectBranches';
import { redactForWire, redactedErrorDetail } from '../errors';
import { githubRepository, parseGithubRepository, safeGithubPullRequestUrl } from '../git/github';
import { projectGit } from './ProjectGitBoundary';
import { ProjectGitService } from './ProjectGitService';
import { workspaceOperations } from './WorkspaceOperationGate';

const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
function fail(message: string): never { throw new Error(`ade: ${message}`); }
export type ProjectGhCommand = (cwd: string, args: string[], input?: string) => Promise<string>;
const ghCommand: ProjectGhCommand = (cwd, args, input) => new Promise((resolve, reject) => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_|^GH_(?:HOST|REPO|PAGER|BROWSER|EDITOR|FORCE_TTY|DEBUG)$/i.test(key)));
  const child = execFile('gh', args, { cwd, windowsHide: true, timeout: 60_000, maxBuffer: 256 * 1024, encoding: 'utf8',
    env: { ...env, GH_HOST: 'github.com', GH_PROMPT_DISABLED: '1', GH_PAGER: 'cat', NO_COLOR: '1' } }, (error, stdout, stderr) => {
    if (error) { console.warn('[ade] project GitHub command failed:', redactedErrorDetail(stderr || error)); reject(new Error('ade: GitHub-Antwort nicht bestätigt. gh-Installation/Anmeldung am PC und Remote-Stand prüfen.')); }
    else resolve(stdout);
  });
  child.stdin?.on('error', () => undefined); child.stdin?.end(input ?? '');
});
interface Inspection { local: Awaited<ReturnType<ProjectGitService['publicationState']>>; status: ProjectPublishStatus; pushUrl: string }
interface Saved { preview: ProjectPublishPreview; revision: string; pushUrl: string; owner: string }

/** Explicit native publication; never force-push, fork, choose a remote or push implicitly for a PR. */
export class ProjectPublishService {
  private readonly previews = new Map<string, Saved>();
  constructor(private readonly git: ProjectGitService, private readonly gh: ProjectGhCommand = ghCommand,
    private readonly now = Date.now, private readonly runGit: typeof projectGit = projectGit) {}

  async status(id: string, remote: string): Promise<ProjectPublishStatus> {
    return workspaceOperations.use(async () => (await this.inspect(id, remote)).status);
  }
  async preview(id: string, action: ProjectPublishAction, owner: string): Promise<ProjectPublishPreview> {
    if (!validProjectPublishAction(action) || redactForWire(JSON.stringify(action), 32 * 1024) !== JSON.stringify(action)) fail('Ungültige Veröffentlichung.');
    return workspaceOperations.use(async () => {
      const state = await this.inspect(id, action.remote); const { baseHead, changedFiles, commitCount } = await this.validate(state, action);
      const preview: ProjectPublishPreview = { id: randomUUID(), workspaceId: id, status: state.status, action: structuredClone(action),
        baseHead, changedFiles, commitCount, expiresAt: this.now() + 300_000 };
      for (const [key, saved] of this.previews) if (saved.preview.expiresAt < this.now()) this.previews.delete(key);
      if (this.previews.size >= 30) fail('Zu viele Veröffentlichungsvorschauen. Später erneut prüfen.');
      this.previews.set(preview.id, { preview, revision: state.local.view.revision, pushUrl: state.pushUrl, owner }); return structuredClone(preview);
    });
  }
  async apply(id: string, owner: string, authorize: () => void = () => undefined) {
    return workspaceOperations.mutate(async () => {
      authorize(); const saved = this.previews.get(id);
      if (!saved || saved.owner !== owner || saved.preview.expiresAt < this.now()) fail('Veröffentlichungsvorschau abgelaufen. Neu prüfen.');
      this.previews.delete(id); const { action, status: expected } = saved.preview;
      const current = await this.inspect(saved.preview.workspaceId, action.remote); authorize();
      if (current.local.view.revision !== saved.revision || current.pushUrl !== saved.pushUrl || current.status.remoteHead !== expected.remoteHead
        || current.status.provider !== expected.provider) fail('Lokaler Stand oder Veröffentlichungsziel geändert. Neu prüfen.');
      const checked = await this.validate(current, action);
      if (checked.baseHead !== saved.preview.baseHead) fail('Remote-Basis wurde geändert. Neu prüfen.');
      const before = await this.git.publicationState(saved.preview.workspaceId); authorize();
      if (before.view.revision !== saved.revision) fail('Workspace wurde während der Prüfung geändert. Neu prüfen.');
      let url: string | null = null; const cwd = before.scope.workspace.workspaceDir;
      if (await this.remoteHead(cwd, current.pushUrl, expected.branch) !== expected.remoteHead
        || action.kind === 'pr' && await this.remoteHead(cwd, current.pushUrl, action.base) !== saved.preview.baseHead) fail('Remote wurde vor Ausführung geändert. Neu prüfen.');
      authorize();
      if (action.kind === 'push') {
        await this.runGit(cwd, ['-c', 'push.followTags=false', '-c', 'push.pushOption=', 'push', '--porcelain', '--no-force', '--no-follow-tags',
          '--recurse-submodules=no', '--signed=false', '--receive-pack=git-receive-pack', '--', current.pushUrl, `${expected.head}:refs/heads/${expected.branch}`], 60_000);
        authorize();
        if (await this.remoteHead(cwd, current.pushUrl, expected.branch) !== expected.head) fail('Push-Antwort und Remote-Commit stimmen nicht überein. Remote-Stand prüfen.');
      } else {
        const existing = current.status.pullRequests.find((pr) => pr.base === action.base && pr.head === expected.head);
        if (existing) url = existing.url;
        else {
          // Explicit --head disables gh's automatic push/fork behavior. Body uses stdin, never shell interpolation.
          await this.gh(cwd, ['pr', 'create', '--repo', githubRepository(expected.provider!), '--head', expected.branch, '--base', action.base,
            '--title', action.title, '--body-file', '-', ...(action.draft ? ['--draft'] : [])], action.body);
          authorize(); const found = await this.pullRequests(cwd, expected.provider!, expected.branch);
          url = found.find((pr) => pr.base === action.base && pr.head === expected.head)?.url ?? null;
          if (!url) fail('PR-Erstellung nicht eindeutig bestätigt. Remote-Stand prüfen, keinen zweiten PR blind erstellen.');
        }
      }
      authorize(); const publication: ProjectPublication = { kind: action.kind, branch: expected.branch, head: expected.head,
        target: expected.target, url, confirmedAt: this.now() };
      return { workspace: before.view.workspace, publication };
    });
  }
  private async remoteHead(cwd: string, url: string, branch: string): Promise<string | null> {
    if (!validProjectBranchName(branch)) fail('Ungültiger Remote-Branch.');
    const value = (await this.runGit(cwd, ['ls-remote', '--heads', '--', url, `refs/heads/${branch}`], 30_000)).trim();
    if (!value) return null;
    const [head, ref, ...extra] = value.split(/\s+/);
    if (!SHA.test(head ?? '') || ref !== `refs/heads/${branch}` || extra.length) fail('Remote-Branch konnte nicht eindeutig gelesen werden.');
    return head!;
  }
  private async pullRequests(cwd: string, provider: string, branch: string): Promise<ProjectPullRequest[]> {
    const raw = JSON.parse(await this.gh(cwd, ['pr', 'list', '--repo', githubRepository(provider), '--head', branch, '--state', 'open', '--limit', '20',
      '--json', 'number,url,headRefName,headRefOid,baseRefName,isDraft,isCrossRepository']));
    if (!Array.isArray(raw) || raw.length >= 20) fail('PR-Liste ist zu gross oder ungültig. GitHub direkt prüfen.');
    if (raw.some((item) => !item || typeof item.isCrossRepository !== 'boolean')) fail('PR-Herkunft ist nicht eindeutig.');
    return raw.filter((item) => item?.isCrossRepository === false).map((item) => {
      const url = typeof item.url === 'string' ? safeGithubPullRequestUrl(item.url, provider, item.number) : null;
      if (!Number.isInteger(item.number) || item.number <= 0 || !url || item.headRefName !== branch || !SHA.test(item.headRefOid)
        || !validProjectBranchName(item.baseRefName) || typeof item.isDraft !== 'boolean') fail('GitHub lieferte keine eindeutige PR-Identität.');
      return { number: item.number, url, head: item.headRefOid, base: item.baseRefName, draft: item.isDraft };
    });
  }
  private async inspect(id: string, remote: string): Promise<Inspection> {
    if (!validProjectRemote(remote)) fail('Ungültiger Remote.');
    const local = await this.git.publicationState(id); const cwd = local.scope.workspace.workspaceDir;
    if (!local.view.remotes.includes(remote)) fail('Remote ist nicht mehr vorhanden.');
    const urls = (await this.runGit(cwd, ['remote', 'get-url', '--push', '--all', remote])).trim().split(/\r?\n/);
    if (urls.length !== 1 || !/^(?:https?:\/\/|ssh:\/\/|git:\/\/|file:\/\/|[\w.-]+@[\w.-]+:|[A-Za-z]:[\\/]|\/)/.test(urls[0]!)) fail('Genau ein unterstütztes Push-Ziel erforderlich. Am PC konfigurieren.');
    const pushUrl = urls[0]!;
    const configured = (await this.runGit(cwd, ['config', '--get-all', `remote.${remote}.url`])).trim().split(/\r?\n/);
    const provider = configured.length === 1 ? parseGithubRepository(configured[0]!) : null;
    // A separately configured push URL must name the same provider; URL rewrites remain pinned in main.
    const explicitPush = (await this.runGit(cwd, ['config', '--local', '--list', '-z'])).split('\0').filter((entry) => entry.startsWith(`remote.${remote}.pushurl\n`));
    const actualProvider = parseGithubRepository(pushUrl);
    const providerMatches = !!provider && actualProvider === provider
      && (!explicitPush.length || explicitPush.length === 1 && parseGithubRepository(explicitPush[0]!.split('\n').slice(1).join('\n')) === provider);
    const target = actualProvider ? `github.com/${actualProvider}` : (() => {
      try { const parsed = new URL(pushUrl); return ['http:', 'https:', 'ssh:', 'git:'].includes(parsed.protocol) ? `${parsed.hostname}${parsed.pathname}` : `Lokales Repository · ${remote}`; }
      catch { return pushUrl.includes('@') ? pushUrl.replace(/^.*@/, '') : `Lokales Repository · ${remote}`; }
    })();
    if (redactForWire(target, 400) !== target) fail('Remote-Ziel kann nicht sicher angezeigt werden.');
    const remoteHead = await this.remoteHead(cwd, pushUrl, local.view.workspace.branch);
    let pullRequests: ProjectPullRequest[] = []; let providerNotice: string | null = null;
    if (provider && providerMatches) try { pullRequests = await this.pullRequests(cwd, provider, local.view.workspace.branch); }
    catch { providerNotice = 'GitHub-PRs nicht lesbar. gh-Installation und GitHub-Anmeldung am PC prüfen.'; }
    const after = await this.git.publicationState(id);
    if (after.view.revision !== local.view.revision) fail('Workspace wurde während der Remote-Prüfung geändert. Aktualisieren.');
    return { local, pushUrl, status: { workspaceId: id, projectName: local.view.workspace.name, branch: local.view.workspace.branch, head: local.view.head!,
      remote, target, remoteHead, provider: providerMatches ? provider : null, pullRequests, providerNotice, checkedAt: this.now() } };
  }
  private async validate(state: Inspection, action: ProjectPublishAction) {
    const { status, local, pushUrl } = state; const cwd = local.scope.workspace.workspaceDir;
    let baseHead = status.remoteHead;
    if (action.kind === 'pr') {
      if (!status.provider || status.providerNotice) fail('Für PRs einen lesbaren GitHub-Remote und angemeldetes gh verwenden.');
      if (status.remoteHead !== status.head) fail('Diesen genauen Branch-Commit zuerst ausdrücklich pushen.');
      if (action.base === status.branch) fail('PR-Zielbranch und Arbeitsbranch müssen verschieden sein.');
      baseHead = await this.remoteHead(cwd, pushUrl, action.base);
      if (!baseHead) fail('PR-Zielbranch ist auf dem Remote nicht vorhanden.');
    }
    if (baseHead) {
      let base: string;
      try { base = (await this.runGit(cwd, ['merge-base', baseHead, status.head])).trim(); }
      catch { fail('Remote-Commit ist lokal nicht prüfbar. Zuerst Fetch ausführen.'); }
      if (action.kind === 'push' && base !== baseHead) fail('Remote und Arbeitsbranch sind auseinander gelaufen. Erst abrufen und zusammenführen; kein Force-Push.');
    }
    const range = baseHead ? `${baseHead}..${status.head}` : status.head;
    const commitCount = Number((await this.runGit(cwd, ['rev-list', '--count', range])).trim());
    const changedFiles = (await this.runGit(cwd, baseHead ? ['diff', '--name-only', '-z', `${baseHead}...${status.head}`]
      : ['ls-tree', '-r', '--name-only', '-z', status.head])).split('\0').filter(Boolean);
    if (!Number.isSafeInteger(commitCount) || commitCount < 0 || changedFiles.length > 500) fail('Veröffentlichung überschreitet die Vorschaugrenze.');
    return { baseHead, commitCount, changedFiles: changedFiles.map((path) => redactForWire(path, 400)) };
  }
}
