import { t as translate } from "../shared/i18n";
import { useLocale } from "../renderer/i18n/language";
import { useEffect, useState, type JSX } from 'react';
import type { MobileDiagnosticsResult, MobileHostState } from '../shared/remote';
import type { MobileHost } from './useMobileHost';
import { MobileClientError } from './client';
import { DiagnosticsReport } from '../renderer/diagnostics/DiagnosticsReport';

/**
 * Tablet diagnostics: the PC runs the same non-mutating CLI checks as its own
 * "Diagnostics" dialog and returns a redacted report. Needs the device grant
 * "Run CLI diagnostics"; without it the section says where to enable it.
 */
export function MobileDiagnostics({ host }: { host: MobileHost }): JSX.Element {
  useLocale();
  const [result, setResult] = useState<MobileDiagnosticsResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [granted, setGranted] = useState<boolean | null>(null);
  useEffect(() => {
    setResult(null); setError(''); setGranted(null);
    if (!host.paired || host.status !== 'online') return;
    let disposed = false;
    void host.request<MobileHostState>('/api/v1/host').then((state) => { if (!disposed) setGranted(state.capabilities?.includes('diagnostics:read') === true); }).catch(() => undefined);
    return () => { disposed = true; };
  }, [host.paired, host.status, host.request, host.identityVersion]);
  const run = async (): Promise<void> => {
    setLoading(true); setError('');
    try {
      setResult(await host.request<MobileDiagnosticsResult>('/api/v1/diagnostics/query', 'POST', {}, crypto.randomUUID())); setGranted(true);
    } catch (reason) {
      setResult(null);
      if (reason instanceof MobileClientError && reason.code === 'scope_not_granted') setGranted(false);
      else setError(reason instanceof Error ? reason.message.slice(0, 300) : translate("Diagnostics could not be run."));
    } finally { setLoading(false); }
  };
  const online = host.paired && host.status === 'online';
  return <section className="m-settings-section m-diagnostics" aria-labelledby="mobile-diagnostics-title">
    <h3 id="mobile-diagnostics-title">{translate("Diagnostics")}</h3>
    <p>{translate("Checks CLI availability, sign-in and task delivery on the PC. Nothing is changed; the version and sign-in commands run on the PC.")}</p>
    {granted === false
      ? <p role="status">{translate("On the PC, open Settings → Connected devices and enable “Run CLI diagnostics” for this device.")}</p>
      : <>
        <button type="button" disabled={loading || !online} onClick={() => void run()}>{loading ? translate("Checking…") : result ? translate("Run again") : translate("Run diagnostics")}</button>
        {!online && <p className="m-field-note">{translate("Connect to the PC to run diagnostics.")}</p>}
        <div className="diag-body" aria-live="polite"><DiagnosticsReport result={result} error={error} loading={loading} /></div>
      </>}
  </section>;
}
