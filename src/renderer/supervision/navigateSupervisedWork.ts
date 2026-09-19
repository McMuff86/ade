import { t as translate } from "../../shared/i18n";
import type { SupervisionTarget } from '../../shared/supervision';
import { openCliSession } from '../work/openCliSession';
import { useMode } from '../stores/mode';
import { useRuns } from '../stores/runs';

/** A late response cannot replace a newer choice or navigate after dismissal. */
export async function navigateSupervisedWork(target: SupervisionTarget, current: () => boolean) {
  if (target.kind === 'session') await openCliSession(target.id, current);
  else {
    await useRuns.getState().refresh(); if (!current()) return;
    if (!useRuns.getState().runs.some(r => r.id === target.id)) throw new Error(translate("Run is no longer available."));
    useRuns.getState().setActiveRun(target.id); useMode.getState().setMode('graph');
  }
}
