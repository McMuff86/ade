import { t as translate } from "../../shared/i18n";
import type { AdeConfig, Agent } from '../../shared/types';
import type { MobileTerminalSelection, SessionLaunchChoice, SessionLaunchOptions } from '../../shared/remote';
import type { ExecutionBackendId } from '../../shared/executionBackends';
import { OLLAMA_MODEL_PATTERN } from '../../shared/runtimes';
import { validSessionChoice } from '../../shared/sessionLaunch';
import { ExecutionBackendService } from '../execution/ExecutionBackendService';
import { agentHomeBackend } from '../repositories/RepositoryScopeService';
import { redactForWire } from '../errors';

export type InteractiveLaunchSettings = Parameters<typeof import('../../shared/runtimes').resolveLaunchCommand>[0] & { name: string };

/** Fixed, bounded CLI discovery. Never launches a model or changes an agent profile. */
export class SessionLaunchService {
  constructor(private readonly store: { get(): AdeConfig }, private readonly execution = new ExecutionBackendService()) {}

  async options(selection: MobileTerminalSelection): Promise<SessionLaunchOptions> {
    const config = this.store.get(); const agent = config.agents.find((a) => a.id === selection.agentId);
    const workspace = selection.projectWorkspaceId ? config.projectWorkspaces.find((item) => item.id === selection.projectWorkspaceId) : undefined;
    if (!selection.terminalHome && !selection.projectWorkspaceId && !agent) throw new Error(translate("ade: Agent no longer exists."));
    if (selection.projectWorkspaceId && !workspace) throw new Error(translate("ade: Project workspace is no longer available."));
    const repo = config.repositories.find((r) => r.id === (workspace?.repositoryId ?? selection.repositoryId));
    if (!selection.terminalHome && (workspace || selection.repositoryId !== null) && !repo?.verified) throw new Error(translate("ade: Project is not available."));
    const backend = selection.terminalHome ? 'native' : repo?.executionBackend ?? agentHomeBackend(agent!);
    const profiles = config.agents.filter((item) => agentHomeBackend(item) === backend).slice(0, 200);
    const [codex, claude, grok, hermes, models] = await Promise.all([
      this.present(backend, 'codex'), this.present(backend, 'claude'), this.present(backend, 'grok'), this.present(backend, 'hermes'), this.models(backend)]);
    return { environment: backend === 'native' ? (process.platform === 'win32' ? 'Windows' : process.platform) : redactForWire(backend, 150),
      ...(workspace ? { profiles: profiles.map((item) => ({ id: item.id, name: redactForWire(item.name, 200), runtime: item.runtime })) } : {}),
      choices: [{ mode: 'shell', available: true, notice: null }, { mode: 'agent', available: !selection.terminalHome && (workspace ? profiles.length > 0 : true), notice: selection.terminalHome ? translate("Free terminal without an agent profile in the user directory.") : translate("Uses the settings of the explicitly selected profile in this environment, including your own start commands.") },
        { mode: 'codex', available: codex, notice: codex ? null : translate("Codex was not found in this environment.") },
        { mode: 'claude', available: claude, notice: claude ? null : translate("Claude CLI was not found in this environment.") },
        { mode: 'grok', available: grok, notice: grok ? null : translate("Grok CLI was not found in this environment.") },
        { mode: 'hermes', available: hermes, notice: hermes ? null : translate("Hermes was not found. Use the saved profile for own wrappers.") },
        { mode: 'ollama', available: models.length > 0, notice: models.length ? null : translate("No models available. Ollama and existing models in this environment on the PC check.") }], models };
  }

  async effectiveAgent(agent: Agent, backend: ExecutionBackendId, choice: SessionLaunchChoice): Promise<Agent> {
    return { ...agent, ...await this.effectiveSettings(agent, backend, choice) };
  }

  async effectiveSettings(settings: InteractiveLaunchSettings, backend: ExecutionBackendId, choice: SessionLaunchChoice): Promise<InteractiveLaunchSettings> {
    if (!validSessionChoice(choice)) throw new Error(translate("ade: Invalid start selection."));
    if (choice.mode === 'agent') return { ...settings };
    if ((choice.mode === 'codex' || choice.mode === 'claude' || choice.mode === 'grok' || choice.mode === 'hermes') && !await this.present(backend, choice.mode)) throw new Error(translate("ade: Selected CLI is not available in this environment."));
    if (choice.mode === 'ollama' && !(await this.models(backend)).includes(choice.model)) throw new Error(translate("ade: Ollama model is no longer available. Update model list."));
    return { ...settings, runtime: choice.mode === 'hermes' ? 'custom' : choice.mode, permissionMode: 'default',
      customCommand: choice.mode === 'hermes' ? 'hermes' : undefined,
      ollamaMode: undefined,
      ollamaHarness: undefined,
      claudeModel: undefined, codexModel: undefined, codexReasoningEffort: undefined, grokModel: undefined, grokReasoningEffort: undefined,
      ollamaModel: choice.mode === 'ollama' ? choice.model : undefined };
  }

  async validateOllamaCoding(settings: InteractiveLaunchSettings, backend: ExecutionBackendId): Promise<void> {
    if (settings.runtime !== 'ollama' || settings.ollamaMode !== 'coding' || settings.customCommand?.trim()) return;
    const qwen = settings.ollamaHarness === 'qwen-code';
    if (!await this.present(backend, qwen ? 'qwen' : 'codex')) throw new Error(qwen
      ? translate("ade: Qwen code was not found in this environment. Install Qwen code or choose Codex CLI as the coding harness.")
      : translate("ade: Ollama-Coding requires the Codex CLI in this environment."));
    if (!settings.ollamaModel || !(await this.models(backend, qwen)).includes(settings.ollamaModel)) {
      throw new Error(translate("ade: Ollama model is not available. Ollama start and update the model list."));
    }
  }

  private async present(backend: ExecutionBackendId, executable: 'codex' | 'claude' | 'grok' | 'hermes' | 'qwen'): Promise<boolean> {
    try {
      const windows = backend === 'native' && process.platform === 'win32';
      const result = await this.execution.run(backend, windows ? 'where.exe' : '/bin/bash', windows ? [executable]
        : ['-lc', `command -v ${executable}`], { timeoutMs: 4000, maxBuffer: 16 * 1024 });
      return result.code === 0 && !result.timedOut && result.stdout.length > 0;
    } catch { return false; }
  }
  private async models(backend: ExecutionBackendId, localOnly = false): Promise<string[]> {
    try {
      const windows = backend === 'native' && process.platform === 'win32';
      const result = await this.execution.run(backend, windows ? 'ollama' : '/bin/bash', windows ? ['list'] : ['-lc', 'ollama list'], {
        timeoutMs: 4000, maxBuffer: 64 * 1024, ...(localOnly ? { env: { OLLAMA_HOST: 'http://127.0.0.1:11434' } } : {}) });
      if (result.code !== 0 || result.timedOut) return [];
      const lines = result.stdout.toString('utf8').split(/\r?\n/);
      if (!/^NAME\s+ID\s+SIZE\s+MODIFIED\s*$/.test(lines.shift()?.trim() ?? '')) return [];
      return [...new Set(lines.map((line) => line.trim().split(/\s+/)[0]!).filter((model) => OLLAMA_MODEL_PATTERN.test(model)
        && redactForWire(model, 250) === model))].slice(0, 200);
    } catch { return []; }
  }
}
