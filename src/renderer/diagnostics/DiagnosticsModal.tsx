import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
import { useCallback, useEffect, useState, type JSX } from 'react';
import type { RuntimeDiagnosticsResult } from '../../shared/types';
import { Modal } from '../onboarding/Modal';
import { useDiagnostics } from '../stores/diagnostics';
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
  const ready = result?.items.filter((item) => item.status === 'ready').length ?? 0;

  return (
    <Modal
      title={translate("Diagnostics")}
      subtitle={translate("Read-only inspection of CLI availability, authentication and task delivery.")}
      onClose={hide}
    >
      <div className="diag-body" aria-live="polite">
        {loading && !result ? <div className="diag-empty">{translate("Checking configured runtimes…")}</div> : null}
        {error ? <div className="diag-error">{localizeAppMessage(error)}</div> : null}
        {result && result.items.length === 0 ? (
          <div className="diag-empty">{translate("Add an agent before running CLI diagnostics.")}</div>
        ) : null}
        {result && result.items.length > 0 ? (
          <>
            <div className="diag-summary">
              {result.items.length === 1 ? translate("{{value1}} of 1 configured runtime is ready", { value1: ready }) : translate("{{value1}} of {{value2}} configured runtimes are ready", { value1: ready, value2: result.items.length })}</div>
            <div className="diag-list">
              {result.items.map((item) => (
                <section className={`diag-item ${item.status}`} key={item.agentId}>
                  <div className="diag-item-head">
                    <span className="diag-status" aria-hidden="true" />
                    <strong>{item.agentName}</strong>
                    <span>{item.label}</span>
                  </div>
                  <div className="diag-message">{localizeAppMessage(item.message)}</div>
                  <dl>
                    <div>
                      <dt>{translate("Backend")}</dt>
                      <dd>{item.executionBackend?.startsWith('wsl:')
                        ? `WSL · ${item.executionBackend.slice('wsl:'.length)}`
                        : translate("Native")}</dd>
                    </div>
                    <div><dt>{translate("Command")}</dt><dd>{item.command}</dd></div>
                    <div>
                      <dt>{translate("Version")}</dt>
                      <dd>{item.version ?? (item.installed === false ? translate("Not installed") : translate("Not checked"))}</dd>
                    </div>
                    <div><dt>{translate("Authentication")}</dt><dd>{item.authDetail}</dd></div>
                    <div>
                      <dt>{translate("Task mode")}</dt>
                      <dd>{item.taskTransport === 'unavailable' ? translate("Interactive only") : item.taskTransport}</dd>
                    </div>
                  </dl>
                </section>
              ))}
            </div>
          </>
        ) : null}
      </div>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={() => void run()} disabled={loading}>
          {loading ? translate("Checking…") : translate("Run again")}
        </button>
        <button type="button" className="btn primary" onClick={hide}>{translate("Close [436c6f73]")}</button>
      </div>
    </Modal>
  );
}
