/** Main-owned project checkout identity. No agent, role, memory or launch defaults. */
export interface ProjectWorkspace {
  id: string;
  repositoryId: string;
  workspaceDir: string;
  directoryIdentity: string;
  gitDirectory: string;
  gitDirectoryIdentity: string;
  gitPointerIdentity: string;
  commonGitIdentity: string;
  kind: 'checkout' | 'worktree';
  createdAt: number;
}
