import type { AdeConfig } from '../../shared/types';
import { validSpeechTarget, validSpeechSelection, type SpeechPreference, type SpeechSelection, type SpeechTarget } from '../../shared/speech';
import type { SpeechService } from './SpeechService';

interface Store { get(): AdeConfig; save(value: Partial<AdeConfig>): unknown }
/** Identity metadata only: voice selection never changes CLI/workspace configuration. */
export class SpeechPreferences {
  constructor(private readonly store: Store, private readonly speech: SpeechService) {}
  private target(target: SpeechTarget) {
    if (!validSpeechTarget(target)) throw new Error('Ungültiges Sprachziel.');
    const config = this.store.get();
    const agent = target.kind === 'agent' ? config.agents.find(item => item.id === target.agentId) : undefined;
    const repositoryId = target.kind === 'default' ? undefined : target.repositoryId;
    const project = repositoryId ? config.repositories.find(item => item.id === repositoryId) : undefined;
    if (target.kind === 'agent' && !agent || repositoryId && !project) throw new Error('Agent oder Projekt ist nicht mehr vorhanden.');
    return { config, agent, project };
  }
  async query(target: SpeechTarget, refresh = false): Promise<SpeechPreference> {
    this.target(target);
    const catalog = await this.speech.catalog(refresh);
    const { config, agent, project } = this.target(target);
    const female = catalog.voices.find(voice => voice.gender === 'female')?.id ?? null;
    const standard = config.settings.speechVoiceId ?? female;
    const inherited = target.kind === 'agent' ? project?.speechVoiceId ?? standard : target.kind === 'project' ? standard : female;
    const selected = target.kind === 'agent' ? agent?.speechVoiceId : target.kind === 'project' ? project?.speechVoiceId : config.settings.speechVoiceId;
    const effective = selected ?? inherited;
    const source = !effective ? 'unavailable' : agent?.speechVoiceId ? 'agent' : project?.speechVoiceId ? 'project' : config.settings.speechVoiceId ? 'default' : 'female-default';
    return { voices: catalog.voices, target, selectedVoiceId: selected ?? null, inheritedVoiceId: inherited, effectiveVoiceId: effective, source };
  }
  async select(input: SpeechSelection, authorize: () => void = () => undefined): Promise<void> {
    if (!validSpeechSelection(input)) throw new Error('Ungültige Stimmenauswahl.');
    this.target(input.target);
    if (input.voiceId !== null && !(await this.speech.catalog()).voices.some(voice => voice.id === input.voiceId)) throw new Error('Stimme nicht verfügbar. Stimmen neu laden.');
    authorize(); const { config, agent, project } = this.target(input.target); const speechVoiceId = input.voiceId ?? undefined;
    if (input.target.kind === 'default') this.store.save({ settings: { ...config.settings, speechVoiceId } });
    else if (agent) this.store.save({ agents: config.agents.map(item => item.id === agent.id ? { ...item, speechVoiceId } : item) });
    else if (project) this.store.save({ repositories: config.repositories.map(item => item.id === project.id ? { ...item, speechVoiceId } : item) });
  }
}
