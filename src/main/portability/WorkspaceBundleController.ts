import {
  closeSync, constants, fstatSync, lstatSync, openSync, readSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { managedProfileSupport } from './managed/ManagedHost';
import type {
  WorkspaceBundleMappings,
  WorkspaceBundlePreviewItem,
  WorkspaceBundlePreviewResult,
} from '../../shared/ipc';
import {
  parseSerializedWorkspaceBundle,
  WORKSPACE_BUNDLE_MAX_BYTES,
  type AdeWorkspaceBundleV1,
} from '../../shared/workspaceBundle';
import {
  planWorkspaceImport,
  type WorkspaceImportMappings,
  type WorkspaceImportPlan,
  type WorkspaceImportPlanItem,
  type WorkspaceTargetProbe,
} from './WorkspaceImportPlanner';
import {
  WorkspaceImportService,
  type WorkspaceImportConfigStore,
  type WorkspaceImportReceipt,
} from './WorkspaceImportService';

interface CachedPreview {
  plan: WorkspaceImportPlan;
  mappings: WorkspaceImportMappings;
  createdAt: number;
}

const PREVIEW_TTL_MS = 10 * 60 * 1_000;

export interface WorkspaceBundleControllerOptions {
  store: WorkspaceImportConfigStore;
  probe: WorkspaceTargetProbe;
  importer: WorkspaceImportService;
  hostPlatform: NodeJS.Platform;
}

function readBundleFile(path: string): string {
  const before = lstatSync(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== BigInt(1)
      || before.size > BigInt(WORKSPACE_BUNDLE_MAX_BYTES)) {
    throw new Error('workspace import: bundle must be a bounded singly-linked regular file');
  }
  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
  const fd = openSync(path, constants.O_RDONLY | noFollow);
  try {
    const opened = fstatSync(fd, { bigint: true });
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino
        || opened.size !== before.size || opened.size > BigInt(WORKSPACE_BUNDLE_MAX_BYTES)) {
      throw new Error('workspace import: bundle changed while it was being opened');
    }
    const bytes = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (count === 0) throw new Error('workspace import: bundle ended before its verified size');
      offset += count;
    }
    const after = fstatSync(fd, { bigint: true });
    if (after.size !== opened.size || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs) {
      throw new Error('workspace import: bundle changed while it was being read');
    }
    return bytes.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

function viewItem(item: WorkspaceImportPlanItem): WorkspaceBundlePreviewItem {
  return {
    sourceId: item.sourceId,
    name: item.name,
    status: item.status,
    ...(item.reason ? { reason: item.reason } : {}),
    ...(item.remediation ? { remediation: item.remediation } : {}),
    ...(item.targetId ? { targetId: item.targetId } : {}),
    ...(item.target ? { target: item.target } : {}),
    ...(item.canonicalPath ? { canonicalPath: item.canonicalPath } : {}),
  };
}

export class WorkspaceBundleController {
  private readonly options: WorkspaceBundleControllerOptions;
  private readonly previews = new Map<string, CachedPreview>();

  constructor(options: WorkspaceBundleControllerOptions) {
    this.options = options;
  }

  async previewFile(path: string, mappings: WorkspaceBundleMappings): Promise<WorkspaceBundlePreviewResult> {
    return this.previewBundle(parseSerializedWorkspaceBundle(readBundleFile(path)), mappings);
  }

  async previewBundle(bundle: AdeWorkspaceBundleV1, mappings: WorkspaceBundleMappings): Promise<WorkspaceBundlePreviewResult> {
    const now = Date.now();
    for (const [id, cached] of Array.from(this.previews.entries())) {
      if (now - cached.createdAt > PREVIEW_TTL_MS) this.previews.delete(id);
    }
    const plan = await planWorkspaceImport(
      bundle,
      this.options.store.get(),
      mappings,
      this.options.probe,
      { hostPlatform: this.options.hostPlatform },
    );
    const sessionId = randomUUID();
    this.previews.set(sessionId, { plan, mappings: structuredClone(mappings), createdAt: now });
    while (this.previews.size > 4) this.previews.delete(this.previews.keys().next().value!);
    const support = managedProfileSupport(this.options.hostPlatform);
    const notices = structuredClone(plan.bundle.notices);
    if (support.notice) {
      // Reported on every host that is not descriptor-anchored, including the
      // ones that CAN apply: the user is told what the weaker guarantee is
      // rather than the button silently doing less than it does on Linux.
      notices.push({ ...support.notice, subjectType: 'bundle' });
    }
    return {
      sessionId,
      token: plan.token,
      canApplyFully: plan.canApplyFully && support.canApply,
      notices,
      repositories: plan.repositories.map(viewItem),
      categories: plan.categories.map(viewItem),
      agents: plan.agents.map(viewItem),
      agentHomes: plan.agentHomes.map(viewItem),
      agentTemplates: plan.agentTemplates.map(viewItem),
    };
  }

  async apply(sessionId: string, token: string): Promise<WorkspaceImportReceipt> {
    const cached = this.previews.get(sessionId);
    if (!cached || Date.now() - cached.createdAt > PREVIEW_TTL_MS || cached.plan.token !== token) {
      if (cached) this.previews.delete(sessionId);
      throw new Error('workspace import: preview session is missing, expired, or does not match the token');
    }
    // The gate the preview advertised, enforced here too. Until now it held only
    // because the renderer disables the button and the write layer happened to
    // fail on an unsupported host — neither is a check.
    if (!managedProfileSupport(this.options.hostPlatform).canApply) {
      throw new Error('workspace import: this host cannot apply a workspace import');
    }
    try {
      return await this.options.importer.apply(cached.plan, cached.mappings);
    } finally {
      this.previews.delete(sessionId);
    }
  }
}
