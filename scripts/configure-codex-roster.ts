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
 * must materialize a durable AGENTS.md before the script succeeds.
 */

import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { _electron as electron } from 'playwright';

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

async function main(): Promise<void> {
  const app = await electron.launch({
    args: [buildPath],
    cwd: root,
    env: { ...process.env, ADE_USER_DATA_DIR: userData },
    timeout: 20_000,
  });

  try {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.hide());
  const page = await app.firstWindow({ timeout: 20_000 });
  await page.waitForLoadState('domcontentloaded');

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
        teamRole?: string;
      }>;
      categories: Array<{ kind?: string; agents: string[] }>;
      runParticipants: Array<{ agentId: string; role: string }>;
      runs: Array<{ id: string; name: string; status: string }>;
      runWorkspaceLeases: Array<{ status: string }>;
    };
    const sessions = await api.invoke('pty:list') as { sessions: Array<{ status: string }> };
    const orchestratorIds = new Set([
      ...config.categories.filter((category) => category.kind === 'orchestrator').flatMap((category) => category.agents),
      ...config.runParticipants.filter((participant) => participant.role === 'orchestrator').map((participant) => participant.agentId),
    ]);
    return {
      targets: config.agents
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
          return { ...agent, inferredRole, isOrchestrator: inferredRole === 'orchestrator' };
        }),
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

  console.log(`${apply ? 'Applying' : 'Dry run'}: enforce ${preflight.targets.length} coding identities on Codex ${MODEL}`);
  for (const target of preflight.targets) {
    const effort = target.isOrchestrator ? 'xhigh' : 'high';
    console.log(`- ${target.name}: bypass, ${effort}`);
  }
  if (!apply) {
    console.log('No changes written. Re-run with --apply.');
  } else {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = join(userData, 'ade', `config.pre-codex-roster.${stamp}.json`);
    copyFileSync(configPath, backupPath);

    const profiles = preflight.targets.map((target) => ({
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
        const files = await api.invoke('fs:agentFiles', { agentId: agent.id }) as Array<{ name: string }>;
        if (!files.some((file) => file.name === 'AGENTS.md')) {
          throw new Error(`AGENTS.md was not materialized for ${agent.name}`);
        }
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

    console.log(`Migrated and verified ${migrated.length} identities.`);
    console.log(`Backup: ${backupPath}`);
  }
  } finally {
    await app.close().catch(() => undefined);
  }
}

void main();
