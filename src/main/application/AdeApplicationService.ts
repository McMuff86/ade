import type { AdeConfig, RunSummary, TaskQueueStatus } from '../../shared/types';
import type { MobileCatalog, MobileHealth } from '../../shared/remote';

export interface ApplicationConfigPort {
  get(): AdeConfig;
}

export interface ApplicationRunPort {
  summarize(runId?: string): RunSummary[];
}

export interface ApplicationQueuePort {
  status(): TaskQueueStatus;
}

/**
 * Transport-neutral, mobile-safe read boundary shared by Electron IPC and the
 * bounded Goal 7 HTTP adapter. It never returns AdeConfig directly.
 */
export class AdeApplicationService {
  constructor(
    private readonly store: ApplicationConfigPort,
    private readonly runsPort: ApplicationRunPort,
    private readonly queuePort: ApplicationQueuePort,
  ) {}

  health(): MobileHealth {
    return {
      apiVersion: 1,
      status: 'ready',
      queue: { ...this.queuePort.status() },
    };
  }

  catalog(): MobileCatalog {
    const config = this.store.get();
    return {
      repositories: config.repositories.map((repository) => ({
        id: repository.id,
        name: repository.name,
        executionBackend: repository.executionBackend,
        verified: repository.verified,
      })),
      agents: config.agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        ...(agent.role ? { role: agent.role } : {}),
        runtime: agent.runtime,
        ...(agent.defaultRepositoryId ? { defaultRepositoryId: agent.defaultRepositoryId } : {}),
        ...(agent.homeExecutionBackend
          ? { homeExecutionBackend: agent.homeExecutionBackend }
          : {}),
      })),
    };
  }

  runs(runId?: string): RunSummary[] {
    return this.runsPort.summarize(runId);
  }
}
