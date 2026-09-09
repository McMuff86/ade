import type { MobileRunSummary } from './remote';

/** A slower catalog refresh must not replace a newer independently read run. */
export function mergeRunSummaries(current: MobileRunSummary[], incoming: MobileRunSummary[]): MobileRunSummary[] {
  const known = new Map(current.map((run) => [run.id, run]));
  return incoming.map((run) => {
    const previous = known.get(run.id);
    return previous && previous.updatedAt > run.updatedAt ? previous : run;
  });
}
