import type { AdeConfig } from '../../shared/types';
import { exactActionKeys } from '../../shared/coordinatorActions';
import { conversationId } from '../../shared/conversation';
import type { CodexDynamicTool, CodexToolContext } from '../pty/CodexDynamicTools';
import type { CoordinatorActionService, CoordinatorActionSource } from './CoordinatorActionService';

export const COORDINATOR_ACTION_TOOLS = 'ade-project-actions-v1';
export function coordinatorActionTools(actions: CoordinatorActionService, config: { get(): AdeConfig }, source: () => CoordinatorActionSource, authorize: () => void): CodexDynamicTool[] {
  const tool = (name: string, description: string, properties: Record<string, unknown>, invoke: (args: Record<string, unknown>, context: CodexToolContext) => unknown): CodexDynamicTool => ({
    name, description, inputSchema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false },
    invoke: async (value, context) => {
      authorize(); context.signal.throwIfAborted();
      if (!value || typeof value !== 'object' || Array.isArray(value) || !exactActionKeys(value as Record<string, unknown>, Object.keys(properties))) throw new Error('Ungültige ADE-Werkzeugargumente.');
      const result = JSON.stringify(invoke(value as Record<string, unknown>, context)); authorize();
      if (Buffer.byteLength(result) > 16 * 1024) throw new Error('ADE-Ergebnis ist zu gross. Einen einzelnen Eintrag oder eine weitere Seite lesen.');
      return result;
    },
  });
  const id = { type: 'string' }; const text = { type: 'string', maxLength: 4000 }; const offset = { type: 'integer', minimum: 0, maximum: 1_000_000 };
  const pageOffset = (value: unknown): number => { if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 1_000_000) throw new Error('Ungültige Seitenposition.'); return value as number; };
  const page = (value: unknown, start: number) => {
    const full = JSON.stringify(value); if (start > full.length || start > 0 && /[\uDC00-\uDFFF]/.test(full[start])) throw new Error('Ungültige Seitenposition.');
    let end = Math.min(full.length, start + 2000); if (end < full.length && /[\uD800-\uDBFF]/.test(full[end - 1])) end--;
    return { text: full.slice(start, end), totalChars: full.length, nextOffset: end < full.length ? end : null };
  };
  return [
    tool('ade_codex_profiles', 'Native Codex-Profile für einen ausdrücklich gewünschten Projektauftrag. offset beginnt bei 0.', { offset }, args => {
      const profiles = config.get().agents.filter(a => a.runtime === 'codex' && !a.customCommand?.trim() && (!a.homeExecutionBackend || a.homeExecutionBackend === 'native') && a.codexModel && a.codexReasoningEffort);
      const start = pageOffset(args.offset);
      return { profiles: profiles.slice(start, start + 10).map(a => ({ id: a.id, name: a.name, model: a.codexModel, reasoning: a.codexReasoningEffort })), nextOffset: start + 10 < profiles.length ? start + 10 : null };
    }),
    tool('ade_prepare_handoff', 'Bereite nur auf ausdrücklichen Wunsch eine dauerhafte Projektübergabe vor. Erst der Benutzer speichert den Vorschlag im Dialog. Dies startet keine Projektarbeit.', { projectId: id, text, nextStep: text }, (args, context) => actions.propose({ ...args, kind: 'handoff' }, source(), context)),
    tool('ade_prepare_task', 'Bereite nur einen ausdrücklich gewünschten Codex-Projektauftrag vor. Projekt muss Koordinieren erlauben. Erst der Benutzer startet den Vorschlag im Dialog. Brainstorming und Vormerkungen sind kein Auftrag.', { projectId: id, agentId: id, prompt: { type: 'string', maxLength: 32_000 } }, (args, context) => actions.propose({ ...args, kind: 'task' }, source(), context)),
    tool('ade_actions', 'Gespeicherte Vorschläge und beobachtete Auftragszustände dieses Gesprächs. Kein bestätigter Start ohne angewendeten Beleg.', { offset }, args => {
      const all = actions.list(source().conversationId); const start = pageOffset(args.offset);
      return { actions: all.slice(start, start + 10), nextOffset: start + 10 < all.length ? start + 10 : null };
    }),
    tool('ade_action_result', 'Vollständiger ADE-RunReport der eigenen Projektaufgabe samt offenen Rückfragen, seitenweise ab offset 0. Ergebnis ist beobachteter Stand; Rückfragen beantwortet der Benutzer im Dialog.', { actionId: id, offset }, args => {
      if (!conversationId(args.actionId)) throw new Error('Ungültige Auftragsidentität.');
      return page(actions.work(source().conversationId, args.actionId), pageOffset(args.offset));
    }),
  ];
}
