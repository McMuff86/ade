import { accessSync, constants, existsSync, lstatSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, posix, relative, resolve } from 'node:path';
import { isExecutionBackendId } from '../../shared/executionBackends';
import type { WorkspaceBundleRepository } from '../../shared/workspaceBundle';
import {
  ExecutionBackendService,
  decodeOutput,
} from '../execution/ExecutionBackendService';
import { normalizeRepositoryRemote } from './WorkspaceBundleExporter';
import type {
  WorkspaceAgentHomeProbeResult,
  WorkspaceRepositoryProbeResult,
  WorkspaceTargetMapping,
  WorkspaceTargetProbe,
} from './WorkspaceImportPlanner';

export interface TargetPathProbeOptions {
  hostPlatform?: NodeJS.Platform;
}

const WSL_HOME_PROBE = String.raw`
import json, os, sys
path = sys.argv[1]
if not os.path.isabs(path):
    raise SystemExit(2)
candidate = os.path.normpath(path)
exists = os.path.lexists(candidate)
if exists and (os.path.islink(candidate) or not os.path.isdir(candidate)):
    raise SystemExit(5)
occupancy = 'absent' if not exists else ('empty-directory' if not os.listdir(candidate) else 'nonempty-directory')
probe = candidate
if not exists:
    probe = os.path.dirname(candidate)
    if not os.path.isdir(probe):
        raise SystemExit(3)
if not os.path.isdir(probe) or not os.access(probe, os.W_OK | os.X_OK):
    raise SystemExit(4)
print(json.dumps({
    'canonicalPath': os.path.join(os.path.realpath(probe), os.path.relpath(candidate, probe)),
    'occupancy': occupancy,
}))
`;

export class TargetPathProbe implements WorkspaceTargetProbe {
  private readonly hostPlatform: NodeJS.Platform;
  private readonly execution: ExecutionBackendService;

  constructor(options: TargetPathProbeOptions = {}, execution?: ExecutionBackendService) {
    this.hostPlatform = options.hostPlatform ?? process.platform;
    this.execution = execution ?? new ExecutionBackendService(this.hostPlatform);
  }

  async canonicalPath(target: WorkspaceTargetMapping): Promise<WorkspaceAgentHomeProbeResult> {
    if (!isExecutionBackendId(target.backend)) {
      return {
        ok: false,
        reason: 'The occupied target path uses an invalid execution backend.',
        remediation: 'Repair the target profile before importing a workspace bundle.',
      };
    }
    if (target.backend !== 'native' && this.hostPlatform !== 'win32') {
      return {
        ok: false,
        reason: 'The occupied WSL path is not available from this ADE host.',
        remediation: 'Repair the target profile or run the import from Windows ADE.',
      };
    }
    try {
      return { ok: true, canonicalPath: await this.execution.canonicalPath(target.backend, target.path) };
    } catch (error) {
      return {
        ok: false,
        reason: 'The occupied target path could not be canonicalized.',
        remediation: error instanceof Error
          ? `Repair the target profile path. Verification detail: ${error.message.slice(0, 500)}`
          : 'Repair the target profile path before importing.',
      };
    }
  }

  async repository(
    _source: WorkspaceBundleRepository,
    target: WorkspaceTargetMapping,
  ): Promise<WorkspaceRepositoryProbeResult> {
    if (!isExecutionBackendId(target.backend)) {
      return {
        ok: false,
        reason: 'The selected repository mapping uses an invalid execution backend.',
        remediation: 'Choose native or an available wsl:<distribution> backend.',
      };
    }
    const backend = target.backend;
    if (backend !== 'native' && this.hostPlatform !== 'win32') {
      return {
        ok: false,
        reason: 'The selected WSL backend is not available from this ADE host.',
        remediation: 'Use native inside WSL/Linux or run Windows ADE for wsl:<distribution> targets.',
      };
    }
    try {
      const canonicalPath = await this.execution.canonicalPath(backend, target.path);
      const inside = await this.execution.run(backend, 'git', [
        '-C', canonicalPath, 'rev-parse', '--is-inside-work-tree',
      ], { timeoutMs: 15_000, maxBuffer: 64 * 1024 });
      if (inside.code !== 0 || decodeOutput(inside.stdout).trim() !== 'true') {
        return {
          ok: false,
          reason: 'The selected target path is not a Git worktree.',
          remediation: 'Choose an existing Git clone for this repository.',
        };
      }
      const rootResult = await this.execution.run(backend, 'git', [
        '-C', canonicalPath, 'rev-parse', '--show-toplevel',
      ], { timeoutMs: 15_000, maxBuffer: 64 * 1024 });
      if (rootResult.code !== 0) {
        return {
          ok: false,
          reason: 'The selected target path has no verifiable Git worktree root.',
          remediation: 'Choose the root directory of an existing Git worktree.',
        };
      }
      const worktreeRoot = await this.execution.canonicalPath(backend, decodeOutput(rootResult.stdout).trim());
      const comparable = (value: string): string => backend === 'native' && this.hostPlatform === 'win32'
        ? value.replace(/\//g, '\\').toLowerCase()
        : value;
      if (comparable(worktreeRoot) !== comparable(canonicalPath)) {
        return {
          ok: false,
          reason: 'The selected target path is inside a Git worktree but is not its root.',
          remediation: `Choose the Git worktree root instead: ${worktreeRoot}`,
        };
      }
      const commonResult = await this.execution.run(backend, 'git', [
        '-C', canonicalPath, 'rev-parse', '--path-format=absolute', '--git-common-dir',
      ], { timeoutMs: 15_000, maxBuffer: 64 * 1024 });
      if (commonResult.code !== 0 || !decodeOutput(commonResult.stdout).trim()) {
        return {
          ok: false,
          reason: 'The selected target path has no verifiable shared Git directory.',
          remediation: 'Choose a complete existing Git clone for this repository.',
        };
      }
      const commonGitDir = await this.execution.canonicalPath(
        backend, decodeOutput(commonResult.stdout).trim(),
      );
      const remote = await this.execution.run(backend, 'git', [
        '-C', canonicalPath, 'remote', 'get-url', 'origin',
      ], { timeoutMs: 15_000, maxBuffer: 64 * 1024 });
      const remoteIdentity = remote.code === 0
        ? normalizeRepositoryRemote(decodeOutput(remote.stdout).trim())
        : undefined;
      return {
        ok: true,
        canonicalPath,
        commonGitDir,
        ...(remoteIdentity ? { remoteIdentity } : {}),
      };
    } catch (error) {
      return {
        ok: false,
        reason: 'The selected target repository path could not be verified.',
        remediation: error instanceof Error
          ? `Choose an accessible existing Git clone. Verification detail: ${error.message.slice(0, 500)}`
          : 'Choose an accessible existing Git clone.',
      };
    }
  }

  async agentHome(target: WorkspaceTargetMapping): Promise<WorkspaceAgentHomeProbeResult> {
    if (!isExecutionBackendId(target.backend)) {
      return {
        ok: false,
        reason: 'The selected agent-home mapping uses an invalid execution backend.',
        remediation: 'Choose native or an available wsl:<distribution> backend.',
      };
    }
    const backend = target.backend;
    if (backend !== 'native' && this.hostPlatform !== 'win32') {
      return {
        ok: false,
        reason: 'The selected WSL backend is not available from this ADE host.',
        remediation: 'Use native inside WSL/Linux or run Windows ADE for wsl:<distribution> homes.',
      };
    }
    try {
      if (backend !== 'native') {
        if (!posix.isAbsolute(target.path)) throw new Error('target path must be POSIX-absolute');
        const output = await this.execution.text(backend, 'python3', [
          '-I', '-c', WSL_HOME_PROBE, target.path,
        ], { timeoutMs: 15_000, maxBuffer: 64 * 1024 });
        const parsed = JSON.parse(output) as { canonicalPath?: unknown; occupancy?: unknown };
        if (typeof parsed.canonicalPath !== 'string' || !posix.isAbsolute(parsed.canonicalPath)) {
          throw new Error('backend returned an invalid canonical path');
        }
        if (!['absent', 'empty-directory', 'nonempty-directory'].includes(String(parsed.occupancy))) {
          throw new Error('backend returned an invalid occupancy state');
        }
        return {
          ok: true,
          canonicalPath: posix.normalize(parsed.canonicalPath),
          occupancy: parsed.occupancy as 'absent' | 'empty-directory' | 'nonempty-directory',
        };
      }
      if (!isAbsolute(target.path)) throw new Error('target path must be absolute');
      const candidate = resolve(target.path);
      const candidateExists = existsSync(candidate);
      if (candidateExists && (lstatSync(candidate).isSymbolicLink() || !statSync(candidate).isDirectory())) {
        throw new Error('existing target must be a non-symlink directory');
      }
      const occupancy = candidateExists
        ? (readdirSync(candidate).length === 0 ? 'empty-directory' : 'nonempty-directory')
        : 'absent';
      const ancestor = candidateExists ? candidate : dirname(candidate);
      if (!candidateExists && !existsSync(ancestor)) {
        throw new Error('the immediate parent directory does not exist');
      }
      if (!statSync(ancestor).isDirectory()) throw new Error('nearest existing parent is not a directory');
      accessSync(ancestor, constants.W_OK | constants.X_OK);
      const canonicalAncestor = realpathSync.native(ancestor);
      const suffix = relative(ancestor, candidate);
      return {
        ok: true,
        canonicalPath: suffix ? join(canonicalAncestor, suffix) : canonicalAncestor,
        occupancy,
      };
    } catch (error) {
      return {
        ok: false,
        reason: 'The selected agent home cannot be created or written on this backend.',
        remediation: error instanceof Error
          ? `Choose an absolute path below a writable directory. Verification detail: ${error.message.slice(0, 500)}`
          : 'Choose an absolute path below a writable directory.',
      };
    }
  }
}
