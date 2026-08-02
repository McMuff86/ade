/**
 * Startup integrity notice for the persisted config.
 *
 * When ADE cannot load its config file it continues with an empty catalog,
 * which on screen is indistinguishable from a fresh install. This banner names
 * the failure and where the original bytes were preserved. A store that could
 * not preserve the original refuses every write, so that notice is blocking
 * and cannot be dismissed.
 */

import { useEffect, useState } from 'react';
import type { ConfigLoadFailure } from '../shared/types';

const REASON: Record<ConfigLoadFailure['reason'], string> = {
  unreadable: 'ADE could not read its configuration file.',
  malformed: 'ADE’s configuration file was not valid JSON.',
  incompatible: 'ADE could not migrate its configuration file.',
};

export function ConfigHealthBanner() {
  const [failure, setFailure] = useState<ConfigLoadFailure | null>(null);
  const [recoveryFailure, setRecoveryFailure] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let active = true;
    window.ade.invoke('config:health')
      .then((health) => {
        if (!active) return;
        setFailure(health.loadFailure);
        setRecoveryFailure(health.importRecoveryFailure);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  // An interrupted workspace import that could not be finished at startup. ADE
  // still runs, but no new import may start until this is resolved, so the
  // notice is not dismissible.
  if (!failure && recoveryFailure) {
    return (
      <div className="config-alert config-alert-blocking" role="alert" data-testid="config-health-alert">
        <div className="config-alert-body">
          <strong className="config-alert-title">
            An interrupted workspace import could not be finished
          </strong>
          <span className="config-alert-detail">
            ADE started normally and your configuration is intact, but the pending import journal
            in the ADE data directory could not be replayed. Further imports are refused until it
            is resolved.
          </span>
          <code className="config-alert-cause">{recoveryFailure}</code>
        </div>
      </div>
    );
  }

  if (!failure) return null;
  if (dismissed && !failure.readOnly) return null;

  return (
    <div
      className={failure.readOnly ? 'config-alert config-alert-blocking' : 'config-alert'}
      role="alert"
      data-testid="config-health-alert"
    >
      <div className="config-alert-body">
        <strong className="config-alert-title">
          {failure.readOnly
            ? 'Configuration unreadable — ADE is running read-only'
            : 'Configuration recovered — agents and runs were not loaded'}
        </strong>
        <span className="config-alert-detail">
          {REASON[failure.reason]}{' '}
          {failure.readOnly
            ? 'The original could not be moved aside, so ADE will not overwrite it and every '
              + 'change is refused. Repair or move config.json in the ADE data directory, '
              + 'then restart ADE.'
            : `The original is preserved at ${failure.quarantinedTo}, next to config.json in `
              + 'the ADE data directory. This session started from an empty catalog.'}
        </span>
        <code className="config-alert-cause">{failure.detail}</code>
      </div>
      {failure.readOnly ? null : (
        <button className="btn" onClick={() => setDismissed(true)}>
          Dismiss
        </button>
      )}
    </div>
  );
}
