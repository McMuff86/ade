import { t as translate } from "../../shared/i18n";
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
      if (!value || typeof value !== 'object' || Array.isArray(value) || !exactActionKeys(value as Record<string, unknown>, Object.keys(properties))) throw new Error(translate("Invalid ADE tool arguments."));
      const result = JSON.stringify(invoke(value as Record<string, unknown>, context)); authorize();
      if (Buffer.byteLength(result) > 16 * 1024) throw new Error(translate("ADE result is too big. Read a single entry or another page."));
      return result;
    },
  });
  const id = { type: 'string' }; const text = { type: 'string', maxLength: 4000 }; const offset = { type: 'integer', minimum: 0, maximum: 1_000_000 };
  const pageOffset = (value: unknown): number => { if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 1_000_000) throw new Error(translate("Invalid page offset.")); return value as number; };
  const page = (value: unknown, start: number) => {
    const full = JSON.stringify(value); if (start > full.length || start > 0 && /[\uDC00-\uDFFF]/.test(full[start])) throw new Error(translate("Invalid page offset."));
    let end = Math.min(full.length, start + 2000); if (end < full.length && /[\uD800-\uDBFF]/.test(full[end - 1])) end--;
    return { text: full.slice(start, end), totalChars: full.length, nextOffset: end < full.length ? end : null };
  };
  return [
    tool('ade_codex_profiles', translate("Native Codex profiles for an explicitly desired project assignment. offset starts at 0."), { offset }, args => {
      const profiles = config.get().agents.filter(a => a.runtime === 'codex' && !a.customCommand?.trim() && (!a.homeExecutionBackend || a.homeExecutionBackend === 'native') && a.codexModel && a.codexReasoningEffort);
      const start = pageOffset(args.offset);
      return { profiles: profiles.slice(start, start + 10).map(a => ({ id: a.id, name: a.name, model: a.codexModel, reasoning: a.codexReasoningEffort })), nextOffset: start + 10 < profiles.length ? start + 10 : null };
    }),
    tool('ade_prepare_handoff', translate("Prepare a persistent project handoff only on explicit request. The user must save the proposal in the dialog. This does not start project work."), { projectId: id, text, nextStep: text }, (args, context) => actions.propose({ ...args, kind: 'handoff' }, source(), context)),
    tool('ade_prepare_task', translate("Prepare only an explicitly requested Codex project job. The project must allow Coordinate mode. The user must start the proposal in the dialog. Brainstorming and ideas saved for later are not work orders."), { projectId: id, agentId: id, prompt: { type: 'string', maxLength: 32_000 } }, (args, context) => actions.propose({ ...args, kind: 'task' }, source(), context)),
    tool('ade_actions', translate("Saved proposals and observed job states for this conversation. Do not claim a confirmed start without an applied receipt."), { offset }, args => {
      const all = actions.list(source().conversationId); const start = pageOffset(args.offset);
      return { actions: all.slice(start, start + 10), nextOffset: start + 10 < all.length ? start + 10 : null };
    }),
    tool('ade_action_result', translate("Complete ADE RunReport for this conversation's project task, including open questions, paginated from offset 0. The result is observed state; the user answers questions in the dialog."), { actionId: id, offset }, args => {
      if (!conversationId(args.actionId)) throw new Error(translate("Invalid job identity."));
      return page(actions.work(source().conversationId, args.actionId), pageOffset(args.offset));
    }),
  ];
}
