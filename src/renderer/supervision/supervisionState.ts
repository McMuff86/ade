import { t as translate } from "../../shared/i18n";
import { create } from 'zustand';
import type { SupervisionAction, SupervisionView } from '../../shared/supervision';
interface State {
  view: SupervisionView | null; error: string; busy: boolean;
  refresh(): Promise<void>; command(action: SupervisionAction, revision: number): Promise<number>;
}
export const useSupervision = create<State>((set, get) => ({
  view: null, error: '', busy: false,
  refresh: async () => {
    try { const view = await window.ade.invoke('supervision:get'); set(state => !state.view || view.revision >= state.view.revision ? { view, error: '' } : {}); }
    catch (reason) { set({ error: String(reason) }); }
  },
  command: async (action, revision) => {
    if (get().busy) throw new Error(translate("A supervision job is still running."));
    set({ busy: true, error: '' });
    try { const receipt = await window.ade.invoke('supervision:command', { ...action, revision, commandId: crypto.randomUUID() }); await get().refresh(); return receipt.revision; }
    catch (reason) { set({ error: String(reason) }); throw reason; }
    finally { set({ busy: false }); }
  },
}));
