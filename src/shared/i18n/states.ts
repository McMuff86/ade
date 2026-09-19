import { t, type MessageKey } from './index';

/** Presentation only: never replace the underlying wire or persisted enum. */
const keys: Record<string, MessageKey> = {
  draft: 'Draft', ready: 'Ready', queued: 'Queued', running: 'Running', starting: 'Starting',
  working: 'Working', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled',
  exited: 'Ended', stopped: 'Stopped', unknown: 'Unknown', paused: 'Paused', blocked: 'Blocked',
  planning: 'Planning', plan: 'Planning', work: 'Working', approval: 'Awaiting approval',
  integrating: 'Integrating', integrate: 'Integrating', verifying: 'Verifying', verify: 'Verifying',
  manual: 'Manual', reused: 'Reused', 'needs-mapping': 'Assignment required', conflict: 'Conflict',
  skipped: 'Skipped', invalid: 'Invalid', published: 'Published', publishing: 'Publishing',
  pending: 'Pending', succeeded: 'Succeeded', active: 'Active', released: 'Released',
};
export function localizedState(value: string): string { return keys[value] ? t(keys[value]) : value; }
