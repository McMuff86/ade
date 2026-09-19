import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
/**
 * New-agent modal — name + photo + category + runtime + permission mode.
 * Ollama reveals its installed model catalog; an "Advanced" section (collapsed by
 * default) holds a free-text custom-command override and optional role.
 */

import { useState } from 'react';
import { Modal } from './Modal';
import { PhotoPicker } from './PhotoPicker';
import { OllamaModePicker } from './OllamaModePicker';
import { RuntimeModelPicker } from './RuntimeModelPicker';
import { useAppData } from '../stores/appdata';
import { useSelection } from '../stores/selection';
import {
  DEFAULT_CODEX_MODEL,
  DEFAULT_CODEX_REASONING_EFFORT,
  DEFAULT_GROK_MODEL,
  DEFAULT_GROK_REASONING_EFFORT,
  type CodexReasoningEffort,
  type GrokReasoningEffort,
  type PermissionMode,
  type RuntimeId,
} from '../../shared/types';
import {
  AGENT_PERMISSION_MODES, AGENT_RUNTIMES,
} from './agentOptions';

interface NewAgentModalProps {
  onClose: () => void;
  /** category preselected by the caller (e.g. the rail's "+ Add agent"). */
  categoryId?: string;
}

export function NewAgentModal({ onClose, categoryId }: NewAgentModalProps): React.ReactElement {
  useLocale();
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
  const [ollamaHarness, setOllamaHarness] = useState<'codex' | 'qwen-code'>('codex');
  const [ollamaMode, setOllamaMode] = useState<'chat' | 'coding'>('coding');
  const [claudeModel, setClaudeModel] = useState('');
  const [codexModel, setCodexModel] = useState('');
  const [codexReasoningEffort, setCodexReasoningEffort] =
    useState<CodexReasoningEffort>(DEFAULT_CODEX_REASONING_EFFORT);
  const [grokModel, setGrokModel] = useState('');
  const [grokReasoningEffort, setGrokReasoningEffort] =
    useState<GrokReasoningEffort>(DEFAULT_GROK_REASONING_EFFORT);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('bypass');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [role, setRole] = useState('');
  const [customCommand, setCustomCommand] = useState('');
  const [busy, setBusy] = useState(false);

  const modelBackend = repositories.find((repository) => repository.id === defaultRepositoryId)?.executionBackend ?? 'native';
  const canCreate = name.trim().length > 0 && catId !== '' && !busy
    && (customCommand.trim() !== '' || (runtime === 'codex' ? !!codexModel : runtime === 'grok' ? !!grokModel : runtime === 'claude' ? !!claudeModel || !!templateId : runtime === 'ollama' ? !!ollamaModel : true));

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
        ollamaMode: runtime === 'ollama' ? ollamaMode : undefined,
        ollamaHarness: runtime === 'ollama' ? ollamaHarness : undefined,
        ollamaModel: runtime === 'ollama' && ollamaModel.trim() ? ollamaModel.trim() : undefined,
        claudeModel: runtime === 'claude' ? claudeModel.trim() || undefined : undefined,
        codexModel: runtime === 'codex' && codexModel.trim() ? codexModel.trim() : undefined,
        codexReasoningEffort: runtime === 'codex' ? codexReasoningEffort : undefined,
        grokModel: runtime === 'grok' && grokModel.trim() ? grokModel.trim() : undefined,
        grokReasoningEffort: runtime === 'grok' ? grokReasoningEffort : undefined,
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
    setOllamaMode(template.ollamaMode ?? 'chat');
    setOllamaHarness(template.ollamaHarness ?? 'codex');
    setClaudeModel(template.claudeModel ?? '');
    setCodexModel(template.codexModel ?? DEFAULT_CODEX_MODEL);
    setCodexReasoningEffort(template.codexReasoningEffort ?? DEFAULT_CODEX_REASONING_EFFORT);
    setGrokModel(template.grokModel ?? DEFAULT_GROK_MODEL);
    setGrokReasoningEffort(template.grokReasoningEffort ?? DEFAULT_GROK_REASONING_EFFORT);
  };

  return (
    <Modal
      title={translate("New agent [4e657720]")}
      subtitle={translate("An agent gets its own workspace, skills and memory (MEMORY.md / USER.md).")}
      onClose={onClose}
    >
      <div className="field">
        <label htmlFor="agent-cat">{translate("Category [43617465]")}</label>
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
          <label htmlFor="agent-template">{translate("TEMPLATE (OPTIONAL)")}</label>
          <select id="agent-template" value={templateId} onChange={(event) => chooseTemplate(event.target.value)}>
            <option value="">{translate("Blank agent")}</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>{template.name}</option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="agent-repository">{translate("Default repository")}</label>
        <select
          id="agent-repository"
          value={defaultRepositoryId}
          onChange={(event) => setDefaultRepositoryId(event.target.value)}
        >
          <option value="">{translate("Portable agent (no default)")}</option>
          {repositories.map((repository) => (
            <option key={repository.id} value={repository.id}>{repository.name}</option>
          ))}
        </select>
        <div className="repo-hint">{translate("Future sessions use this repo unless another scope is chosen.")}</div>
      </div>

      <div className="field">
        <label htmlFor="agent-name">{translate("Name")}</label>
        <input
          id="agent-name"
          type="text"
          value={name}
          autoComplete="off"
          placeholder={translate("e.g. Nova")}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="agent-rt">{translate("Runtime")}</label>
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

      {runtime === 'ollama' && <OllamaModePicker id="agent-ollama-mode" value={ollamaMode} onChange={setOllamaMode} harness={ollamaHarness} onHarnessChange={setOllamaHarness} />}
      {(runtime === 'codex' || runtime === 'grok' || runtime === 'claude' || runtime === 'ollama') && <RuntimeModelPicker
        key={runtime + ':' + modelBackend} runtime={runtime} backend={modelBackend}
        id={`agent-${runtime}-model`} label={translate("{{value1}} MODEL", { value1: runtime.toUpperCase() })}
        value={runtime === 'codex' ? codexModel : runtime === 'grok' ? grokModel : runtime === 'claude' ? claudeModel : ollamaModel}
        onChange={runtime === 'codex' ? setCodexModel : runtime === 'grok' ? setGrokModel : runtime === 'claude' ? setClaudeModel : setOllamaModel}
        effort={runtime === 'codex' ? codexReasoningEffort : runtime === 'grok' ? grokReasoningEffort : undefined}
        onEffortChange={runtime === 'codex' ? setCodexReasoningEffort : runtime === 'grok' ? (value) => setGrokReasoningEffort(value as GrokReasoningEffort) : undefined}
        newProfile={!templateId}
      />}
      {customCommand.trim() && <p className="repo-hint">{translate("A separate start command determines the model itself and takes precedence over this selection.")}</p>}

      <div className="field">
        <label htmlFor="agent-perm">{translate("Permission mode")}</label>
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
        <label>{translate("Profile photo")}</label>
        <PhotoPicker value={photo} onChange={setPhoto} shape="round" name={name} runtime={runtime} />
      </div>

      <button
        type="button"
        className="advanced-toggle"
        aria-expanded={advancedOpen}
        onClick={() => setAdvancedOpen((v) => !v)}
      >
        <span className="advanced-chevron">{advancedOpen ? '▾' : '▸'}</span> {" "}{translate("Advanced")}</button>

      {advancedOpen ? (
        <div className="advanced-body">
          <div className="field">
            <label htmlFor="agent-role">{translate("Role [526f6c65]")}</label>
            <input
              id="agent-role"
              type="text"
              value={role}
              autoComplete="off"
              placeholder={translate("e.g. Frontend & theme [652e672e]")}
              onChange={(e) => setRole(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="agent-cmd">{translate("Custom command override")}</label>
            <input
              id="agent-cmd"
              type="text"
              value={customCommand}
              autoComplete="off"
              placeholder={translate("overrides the runtime launch command")}
              onChange={(e) => setCustomCommand(e.target.value)}
            />
          </div>
        </div>
      ) : null}

      <div className="modal-actions">
        <button type="button" className="btn" onClick={onClose}>
          {translate("Cancel [43616e63]")}</button>
        <button
          type="button"
          className="btn primary"
          onClick={() => void submit()}
          disabled={!canCreate}
        >
          {busy ? translate("Creating…") : translate("Create an agent")}
        </button>
      </div>
    </Modal>
  );
}
