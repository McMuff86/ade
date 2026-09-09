import type { AdeConfig, Agent } from '../../shared/types';
import type { MobileWorkspaceSelection, SessionLaunchChoice, SessionLaunchOptions } from '../../shared/remote';
import type { ExecutionBackendId } from '../../shared/executionBackends';
import { OLLAMA_MODEL_PATTERN } from '../../shared/runtimes';
import { validSessionChoice } from '../../shared/sessionLaunch';
import { ExecutionBackendService } from '../execution/ExecutionBackendService';
import { agentHomeBackend } from '../repositories/RepositoryScopeService';
import { redactForWire } from '../errors';

/** Fixed, bounded CLI discovery. Never launches a model or changes an agent profile. */
export class SessionLaunchService {
  constructor(private readonly store: { get(): AdeConfig }, private readonly execution = new ExecutionBackendService()) {}

  async options(selection: MobileWorkspaceSelection): Promise<SessionLaunchOptions> {
    const config = this.store.get(); const agent = config.agents.find((a) => a.id === selection.agentId);
    if (!agent) throw new Error('ade: Agent ist nicht mehr vorhanden.');
    const repo = selection.repositoryId === null ? undefined : config.repositories.find((r) => r.id === selection.repositoryId);
    if (selection.repositoryId !== null && !repo?.verified) throw new Error('ade: Projekt ist nicht verfügbar.');
    const backend = repo?.executionBackend ?? agentHomeBackend(agent);
    const [codex, claude, grok, hermes, models] = await Promise.all([
      this.present(backend, 'codex'), this.present(backend, 'claude'), this.present(backend, 'grok'), this.present(backend, 'hermes'), this.models(backend)]);
    return { environment: backend === 'native' ? (process.platform === 'win32' ? 'Windows' : process.platform) : redactForWire(backend, 150),
      choices: [{ mode: 'shell', available: true, notice: null }, { mode: 'agent', available: true, notice: 'Verwendet die Einstellungen dieses Agenten, einschliesslich eigener Startbefehle.' },
        { mode: 'codex', available: codex, notice: codex ? null : 'Codex wurde in dieser Umgebung nicht gefunden.' },
        { mode: 'claude', available: claude, notice: claude ? null : 'Claude CLI wurde in dieser Umgebung nicht gefunden.' },
        { mode: 'grok', available: grok, notice: grok ? null : 'Grok CLI wurde in dieser Umgebung nicht gefunden.' },
        { mode: 'hermes', available: hermes, notice: hermes ? null : 'Hermes wurde nicht gefunden. Für eigene Wrapper das gespeicherte Profil verwenden.' },
        { mode: 'ollama', available: models.length > 0, notice: models.length ? null : 'Keine Modelle erreichbar. Ollama und vorhandene Modelle in dieser Umgebung am PC prüfen.' }], models };
  }

  async effectiveAgent(agent: Agent, backend: ExecutionBackendId, choice: SessionLaunchChoice): Promise<Agent> {
    if (!validSessionChoice(choice)) throw new Error('ade: Ungültige Startauswahl.');
    if (choice.mode === 'agent') return { ...agent };
    if ((choice.mode === 'codex' || choice.mode === 'claude' || choice.mode === 'grok' || choice.mode === 'hermes') && !await this.present(backend, choice.mode)) throw new Error('ade: Gewähltes CLI ist in dieser Umgebung nicht verfügbar.');
    if (choice.mode === 'ollama' && !(await this.models(backend)).includes(choice.model)) throw new Error('ade: Ollama-Modell ist nicht mehr verfügbar. Modellliste aktualisieren.');
    return { ...agent, runtime: choice.mode === 'hermes' ? 'custom' : choice.mode, permissionMode: 'default',
      customCommand: choice.mode === 'hermes' ? 'hermes' : undefined,
      claudeModel: undefined, codexModel: undefined, codexReasoningEffort: undefined, grokModel: undefined, grokReasoningEffort: undefined,
      ollamaModel: choice.mode === 'ollama' ? choice.model : undefined };
  }

  private async present(backend: ExecutionBackendId, executable: 'codex' | 'claude' | 'grok' | 'hermes'): Promise<boolean> {
    try {
      const windows = backend === 'native' && process.platform === 'win32';
      const result = await this.execution.run(backend, windows ? 'where.exe' : '/bin/bash', windows ? [executable]
        : ['-lc', `command -v ${executable}`], { timeoutMs: 4000, maxBuffer: 16 * 1024 });
      return result.code === 0 && !result.timedOut && result.stdout.length > 0;
    } catch { return false; }
  }
  private async models(backend: ExecutionBackendId): Promise<string[]> {
    try {
      const windows = backend === 'native' && process.platform === 'win32';
      const result = await this.execution.run(backend, windows ? 'ollama' : '/bin/bash', windows ? ['list'] : ['-lc', 'ollama list'], { timeoutMs: 4000, maxBuffer: 64 * 1024 });
      if (result.code !== 0 || result.timedOut) return [];
      const lines = result.stdout.toString('utf8').split(/\r?\n/);
      if (!/^NAME\s+ID\s+SIZE\s+MODIFIED\s*$/.test(lines.shift()?.trim() ?? '')) return [];
      return [...new Set(lines.map((line) => line.trim().split(/\s+/)[0]!).filter((model) => OLLAMA_MODEL_PATTERN.test(model)
        && redactForWire(model, 250) === model))].slice(0, 200);
    } catch { return []; }
  }
}
