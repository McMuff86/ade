import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
import { useRef } from 'react';
import type { PromptComposerPort } from './PromptComposer';
import { useComputerCall } from './useComputerCall';

/** Desktop test box: explicit, foreground-only call-and-response. It never writes a prompt. */
export function ComputerVoiceTest({ port, enabled, onBusy }: {
  port: PromptComposerPort; enabled: boolean; onBusy(busy: boolean): void;
}) {
  useLocale();
  const button = useRef<HTMLButtonElement>(null);
  const computer = useComputerCall(port, { enabled, onBusy, onSettled: () => requestAnimationFrame(() => button.current?.focus()) });
  const { active, status, error, reply } = computer;
  return <section className="computer-voice-test" aria-label={translate("Computer voice test")}>
    <div className="prompt-actions">
      <button ref={button} type="button" disabled={!enabled || active} onClick={() => void computer.run()}>{translate("Test computer voice")}</button>
      {active && <button type="button" onClick={computer.stop}>{translate("End computer voice test")}</button>}
      {reply && !active && <button type="button" disabled={!enabled} onClick={() => void computer.run(reply)}>{translate("Play greeting")}</button>}
    </div>
    <p className="prompt-help">{translate("Activate, then say \"computer.\" Personal greeting with the default ADE voice and a hint about the next dictation. The test listens for up to 20 seconds; leave this window open. Uses ElevenLabs for recognition and voice.")}</p>
    {!enabled && <p className="prompt-help">{translate("Requires a free dictation function and on the tablet also the permission for voices.")}</p>}
    {status && <p role="status">{status}</p>}{reply && <p aria-label={translate("Computer response")}>{reply.text}</p>}
    {error && <p role="alert">{localizeAppMessage(error)}</p>}
  </section>;
}
