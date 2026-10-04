import { t as translate } from "../../shared/i18n";
import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { useLocale } from "../i18n/language";
import { useRef, useState } from 'react';

/**
 * Answer a finished single task. The agent continues in the recorded CLI
 * conversation; the host decides whether that is still possible. A failed send
 * keeps the draft and retries under the same key, so one answer starts one task.
 */
export function TaskReplyForm({ idPrefix, disabled, send, errorText }: {
  idPrefix: string; disabled?: boolean;
  send(prompt: string, key: string): Promise<void>;
  errorText(reason: unknown): string;
}) {
  useLocale();
  const [text, setText] = useState(''); const [pending, setPending] = useState(false); const [error, setError] = useState('');
  const attempt = useRef<{ text: string; key: string } | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const submit = async () => {
    const prompt = text.trim(); if (!prompt || pending) return;
    if (attempt.current?.text !== prompt) attempt.current = { text: prompt, key: crypto.randomUUID() };
    // The form unmounts once the reply is queued; keep keyboard focus inside its dialog or panel.
    const home = form.current?.closest<HTMLElement>('[role="dialog"], dialog, section, article');
    setPending(true); setError('');
    try {
      await send(prompt, attempt.current.key); attempt.current = null; setText('');
      requestAnimationFrame(() => {
        if (!home?.isConnected || (document.activeElement && document.activeElement !== document.body && document.activeElement.isConnected)) return;
        if (!home.hasAttribute('tabindex')) home.setAttribute('tabindex', '-1');
        home.focus();
      });
    }
    catch (reason) { setError(errorText(reason)); }
    finally { setPending(false); }
  };
  return <form ref={form} className="task-reply" aria-label={translate("Reply to the agent")} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <label htmlFor={`${idPrefix}-reply`}>{translate("Reply to the agent")}</label>
    <textarea id={`${idPrefix}-reply`} value={text} maxLength={8000} rows={3} disabled={pending} onChange={(event) => setText(event.target.value)} />
    <p className="task-reply-note">{translate("The agent continues in the same conversation and workspace.")}</p>
    {error && <p role="alert">{localizeAppMessage(error)}</p>}
    {pending && <p role="status">{translate("Sending reply…")}</p>}
    <button type="submit" disabled={disabled || pending || !text.trim()}>{translate("Send reply")}</button>
  </form>;
}
