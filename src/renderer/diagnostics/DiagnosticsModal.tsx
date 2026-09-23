import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
import { useCallback, useEffect, useState, type JSX } from 'react';
import type { RuntimeDiagnosticsResult } from '../../shared/types';
import { Modal } from '../onboarding/Modal';
import { useDiagnostics } from '../stores/diagnostics';
import { DiagnosticsReport } from './DiagnosticsReport';
import '../onboarding/onboarding.css';
import './diagnostics.css';

function safeMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .slice(0, 500);
}

export function DiagnosticsModal(): JSX.Element | null {
  useLocale();
  const open = useDiagnostics((state) => state.open);
  const agentId = useDiagnostics((state) => state.agentId);
  const sessionId = useDiagnostics((state) => state.sessionId);
  const hide = useDiagnostics((state) => state.hide);
  const [result, setResult] = useState<RuntimeDiagnosticsResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const run = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      setResult(await window.ade.invoke('runtime:diagnose', agentId
        ? { agentId, sessionId }
        : {}));
    } catch (cause) {
      setResult(null);
      setError(safeMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [agentId, sessionId]);

  useEffect(() => {
    if (!open) return;
    void run();
  }, [open, run]);

  if (!open) return null;

  return (
    <Modal
      title={translate("Diagnostics")}
      subtitle={translate("Read-only inspection of CLI availability, authentication and task delivery.")}
      onClose={hide}
    >
      <div className="diag-body" aria-live="polite"><DiagnosticsReport result={result} error={error} loading={loading} /></div>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={() => void run()} disabled={loading}>
          {loading ? translate("Checking…") : translate("Run again")}
        </button>
        <button type="button" className="btn primary" onClick={hide}>{translate("Close [436c6f73]")}</button>
      </div>
    </Modal>
  );
}
