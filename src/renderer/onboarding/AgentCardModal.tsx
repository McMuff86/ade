/**
 * Agent business card — opened by clicking the avatar in the rail. A large
 * portrait plus the identity's operative facts at a glance; editing stays in
 * Agent settings, one click away.
 */

import { NATIVE_EXECUTION_BACKEND } from '../../shared/executionBackends';
import { LAUNCH_PROFILES, resolveLaunchCommand } from '../../shared/runtimes';
import type { Agent } from '../../shared/types';
import { Avatar } from '../rail/Avatar';
import { useAppData } from '../stores/appdata';
import { useSessions } from '../stores/sessions';
import { useOnboarding } from './useOnboarding';
import { Modal } from './Modal';
import { AGENT_PERMISSION_MODES } from './agentOptions';

interface AgentCardModalProps {
  agent: Agent;
  onClose: () => void;
}

const TEAM_ROLE_LABELS: Record<string, string> = {
  orchestrator: 'Main orchestrator',
  lead: 'Team lead',
  worker: 'Worker',
};

function runtimeLine(agent: Agent): string {
  const label = LAUNCH_PROFILES[agent.runtime]?.label ?? agent.runtime;
  if (agent.runtime === 'codex') {
    const model = agent.codexModel ?? 'default model';
    const effort = agent.codexReasoningEffort ? ` · ${agent.codexReasoningEffort}` : '';
    return `${label} · ${model}${effort}`;
  }
  if (agent.runtime === 'ollama' && agent.ollamaModel) return `${label} · ${agent.ollamaModel}`;
  return label;
}

export function AgentCardModal({ agent, onClose }: AgentCardModalProps): React.ReactElement {
  const repositories = useAppData((s) => s.repositories);
  const sessions = useSessions((s) => s.sessions);
  const openAgentSettings = useOnboarding((s) => s.openAgentSettings);

  const running = Object.values(sessions)
    .filter((session) => session.agentId === agent.id && session.status === 'running').length;
  const homeIsWsl = Boolean(
    agent.homeExecutionBackend && agent.homeExecutionBackend !== NATIVE_EXECUTION_BACKEND,
  );
  const homeBackendLabel = homeIsWsl
    ? `WSL · ${agent.homeExecutionBackend!.slice('wsl:'.length)}`
    : 'Native';
  const defaultRepository = agent.defaultRepositoryId
    ? repositories.find((repository) => repository.id === agent.defaultRepositoryId)
    : undefined;
  const command = resolveLaunchCommand(agent).trim();
  const permission = AGENT_PERMISSION_MODES
    .find((mode) => mode.id === agent.permissionMode)?.label ?? agent.permissionMode;
  const dashboard = agent.dashboardCommand?.trim() || agent.dashboardUrl?.trim();

  const specs: Array<{ label: string; value: string; mono?: boolean }> = [
    { label: 'Runtime', value: runtimeLine(agent) },
    { label: 'Permissions', value: permission },
    { label: 'Start command', value: command || 'Default shell', mono: true },
    {
      label: 'Home',
      value: `${homeBackendLabel} · ${agent.homeWorkspaceDir ?? agent.workspaceDir}`,
      mono: true,
    },
    {
      label: 'Default repository',
      value: defaultRepository?.name ?? 'Portable (no default)',
    },
    ...(agent.teamRole
      ? [{ label: 'Team role', value: TEAM_ROLE_LABELS[agent.teamRole] ?? agent.teamRole }]
      : []),
    ...(dashboard
      ? [{
          label: 'Dashboard',
          value: `${dashboard}${agent.dashboardTarget === 'external' ? ' · browser' : ' · ADE window'}`,
          mono: true,
        }]
      : []),
  ];

  return (
    <Modal
      className="agent-card"
      title={agent.name}
      subtitle={agent.role}
      onClose={onClose}
      lead={(
        <div className="agent-card-portrait">
          <Avatar name={agent.name} photo={agent.photo} shape="round" size={112} seed={agent.id} />
          <span className={running > 0 ? 'agent-card-status on' : 'agent-card-status'}>
            {running > 0
              ? `${running} session${running === 1 ? '' : 's'} running`
              : 'idle'}
          </span>
        </div>
      )}
    >
      <dl className="agent-card-specs">
        {specs.map((spec) => (
          <div key={spec.label} className="agent-card-spec">
            <dt>{spec.label}</dt>
            <dd className={spec.mono ? 'mono' : undefined} title={spec.value}>{spec.value}</dd>
          </div>
        ))}
      </dl>

      <div className="modal-actions">
        <button type="button" className="btn" onClick={() => openAgentSettings(agent.id)}>
          Agent settings
        </button>
        <button type="button" className="btn primary" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
