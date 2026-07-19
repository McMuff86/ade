/**
 * New-agent modal — name + photo + category + runtime + permission mode.
 * Ollama reveals a free-text model field; an "Advanced" section (collapsed by
 * default) holds a free-text custom-command override and optional role.
 */

import { useState } from 'react';
import { Modal } from './Modal';
import { PhotoPicker } from './PhotoPicker';
import { useAppData } from '../stores/appdata';
import { useSelection } from '../stores/selection';
import {
  DEFAULT_CODEX_MODEL,
  DEFAULT_CODEX_REASONING_EFFORT,
  type CodexReasoningEffort,
  type PermissionMode,
  type RuntimeId,
} from '../../shared/types';
import { AGENT_PERMISSION_MODES, AGENT_RUNTIMES, CODEX_REASONING_EFFORTS } from './agentOptions';

interface NewAgentModalProps {
  onClose: () => void;
  /** category preselected by the caller (e.g. the rail's "+ Add agent"). */
  categoryId?: string;
}

export function NewAgentModal({ onClose, categoryId }: NewAgentModalProps): React.ReactElement {
  const categories = useAppData((s) => s.categories);
  const repositories = useAppData((s) => s.repositories);
  const templates = useAppData((s) => s.agentTemplates);
  const createAgent = useAppData((s) => s.createAgent);
  const spawnAgentTemplate = useAppData((s) => s.spawnAgentTemplate);
  const setSelectedAgent = useSelection((s) => s.setSelectedAgent);

  const [name, setName] = useState('');
  const [photo, setPhoto] = useState<string | undefined>(undefined);
  const [catId, setCatId] = useState(categoryId ?? categories[0]?.id ?? '');
  const [templateId, setTemplateId] = useState('');
  const [defaultRepositoryId, setDefaultRepositoryId] = useState(
    categories.find((category) => category.id === (categoryId ?? categories[0]?.id))
      ?.defaultRepositoryId ?? '',
  );
  const [runtime, setRuntime] = useState<RuntimeId>('codex');
  const [ollamaModel, setOllamaModel] = useState('');
  const [codexModel, setCodexModel] = useState(DEFAULT_CODEX_MODEL);
  const [codexReasoningEffort, setCodexReasoningEffort] =
    useState<CodexReasoningEffort>(DEFAULT_CODEX_REASONING_EFFORT);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('bypass');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [role, setRole] = useState('');
  const [customCommand, setCustomCommand] = useState('');
  const [busy, setBusy] = useState(false);

  const canCreate = name.trim().length > 0 && catId !== '' && !busy;

  const submit = async (): Promise<void> => {
    if (!canCreate) return;
    setBusy(true);
    try {
      const input = {
        categoryId: catId,
        name: name.trim(),
        role: role.trim() || undefined,
        photo,
        runtime,
        permissionMode,
        customCommand: customCommand.trim() || undefined,
        ollamaModel: runtime === 'ollama' && ollamaModel.trim() ? ollamaModel.trim() : undefined,
        codexModel: runtime === 'codex' && codexModel.trim() ? codexModel.trim() : undefined,
        codexReasoningEffort: runtime === 'codex' ? codexReasoningEffort : undefined,
        defaultRepositoryId: defaultRepositoryId || null,
      };
      const agent = templateId
        ? await spawnAgentTemplate({ templateId, ...input })
        : await createAgent(input);
      setSelectedAgent(agent.id);
      onClose();
    } catch (err) {
      console.error('[ade] create agent failed:', err);
      setBusy(false);
    }
  };

  const chooseTemplate = (id: string): void => {
    setTemplateId(id);
    const template = templates.find((candidate) => candidate.id === id);
    if (!template) return;
    setName(template.name);
    setRole(template.role ?? '');
    setPhoto(template.photo);
    setRuntime(template.runtime);
    setPermissionMode(template.permissionMode);
    setCustomCommand(template.customCommand ?? '');
    setOllamaModel(template.ollamaModel ?? '');
    setCodexModel(template.codexModel ?? DEFAULT_CODEX_MODEL);
    setCodexReasoningEffort(template.codexReasoningEffort ?? DEFAULT_CODEX_REASONING_EFFORT);
  };

  return (
    <Modal
      title="New agent"
      subtitle="An agent gets its own workspace, its own skills and its own memory (MEMORY.md / USER.md)."
      onClose={onClose}
    >
      <div className="field">
        <label htmlFor="agent-cat">CATEGORY</label>
        <select
          id="agent-cat"
          value={catId}
          onChange={(event) => {
            const next = event.target.value;
            setCatId(next);
            setDefaultRepositoryId(
              categories.find((category) => category.id === next)?.defaultRepositoryId ?? '',
            );
          }}
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {templates.length > 0 ? (
        <div className="field">
          <label htmlFor="agent-template">TEMPLATE (OPTIONAL)</label>
          <select id="agent-template" value={templateId} onChange={(event) => chooseTemplate(event.target.value)}>
            <option value="">Blank agent</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>{template.name}</option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="agent-repository">DEFAULT REPOSITORY</label>
        <select
          id="agent-repository"
          value={defaultRepositoryId}
          onChange={(event) => setDefaultRepositoryId(event.target.value)}
        >
          <option value="">Portable agent (no default)</option>
          {repositories.map((repository) => (
            <option key={repository.id} value={repository.id}>{repository.name}</option>
          ))}
        </select>
        <div className="repo-hint">Future sessions use this repo unless another scope is chosen.</div>
      </div>

      <div className="field">
        <label htmlFor="agent-name">NAME</label>
        <input
          id="agent-name"
          type="text"
          value={name}
          autoComplete="off"
          placeholder="e.g. Nova"
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="agent-rt">RUNTIME</label>
        <select
          id="agent-rt"
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
          <label htmlFor="agent-model">MODEL</label>
          <input
            id="agent-model"
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
            <label htmlFor="agent-codex-model">CODEX MODEL</label>
            <input
              id="agent-codex-model"
              type="text"
              value={codexModel}
              maxLength={100}
              autoComplete="off"
              placeholder={DEFAULT_CODEX_MODEL}
              onChange={(event) => setCodexModel(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="agent-codex-reasoning">REASONING EFFORT</label>
            <select
              id="agent-codex-reasoning"
              value={codexReasoningEffort}
              onChange={(event) => setCodexReasoningEffort(event.target.value as CodexReasoningEffort)}
            >
              {CODEX_REASONING_EFFORTS.map((effort) => (
                <option key={effort.id} value={effort.id}>{effort.label}</option>
              ))}
            </select>
          </div>
          <div className="repo-hint codex-profile-hint">
            Persisted for interactive and managed Codex sessions. Orchestrators should use Extra high.
          </div>
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="agent-perm">PERMISSION MODE</label>
        <select
          id="agent-perm"
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
        <label>PROFILE PHOTO</label>
        <PhotoPicker value={photo} onChange={setPhoto} shape="round" name={name} />
      </div>

      <button
        type="button"
        className="advanced-toggle"
        aria-expanded={advancedOpen}
        onClick={() => setAdvancedOpen((v) => !v)}
      >
        <span className="advanced-chevron">{advancedOpen ? '▾' : '▸'}</span> Advanced
      </button>

      {advancedOpen ? (
        <div className="advanced-body">
          <div className="field">
            <label htmlFor="agent-role">ROLE</label>
            <input
              id="agent-role"
              type="text"
              value={role}
              autoComplete="off"
              placeholder="e.g. Frontend &amp; theme"
              onChange={(e) => setRole(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="agent-cmd">CUSTOM COMMAND OVERRIDE</label>
            <input
              id="agent-cmd"
              type="text"
              value={customCommand}
              autoComplete="off"
              placeholder="overrides the runtime launch command"
              onChange={(e) => setCustomCommand(e.target.value)}
            />
          </div>
        </div>
      ) : null}

      <div className="modal-actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={() => void submit()}
          disabled={!canCreate}
        >
          {busy ? 'Creating…' : 'Create agent'}
        </button>
      </div>
    </Modal>
  );
}
