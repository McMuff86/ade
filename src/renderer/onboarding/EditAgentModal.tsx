/**
 * Existing-agent settings: runtime, permission mode and launch command can be
 * changed after creation without touching the agent's workspace or memory.
 */

import { useState } from 'react';
import { resolveLaunchCommand } from '../../shared/runtimes';
import {
  DEFAULT_CODEX_MODEL,
  DEFAULT_CODEX_REASONING_EFFORT,
  type Agent,
  type CodexReasoningEffort,
  type PermissionMode,
  type RuntimeId,
} from '../../shared/types';
import { useAppData } from '../stores/appdata';
import { Modal } from './Modal';
import { AGENT_PERMISSION_MODES, AGENT_RUNTIMES, CODEX_REASONING_EFFORTS } from './agentOptions';

interface EditAgentModalProps {
  agent: Agent;
  onClose: () => void;
}

export function EditAgentModal({ agent, onClose }: EditAgentModalProps): React.ReactElement {
  const updateAgent = useAppData((s) => s.updateAgent);
  const repositories = useAppData((s) => s.repositories);
  const createAgentTemplate = useAppData((s) => s.createAgentTemplate);

  const [name, setName] = useState(agent.name);
  const [role, setRole] = useState(agent.role ?? '');
  const [runtime, setRuntime] = useState<RuntimeId>(agent.runtime);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(agent.permissionMode);
  const [ollamaModel, setOllamaModel] = useState(agent.ollamaModel ?? '');
  const [codexModel, setCodexModel] = useState(agent.codexModel ?? DEFAULT_CODEX_MODEL);
  const [codexReasoningEffort, setCodexReasoningEffort] = useState<CodexReasoningEffort>(
    agent.codexReasoningEffort ?? DEFAULT_CODEX_REASONING_EFFORT,
  );
  const [customCommand, setCustomCommand] = useState(agent.customCommand ?? '');
  const [defaultRepositoryId, setDefaultRepositoryId] = useState(agent.defaultRepositoryId ?? '');
  const [templateName, setTemplateName] = useState(`${agent.name} template`);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [templateSaved, setTemplateSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const defaultCommand = resolveLaunchCommand({
    runtime,
    permissionMode,
    customCommand: undefined,
    ollamaModel: runtime === 'ollama' ? ollamaModel.trim() || undefined : undefined,
    codexModel: runtime === 'codex' ? codexModel.trim() || DEFAULT_CODEX_MODEL : undefined,
    codexReasoningEffort: runtime === 'codex' ? codexReasoningEffort : undefined,
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
        codexModel: runtime === 'codex' && codexModel.trim() ? codexModel.trim() : undefined,
        codexReasoningEffort: runtime === 'codex' ? codexReasoningEffort : undefined,
        defaultRepositoryId: defaultRepositoryId || null,
      });
      onClose();
    } catch (err) {
      console.error('[ade] update agent failed:', err);
      setBusy(false);
    }
  };

  const saveTemplate = async (): Promise<void> => {
    if (!templateName.trim() || templateBusy) return;
    setTemplateBusy(true);
    setTemplateSaved(false);
    try {
      await createAgentTemplate({ sourceAgentId: agent.id, name: templateName.trim() });
      setTemplateSaved(true);
    } catch (error) {
      console.error('[ade] create agent template failed:', error);
    } finally {
      setTemplateBusy(false);
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

      {runtime === 'codex' ? (
        <div className="codex-profile-grid">
          <div className="field">
            <label htmlFor="edit-agent-codex-model">CODEX MODEL</label>
            <input
              id="edit-agent-codex-model"
              type="text"
              value={codexModel}
              maxLength={100}
              autoComplete="off"
              placeholder={DEFAULT_CODEX_MODEL}
              onChange={(event) => setCodexModel(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="edit-agent-codex-reasoning">REASONING EFFORT</label>
            <select
              id="edit-agent-codex-reasoning"
              value={codexReasoningEffort}
              onChange={(event) => setCodexReasoningEffort(event.target.value as CodexReasoningEffort)}
            >
              {CODEX_REASONING_EFFORTS.map((effort) => (
                <option key={effort.id} value={effort.id}>{effort.label}</option>
              ))}
            </select>
          </div>
          <div className="repo-hint codex-profile-hint">
            Applied to interactive terminals and managed tasks. Extra high is recommended for the main orchestrator.
          </div>
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
        <label htmlFor="edit-agent-repository">DEFAULT REPOSITORY</label>
        <select
          id="edit-agent-repository"
          value={defaultRepositoryId}
          onChange={(event) => setDefaultRepositoryId(event.target.value)}
        >
          <option value="">Portable agent (no default)</option>
          {repositories.map((repository) => (
            <option key={repository.id} value={repository.id}>{repository.name}</option>
          ))}
        </select>
        <div className="repo-hint">Changing this affects future sessions only.</div>
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

      <div className="field">
        <label htmlFor="edit-agent-template">REUSABLE TEMPLATE</label>
        <div className="repo-picker">
          <input
            id="edit-agent-template"
            type="text"
            value={templateName}
            maxLength={200}
            onChange={(event) => {
              setTemplateName(event.target.value);
              setTemplateSaved(false);
            }}
          />
          <button
            type="button"
            className="btn"
            disabled={!templateName.trim() || templateBusy}
            onClick={() => void saveTemplate()}
          >
            {templateBusy ? 'Saving...' : 'Save template'}
          </button>
        </div>
        {templateSaved ? <div className="repo-hint">Template saved with an independent memory seed.</div> : null}
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
