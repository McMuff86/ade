import { closeSync, fsyncSync, openSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AdeConfig } from '../../shared/types';
import type { CoordinatorActionInput } from '../../shared/coordinatorActions';
import { validCoordinatorActionInput } from '../../shared/coordinatorActions';
import { t as translate } from '../../shared/i18n';
import type { RemoteWorkspaceService } from '../application/RemoteWorkspaceService';
import { projectDirectoryName } from '../application/RemoteWorkspaceService';
import { projectRootIdentity } from '../settings/ProjectDefaultsService';
import { assertNoLinks } from '../repositories/pathDiscipline';
import { projectGit } from '../repositories/ProjectGitBoundary';
import { ghCommand } from '../repositories/ProjectPublishService';
import { workspaceOperations } from '../repositories/WorkspaceOperationGate';
import { redactedErrorMessage } from '../errors';

/** Only new host-selected repositories; model input never supplies paths or argv.
 * The parent action is durable before entry. Failed/ambiguous creation is never
 * retried automatically and never deletes the user's partial project. */
export class ConversationProjectService {
  constructor(private readonly config: { get(): AdeConfig }, private readonly provision: RemoteWorkspaceService,
    private readonly changed: () => void, private readonly github: typeof ghCommand = ghCommand,
    private readonly git: typeof projectGit = projectGit) {}

  async create(input: Extract<CoordinatorActionInput, { kind: 'project' }>, authorize: () => void, reserved: (id: string) => void): Promise<string> {
    if (!validCoordinatorActionInput(input)) throw new Error(translate('Invalid ADE Action Proposal.'));
    return workspaceOperations.mutate(async () => {
      authorize(); projectDirectoryName(input.name);
      if (this.config.get().repositories.some(r => r.name.trim().toLocaleLowerCase() === input.name.trim().toLocaleLowerCase())) {
        throw new Error(translate('A project with this name already exists. Use that project or propose a new name.'));
      }
      // Read account availability before creating local state; never expose tokens.
      let owner = '';
      if (input.githubRepo) {
        const account = JSON.parse(await this.github(process.cwd(), ['api', 'user'])); authorize();
        if (typeof account.login !== 'string' || !/^[A-Za-z0-9-]{1,39}$/.test(account.login)) throw new Error(translate('GitHub account could not be confirmed.'));
        owner = account.login;
      }
      const result = await this.provision.execute({ operation: 'project-create', input: { name: input.name } }, authorize);
      const repository = this.config.get().repositories.find(r => r.id === result.created?.id && r.verified && r.executionBackend === 'native');
      if (!repository) throw new Error(translate('Project creation could not be confirmed.'));
      reserved(repository.id);
      authorize();
      const root = repository.rootPath;
      const identity = projectRootIdentity(root); const gitIdentity = projectRootIdentity(repository.commonGitDir);
      const check = () => {
        authorize(); assertNoLinks(root); assertNoLinks(join(root, '.git')); assertNoLinks(repository.commonGitDir);
        if (projectRootIdentity(root) !== identity || projectRootIdentity(repository.commonGitDir) !== gitIdentity
          || this.config.get().repositories.find(r => r.id === repository.id)?.rootPath !== root) throw new Error(translate('Project folder changed during creation.'));
      };
      const files = [['AGENTS.md', input.agentsMd], ['PROJECT.md', input.context]] as const;
      for (const [name, content] of files) {
        check(); const path = join(root, name); assertNoLinks(path);
        const fd = openSync(path, 'wx', 0o600);
        try { writeFileSync(fd, content); fsyncSync(fd); } finally { closeSync(fd); }
      }
      check(); await this.git(root, ['add', '--', 'AGENTS.md', 'PROJECT.md']);
      check(); await this.git(root, ['-c', 'user.name=ADE', '-c', 'user.email=ade@localhost', '-c', 'commit.gpgSign=false', 'commit', '-m', 'Add project context and agent instructions']);
      check();
      if (input.githubRepo) {
        const created = JSON.parse(await this.github(root, ['api', '--method', 'POST', 'user/repos', '--input', '-'],
          JSON.stringify({ name: input.githubRepo, private: true, auto_init: false })));
        check();
        const fullName = `${owner}/${input.githubRepo}`;
        if (created.private !== true || !Number.isSafeInteger(created.id) || created.id <= 0
          || typeof created.full_name !== 'string' || created.full_name.toLowerCase() !== fullName.toLowerCase()) {
          throw new Error(translate('Private GitHub repository could not be confirmed. Check GitHub before trying again.'));
        }
        const verified = JSON.parse(await this.github(root, ['api', `repos/${fullName}`])); check();
        if (verified.private !== true || verified.id !== created.id || typeof verified.full_name !== 'string'
          || verified.full_name.toLowerCase() !== fullName.toLowerCase()) throw new Error(translate('Private GitHub repository could not be confirmed. Check GitHub before trying again.'));
        const remoteUrl = `https://github.com/${fullName}.git`;
        await this.git(root, ['remote', 'add', 'origin', remoteUrl]); check();
        const pushUrl = (await this.git(root, ['remote', 'get-url', '--push', '--all', 'origin'])).trim(); check();
        if (pushUrl !== remoteUrl) throw new Error(translate('Private GitHub repository could not be confirmed. Check GitHub before trying again.'));
        await this.git(root, ['push', '--set-upstream', 'origin', 'main'], 60_000); check();
      }
      try { this.changed(); } catch (error) { console.warn('[ade] project creation notification failed:', redactedErrorMessage(error)); }
      return repository.id;
    });
  }
}
