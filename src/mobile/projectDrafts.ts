import type { MobileRunSummary } from '../shared/remote';
import type { WorkDraft } from './WorkComposer';

export interface ProjectDraftState { active: string; drafts: Record<string, WorkDraft> }
export const draftKey = (draft: Pick<WorkDraft, 'repositoryId' | 'mode'>): string => JSON.stringify([draft.repositoryId, draft.mode]);
export function initialProjectDraft(draft: WorkDraft): ProjectDraftState { const key = draftKey(draft); return { active: key, drafts: { [key]: draft } }; }
/** Switching repository/mode keeps each prompt private to its own project draft. */
export function updateProjectDraft(state: ProjectDraftState, proposed: WorkDraft): ProjectDraftState {
  const key = draftKey(proposed);
  const next = key === state.active ? proposed : state.drafts[key] ?? { ...proposed, name: '', prompt: '' };
  return { active: key, drafts: { ...state.drafts, [key]: next } };
}
export function selectProjectDraft(state: ProjectDraftState, seed: WorkDraft, agentId?: string): ProjectDraftState {
  const next = updateProjectDraft(state, seed); const draft = next.drafts[next.active]!;
  return agentId ? { ...next, drafts: { ...next.drafts, [next.active]: { ...draft, agentIds: [agentId] } } } : next;
}
export function filterProjectRuns(runs: MobileRunSummary[], repositoryId: string, agentId: string): MobileRunSummary[] {
  return runs.filter((run) => (!repositoryId || run.repositoryId === repositoryId)
    && (!agentId || run.participants.some((participant) => participant.agentId === agentId)));
}

export function completeProjectDraft(state: ProjectDraftState, repositoryId: string, mode: WorkDraft['mode'], prompt: string, name: string): ProjectDraftState {
  const key = draftKey({ repositoryId, mode }); const draft = state.drafts[key];
  if (!draft || draft.prompt !== prompt || draft.name.trim() !== name) return state;
  return { ...state, drafts: { ...state.drafts, [key]: { ...draft, prompt: '', name: '' } } };
}
