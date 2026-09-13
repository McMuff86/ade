import { speechTargetKey, type SpeechTarget } from '../../shared/speech';
import { SpeechPreferenceSection } from './SpeechPreferenceSection';
export function TargetSpeechSettings({ target, title }: { target: SpeechTarget; title?: string }) {
  return <SpeechPreferenceSection key={speechTargetKey(target)} title={title} port={{
    load: () => window.ade.invoke('speech:preferences', target),
    select: voiceId => window.ade.invoke('speech:configure', { target, voiceId }),
    test: voiceId => window.ade.invoke('speech:test', { voiceId }),
  }} />;
}
