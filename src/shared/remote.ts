import type { ExecutionBackendId } from './executionBackends';
import type { RunSummary, RuntimeId, TaskQueueStatus } from './types';

export interface MobileHealth {
  apiVersion: 1;
  status: 'ready';
  queue: TaskQueueStatus;
}

export interface MobileRepositorySummary {
  id: string;
  name: string;
  executionBackend: ExecutionBackendId;
  verified: boolean;
}

export interface MobileAgentSummary {
  id: string;
  name: string;
  role?: string;
  runtime: RuntimeId;
  defaultRepositoryId?: string;
  homeExecutionBackend?: ExecutionBackendId;
}

export interface MobileCatalog {
  repositories: MobileRepositorySummary[];
  agents: MobileAgentSummary[];
}

export type MobileRunSummary = RunSummary;
