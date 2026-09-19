import { t as translate } from "../../shared/i18n";
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { projectRootIdentity } from '../settings/ProjectDefaultsService';
import { randomUUID } from 'node:crypto';
import type { AdeConfig, SessionMeta } from '../../shared/types';
import type { MobileAdminCommand, MobileAdministrationValue } from '../../shared/remote';
import { createAgent, createCategory, spawnAgentTemplate, updateCategory } from '../identity';
import type { RepositoryScopeService } from '../repositories/RepositoryScopeService';
import { ExecutionBackendService } from '../execution/ExecutionBackendService';
import { assertNoLinks } from '../repositories/pathDiscipline';
import { redactForWire } from '../errors';
import { projectGit } from '../repositories/ProjectGitBoundary';

export type WorkspaceProvisionCommand = Extract<MobileAdminCommand, { operation: 'agent-create' | 'project-create' | 'workspace-prepare' | 'category-group' }>;
/** Host-selected settings and generated paths only; no remote filesystem or shell dispatch. */
export class RemoteWorkspaceService {
  constructor(private readonly store: { get(): AdeConfig; save(partial: Partial<AdeConfig>): AdeConfig },
    private readonly scopes: RepositoryScopeService, private readonly baseDir: string,
    private readonly sessions: () => SessionMeta[], private readonly execution = new ExecutionBackendService()) {}

  async execute(command: WorkspaceProvisionCommand, authorize: () => void = () => undefined): Promise<MobileAdministrationValue> {
    authorize();
    if (command.operation === 'category-group') {
      const category = this.store.get().categories.find((item) => item.id === command.input.categoryId);
      if (!category) throw new Error(translate("ade: Category is no longer available."));
      updateCategory(this.store, { id: category.id, name: category.name, navigationGroup: command.input.navigationGroup });
      return {};
    }
    if (command.operation === 'agent-create') {
      const input = command.input; const config = this.store.get();
      if (config.agents.length >= 200) throw new Error(translate("ade: Maximum of 200 agents. Manage no longer needed agents on the PC."));
      const source = input.source.kind === 'agent' ? config.agents.find((item) => item.id === input.source.id)
        : input.source.kind === 'template' ? config.agentTemplates.find((item) => item.id === input.source.id) : undefined;
      if (!source && !(input.source.kind === 'runtime' && input.source.id === 'codex')) throw new Error(translate("ade: Agent template is no longer available."));
      if (input.categoryId && !config.categories.some((item) => item.id === input.categoryId)) throw new Error(translate("ade: Agent group is no longer available."));
      assertNoLinks(join(this.baseDir, 'agents'));
      const categoryId = input.categoryId ?? config.categories[0]?.id ?? (await createCategory(this.store, { name: 'Remote Agents' }, this.scopes)).id;
      const agent = input.source.kind === 'template'
        ? await spawnAgentTemplate(this.store, { templateId: input.source.id, categoryId, name: input.name, defaultRepositoryId: null }, this.scopes, { baseDir: this.baseDir })
        : await createAgent(this.store, { categoryId, name: input.name, defaultRepositoryId: null,
          runtime: source?.runtime ?? 'codex', permissionMode: source?.permissionMode ?? 'default', role: source?.role,
          customCommand: source?.customCommand, ollamaModel: source?.ollamaModel, ollamaMode: source?.ollamaMode, ollamaHarness: source?.ollamaHarness, claudeModel: source?.claudeModel, codexModel: source?.codexModel,
          codexReasoningEffort: source?.codexReasoningEffort, grokModel: source?.grokModel, grokReasoningEffort: source?.grokReasoningEffort,
        }, this.scopes, { baseDir: this.baseDir });
      return { created: { kind: 'agent', id: agent.id } };
    }
    if (command.operation === 'project-create') {
      // The legacy catalog identity importer inherits its environment. Reject
      // Git overrides before making a directory rather than importing another repo.
      const checkGitEnvironment = () => {
        if (Object.keys(process.env).some((key) => /^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG(?:_.*)?)$/i.test(key))) {
          throw new Error(translate("ade: Project launch blocked by Git environment variables. Start ADE on the PC without Git overrides."));
        }
      };
      checkGitEnvironment();
      if (this.store.get().repositories.length >= 100) throw new Error(translate("ade: Maximum of 100 projects. Manage projects on the PC."));
      const defaults = this.store.get().settings.projectDefaults;
      const checkRoot = () => {
        authorize();
        checkGitEnvironment();
        if (defaults && projectRootIdentity(defaults.rootPath) !== defaults.rootIdentity) {
          throw new Error(translate("ade: The project root folder has changed. Select again in settings on the PC."));
        }
      };
      checkRoot();
      const root = defaults?.rootPath ?? join(this.baseDir, 'projects');
      if (!defaults) { assertNoLinks(root); mkdirSync(root, { recursive: true, mode: 0o700 }); }
      const directory = join(root, defaults ? projectDirectoryName(command.input.name) : randomUUID());
      assertNoLinks(directory);
      try { mkdirSync(directory, { mode: 0o700 }); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(translate("ade: This project folder already exists. Choose another project name."));
        throw error;
      }
      checkRoot(); assertNoLinks(directory);
      const git = async (args: string[]) => {
        checkRoot(); assertNoLinks(directory); assertNoLinks(join(directory, '.git'));
        return projectGit(directory, ['-c', 'init.templateDir=', ...args], 20_000);
      };
      await git(['init', '--initial-branch=main']);
      await git(['-c', 'user.name=ADE', '-c', 'user.email=ade@localhost', '-c', 'commit.gpgSign=false', 'commit', '--allow-empty', '-m', 'Initialize ADE project']);
      checkRoot();
      const repository = await this.scopes.importRepository(directory, command.input.name, 'native', () => { checkRoot(); assertNoLinks(directory); });
      return { created: { kind: 'repository', id: repository.id } };
    }
    const { agentId, repositoryId } = command.input;
    const config = this.store.get();
    const repository = config.repositories.find((item) => item.id === repositoryId);
    if (!repository || repository.executionBackend !== 'native') throw new Error(translate("ade: Remote workspace preparation requires a native project."));
    assertNoLinks(repository.rootPath); assertNoLinks(repository.commonGitDir);
    const existing = config.workspaceBindings.find((item) => item.agentId === agentId && item.repositoryId === repositoryId);
    if (existing) {
      assertNoLinks(existing.workspaceDir);
      const same = (path: string | undefined) => !!path && this.execution.samePath('native', path, existing.workspaceDir);
      if (config.runWorkspaceLeases.some((item) => (item.workspaceBindingId === existing.id || same(item.workspaceDir)) && item.status === 'active')
        || this.sessions().some((item) => (item.workspaceBindingId === existing.id || same(item.workspaceDir)) && item.status === 'running')) {
        throw new Error(translate("ade: This workspace is in use right now. Complete ongoing work first."));
      }
    }
    const scope = await this.scopes.resolve(agentId, { repositoryId });
    if (!scope.workspaceBindingId) throw new Error(translate("ade: Workspace could not be confirmed."));
    assertNoLinks(scope.workspaceDir);
    return { created: { kind: 'workspace', id: scope.workspaceBindingId, repositoryId, agentId, branch: redactForWire(scope.branch, 300) } };
  }
}

export function projectDirectoryName(name: string): string {
  if (/[\\/:\x00-\x1f]/.test(name)) throw new Error(translate("ade: The project name must not contain a path."));
  const slug = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  if (!slug || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(slug)) throw new Error(translate("ade: Choose another project name."));
  return slug;
}
