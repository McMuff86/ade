import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
import type { JSX } from 'react';
import type { RuntimeDiagnosticsResult } from '../../shared/types';
import './diagnostics.css';

/**
 * The diagnostics list shared by the desktop modal and the tablet settings
 * section: loading, error and empty states plus one flat row per runtime.
 * Callers own the fetch; this component only renders what they hold.
 */
export function DiagnosticsReport({ result, error, loading }: { result: RuntimeDiagnosticsResult | null; error: string; loading: boolean }): JSX.Element {
  useLocale();
  const ready = result?.items.filter((item) => item.status === 'ready').length ?? 0;
  return <>
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
  </>;
}
