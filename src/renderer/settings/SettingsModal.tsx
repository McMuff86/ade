/**
 * ADE settings — harness management: per-CLI readiness including the CLI's
 * own sign-in state (subscription logins stay with the CLI and simply keep
 * working for ADE), a sign-in terminal per harness, write-only encrypted
 * API keys and generic encrypted service keys with an injection scope.
 * Stored values are never displayed; the renderer only ever sees booleans.
 */

import { useCallback, useEffect, useState, type JSX } from 'react';
import type {
  HarnessStatusResult,
  RuntimeDiagnosticsResult,
  RuntimeId,
  ServiceKeyScope,
} from '../../shared/types';
import {
  HARNESS_API_KEY_ENV,
  HARNESS_LOGIN_COMMANDS,
  HARNESS_RUNTIMES,
  LAUNCH_PROFILES,
} from '../../shared/runtimes';
import { Modal } from '../onboarding/Modal';
import { runtimeVisual } from '../graph/runtimeGlyphs';
import { useSelection } from '../stores/selection';
import { useSessions } from '../stores/sessions';
import { useMode } from '../stores/mode';
import '../onboarding/onboarding.css';
import './settings.css';

const SCOPE_RUNTIMES: readonly RuntimeId[] = [
  'claude', 'codex', 'opencode', 'grok', 'gemini', 'ollama', 'shell', 'custom',
];

function safeMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .slice(0, 500);
}

function formatSavedAt(value: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    .format(new Date(value));
}

function scopeLabel(scope: ServiceKeyScope): string {
  return scope === 'all'
    ? 'alle Sessions'
    : scope.map((runtime) => LAUNCH_PROFILES[runtime].label).join(', ');
}

export function SettingsModal({ onClose }: { onClose: () => void }): JSX.Element {
  const selectedAgentId = useSelection((state) => state.selectedAgentId);
  const openHarnessLogin = useSessions((state) => state.openHarnessLogin);
  const setMode = useMode((state) => state.setMode);
  const [status, setStatus] = useState<HarnessStatusResult | null>(null);
  const [diagnosis, setDiagnosis] = useState<RuntimeDiagnosticsResult | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyValue, setNewKeyValue] = useState('');
  const [newKeyAllSessions, setNewKeyAllSessions] = useState(true);
  const [newKeyRuntimes, setNewKeyRuntimes] = useState<Record<string, boolean>>({});

  const refreshStatus = useCallback(async (): Promise<void> => {
    try {
      setStatus(await window.ade.invoke('harness:status'));
    } catch (cause) {
      setError(safeMessage(cause));
    }
  }, []);

  const runDiagnose = useCallback(async (): Promise<void> => {
    setDiagnosing(true);
    try {
      setDiagnosis(await window.ade.invoke('harness:diagnose'));
    } catch (cause) {
      setError(safeMessage(cause));
    } finally {
      setDiagnosing(false);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    void runDiagnose();
  }, [refreshStatus, runDiagnose]);

  const guarded = async (action: () => Promise<void>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(safeMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const saveKey = (runtime: RuntimeId): Promise<void> => guarded(async () => {
    const apiKey = (drafts[runtime] ?? '').trim();
    if (!apiKey) return;
    await window.ade.invoke('harness:setKey', { runtime, apiKey });
    setDrafts((current) => ({ ...current, [runtime]: '' }));
    await refreshStatus();
  });

  const clearKey = (runtime: RuntimeId): Promise<void> => guarded(async () => {
    await window.ade.invoke('harness:clearKey', { runtime });
    await refreshStatus();
  });

  const openLogin = (runtime: RuntimeId): Promise<void> => guarded(async () => {
    if (!selectedAgentId) return;
    await openHarnessLogin(selectedAgentId, runtime);
    setMode('terminals');
    onClose();
  });

  const saveServiceKey = (): Promise<void> => guarded(async () => {
    const name = newKeyName.trim();
    const value = newKeyValue.trim();
    if (!name || !value) return;
    const scope: ServiceKeyScope = newKeyAllSessions
      ? 'all'
      : SCOPE_RUNTIMES.filter((runtime) => newKeyRuntimes[runtime]);
    if (scope !== 'all' && scope.length === 0) {
      setError('Wähle mindestens ein Harness für den Key aus.');
      return;
    }
    await window.ade.invoke('harness:setServiceKey', { name, value, scope });
    setNewKeyName('');
    setNewKeyValue('');
    setNewKeyAllSessions(true);
    setNewKeyRuntimes({});
    await refreshStatus();
  });

  const clearServiceKey = (name: string): Promise<void> => guarded(async () => {
    await window.ade.invoke('harness:clearServiceKey', { name });
    await refreshStatus();
  });

  const keyStatusFor = (runtime: RuntimeId): { hasStoredKey: boolean; savedAt?: number } =>
    status?.items.find((item) => item.runtime === runtime) ?? { hasStoredKey: false };
  const diagnosisFor = (runtime: RuntimeId): RuntimeDiagnosticsResult['items'][number] | undefined =>
    diagnosis?.items.find((item) => item.runtime === runtime);
  const storageAvailable = status?.keyStorageAvailable !== false;

  return (
    <Modal
      title="Settings"
      subtitle="Harness-Verwaltung: Anmeldung, CLI-Status, API-Keys und Service-Keys."
      onClose={onClose}
    >
      <div className="st-body" data-testid="settings-harnesses">
        {error ? <div className="st-error" role="alert">{error}</div> : null}
        {!storageAvailable ? (
          <div className="st-warning">
            Sichere Schlüsselablage ist auf diesem System nicht verfügbar.
            Keys können deshalb nicht gespeichert werden; die Anmeldung über
            das jeweilige CLI funktioniert weiterhin.
          </div>
        ) : null}
        <div className="st-list">
          {HARNESS_RUNTIMES.map((runtime) => {
            const visual = runtimeVisual(runtime);
            const probe = diagnosisFor(runtime);
            const keyEnv = HARNESS_API_KEY_ENV[runtime];
            const loginCommand = HARNESS_LOGIN_COMMANDS[runtime];
            const keyStatus = keyStatusFor(runtime);
            const authenticated = probe?.authStatus === 'authenticated';
            return (
              <section key={runtime} className={`st-harness ${probe?.status ?? 'pending'}`}>
                <div className="st-harness-head">
                  <span className="st-harness-glyph" style={{ ['--rt' as string]: visual.color }}>
                    <visual.Glyph />
                  </span>
                  <strong>{LAUNCH_PROFILES[runtime].label}</strong>
                  {authenticated ? <span className="st-badge st-badge-auth">Angemeldet</span> : null}
                  <span className="st-harness-state">
                    {diagnosing && !probe
                      ? 'Prüfe…'
                      : probe
                        ? probe.installed === false
                          ? 'Nicht installiert'
                          : probe.version ?? 'Installiert'
                        : 'Nicht geprüft'}
                  </span>
                </div>
                {probe ? (
                  <div className="st-harness-message">
                    {authenticated ? probe.authDetail : probe.message}
                  </div>
                ) : null}
                <div className="st-harness-login">
                  {loginCommand ? (
                    <>
                      Anmeldung über das CLI: <code>{loginCommand}</code>
                      <button
                        type="button"
                        className="btn st-login-btn"
                        disabled={busy || !selectedAgentId}
                        title={selectedAgentId
                          ? 'Öffnet ein Terminal mit dem Anmeldekommando; der Login-Flow gehört dem CLI'
                          : 'Wähle links zuerst einen Agenten aus'}
                        onClick={() => void openLogin(runtime)}
                      >
                        Anmelden im Terminal
                      </button>
                    </>
                  ) : (
                    'Anmeldung erfolgt beim ersten interaktiven Start des CLI.'
                  )}
                </div>
                {keyEnv ? (
                  <>
                    {authenticated && keyStatus.hasStoredKey ? (
                      <div className="st-warning st-key-warning">
                        Der gespeicherte API-Key überschreibt die bestehende
                        Anmeldung in ADE-Sessions — Abrechnung läuft dann über
                        die API statt über deine Subscription.
                      </div>
                    ) : null}
                    {keyStatus.hasStoredKey ? (
                      <div className="st-key-row">
                        <span className="st-key-saved">
                          API-Key gespeichert ({keyEnv})
                          {keyStatus.savedAt ? ` · ${formatSavedAt(keyStatus.savedAt)}` : ''}
                        </span>
                        <button
                          type="button"
                          className="btn"
                          disabled={busy}
                          onClick={() => void clearKey(runtime)}
                        >
                          Entfernen
                        </button>
                      </div>
                    ) : (
                      <div className="st-key-row">
                        <input
                          type="password"
                          autoComplete="off"
                          aria-label={`API-Key für ${LAUNCH_PROFILES[runtime].label}`}
                          placeholder={`${keyEnv} (Alternative zur Subscription: API-Abrechnung)`}
                          value={drafts[runtime] ?? ''}
                          disabled={!storageAvailable || busy}
                          onChange={(event) => setDrafts((current) => ({
                            ...current,
                            [runtime]: event.target.value,
                          }))}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              void saveKey(runtime);
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="btn"
                          disabled={!storageAvailable || busy || !(drafts[runtime] ?? '').trim()}
                          onClick={() => void saveKey(runtime)}
                        >
                          Speichern
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="st-key-none">
                    Dieses Harness verwendet keinen von ADE gespeicherten API-Key.
                  </div>
                )}
              </section>
            );
          })}
        </div>

        <div className="st-section-head">
          <strong>Service-Keys</strong>
          <span>
            Zusatzdienste für Agents (z.&nbsp;B. ELEVENLABS_API_KEY) —
            verschlüsselt gespeichert und als Umgebungsvariable injiziert.
          </span>
        </div>
        {status?.serviceKeys.length ? (
          <ul className="st-service-list">
            {status.serviceKeys.map((key) => (
              <li key={key.name} className="st-key-row">
                <span className="st-key-saved" title={`Gespeichert ${formatSavedAt(key.savedAt)}`}>
                  <code>{key.name}</code> · {scopeLabel(key.scope)}
                </span>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => void clearServiceKey(key.name)}
                >
                  Entfernen
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="st-key-none">Noch keine Service-Keys gespeichert.</div>
        )}
        <div className="st-service-add">
          <div className="st-key-row">
            <input
              type="text"
              aria-label="Name des Service-Keys"
              placeholder="ELEVENLABS_API_KEY"
              value={newKeyName}
              disabled={!storageAvailable || busy}
              onChange={(event) => setNewKeyName(event.target.value.toUpperCase())}
            />
            <input
              type="password"
              autoComplete="off"
              aria-label="Wert des Service-Keys"
              placeholder="Wert"
              value={newKeyValue}
              disabled={!storageAvailable || busy}
              onChange={(event) => setNewKeyValue(event.target.value)}
            />
            <button
              type="button"
              className="btn"
              disabled={!storageAvailable || busy || !newKeyName.trim() || !newKeyValue.trim()}
              onClick={() => void saveServiceKey()}
            >
              Speichern
            </button>
          </div>
          <label className="st-scope-all">
            <input
              type="checkbox"
              checked={newKeyAllSessions}
              disabled={!storageAvailable || busy}
              onChange={(event) => setNewKeyAllSessions(event.target.checked)}
            />
            In allen Sessions verfügbar
          </label>
          {!newKeyAllSessions ? (
            <div className="st-scope-runtimes" role="group" aria-label="Harnesses für diesen Key">
              {SCOPE_RUNTIMES.map((runtime) => (
                <label key={runtime}>
                  <input
                    type="checkbox"
                    checked={Boolean(newKeyRuntimes[runtime])}
                    disabled={!storageAvailable || busy}
                    onChange={(event) => setNewKeyRuntimes((current) => ({
                      ...current,
                      [runtime]: event.target.checked,
                    }))}
                  />
                  {LAUNCH_PROFILES[runtime].label}
                </label>
              ))}
            </div>
          ) : null}
        </div>

        <div className="st-footnote">
          Subscription-Anmeldungen (z.&nbsp;B. Claude Pro/Max, ChatGPT für
          Codex) verwaltet das jeweilige CLI selbst und gelten automatisch
          auch für ADE-Sessions. Gespeicherte Keys werden mit der sicheren
          Ablage des Betriebssystems verschlüsselt, nie angezeigt und nur den
          gewählten Sessions als Umgebungsvariable übergeben.
        </div>
      </div>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={() => void runDiagnose()} disabled={diagnosing}>
          {diagnosing ? 'Prüfe…' : 'CLI-Status erneut prüfen'}
        </button>
        <button type="button" className="btn primary" onClick={onClose}>Schließen</button>
      </div>
    </Modal>
  );
}
