import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { projectRootIdentity } from '../settings/ProjectDefaultsService';
import { randomUUID } from 'node:crypto';
import type { AdeConfig, SessionMeta } from '../../shared/types';
import type { MobileAdminCommand, MobileAdministrationValue } from '../../shared/remote';
import { createAgent, createCategory, spawnAgentTemplate } from '../identity';
import type { RepositoryScopeService } from '../repositories/RepositoryScopeService';
import { ExecutionBackendService } from '../execution/ExecutionBackendService';
import { assertNoLinks } from '../repositories/pathDiscipline';
import { redactForWire } from '../errors';
import { hostNullDevice } from '../platform';

export type WorkspaceProvisionCommand = Extract<MobileAdminCommand, { operation: 'agent-create' | 'project-create' | 'workspace-prepare' }>;
/** Host-selected settings and generated paths only; no remote filesystem or shell dispatch. */
export class RemoteWorkspaceService {
  constructor(private readonly store: { get(): AdeConfig; save(partial: Partial<AdeConfig>): AdeConfig },
    private readonly scopes: RepositoryScopeService, private readonly baseDir: string,
    private readonly sessions: () => SessionMeta[], private readonly execution = new ExecutionBackendService()) {}

  async execute(command: WorkspaceProvisionCommand): Promise<MobileAdministrationValue> {
    if (command.operation === 'agent-create') {
      const input = command.input; const config = this.store.get();
      if (config.agents.length >= 200) throw new Error('ade: Maximal 200 Agents. Nicht mehr benötigte Agents am PC verwalten.');
      const source = input.source.kind === 'agent' ? config.agents.find((item) => item.id === input.source.id)
        : input.source.kind === 'template' ? config.agentTemplates.find((item) => item.id === input.source.id) : undefined;
      if (!source && !(input.source.kind === 'runtime' && input.source.id === 'codex')) throw new Error('ade: Agent-Vorlage ist nicht mehr verfügbar.');
      if (input.categoryId && !config.categories.some((item) => item.id === input.categoryId)) throw new Error('ade: Agent-Gruppe ist nicht mehr verfügbar.');
      assertNoLinks(join(this.baseDir, 'agents'));
      const categoryId = input.categoryId ?? config.categories[0]?.id ?? (await createCategory(this.store, { name: 'Remote Agents' }, this.scopes)).id;
      const agent = input.source.kind === 'template'
        ? await spawnAgentTemplate(this.store, { templateId: input.source.id, categoryId, name: input.name, defaultRepositoryId: null }, this.scopes, { baseDir: this.baseDir })
        : await createAgent(this.store, { categoryId, name: input.name, defaultRepositoryId: null,
          runtime: source?.runtime ?? 'codex', permissionMode: source?.permissionMode ?? 'default', role: source?.role,
          customCommand: source?.customCommand, ollamaModel: source?.ollamaModel, claudeModel: source?.claudeModel, codexModel: source?.codexModel,
          codexReasoningEffort: source?.codexReasoningEffort, grokModel: source?.grokModel, grokReasoningEffort: source?.grokReasoningEffort,
        }, this.scopes, { baseDir: this.baseDir });
      return { created: { kind: 'agent', id: agent.id } };
    }
    if (command.operation === 'project-create') {
      if (this.store.get().repositories.length >= 100) throw new Error('ade: Maximal 100 Projekte. Projekte am PC verwalten.');
      const defaults = this.store.get().settings.projectDefaults;
      const checkRoot = () => {
        if (defaults && projectRootIdentity(defaults.rootPath) !== defaults.rootIdentity) {
          throw new Error('ade: Der Projekt-Stammordner hat sich geändert. In Settings am PC erneut auswählen.');
        }
      };
      checkRoot();
      const root = defaults?.rootPath ?? join(this.baseDir, 'projects');
      if (!defaults) { assertNoLinks(root); mkdirSync(root, { recursive: true, mode: 0o700 }); }
      const directory = join(root, defaults ? projectDirectoryName(command.input.name) : randomUUID());
      assertNoLinks(directory);
      try { mkdirSync(directory, { mode: 0o700 }); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('ade: Dieser Projektordner existiert bereits. Einen anderen Projektnamen wählen.');
        throw error;
      }
      checkRoot(); assertNoLinks(directory);
      const git = async (args: string[]) => {
        checkRoot(); assertNoLinks(directory); assertNoLinks(join(directory, '.git'));
        return this.execution.checked('native', 'git', ['-c', `core.hooksPath=${hostNullDevice()}`, '-c', 'init.templateDir=', ...args],
          { cwd: directory, timeoutMs: 20_000, maxBuffer: 64 * 1024, env: { GIT_TERMINAL_PROMPT: '0' } });
      };
      await git(['init', '--initial-branch=main']);
      await git(['-c', 'user.name=ADE', '-c', 'user.email=ade@localhost', '-c', 'commit.gpgSign=false', 'commit', '--allow-empty', '-m', 'Initialize ADE project']);
      checkRoot();
      const repository = await this.scopes.importRepository(directory, command.input.name);
      return { created: { kind: 'repository', id: repository.id } };
    }
    const { agentId, repositoryId } = command.input;
    const config = this.store.get();
    const repository = config.repositories.find((item) => item.id === repositoryId);
    if (!repository || repository.executionBackend !== 'native') throw new Error('ade: Remote-Workspace-Vorbereitung benötigt ein natives Projekt.');
    assertNoLinks(repository.rootPath); assertNoLinks(repository.commonGitDir);
    const existing = config.workspaceBindings.find((item) => item.agentId === agentId && item.repositoryId === repositoryId);
    if (existing) {
      assertNoLinks(existing.workspaceDir);
      const same = (path: string | undefined) => !!path && this.execution.samePath('native', path, existing.workspaceDir);
      if (config.runWorkspaceLeases.some((item) => (item.workspaceBindingId === existing.id || same(item.workspaceDir)) && item.status === 'active')
        || this.sessions().some((item) => (item.workspaceBindingId === existing.id || same(item.workspaceDir)) && item.status === 'running')) {
        throw new Error('ade: Dieser Workspace wird gerade verwendet. Laufende Arbeit zuerst abschliessen.');
      }
    }
    const scope = await this.scopes.resolve(agentId, { repositoryId });
    if (!scope.workspaceBindingId) throw new Error('ade: Workspace konnte nicht bestätigt werden.');
    assertNoLinks(scope.workspaceDir);
    return { created: { kind: 'workspace', id: scope.workspaceBindingId, repositoryId, agentId, branch: redactForWire(scope.branch, 300) } };
  }
}

export function projectDirectoryName(name: string): string {
  if (/[\\/:\x00-\x1f]/.test(name)) throw new Error('ade: Der Projektname darf keinen Pfad enthalten.');
  const slug = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  if (!slug || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(slug)) throw new Error('ade: Einen anderen Projektnamen wählen.');
  return slug;
}
