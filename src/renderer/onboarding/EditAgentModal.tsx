import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
/**
 * Existing-agent settings: runtime, permission mode and launch command can be
 * changed after creation without touching the agent's workspace or memory.
 */

import { useEffect, useState } from 'react';
import {
  NATIVE_EXECUTION_BACKEND,
  type ExecutionBackendId,
} from '../../shared/executionBackends';
import type { WslDistributionInfo } from '../../shared/ipc';
import { resolveLaunchCommand } from '../../shared/runtimes';
import {
  DEFAULT_CODEX_MODEL,
  DEFAULT_CODEX_REASONING_EFFORT,
  DEFAULT_GROK_MODEL,
  DEFAULT_GROK_REASONING_EFFORT,
  type Agent,
  type CodexReasoningEffort,
  type DashboardTarget,
  type GrokReasoningEffort,
  type PermissionMode,
  type RuntimeId,
} from '../../shared/types';
import { useAppData } from '../stores/appdata';
import { DeleteAction } from './DeleteAction';
import { Modal } from './Modal';
import { PhotoPicker } from './PhotoPicker';
import { OllamaModePicker } from './OllamaModePicker';
import { RuntimeModelPicker } from './RuntimeModelPicker';
import { DesktopAgentBehavior } from './AgentBehaviorEditor';
import { TargetSpeechSettings } from '../settings/TargetSpeechSettings';
import {
  AGENT_PERMISSION_MODES, AGENT_RUNTIMES,
} from './agentOptions';

interface EditAgentModalProps {
  agent: Agent;
  onClose: () => void;
}

export function EditAgentModal({ agent, onClose }: EditAgentModalProps): React.ReactElement {
  useLocale();
  const updateAgent = useAppData((s) => s.updateAgent);
  const deleteAgent = useAppData((s) => s.deleteAgent);
  const repositories = useAppData((s) => s.repositories);
  const createAgentTemplate = useAppData((s) => s.createAgentTemplate);

  const [name, setName] = useState(agent.name);
  const [photo, setPhoto] = useState<string | undefined>(agent.photo);
  const [role, setRole] = useState(agent.role ?? '');
  const [runtime, setRuntime] = useState<RuntimeId>(agent.runtime);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(agent.permissionMode);
  const [ollamaModel, setOllamaModel] = useState(agent.ollamaModel ?? '');
  const [ollamaHarness, setOllamaHarness] = useState<'codex' | 'qwen-code'>(agent.ollamaHarness ?? 'codex');
  const [ollamaMode, setOllamaMode] = useState<'chat' | 'coding'>(agent.ollamaMode ?? 'chat');
  const [claudeModel, setClaudeModel] = useState(agent.claudeModel ?? '');
  const [codexModel, setCodexModel] = useState(agent.codexModel ?? DEFAULT_CODEX_MODEL);
  const [codexReasoningEffort, setCodexReasoningEffort] = useState<CodexReasoningEffort>(
    agent.codexReasoningEffort ?? DEFAULT_CODEX_REASONING_EFFORT,
  );
  const [grokModel, setGrokModel] = useState(agent.grokModel ?? DEFAULT_GROK_MODEL);
  const [grokReasoningEffort, setGrokReasoningEffort] = useState<GrokReasoningEffort>(
    agent.grokReasoningEffort ?? DEFAULT_GROK_REASONING_EFFORT,
  );
  const [customCommand, setCustomCommand] = useState(agent.customCommand ?? '');
  const [defaultRepositoryId, setDefaultRepositoryId] = useState(agent.defaultRepositoryId ?? '');
  const [homeBackend, setHomeBackend] = useState<ExecutionBackendId>(
    agent.homeExecutionBackend ?? NATIVE_EXECUTION_BACKEND,
  );
  const [homeDir, setHomeDir] = useState(agent.homeWorkspaceDir ?? '');
  const [dashboardUrl, setDashboardUrl] = useState(agent.dashboardUrl ?? '');
  const [dashboardCommand, setDashboardCommand] = useState(agent.dashboardCommand ?? '');
  const [dashboardTarget, setDashboardTarget] = useState<DashboardTarget>(
    agent.dashboardTarget ?? 'window',
  );
  const [wslDistributions, setWslDistributions] = useState<WslDistributionInfo[]>([]);
  const [templateName, setTemplateName] = useState(`${agent.name} template`);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [templateSaved, setTemplateSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const defaultCommand = runtime === 'ollama' && ollamaMode === 'coding' && !ollamaModel.trim() ? '' : resolveLaunchCommand({
    runtime,
    permissionMode,
    customCommand: undefined,
    ollamaMode: runtime === 'ollama' ? ollamaMode : undefined,
    ollamaHarness: runtime === 'ollama' ? ollamaHarness : undefined,
    ollamaModel: runtime === 'ollama' ? ollamaModel.trim() || undefined : undefined,
    claudeModel: runtime === 'claude' ? claudeModel.trim() || undefined : undefined,
    codexModel: runtime === 'codex' ? codexModel.trim() || DEFAULT_CODEX_MODEL : undefined,
    codexReasoningEffort: runtime === 'codex' ? codexReasoningEffort : undefined,
    grokModel: runtime === 'grok' ? grokModel.trim() || DEFAULT_GROK_MODEL : undefined,
    grokReasoningEffort: runtime === 'grok' ? grokReasoningEffort : undefined,
  });
  useEffect(() => {
    let disposed = false;
    void window.ade.invoke('wsl:list')
      .then((result) => {
        if (!disposed) setWslDistributions(result.distributions);
      })
      .catch(() => {
        if (!disposed) setWslDistributions([]);
      });
    return () => {
      disposed = true;
    };
  }, []);

  const commandPlaceholder = defaultCommand.trim().length > 0 ? defaultCommand : 'default shell';
  const homeIsWsl = homeBackend !== NATIVE_EXECUTION_BACKEND;
  const homeDirValid = !homeIsWsl || homeDir.trim().replace(/\\/g, '/').startsWith('/');
  const modelBackend = repositories.find((repository) => repository.id === defaultRepositoryId)?.executionBackend ?? homeBackend;
  const canSave = name.trim().length > 0 && homeDirValid && !busy
    && (runtime !== 'ollama' || !!customCommand.trim() || !!ollamaModel.trim());
  // A stored distro stays selectable even when `wsl --list` no longer knows it.
  const homeBackendOptions: Array<{ backend: ExecutionBackendId; label: string }> = ([
    { backend: NATIVE_EXECUTION_BACKEND, label: translate("Windows (native)") },
    ...wslDistributions.map((distribution) => ({
      backend: distribution.backend,
      label: `WSL · ${distribution.name}${distribution.available ? '' : ' (unavailable?)'}`,
    })),
    ...(homeIsWsl && !wslDistributions.some((distribution) => distribution.backend === homeBackend)
      ? [{ backend: homeBackend, label: `WSL · ${homeBackend.slice('wsl:'.length)} (not installed)` }]
      : []),
  ]);

  const submit = async (): Promise<void> => {
    if (!canSave) return;
    setBusy(true);
    setSaveError(null);
    try {
      await updateAgent({
        id: agent.id,
        name: name.trim(),
        role: role.trim() || undefined,
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
        homeExecutionBackend: homeBackend,
        homeWorkspaceDir: homeDir.trim(),
        photo: photo ?? null,
        dashboardUrl: dashboardUrl.trim(),
        dashboardCommand: dashboardCommand.trim(),
        dashboardTarget,
      });
      onClose();
    } catch (err) {
      console.error('[ade] update agent failed:', err);
      setSaveError(err instanceof Error ? err.message : String(err));
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
    <Modal title={translate("Agent settings")} subtitle={translate("Configure how new terminal sessions start.")} onClose={onClose}>
      <div className="field">
        <label>{translate("Profile photo")}</label>
        <PhotoPicker value={photo} onChange={setPhoto} shape="round" name={name} runtime={runtime} />
      </div>

      <div className="field">
        <label htmlFor="edit-agent-name">{translate("Name")}</label>
        <input
          id="edit-agent-name"
          type="text"
          value={name}
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="edit-agent-role">{translate("Role [526f6c65]")}</label>
        <input
          id="edit-agent-role"
          type="text"
          value={role}
          autoComplete="off"
          placeholder={translate("e.g. Frontend & theme")}
          onChange={(e) => setRole(e.target.value)}
        />
      </div>

      <DesktopAgentBehavior agentId={agent.id} />
      <TargetSpeechSettings target={{ kind: 'agent', agentId: agent.id, ...(agent.defaultRepositoryId ? { repositoryId: agent.defaultRepositoryId } : {}) }} title={translate("Agent voice")} />

      <div className="field">
        <label htmlFor="edit-agent-runtime">{translate("Runtime")}</label>
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

      {runtime === 'ollama' && <OllamaModePicker id="edit-agent-ollama-mode" value={ollamaMode} onChange={setOllamaMode} harness={ollamaHarness} onHarnessChange={setOllamaHarness} />}
      {(runtime === 'codex' || runtime === 'grok' || runtime === 'claude' || runtime === 'ollama') && <RuntimeModelPicker
        key={runtime + ':' + modelBackend} runtime={runtime} backend={modelBackend}
        id={`edit-agent-${runtime}-model`} label={translate("{{value1}} MODEL", { value1: runtime.toUpperCase() })}
        value={runtime === 'codex' ? codexModel : runtime === 'grok' ? grokModel : runtime === 'claude' ? claudeModel : ollamaModel}
        onChange={runtime === 'codex' ? setCodexModel : runtime === 'grok' ? setGrokModel : runtime === 'claude' ? setClaudeModel : setOllamaModel}
        effort={runtime === 'codex' ? codexReasoningEffort : runtime === 'grok' ? grokReasoningEffort : undefined}
        onEffortChange={runtime === 'codex' ? setCodexReasoningEffort : runtime === 'grok' ? (value) => setGrokReasoningEffort(value as GrokReasoningEffort) : undefined}
        newProfile={false}
      />}
      {customCommand.trim() && <p className="repo-hint">{translate("A separate start command determines the model itself and takes precedence over this selection.")}</p>}

      <div className="field">
        <label htmlFor="edit-agent-perm">{translate("Permission mode")}</label>
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
        <label htmlFor="edit-agent-repository">{translate("Default repository")}</label>
        <select
          id="edit-agent-repository"
          value={defaultRepositoryId}
          onChange={(event) => setDefaultRepositoryId(event.target.value)}
        >
          <option value="">{translate("Portable agent (no default)")}</option>
          {repositories.map((repository) => (
            <option key={repository.id} value={repository.id}>{repository.name}</option>
          ))}
        </select>
        <div className="repo-hint">{translate("Changing this affects future sessions only.")}</div>
      </div>

      <div className="field">
        <label htmlFor="edit-agent-home-backend">{translate("Home backend")}</label>
        <select
          id="edit-agent-home-backend"
          value={homeBackend}
          onChange={(event) => {
            const next = event.target.value as ExecutionBackendId;
            setHomeBackend(next);
            // Never carry a path across worlds: '' falls back to the ADE
            // default home (native) or forces an explicit Linux path (WSL).
            const posixLike = homeDir.trim().replace(/\\/g, '/').startsWith('/');
            if ((next !== NATIVE_EXECUTION_BACKEND) !== posixLike) setHomeDir('');
          }}
        >
          {homeBackendOptions.map((option) => (
            <option key={option.backend} value={option.backend}>{option.label}</option>
          ))}
        </select>
        <div className="repo-hint">
          {translate("Where sessions without a repository run. WSL launches the start command inside the distribution.")}</div>
      </div>

      <div className="field">
        <label htmlFor="edit-agent-home-dir">{translate("Home directory")}</label>
        <input
          id="edit-agent-home-dir"
          type="text"
          value={homeDir}
          autoComplete="off"
          spellCheck={false}
          placeholder={homeIsWsl ? '/home/user/project' : 'ADE default workspace'}
          onChange={(event) => setHomeDir(event.target.value)}
        />
        {homeIsWsl && !homeDirValid ? (
          <div className="repo-hint">{translate("A WSL home needs an absolute Linux path, e.g. /home/user/project.")}</div>
        ) : null}
      </div>

      <div className="field">
        <label htmlFor="edit-agent-cmd">{translate("Start command")}</label>
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
        <label htmlFor="edit-agent-dash-cmd">{translate("Dashboard command")}</label>
        <input
          id="edit-agent-dash-cmd"
          type="text"
          value={dashboardCommand}
          autoComplete="off"
          spellCheck={false}
          placeholder={translate("e.g. openclaw dashboard --no-open")}
          onChange={(e) => setDashboardCommand(e.target.value)}
        />
        <div className="repo-hint">
          {translate("Runs in the agent's home backend; its output must contain the dashboard URL. Wins over the fixed URL below.")}</div>
      </div>

      <div className="field">
        <label htmlFor="edit-agent-dash-url">{translate("Dashboard URL")}</label>
        <input
          id="edit-agent-dash-url"
          type="text"
          value={dashboardUrl}
          autoComplete="off"
          spellCheck={false}
          placeholder={translate("https://host.example:8443/")}
          onChange={(e) => setDashboardUrl(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="edit-agent-dash-target">{translate("Dashboard opens in")}</label>
        <select
          id="edit-agent-dash-target"
          value={dashboardTarget}
          onChange={(e) => setDashboardTarget(e.target.value as DashboardTarget)}
        >
          <option value="window">{translate("ADE window (origin-locked)")}</option>
          <option value="external">{translate("External browser")}</option>
        </select>
      </div>

      <div className="field">
        <label htmlFor="edit-agent-template">{translate("Reusable template")}</label>
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
            {templateBusy ? translate("Saving...") : translate("Save template")}
          </button>
        </div>
        {templateSaved ? <div className="repo-hint">{translate("Template saved with an independent memory seed.")}</div> : null}
      </div>

      {saveError ? <div className="modal-error" role="alert">{saveError}</div> : null}

      <div className="modal-actions">
        <DeleteAction
          label={translate("Delete the agent")}
          consequence={translate("Removes the agent from ADE and terminates its current terminals. ")
            + translate("Workspace, memory and photo remain on the hard drive.")}
          busy={busy}
          onDelete={async () => {
            await deleteAgent(agent.id);
            onClose();
          }}
        />
        <button type="button" className="btn" onClick={onClose}>
          {translate("Cancel [43616e63]")}</button>
        <button
          type="button"
          className="btn primary"
          onClick={() => void submit()}
          disabled={!canSave}
        >
          {busy ? translate("Saving...") : translate("Save")}
        </button>
      </div>
    </Modal>
  );
}
