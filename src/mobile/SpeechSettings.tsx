import { useRef, useState } from 'react';
import type { MobileSpeechCommand, MobileSpeechResult } from '../shared/remote';
import { speechTargetKey, type SpeechAudio, type SpeechTarget } from '../shared/speech';
import { SpeechPreferenceSection } from '../renderer/settings/SpeechPreferenceSection';
import { useDeviceDraft } from './deviceDrafts';
import { MobileClientError } from './client';
import type { MobileHost } from './useMobileHost';

interface PendingSpeech { key: string; command: MobileSpeechCommand }
export function MobileSpeechSettings({ host, target, title }: { host: MobileHost; target: SpeechTarget; title?: string }) {
  return <SpeechSettings key={`${host.identityVersion}:${speechTargetKey(target)}`} host={host} target={target} title={title} />;
}
function SpeechSettings({ host, target, title }: { host: MobileHost; target: SpeechTarget; title?: string }) {
  const [pending, savePending] = useDeviceDraft<PendingSpeech | null>(host.deviceId, speechTargetKey(target), null);
  const [error, setError] = useState(''); const [retrying, setRetrying] = useState(false); const lock = useRef(false);
  const [recoveredAudio, setRecoveredAudio] = useState<SpeechAudio>();
  const [executing, setExecuting] = useState(false);
  const execute = async (job: PendingSpeech): Promise<SpeechAudio | undefined> => {
    if (!savePending(job)) throw new Error('Browser-Speicher nicht verfügbar. Sprachaktion wurde nicht gestartet.');
    setExecuting(true);
    try {
      const result = await host.request<MobileSpeechResult>('/api/v1/speech/command', 'POST', job.command, job.key);
      const audio = job.command.operation === 'test'
        ? (await host.request<MobileSpeechResult>('/api/v1/speech/query', 'POST', { operation: 'audio', testId: result.testId })).audio : undefined;
      if (job.command.operation === 'test' && !audio) throw new Error('Stimmtest ist nicht verfügbar.');
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
        if (!rights.capabilities?.includes('speech:control')) throw new Error('Am PC unter Settings → Verbundene Geräte die Freigabe „Stimmen wählen und ElevenLabs-Stimmtests ausführen“ aktivieren.');
        const result = await host.request<MobileSpeechResult>('/api/v1/speech/query', 'POST', { operation: 'voices', target });
        if (!result.preferences) throw new Error('Stimmeneinstellungen sind nicht verfügbar.'); return result.preferences;
      },
      select: async (voiceId, tuning) => { await execute({ key: crypto.randomUUID(), command: { operation: 'select', target, voiceId, ...(tuning ? { tuning } : {}) } }); },
      test: async (voiceId, tuning) => (await execute({ key: crypto.randomUUID(), command: { operation: 'test', target, voiceId, ...(tuning ? { tuning } : {}) } }))!,
    }} />
    {pending && <section aria-label="Offene Sprachaktion"><p>Die letzte Sprachaktion ist noch nicht bestätigt. Erneut prüfen verwendet denselben Auftrag.</p>
      <button disabled={executing || retrying || host.status !== 'online'} onClick={() => {
        if (lock.current) return; lock.current = true; setRetrying(true); setError('');
        void execute(pending).then(audio => { if (audio) setRecoveredAudio(audio); }).catch(reason => setError(reason instanceof Error ? reason.message : 'Sprachaktion konnte nicht bestätigt werden.'))
          .finally(() => { lock.current = false; setRetrying(false); });
      }}>Sprachaktion erneut prüfen</button>
      <button disabled={executing || retrying} onClick={() => savePending(null)}>Offene Aktion verwerfen</button>
      <p>Ein danach neu gestarteter Stimmtest kann erneut Guthaben verbrauchen.</p>
    </section>}{error && <p role="alert">{error}</p>}
  </div>;
}
