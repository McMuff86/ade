import { t as translate } from "../../shared/i18n";
import { lstatSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, parse, resolve } from 'node:path';
import type { AdeConfig } from '../../shared/types';
import type { ProjectDefaultsInput, ProjectDefaultsView } from '../../shared/projectDefaults';
import { assertNoLinks } from '../repositories/pathDiscipline';

export function projectRootIdentity(path: string): string {
  assertNoLinks(path);
  const stat = lstatSync(path);
  if (!stat.isDirectory()) throw new Error(translate("ade: The project root folder must be an existing folder."));
  return `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
}

export class ProjectDefaultsService {
  constructor(private readonly store: { get(): AdeConfig; save(value: Partial<AdeConfig>): AdeConfig }) {}
  get(): ProjectDefaultsView {
    const defaults = this.store.get().settings.projectDefaults;
    return { rootPath: defaults?.rootPath ?? join(homedir(), 'repos'), agentId: defaults?.agentId ?? null, configured: !!defaults };
  }
  save(input: ProjectDefaultsInput): ProjectDefaultsView {
    if (!isAbsolute(input.rootPath) || input.rootPath.includes('\0') || input.rootPath.length > 4096) {
      throw new Error(translate("ade: Choose an absolute native project root folder."));
    }
    const path = resolve(input.rootPath);
    if (path === parse(path).root) throw new Error(translate("ade: Choose a project folder instead of the drive root."));
    const identity = projectRootIdentity(path);
    const rootPath = realpathSync.native(path);
    if (projectRootIdentity(rootPath) !== identity) throw new Error(translate("ade: The folder has changed. Select again."));
    if (input.agentId && !this.store.get().agents.some((agent) => agent.id === input.agentId && agent.runtime === 'codex'
      && (!agent.homeExecutionBackend || agent.homeExecutionBackend === 'native'))) {
      throw new Error(translate("ade: Select a native Codex profile."));
    }
    this.store.save({ settings: { ...this.store.get().settings,
      projectDefaults: { rootPath, rootIdentity: identity, ...(input.agentId ? { agentId: input.agentId } : {}) } } });
    return this.get();
  }
}
