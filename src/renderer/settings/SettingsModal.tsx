/**
 * ADE settings — harness management: per-CLI readiness, documented sign-in
 * commands and write-only, encrypted API-key storage. Stored keys are never
 * displayed; the renderer only ever sees boolean status.
 */

import { useCallback, useEffect, useState, type JSX } from 'react';
import type {
  HarnessStatusResult,
  RuntimeDiagnosticsResult,
  RuntimeId,
} from '../../shared/types';
import {
  HARNESS_API_KEY_ENV,
  HARNESS_LOGIN_COMMANDS,
  HARNESS_RUNTIMES,
  LAUNCH_PROFILES,
} from '../../shared/runtimes';
import { Modal } from '../onboarding/Modal';
import { runtimeVisual } from '../graph/runtimeGlyphs';
import '../onboarding/onboarding.css';
import './settings.css';

function safeMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .slice(0, 500);
}

function formatSavedAt(value: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    .format(new Date(value));
}

export function SettingsModal({ onClose }: { onClose: () => void }): JSX.Element {
  const [status, setStatus] = useState<HarnessStatusResult | null>(null);
  const [diagnosis, setDiagnosis] = useState<RuntimeDiagnosticsResult | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyRuntime, setBusyRuntime] = useState<RuntimeId | null>(null);

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

  const saveKey = async (runtime: RuntimeId): Promise<void> => {
    const apiKey = (drafts[runtime] ?? '').trim();
    if (!apiKey || busyRuntime) return;
    setBusyRuntime(runtime);
    setError('');
    try {
      await window.ade.invoke('harness:setKey', { runtime, apiKey });
      setDrafts((current) => ({ ...current, [runtime]: '' }));
      await refreshStatus();
    } catch (cause) {
      setError(safeMessage(cause));
    } finally {
      setBusyRuntime(null);
    }
  };

  const clearKey = async (runtime: RuntimeId): Promise<void> => {
    if (busyRuntime) return;
    setBusyRuntime(runtime);
    setError('');
    try {
      await window.ade.invoke('harness:clearKey', { runtime });
      await refreshStatus();
    } catch (cause) {
      setError(safeMessage(cause));
    } finally {
      setBusyRuntime(null);
    }
  };

  const keyStatusFor = (runtime: RuntimeId): { hasStoredKey: boolean; savedAt?: number } =>
    status?.items.find((item) => item.runtime === runtime) ?? { hasStoredKey: false };
  const diagnosisFor = (runtime: RuntimeId): RuntimeDiagnosticsResult['items'][number] | undefined =>
    diagnosis?.items.find((item) => item.runtime === runtime);
  const storageAvailable = status?.keyStorageAvailable !== false;

  return (
    <Modal
      title="Settings"
      subtitle="Harness-Verwaltung: CLI-Status, Anmeldung und API-Keys pro Harness."
      onClose={onClose}
    >
      <div className="st-body" data-testid="settings-harnesses">
        {error ? <div className="st-error" role="alert">{error}</div> : null}
        {!storageAvailable ? (
          <div className="st-warning">
            Sichere Schlüsselablage ist auf diesem System nicht verfügbar.
            API-Keys können deshalb nicht gespeichert werden; die Anmeldung
            über das jeweilige CLI funktioniert weiterhin.
          </div>
        ) : null}
        <div className="st-list">
          {HARNESS_RUNTIMES.map((runtime) => {
            const visual = runtimeVisual(runtime);
            const probe = diagnosisFor(runtime);
            const keyEnv = HARNESS_API_KEY_ENV[runtime];
            const loginCommand = HARNESS_LOGIN_COMMANDS[runtime];
            const keyStatus = keyStatusFor(runtime);
            return (
              <section key={runtime} className={`st-harness ${probe?.status ?? 'pending'}`}>
                <div className="st-harness-head">
                  <span className="st-harness-glyph" style={{ ['--rt' as string]: visual.color }}>
                    <visual.Glyph />
                  </span>
                  <strong>{LAUNCH_PROFILES[runtime].label}</strong>
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
                {probe ? <div className="st-harness-message">{probe.message}</div> : null}
                {loginCommand ? (
                  <div className="st-harness-login">
                    Anmeldung: <code>{loginCommand}</code> in einem Terminal ausführen.
                  </div>
                ) : (
                  <div className="st-harness-login">
                    Anmeldung erfolgt beim ersten interaktiven Start des CLI.
                  </div>
                )}
                {keyEnv ? (
                  keyStatus.hasStoredKey ? (
                    <div className="st-key-row">
                      <span className="st-key-saved">
                        API-Key gespeichert ({keyEnv})
                        {keyStatus.savedAt ? ` · ${formatSavedAt(keyStatus.savedAt)}` : ''}
                      </span>
                      <button
                        type="button"
                        className="btn"
                        disabled={busyRuntime !== null}
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
                        placeholder={`${keyEnv} speichern (optional)`}
                        value={drafts[runtime] ?? ''}
                        disabled={!storageAvailable || busyRuntime !== null}
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
                        disabled={!storageAvailable
                          || busyRuntime !== null
                          || !(drafts[runtime] ?? '').trim()}
                        onClick={() => void saveKey(runtime)}
                      >
                        Speichern
                      </button>
                    </div>
                  )
                ) : (
                  <div className="st-key-none">
                    Dieses Harness verwendet keinen von ADE gespeicherten API-Key.
                  </div>
                )}
              </section>
            );
          })}
        </div>
        <div className="st-footnote">
          API-Keys werden mit der sicheren Ablage des Betriebssystems
          verschlüsselt in deinem ADE-Profil gespeichert, nie angezeigt und
          nur Sessions der passenden Harness als Umgebungsvariable übergeben.
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
