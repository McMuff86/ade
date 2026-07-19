/**
 * Enforce the saved ADE Codex roster through the public Electron IPC contract.
 *
 * Dry-run by default:
 *   pnpm run agents:codex
 * Apply after building:
 *   pnpm run agents:codex -- --apply
 *
 * Main orchestrators receive gpt-5.6-sol/xhigh; leads, workers and ordinary
 * identities receive gpt-5.6-sol/high. Every migrated identity uses bypass and
 * must materialize a durable AGENTS.md before the script succeeds. Apply also
 * archives stale CLAUDE.md files only when they contain ADE-owned fences and
 * no repository/user content.
 */

import { createHash } from 'node:crypto';
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import {
  AGENT_ROLE_END_MARKER,
  AGENT_ROLE_START_MARKER,
} from '../src/main/memory/agentInstructions';
import { inspectLegacyClaudeInstruction } from '../src/main/memory/legacyInstructions';

const MODEL = 'gpt-5.6-sol';
const apply = process.argv.slice(2).includes('--apply');
const root = join(__dirname, '..');
const appData = process.env['APPDATA'];
if (!appData) throw new Error('agents:codex: APPDATA is unavailable');
const userData = join(appData, 'ADE');
const configPath = join(userData, 'ade', 'config.json');
const buildPath = join(root, 'out', 'main', 'index.js');
if (!existsSync(buildPath)) throw new Error('agents:codex: run pnpm build first');
if (!existsSync(configPath)) throw new Error(`agents:codex: config not found at ${configPath}`);

function pathKey(path: string): string {
  const resolved = resolve(path);
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
}

function archiveLegacyInstruction(path: string, archiveDir: string, agentId: string): string {
  const digest = createHash('sha256').update(pathKey(path)).digest('hex').slice(0, 12);
  const archivePath = join(archiveDir, `${agentId}-${digest}-CLAUDE.md`);
  mkdirSync(archiveDir, { recursive: true });
  copyFileSync(path, archivePath, constants.COPYFILE_EXCL);
  const originalHash = createHash('sha256').update(readFileSync(path)).digest('hex');
  const archiveHash = createHash('sha256').update(readFileSync(archivePath)).digest('hex');
  if (originalHash !== archiveHash) {
    throw new Error(`agents:codex: legacy instruction backup verification failed for ${path}`);
  }
  unlinkSync(path);
  return archivePath;
}

function hasDurableAgentInstructions(
  target: { memoryDir: string; name: string },
  reasoningEffort: 'high' | 'xhigh',
): boolean {
  const path = join(target.memoryDir, 'AGENTS.md');
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 512 * 1024) return false;
    const content = readFileSync(path, 'utf8');
    return content.includes(AGENT_ROLE_START_MARKER)
      && content.includes(AGENT_ROLE_END_MARKER)
      && content.includes(`Identity: ${target.name}`)
      && content.includes(`model ${MODEL}`)
      && content.includes(`reasoning ${reasoningEffort}`);
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const app = await electron.launch({
    args: [buildPath],
    cwd: root,
    env: { ...process.env, ADE_USER_DATA_DIR: userData },
    timeout: 20_000,
  });

  try {
  const page = await app.firstWindow({ timeout: 20_000 });
  await page.waitForURL((url) => (
    url.protocol === 'file:' && url.pathname.endsWith('/out/renderer/index.html')
  ), { timeout: 20_000 });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => typeof window.ade?.invoke === 'function');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.hide());

  const preflight = await page.evaluate(async () => {
    const api = (window as unknown as {
      ade: { invoke: (channel: string, payload?: unknown) => Promise<unknown> };
    }).ade;
    const config = await api.invoke('config:get') as {
      agents: Array<{
        id: string;
        name: string;
        role?: string;
        runtime: string;
        permissionMode: string;
        codexModel?: string;
        codexReasoningEffort?: string;
        teamRole?: string;
        workspaceDir: string;
        homeWorkspaceDir?: string;
        memoryDir: string;
      }>;
      categories: Array<{ kind?: string; agents: string[] }>;
      workspaceBindings: Array<{
        agentId: string;
        workspaceDir: string;
        executionBackend?: string;
      }>;
      runParticipants: Array<{ agentId: string; role: string }>;
      runs: Array<{ id: string; name: string; status: string }>;
      runWorkspaceLeases: Array<{ status: string }>;
    };
    const sessions = await api.invoke('pty:list') as { sessions: Array<{ status: string }> };
    const orchestratorIds = new Set([
      ...config.categories.filter((category) => category.kind === 'orchestrator').flatMap((category) => category.agents),
      ...config.runParticipants.filter((participant) => participant.role === 'orchestrator').map((participant) => participant.agentId),
    ]);
    const targets = config.agents
        .filter((agent) => agent.runtime === 'claude' || agent.runtime === 'codex')
        .map((agent) => {
          const participantRoles = config.runParticipants
            .filter((participant) => participant.agentId === agent.id)
            .map((participant) => participant.role);
          const inferredRole = orchestratorIds.has(agent.id)
            ? 'orchestrator'
            : participantRoles.includes('lead')
              ? 'lead'
              : participantRoles.includes('worker')
                ? 'worker'
                : agent.teamRole;
          const workspaceDirs = [
            agent.workspaceDir,
            agent.homeWorkspaceDir,
            ...config.workspaceBindings
              .filter((binding) => (
                binding.agentId === agent.id
                && (!binding.executionBackend || binding.executionBackend === 'native')
              ))
              .map((binding) => binding.workspaceDir),
          ].filter((path): path is string => Boolean(path));
          return {
            ...agent,
            inferredRole,
            isOrchestrator: inferredRole === 'orchestrator',
            workspaceDirs: [...new Set(workspaceDirs)],
          };
        });
    return {
      targets,
      activeRuns: config.runs.filter((run) => ['running', 'planning', 'working', 'integrating', 'verifying'].includes(run.status)),
      activeLeases: config.runWorkspaceLeases.filter((lease) => lease.status === 'active').length,
      activeSessions: sessions.sessions.filter((session) => session.status === 'running').length,
    };
  });

  if (preflight.activeRuns.length || preflight.activeLeases || preflight.activeSessions) {
    throw new Error(
      `agents:codex: refusing migration with active state ` +
      `(runs=${preflight.activeRuns.length}, leases=${preflight.activeLeases}, sessions=${preflight.activeSessions})`,
    );
  }

  const targets = preflight.targets.map((target) => ({
    ...target,
    legacyInstructions: target.workspaceDirs
      .map((workspaceDir) => inspectLegacyClaudeInstruction(workspaceDir))
      .filter((inspection) => inspection.status === 'managed'),
  }));

  console.log(`${apply ? 'Applying' : 'Dry run'}: enforce ${targets.length} coding identities on Codex ${MODEL}`);
  const drift: string[] = [];
  for (const target of targets) {
    const effort = target.isOrchestrator ? 'xhigh' : 'high';
    const compliant = target.runtime === 'codex'
      && target.permissionMode === 'bypass'
      && target.codexModel === MODEL
      && target.codexReasoningEffort === effort
      && hasDurableAgentInstructions(target, effort)
      && target.legacyInstructions.length === 0;
    const legacy = target.legacyInstructions.length > 0
      ? `, ${target.legacyInstructions.length} ADE-owned legacy CLAUDE.md`
      : '';
    console.log(`- ${target.name}: ${compliant ? 'ok' : 'needs update'} — bypass, ${effort}, AGENTS.md${legacy}`);
    if (!compliant) drift.push(target.name);
  }
  if (!apply) {
    if (drift.length > 0) {
      throw new Error(`agents:codex: ${drift.length} identity/identities require --apply: ${drift.join(', ')}`);
    }
    console.log('Roster audit passed. No changes written.');
  } else {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = join(userData, 'ade', `config.pre-codex-roster.${stamp}.json`);
    copyFileSync(configPath, backupPath);

    const profiles = targets.map((target) => ({
      id: target.id,
      reasoningEffort: target.isOrchestrator ? 'xhigh' : 'high',
      teamRole: target.inferredRole,
    }));
    const migrated = await page.evaluate(async ({ profiles, model }) => {
      const api = (window as unknown as {
        ade: { invoke: (channel: string, payload?: unknown) => Promise<unknown> };
      }).ade;
      const config = await api.invoke('config:get') as {
        agents: Array<{
          id: string;
          name: string;
          role?: string;
          runtime: string;
          teamRole?: string;
        }>;
      };
      const updated: string[] = [];
      for (const profile of profiles) {
        const agent = config.agents.find((candidate) => candidate.id === profile.id);
        if (!agent || (agent.runtime !== 'claude' && agent.runtime !== 'codex')) {
          throw new Error(`migration target drifted: ${profile.id}`);
        }
        await api.invoke('agent:update', {
          id: agent.id,
          name: agent.name,
          role: agent.role,
          runtime: 'codex',
          permissionMode: 'bypass',
          codexModel: model,
          codexReasoningEffort: profile.reasoningEffort,
          teamRole: profile.teamRole,
        });
        updated.push(agent.name);
      }
      const after = await api.invoke('config:get') as {
        agents: Array<{
          id: string;
          runtime: string;
          permissionMode: string;
          codexModel?: string;
          codexReasoningEffort?: string;
        }>;
      };
      for (const profile of profiles) {
        const agent = after.agents.find((candidate) => candidate.id === profile.id);
        if (!agent || agent.runtime !== 'codex' || agent.permissionMode !== 'bypass' ||
            agent.codexModel !== model || agent.codexReasoningEffort !== profile.reasoningEffort) {
          throw new Error(`persisted Codex profile verification failed for ${profile.id}`);
        }
      }
      return updated;
    }, { profiles, model: MODEL });

    for (const target of targets) {
      const effort = target.isOrchestrator ? 'xhigh' : 'high';
      if (!hasDurableAgentInstructions(target, effort)) {
        throw new Error(`agents:codex: durable AGENTS.md verification failed for ${target.name}`);
      }
    }

    console.log(`Migrated and verified ${migrated.length} identities.`);
    console.log(`Backup: ${backupPath}`);

    const archiveDir = join(userData, 'ade', 'legacy-instruction-backups', stamp);
    const archived = new Set<string>();
    for (const target of targets) {
      for (const inspection of target.legacyInstructions) {
        const key = pathKey(inspection.path);
        if (archived.has(key)) continue;
        const current = inspectLegacyClaudeInstruction(dirname(inspection.path));
        if (current.status !== 'managed' || pathKey(current.path) !== key) {
          throw new Error(`agents:codex: legacy instruction changed during migration: ${inspection.path}`);
        }
        const archivePath = archiveLegacyInstruction(inspection.path, archiveDir, target.id);
        if (inspectLegacyClaudeInstruction(dirname(inspection.path)).status !== 'absent') {
          throw new Error(`agents:codex: legacy instruction remains after archive: ${inspection.path}`);
        }
        archived.add(key);
        console.log(`Archived ADE-owned legacy CLAUDE.md for ${target.name}: ${archivePath}`);
      }
    }
    if (archived.size > 0) console.log(`Archived and removed ${archived.size} ADE-owned legacy instruction file(s).`);
  }
  } finally {
    await app.close().catch(() => undefined);
  }
}

void main();
