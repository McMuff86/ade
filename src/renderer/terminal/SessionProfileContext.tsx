import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { intlLocale } from '../../shared/i18n';
import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
import { useEffect, useRef, useState } from 'react';
import type { SessionProfileContext as ProfileContext } from '../../shared/agentBehavior';

/** Metadata only. The saved profile text is inspected explicitly in its editor. */
export function SessionProfileContext({ context, readRevision, readText }: {
  context?: ProfileContext; readRevision: () => Promise<string>; readText: () => Promise<string | null>;
}) {
  useLocale();
  const [revision, setRevision] = useState<string>(); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [text, setText] = useState<string>();
  const live = useRef(true);
  useEffect(() => { live.current = true; setRevision(undefined); setText(undefined); setError(''); return () => { live.current = false; }; }, [context?.digest]);
  if (!context) return null;
  return <details className="session-profile-context"><summary>{translate("Profile at start ·")}{" "}{context.profileName}</summary>
    <p>{translate("Pass profile instructions ·")}{" "}{new Date(context.capturedAt).toLocaleString(intlLocale())} · <code>{context.digest.slice(0, 12)}</code></p>
    <p>{translate("This status is maintained for the session. The display confirms the handover, not the observance by the model.")}</p>
    <ul>{context.sources.map((source, index) => <li key={`${source.kind}:${source.id ?? index}`}>{source.name} · {source.chars}{" "}{translate("characters ·")}{" "}<code>{source.sha256.slice(0, 12)}</code></li>)}</ul>
    <button type="button" disabled={busy} onClick={() => {
      setBusy(true); setError(''); void readRevision().then(value => { if (live.current) setRevision(value); })
        .catch(() => { if (live.current) setError(translate("Current profile status could not be checked.")); })
        .finally(() => { if (live.current) setBusy(false); });
    }}>{busy ? translate("Profile status is checked…") : translate("Compare with saved profile")}</button>
    {revision && <p role="status">{revision === (context.profileDigest ?? context.digest) ? translate("The stored profile corresponds to the starting status.") : translate("The saved profile has been changed. Start a new session to use the new status.")}</p>}
    <button type="button" disabled={busy} onClick={() => {
      setBusy(true); setError(''); void readText().then(value => { if (live.current) {
        if (value === null) setError(translate("The frozen profile text is no longer available.")); else setText(value);
      } }).catch(() => { if (live.current) setError(translate("The profile text could not be loaded.")); })
        .finally(() => { if (live.current) setBusy(false); });
    }}>{translate("View the instructions given")}</button>
    {text !== undefined && <pre aria-label={translate("Profile instructions submitted")} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 320, overflow: 'auto' }}>{text}</pre>}
    {error && <p role="alert">{localizeAppMessage(error)}</p>}
  </details>;
}
