import { t as translate } from "../../shared/i18n";
import type { NodeStatus } from './graphModel';
/** Render-boundary texts for graph node, run, phase and task states. */

export function statusText(status: NodeStatus): string {
  switch (status) {
    case 'running': return translate("Terminal active");
    case 'working': return translate("working");
    case 'done': return translate("done");
    case 'failed': return translate("Failed [6665686c]");
    default: return 'idle';
  }
}

export function runStatusText(status: string): string {
  switch (status) {
    case 'draft': return translate("Draft");
    case 'running': return translate("Running");
    case 'completed': return translate("Completed");
    case 'failed': return translate("Failed");
    case 'cancelled': return translate("Aborted");
    default: return status;
  }
}

export function phaseText(phase: string): string {
  switch (phase) {
    case 'planning': return translate("Planning");
    case 'working': return translate("Worker");
    case 'approval': return translate("Approval");
    case 'integrating': return translate("Integration");
    case 'verifying': return translate("Verification");
    case 'completed': return translate("Finished");
    case 'failed': return translate("Error");
    case 'cancelled': return translate("Aborted");
    default: return translate("Draft");
  }
}

export function taskStatusText(status: string): string {
  switch (status) {
    case 'queued': return translate("waiting");
    case 'running': return translate("running");
    case 'completed': return translate("completed");
    case 'failed': return translate("Failed [6665686c]");
    case 'cancelled': return translate("cancelled");
    default: return status;
  }
}

export const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
