import { t as translate } from "../../shared/i18n";
import type { AdeConfig } from '../../shared/types';
import type { AgentBehaviorUpdate, AgentBehaviorView } from '../../shared/agentBehavior';
import { validateAgentBehaviorProfile } from '../../shared/agentProfile';
import { previewAgentInstructions } from './agentInstructions';
import { redactForWire } from '../errors';

export function validateBehaviorUpdate(value: unknown): AgentBehaviorUpdate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(translate("Invalid profile instructions."));
  const item = value as Record<string, unknown>;
  if (Object.keys(item).length !== 3 || !Object.hasOwn(item, 'agentId') || !Object.hasOwn(item, 'revision') || !Object.hasOwn(item, 'profile')
    || typeof item.agentId !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(item.agentId)
    || typeof item.revision !== 'string' || !/^[a-f0-9]{64}$/.test(item.revision)) throw new Error(translate("Invalid profile instructions."));
  return { agentId: item.agentId, revision: item.revision, profile: validateAgentBehaviorProfile(item.profile) };
}

/** Profile copies live in ADE config, never in a leased project. */
export class AgentBehaviorService {
  constructor(private readonly store: { get(): AdeConfig; save(partial: Partial<AdeConfig>): unknown }) {}
  private agent(id: string) {
    const agent = this.store.get().agents.find(item => item.id === id);
    if (!agent) throw new Error(translate("Agent no longer exists."));
    return agent;
  }
  query(id: string, wire = false): AgentBehaviorView {
    const agent = this.agent(id); const snapshot = previewAgentInstructions(agent);
    const profile = structuredClone(agent.profile ?? { instructions: '', documents: [] });
    const raw = { profile, revision: snapshot.sha256, context: { text: snapshot.content, sources: snapshot.sources, chars: snapshot.chars } };
    if (!wire) return raw;
    const clean = (text: string) => redactForWire(text, 32_000);
    const safeProfile = { instructions: clean(profile.instructions), documents: profile.documents.map(doc => ({ ...doc, name: clean(doc.name), text: clean(doc.text) })) };
    return { ...raw, profile: safeProfile, context: { ...raw.context, text: clean(snapshot.content), sources: snapshot.sources.map(source => ({ ...source, name: clean(source.name) })) },
      ...(JSON.stringify(safeProfile) !== JSON.stringify(profile) ? { redacted: true } : {}) };
  }
  update(value: unknown): { revision: string } {
    const input = validateBehaviorUpdate(value); const agent = this.agent(input.agentId);
    if (this.query(agent.id).revision !== input.revision) throw new Error(translate("Profile instructions changed. Reload and review the changes."));
    const updated = { ...agent, profile: structuredClone(input.profile) };
    const snapshot = previewAgentInstructions(updated);
    this.store.save({ agents: this.store.get().agents.map(item => item.id === agent.id ? updated : item) });
    return { revision: snapshot.sha256 };
  }
}
