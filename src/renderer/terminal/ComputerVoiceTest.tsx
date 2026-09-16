import { useRef } from 'react';
import type { PromptComposerPort } from './PromptComposer';
import { useComputerCall } from './useComputerCall';

/** Desktop test box: explicit, foreground-only call-and-response. It never writes a prompt. */
export function ComputerVoiceTest({ port, enabled, onBusy }: {
  port: PromptComposerPort; enabled: boolean; onBusy(busy: boolean): void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const computer = useComputerCall(port, { enabled, onBusy, onSettled: () => requestAnimationFrame(() => button.current?.focus()) });
  const { active, status, error, reply } = computer;
  return <section className="computer-voice-test" aria-label="Computer Sprachtest">
    <div className="prompt-actions">
      <button ref={button} type="button" disabled={!enabled || active} onClick={() => void computer.run()}>Computer testen</button>
      {active && <button type="button" onClick={computer.stop}>Computer-Test beenden</button>}
      {reply && !active && <button type="button" disabled={!enabled} onClick={() => void computer.run(reply)}>Begrüssung abspielen</button>}
    </div>
    <p className="prompt-help">Aktivieren, dann „Computer“ sagen. Persönliche Begrüssung mit der ADE-Standardstimme und einem Hinweis zum nächsten Diktat. Der Test hört bis zu 20 Sekunden zu; dieses Fenster offen lassen. Verwendet ElevenLabs für Erkennung und Stimme.</p>
    {!enabled && <p className="prompt-help">Benötigt eine freie Diktatfunktion und auf dem Tablet auch die Freigabe für Stimmen.</p>}
    {status && <p role="status">{status}</p>}{reply && <p aria-label="Computer Antwort">{reply.text}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
