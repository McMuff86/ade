/**
 * Turn a selected ADE profile directory into a bundle the importer can preview.
 *
 * This existed inline in the IPC handler and hardcoded `includeMemory: false`,
 * `includePhotos: false` and `repositoryRemote: () => null`. The import then
 * reported success while writing empty MEMORY.md/USER.md files and no photos,
 * and — because a repository without a remote identity skips the planner's
 * origin match (WorkspaceImportPlanner) — accepted any Git worktree the user
 * typed as the target for any source repository. None of it was surfaced.
 *
 * Every one of those was a limitation of the call site, not of the reader:
 * exportProfileWorkspaceBundle has always been able to carry memory and photos.
 */

import type { Repository } from '../../shared/types';
import type { WorkspaceBundleSourcePlatform } from '../../shared/workspaceBundle';
import { exportProfileWorkspaceBundle } from './ProfileMigrationSource';
import type { WorkspaceBundleExportResult } from './WorkspaceBundleExporter';

export interface ProfileImportPreviewOptions {
  sourcePlatform: WorkspaceBundleSourcePlatform;
  /**
   * The origin remote URL of a repository in the selected profile, exactly as
   * `git remote get-url origin` prints it — the exporter normalises it into the
   * comparable identity. Null when it cannot be read here, because a profile
   * copied from another machine names paths this host may not have; that costs
   * the origin-match check for that one repository and never fails the import.
   */
  resolveRemote(repository: Repository): Promise<string | null>;
  exportedAt?: string;
}

export async function buildProfileImportBundle(
  profilePath: string,
  options: ProfileImportPreviewOptions,
): Promise<WorkspaceBundleExportResult> {
  // Discovery pass. The remote callback is the only place the source
  // repositories — with the host paths the bundle deliberately never carries —
  // become visible, and it runs regardless of the resource flags. Memory and
  // photos stay off here so this costs a config read and nothing more.
  const discovered: Repository[] = [];
  exportProfileWorkspaceBundle(profilePath, {
    sourcePlatform: options.sourcePlatform,
    exportedAt: options.exportedAt,
    includeMemory: false,
    includePhotos: false,
    repositoryRemote: (repository) => {
      discovered.push(repository);
      return null;
    },
  });

  const remotes = new Map<string, string>();
  for (const repository of discovered) {
    const remote = await options.resolveRemote(repository);
    if (remote) remotes.set(repository.id, remote);
  }

  return exportProfileWorkspaceBundle(profilePath, {
    sourcePlatform: options.sourcePlatform,
    exportedAt: options.exportedAt,
    includeMemory: true,
    includePhotos: true,
    repositoryRemote: (repository) => remotes.get(repository.id) ?? null,
  });
}
