import { localizeAppMessage } from '../shared/i18n/appMessages';
import { t as translate } from "../shared/i18n";
import { useLocale } from "../renderer/i18n/language";
import { useRef, useState } from 'react';
import type { MobileSpeechCommand, MobileSpeechResult } from '../shared/remote';
import { speechTargetKey, type SpeechAudio, type SpeechTarget } from '../shared/speech';
import { SpeechPreferenceSection } from '../renderer/settings/SpeechPreferenceSection';
import { useDeviceDraft } from './deviceDrafts';
import { MobileClientError } from './client';
import type { MobileHost } from './useMobileHost';

interface PendingSpeech { key: string; command: MobileSpeechCommand }
export function MobileSpeechSettings({ host, target, title }: { host: MobileHost; target: SpeechTarget; title?: string }) {
  useLocale();
  return <SpeechSettings key={`${host.identityVersion}:${speechTargetKey(target)}`} host={host} target={target} title={title} />;
}
function SpeechSettings({ host, target, title }: { host: MobileHost; target: SpeechTarget; title?: string }) {
  useLocale();
  const [pending, savePending] = useDeviceDraft<PendingSpeech | null>(host.deviceId, speechTargetKey(target), null);
  const [error, setError] = useState(''); const [retrying, setRetrying] = useState(false); const lock = useRef(false);
  const [recoveredAudio, setRecoveredAudio] = useState<SpeechAudio>();
  const [executing, setExecuting] = useState(false);
  const execute = async (job: PendingSpeech): Promise<SpeechAudio | undefined> => {
    if (!savePending(job)) throw new Error(translate("Browser storage not available. Voice action was not started."));
    setExecuting(true);
    try {
      const result = await host.request<MobileSpeechResult>('/api/v1/speech/command', 'POST', job.command, job.key);
      const audio = job.command.operation === 'test'
        ? (await host.request<MobileSpeechResult>('/api/v1/speech/query', 'POST', { operation: 'audio', testId: result.testId })).audio : undefined;
      if (job.command.operation === 'test' && !audio) throw new Error(translate("Voice test is not available."));
      savePending(null); return audio;
    } catch (reason) {
      if (reason instanceof MobileClientError && [400, 403, 404, 422].includes(reason.status)) savePending(null);
      throw reason;
    } finally {
      setExecuting(false);
    }
  };
  return <div className="m-speech-settings">
    <SpeechPreferenceSection title={title} enabled={host.status === 'online'} pending={!!pending || retrying} recoveredAudio={recoveredAudio} port={{
      load: async () => {
        const rights = await host.request<{ capabilities?: string[] }>('/api/v1/host');
        if (!rights.capabilities?.includes('speech:control')) throw new Error(translate("On the PC, open Settings → Connected devices and enable “Choose voices and run ElevenLabs voice tests”."));
        const result = await host.request<MobileSpeechResult>('/api/v1/speech/query', 'POST', { operation: 'voices', target });
        if (!result.preferences) throw new Error(translate("Voice settings are not available.")); return result.preferences;
      },
      select: async (voiceId, tuning) => { await execute({ key: crypto.randomUUID(), command: { operation: 'select', target, voiceId, ...(tuning ? { tuning } : {}) } }); },
      test: async (voiceId, tuning) => (await execute({ key: crypto.randomUUID(), command: { operation: 'test', target, voiceId, ...(tuning ? { tuning } : {}) } }))!,
    }} />
    {pending && <section aria-label={translate("Pending voice operation")}><p>{translate("The last voice operation has not been confirmed yet. Checking again uses the same request.")}</p>
      <button disabled={executing || retrying || host.status !== 'online'} onClick={() => {
        if (lock.current) return; lock.current = true; setRetrying(true); setError('');
        void execute(pending).then(audio => { if (audio) setRecoveredAudio(audio); }).catch(reason => setError(reason instanceof Error ? reason.message : translate("Voice operation could not be confirmed.")))
          .finally(() => { lock.current = false; setRetrying(false); });
      }}>{translate("Check voice operation again")}</button>
      <button disabled={executing || retrying} onClick={() => savePending(null)}>{translate("Discard pending operation")}</button>
      <p>{translate("A voice test that is restarted afterwards can consume credit again.")}</p>
    </section>}{error && <p role="alert">{localizeAppMessage(error)}</p>}
  </div>;
}
