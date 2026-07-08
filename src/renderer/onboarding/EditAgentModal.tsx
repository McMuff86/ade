/**
 * Existing-agent settings: runtime, permission mode and launch command can be
 * changed after creation without touching the agent's workspace or memory.
 */

import { useState } from 'react';
import { resolveLaunchCommand } from '../../shared/runtimes';
import type { Agent, PermissionMode, RuntimeId } from '../../shared/types';
import { useAppData } from '../stores/appdata';
import { Modal } from './Modal';
import { AGENT_PERMISSION_MODES, AGENT_RUNTIMES } from './agentOptions';

interface EditAgentModalProps {
  agent: Agent;
  onClose: () => void;
}

export function EditAgentModal({ agent, onClose }: EditAgentModalProps): React.ReactElement {
  const updateAgent = useAppData((s) => s.updateAgent);

  const [name, setName] = useState(agent.name);
  const [role, setRole] = useState(agent.role ?? '');
  const [runtime, setRuntime] = useState<RuntimeId>(agent.runtime);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(agent.permissionMode);
  const [ollamaModel, setOllamaModel] = useState(agent.ollamaModel ?? '');
  const [customCommand, setCustomCommand] = useState(agent.customCommand ?? '');
  const [busy, setBusy] = useState(false);

  const defaultCommand = resolveLaunchCommand({
    runtime,
    permissionMode,
    customCommand: undefined,
    ollamaModel: runtime === 'ollama' ? ollamaModel.trim() || undefined : undefined,
  });
  const commandPlaceholder = defaultCommand.trim().length > 0 ? defaultCommand : 'default shell';
  const canSave = name.trim().length > 0 && !busy;

  const submit = async (): Promise<void> => {
    if (!canSave) return;
    setBusy(true);
    try {
      await updateAgent({
        id: agent.id,
        name: name.trim(),
        role: role.trim() || undefined,
        runtime,
        permissionMode,
        customCommand: customCommand.trim() || undefined,
        ollamaModel: runtime === 'ollama' && ollamaModel.trim() ? ollamaModel.trim() : undefined,
      });
      onClose();
    } catch (err) {
      console.error('[ade] update agent failed:', err);
      setBusy(false);
    }
  };

  return (
    <Modal title="Agent settings" subtitle="Configure how new terminal sessions start." onClose={onClose}>
      <div className="field">
        <label htmlFor="edit-agent-name">NAME</label>
        <input
          id="edit-agent-name"
          type="text"
          value={name}
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="edit-agent-role">ROLE</label>
        <input
          id="edit-agent-role"
          type="text"
          value={role}
          autoComplete="off"
          placeholder="e.g. Frontend & theme"
          onChange={(e) => setRole(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="edit-agent-runtime">RUNTIME</label>
        <select
          id="edit-agent-runtime"
          value={runtime}
          onChange={(e) => setRuntime(e.target.value as RuntimeId)}
        >
          {AGENT_RUNTIMES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      {runtime === 'ollama' ? (
        <div className="field">
          <label htmlFor="edit-agent-model">MODEL</label>
          <input
            id="edit-agent-model"
            type="text"
            value={ollamaModel}
            autoComplete="off"
            placeholder="e.g. llama3.3"
            onChange={(e) => setOllamaModel(e.target.value)}
          />
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="edit-agent-perm">PERMISSION MODE</label>
        <select
          id="edit-agent-perm"
          value={permissionMode}
          onChange={(e) => setPermissionMode(e.target.value as PermissionMode)}
        >
          {AGENT_PERMISSION_MODES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="edit-agent-cmd">START COMMAND</label>
        <input
          id="edit-agent-cmd"
          type="text"
          value={customCommand}
          autoComplete="off"
          placeholder={commandPlaceholder}
          onChange={(e) => setCustomCommand(e.target.value)}
        />
      </div>

      <div className="modal-actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={() => void submit()}
          disabled={!canSave}
        >
          {busy ? 'Saving...' : 'Save'}
        </button>
      </div>
    </Modal>
  );
}
