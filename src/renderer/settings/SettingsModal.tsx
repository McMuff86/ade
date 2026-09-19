import { localizedState } from '../../shared/i18n/states';
import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { intlLocale } from '../../shared/i18n';
import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
import { LanguageSetting } from '../i18n/language';
/**
 * ADE settings — harness management: per-CLI readiness including the CLI's
 * own sign-in state (subscription logins stay with the CLI and simply keep
 * working for ADE), a sign-in terminal per harness, write-only encrypted
 * API keys and generic encrypted service keys with an injection scope.
 * Stored values are never displayed; the renderer only ever sees booleans.
 */

import { useCallback, useEffect, useState, type JSX } from 'react';
import { shapeImportTargetPath } from '../../shared/importTargetPath';
import type {
  HarnessStatusResult,
  RuntimeDiagnosticsResult,
  RuntimeId,
  ServiceKeyScope,
} from '../../shared/types';
import type {
  WorkspaceBundleMappings,
  WorkspaceBundlePreviewItem,
  WorkspaceBundlePreviewResult,
} from '../../shared/ipc';
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
import { useSettings } from '../stores/settings';
import { useMode } from '../stores/mode';
import { useAppData } from '../stores/appdata';
import '../onboarding/onboarding.css';
import './settings.css';
import { RemoteDevicesSection } from './RemoteDevicesSection';
import { MobileAccessSection } from './MobileAccessSection';
import { ProjectDefaultsSection } from './ProjectDefaultsSection';
import { TargetSpeechSettings } from './TargetSpeechSettings';
import { SettingsTabs } from './SettingsTabs';

const SCOPE_RUNTIMES: readonly RuntimeId[] = [
  'claude', 'codex', 'opencode', 'grok', 'gemini', 'ollama', 'shell', 'custom',
];

function safeMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .slice(0, 500);
}

function formatSavedAt(value: number): string {
  return new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'medium', timeStyle: 'short' })
    .format(new Date(value));
}

function scopeLabel(scope: ServiceKeyScope): string {
  return scope === 'all'
    ? translate("all sessions")
    : scope.map((runtime) => LAUNCH_PROFILES[runtime].label).join(', ');
}

export function SettingsModal({ onClose }: { onClose: () => void }): JSX.Element {
  useLocale();
  const selectedAgentId = useSelection((state) => state.selectedAgentId);
  const openHarnessLogin = useSessions((state) => state.openHarnessLogin);
  const setMode = useMode((state) => state.setMode);
  const theme = useSettings((state) => state.theme);
  const setTheme = useSettings((state) => state.setTheme);
  const inspectorSide = useSettings((state) => state.inspectorSide);
  const setInspectorSide = useSettings((state) => state.setInspectorSide);
  const hydrateSettings = useSettings((state) => state.hydrate);
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
  const [bundleSelection, setBundleSelection] = useState<{ id: string; name: string } | null>(null);
  const [bundleMappings, setBundleMappings] = useState<WorkspaceBundleMappings>({
    repositories: {}, agentHomes: {}, settings: 'keep-target',
  });
  const [bundlePreview, setBundlePreview] = useState<WorkspaceBundlePreviewResult | null>(null);
  const [bundlePreviewCurrent, setBundlePreviewCurrent] = useState(false);
  const [bundleConfirmed, setBundleConfirmed] = useState(false);
  const [bundlePartialConfirmed, setBundlePartialConfirmed] = useState(false);
  const [bundleMessage, setBundleMessage] = useState('');
  const [exportMemory, setExportMemory] = useState(false);
  const [exportPhotos, setExportPhotos] = useState(false);

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
    await runDiagnose();
  });

  const clearKey = (runtime: RuntimeId): Promise<void> => guarded(async () => {
    await window.ade.invoke('harness:clearKey', { runtime });
    await refreshStatus();
    await runDiagnose();
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
      setError(translate("Select at least one harness for the key."));
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

  const previewBundle = async (
    selection = bundleSelection,
    mappings = bundleMappings,
  ): Promise<WorkspaceBundlePreviewResult | undefined> => {
    if (!selection) return;
    // Clear first: leaving the previous success line standing while the refresh
    // silently does nothing is what made a declined authorization look like a
    // dead button — the statuses still described the old plan, the fields
    // already showed the new one, and the message said it had worked.
    setBundleMessage('');
    const authorization = await window.ade.invoke('workspaceBundle:authorizeMappings', { mappings });
    if (!authorization) {
      setBundleMessage(translate("Preview not updated: The goals have not been authorized. ")
        + translate("The displayed statuses are still part of the previous plan."));
      return;
    }
    const preview = await window.ade.invoke('workspaceBundle:preview', {
      selectionId: selection.id,
      mappingAuthorizationId: authorization.authorizationId,
    });
    setBundlePreview(preview);
    setBundlePreviewCurrent(true);
    setBundleConfirmed(false);
    setBundlePartialConfirmed(false);
    setBundleMessage(translate("Preview updated. No target profiles have been changed yet."));
    return preview;
  };

  const pickBundle = (): Promise<void> => guarded(async () => {
    const selected = await window.ade.invoke('workspaceBundle:pickImport');
    if (!selected) return;
    const mappings: WorkspaceBundleMappings = {
      repositories: {}, agentHomes: {}, settings: 'keep-target',
    };
    const selection = { id: selected.selectionId, name: selected.displayName };
    setBundleSelection(selection);
    setBundleMappings(mappings);
    const preview = await previewBundle(selection, mappings);
    if (preview) seedSuggestedTargets(preview);
  });

  const shapeTargetPath = (value: string): string => (
    bundlePreview ? shapeImportTargetPath(value, bundlePreview.hostPlatform) : value
  );

  const updateMapping = (
    collection: 'repositories' | 'agentHomes',
    sourceId: string,
    field: 'backend' | 'path',
    rawValue: string,
  ): void => {
    const value = field === 'path' ? shapeTargetPath(rawValue) : rawValue;
    setBundlePreviewCurrent(false);
    setBundleConfirmed(false);
    setBundleMappings((current) => {
      const next = {
        backend: current[collection][sourceId]?.backend ?? 'native',
        path: current[collection][sourceId]?.path ?? '',
        [field]: value,
      };
      const entries = { ...current[collection] };
      // An entry with an empty path is not "no mapping yet" — IPC validation
      // requires at least one character, so keeping it would reject every
      // further preview and strand the user with no way back except re-picking
      // the bundle. Clearing the field removes the mapping instead.
      if (next.path.trim().length === 0) delete entries[sourceId];
      else entries[sourceId] = next;
      return { ...current, [collection]: entries };
    });
  };

  /**
   * Suggested targets arrive with the preview. They are only seeded into empty
   * fields, so a value the user typed is never overwritten, and the preview is
   * marked stale because the fields no longer describe what was planned.
   */
  /**
   * Fill the agent-home fields once, when a bundle is first opened.
   *
   * Deliberately not on every refresh: the suggestion would then reappear in a
   * field the user had just cleared, and each reappearance marked the preview
   * stale again — so "Vorschau aktualisieren" could never settle. A proposal is
   * a starting point for this bundle, not a value the form keeps restoring.
   */
  const seedSuggestedTargets = (preview: WorkspaceBundlePreviewResult): void => {
    const seeded = preview.agentHomes.filter((item) => item.suggestedTarget);
    if (seeded.length === 0) return;
    setBundleMappings((current) => ({
      ...current,
      agentHomes: {
        ...current.agentHomes,
        ...Object.fromEntries(seeded.map((item) => [item.sourceId, { ...item.suggestedTarget! }])),
      },
    }));
    setBundlePreviewCurrent(false);
  };

  const browseForTarget = (
    collection: 'repositories' | 'agentHomes',
    item: WorkspaceBundlePreviewItem,
  ): Promise<void> => guarded(async () => {
    const picked = await window.ade.invoke('dialog:pickFolder');
    if (!picked.path) return;
    if (collection === 'repositories') {
      if (!picked.isRepo) throw new Error(translate("The selected folder is not a git repository."));
      updateMapping(collection, item.sourceId, 'path', picked.path);
      return;
    }
    // An agent home must not exist yet — the provisioner creates it and refuses
    // an occupied path — so the picker chooses its PARENT and the leaf is
    // appended. Reuse the host's own suggestion for the leaf so the layout
    // matches the profile's other agents.
    const leaf = (bundleMappings.agentHomes[item.sourceId]?.path ?? item.suggestedTarget?.path ?? '')
      .split(/[\\/]/).filter(Boolean).pop() ?? item.sourceId;
    const separator = picked.path.includes('\\') && !picked.path.includes('/') ? '\\' : '/';
    updateMapping(collection, item.sourceId, 'path',
      `${picked.path.replace(/[\\/]+$/, '')}${separator}${leaf}`);
  });

  const toggleBundleSkip = (
    collection: 'repositories' | 'categories' | 'agents' | 'agentTemplates',
    sourceId: string,
    skipped: boolean,
  ): void => {
    setBundlePreviewCurrent(false);
    setBundleConfirmed(false);
    setBundleMappings((current) => {
      const decisions = { ...(current.skip?.[collection] ?? {}) };
      if (skipped) decisions[sourceId] = true;
      else delete decisions[sourceId];
      return { ...current, skip: { ...current.skip, [collection]: decisions } };
    });
  };

  const updateBundleName = (
    collection: 'repositories' | 'categories' | 'agents' | 'agentTemplates',
    sourceId: string,
    name: string,
  ): void => {
    setBundlePreviewCurrent(false);
    setBundleConfirmed(false);
    setBundleMappings((current) => ({
      ...current,
      names: {
        ...current.names,
        [collection]: { ...(current.names?.[collection] ?? {}), [sourceId]: name },
      },
    }));
  };

  const applyBundle = (): Promise<void> => guarded(async () => {
    const hasSkipped = [
      ...bundlePreview?.repositories ?? [], ...bundlePreview?.categories ?? [],
      ...bundlePreview?.agents ?? [], ...bundlePreview?.agentTemplates ?? [],
      ...bundlePreview?.agentHomes ?? [],
    ].some((item) => item.status === 'skipped');
    if (!bundlePreview?.canApplyFully || !bundlePreviewCurrent || !bundleConfirmed
        || (hasSkipped && !bundlePartialConfirmed)) return;
    const receipt = await window.ade.invoke('workspaceBundle:apply', {
      sessionId: bundlePreview.sessionId,
      token: bundlePreview.token,
    });
    await Promise.all([useAppData.getState().refresh(), hydrateSettings()]);
    const skipped = receipt.items.filter((item) => item.outcome === 'skipped').length;
    const imported = Object.values(receipt.imported).reduce((sum, count) => sum + count, 0);
    const details = receipt.items.map((item) => `${item.kind}: ${item.outcome}`
      + (item.targetId && item.targetId !== item.sourceId ? ' (ID remapped)' : '')
      + (item.reasonCode ? ` (${item.reasonCode})` : '')).join(' · ');
    setBundleMessage(translate("Import completed: {{value1}} imported, {{value2}} skipped. ", { value1: imported, value2: skipped })
      + `Backup: ${receipt.backupPath} · Receipt: ${receipt.receiptPath}${details ? translate(" · Results: {{value1}}", { value1: details }) : ''}`);
    setBundlePreview(null);
    setBundleConfirmed(false);
  });

  const exportBundle = (): Promise<void> => guarded(async () => {
    const result = await window.ade.invoke('workspaceBundle:export', {
      includeMemory: exportMemory,
      includePhotos: exportPhotos,
    });
    if (result) {
      const warnings = result.notices.map((notice) => notice.message).join(' · ');
      setBundleMessage(`Bundle exportiert: ${result.path}${warnings ? translate(" — Notices: {{value1}}", { value1: warnings }) : ''}`);
    }
  });

  /** What the plan will actually produce, per collection, as "kept of total". */
  const importTotals = ((): { parts: string[]; skippedAny: boolean } => {
    if (!bundlePreview) return { parts: [], skippedAny: false };
    const groups: Array<[string, WorkspaceBundlePreviewItem[]]> = ([
      [translate("Repositories"), bundlePreview.repositories],
      [translate("Categories"), bundlePreview.categories],
      [translate("Agents"), bundlePreview.agents],
      [translate("Templates"), bundlePreview.agentTemplates],
    ]);
    const parts: string[] = [];
    let skippedAny = false;
    for (const [label, items] of groups) {
      if (items.length === 0) continue;
      const kept = items.filter((item) => item.status !== 'skipped' && item.status !== 'invalid').length;
      if (kept !== items.length) skippedAny = true;
      parts.push(translate('{{kept}} of {{total}} {{label}}', { kept, total: items.length, label }));
    }
    return { parts, skippedAny };
  })();

  const mappingRow = (
    item: WorkspaceBundlePreviewItem,
    collection: 'repositories' | 'agentHomes',
  ): JSX.Element => {
    const mapping = bundleMappings[collection][item.sourceId] ?? { backend: 'native', path: '' };
    const skipCollection = collection === 'repositories' ? 'repositories' : 'agents';
    const skipped = bundleMappings.skip?.[skipCollection]?.[item.sourceId] === true;
    return (
      <div key={`${collection}-${item.sourceId}`} className={`st-bundle-item is-${item.status}`}>
        <div className="st-bundle-item-head">
          <strong>{item.name}</strong><span>{localizedState(item.status)}</span>
        </div>
        <div className="st-key-row">
          {/* An agent home is not its own identity: the name and the skip
              decision belong to the agent, which has its own row further down.
              Rendering them here too bound a second checkbox to the same state
              in a different section — ticking either one silently dropped the
              agent AND its home, which is how an import of seven ready agents
              imported none. A repository has no identity row, so it keeps them. */}
          {collection === 'repositories' ? (
            <input
              aria-label={translate("Import name for {{value1}}", { value1: item.name })}
              value={bundleMappings.names?.[skipCollection]?.[item.sourceId] ?? item.name}
              disabled={busy}
              onChange={(event) => updateBundleName(skipCollection, item.sourceId, event.target.value)}
            />
          ) : null}
          <input
            aria-label={translate("Backend for {{value1}}", { value1: item.name })}
            value={mapping.backend}
            disabled={busy}
            onChange={(event) => updateMapping(collection, item.sourceId, 'backend', event.target.value)}
          />
        </div>
        {/* The target gets its own full-width row: it is the longest value on
            the form by far, and sharing a row with the name and the backend
            left it showing about a dozen characters. */}
        <div className="st-key-row">
          <input
            className="st-bundle-target"
            aria-label={translate("Target path for {{value1}}", { value1: item.name })}
            placeholder={collection === 'repositories'
              ? translate("Path to the existing git clone")
              : translate("New agent home (created upon import)")}
            value={mapping.path}
            title={mapping.path}
            spellCheck={false}
            disabled={busy}
            onChange={(event) => updateMapping(collection, item.sourceId, 'path', event.target.value)}
          />
          <button
            className="btn"
            disabled={busy}
            title={collection === 'repositories'
              ? translate("Choose the existing git clone")
              : translate("Select higher-level folder — the home itself is created when imported")}
            onClick={() => void browseForTarget(collection, item)}
          >
            {translate("Browse…")}</button>
        </div>
        {item.reason ? <div className="st-harness-message">{item.reason}</div> : null}
        {item.remediation ? <div className="st-bundle-remediation">{item.remediation}</div> : null}
        {collection === 'repositories' ? (
          <label className="st-scope-all">
            <input type="checkbox" checked={skipped} disabled={busy}
              onChange={(event) => toggleBundleSkip(skipCollection, item.sourceId, event.target.checked)} />
            {translate("Skip this entry")}</label>
        ) : skipped ? (
          <div className="st-bundle-remediation">
            {translate("The associated agent is marked to skip, so this home is not created either.")}</div>
        ) : null}
      </div>
    );
  };

  // Same shape as the mapping rows above: a head naming the entry and its
  // status, then the editable name, then the decision. Previously the name
  // appeared twice — once in the field, once in a trailing sentence — which
  // read like the row was listed a second time.
  const identityDecision = (
    item: WorkspaceBundlePreviewItem,
    collection: 'categories' | 'agents' | 'agentTemplates',
  ): JSX.Element => (
    <div key={`${collection}-${item.sourceId}`} className={`st-bundle-item is-${item.status}`}>
      <div className="st-bundle-item-head">
        <strong>{item.name}</strong><span>{localizedState(item.status)}</span>
      </div>
      <div className="st-key-row">
        <input aria-label={translate("Import name for {{value1}}", { value1: item.name })}
          value={bundleMappings.names?.[collection]?.[item.sourceId] ?? item.name}
          disabled={busy}
          onChange={(event) => updateBundleName(collection, item.sourceId, event.target.value)} />
      </div>
      {item.reason ? <div className="st-harness-message">{item.reason}</div> : null}
      <label className="st-scope-all">
        <input type="checkbox" disabled={busy}
          checked={bundleMappings.skip?.[collection]?.[item.sourceId] === true}
          onChange={(event) => toggleBundleSkip(collection, item.sourceId, event.target.checked)} />
        {translate("Skip this entry")}</label>
    </div>
  );

  const keyStatusFor = (runtime: RuntimeId): { hasStoredKey: boolean; savedAt?: number } =>
    status?.items.find((item) => item.runtime === runtime) ?? { hasStoredKey: false };
  const diagnosisFor = (runtime: RuntimeId): RuntimeDiagnosticsResult['items'][number] | undefined =>
    diagnosis?.items.find((item) => item.runtime === runtime);
  const storageAvailable = status?.keyStorageAvailable !== false;

  return (
    <Modal
      title={translate("Settings")}
      subtitle={translate("Appearance, connected devices, workspaces and harness management.")}
      onClose={onClose}
    >
      <SettingsTabs voice={<div className="st-body"><TargetSpeechSettings target={{ kind: 'default' }} /></div>}><div className="st-body" data-testid="settings-harnesses">
        <LanguageSetting desktop />
        {error ? <div className="st-error" role="alert">{localizeAppMessage(error)}</div> : null}
        <div className="st-theme-row" role="group" aria-label={translate("Appearance")}>
          <span className="st-theme-label">{translate("Appearance")}</span>
          <div className="st-theme-choice">
            <button
              type="button"
              className={`btn${theme === 'dark' ? ' st-theme-active' : ''}`}
              aria-pressed={theme === 'dark'}
              onClick={() => setTheme('dark')}
            >
              {translate("Dark [44756e6b]")}</button>
            <button
              type="button"
              className={`btn${theme === 'light' ? ' st-theme-active' : ''}`}
              aria-pressed={theme === 'light'}
              onClick={() => setTheme('light')}
            >
              {translate("Light [48656c6c]")}</button>
          </div>
        </div>
        <div className="st-theme-row" role="group" aria-label={translate("Inspector position")} data-testid="settings-inspector-side">
          <span className="st-theme-label">{translate("Inspector")}</span>
          <div className="st-theme-choice">
            <button
              type="button"
              className={`btn${inspectorSide === 'right' ? ' st-theme-active' : ''}`}
              aria-pressed={inspectorSide === 'right'}
              onClick={() => setInspectorSide('right')}
            >
              {translate("Right")}</button>
            <button
              type="button"
              className={`btn${inspectorSide === 'left' ? ' st-theme-active' : ''}`}
              aria-pressed={inspectorSide === 'left'}
              onClick={() => setInspectorSide('left')}
            >
              {translate("Links")}</button>
          </div>
        </div>
        <MobileAccessSection />
        <ProjectDefaultsSection />
        <RemoteDevicesSection />
        <section className="st-bundle-section" data-testid="workspace-bundle-settings">
          <div className="st-section-head">
            <strong>{translate("Workspace bundles")}</strong>
            <span>{translate("Export agents and workspace state portable or import with preflight.")}</span>
          </div>
          <div className="st-bundle-actions">
            <label><input type="checkbox" checked={exportMemory} disabled={busy}
              onChange={(event) => setExportMemory(event.target.checked)} /> {" "}{translate("Include memory")}</label>
            <label><input type="checkbox" checked={exportPhotos} disabled={busy}
              onChange={(event) => setExportPhotos(event.target.checked)} /> {" "}{translate("Include photos")}</label>
            <label><input type="checkbox" disabled={busy}
              checked={bundleMappings.settings === 'use-bundle'}
              onChange={(event) => {
                setBundlePreviewCurrent(false);
                setBundleConfirmed(false);
                setBundleMappings((current) => ({
                  ...current, settings: event.target.checked ? 'use-bundle' : 'keep-target',
                }));
              }} /> {" "}{translate("Adopt Bundle Theme and Memory Settings")}</label>
            <button type="button" className="btn" disabled={busy} onClick={() => void exportBundle()}>
              {translate("Export bundle")}</button>
            <button type="button" className="btn" disabled={busy} onClick={() => void pickBundle()}>
              {translate("Import workspace/profile…")}</button>
          </div>
          {bundleSelection ? <div className="st-bundle-path">{bundleSelection.name}</div> : null}
          {bundlePreview ? (
            <div className="st-bundle-preview">
              <div className="st-bundle-summary">
                {translate("Preflight:")}{" "}{!bundlePreviewCurrent ? translate("outdated — refresh preview")
                  : bundlePreview.canApplyFully ? translate("ready") : translate("Mapping or conflict resolution required")}
              </div>
              {/* The counts the import will actually produce. "bereit" was true
                  for a plan that imported two categories and none of seven
                  agents, because every skip is individually plausible and
                  nothing ever added them up. */}
              <div className={importTotals.skippedAny ? 'st-warning' : 'st-bundle-summary'}
                data-testid="bundle-import-totals">
                {translate("Items to import:")}{" "}{importTotals.parts.join(' · ')}
                {importTotals.skippedAny ? translate(" — the rest is marked to skip.") : ''}
              </div>
              {bundlePreview.notices.length > 0 ? (
                <div className="st-warning">
                  {bundlePreview.notices.map((notice) => notice.message).join(' · ')}
                </div>
              ) : null}
              {bundlePreview.repositories.length > 0 ? (
                <><h4>{translate("Repositories")}</h4>{bundlePreview.repositories.map((item) => mappingRow(item, 'repositories'))}</>
              ) : null}
              {bundlePreview.agentHomes.length > 0 ? (
                <><h4>{translate("Agent Homes")}</h4>{bundlePreview.agentHomes.map((item) => mappingRow(item, 'agentHomes'))}</>
              ) : null}
              {/* Headings, because a repository, a category and an agent can
                  carry the same name — "RhinoClaw" is all three on a real
                  profile — and an unlabelled run of rows reads as a repeat of
                  the sections above rather than as different objects. */}
              <div className="st-bundle-status-list">
                {bundlePreview.categories.length > 0 ? (
                  <><h4>{translate("Categories")}</h4>
                    {bundlePreview.categories.map((item) => identityDecision(item, 'categories'))}</>
                ) : null}
                {bundlePreview.agents.length > 0 ? (
                  <><h4>{translate("Agents")}</h4>
                    {bundlePreview.agents.map((item) => identityDecision(item, 'agents'))}</>
                ) : null}
                {bundlePreview.agentTemplates.length > 0 ? (
                  <><h4>{translate("Agent templates")}</h4>
                    {bundlePreview.agentTemplates.map((item) => identityDecision(item, 'agentTemplates'))}</>
                ) : null}
              </div>
              <button type="button" className="btn" disabled={busy}
                onClick={() => void guarded(async () => { await previewBundle(); })}>
                {translate("Update Preview")}</button>
              <label className="st-scope-all">
                <input type="checkbox" checked={bundleConfirmed}
                  disabled={busy || !bundlePreviewCurrent || !bundlePreview.canApplyFully}
                  onChange={(event) => setBundleConfirmed(event.target.checked)} />
                {translate("Apply verified plan; ADE creates a backup beforehand.")}</label>
              {[...bundlePreview.repositories, ...bundlePreview.categories, ...bundlePreview.agents,
                ...bundlePreview.agentTemplates, ...bundlePreview.agentHomes]
                .some((item) => item.status === 'skipped') ? (
                  <label className="st-scope-all">
                    <input type="checkbox" checked={bundlePartialConfirmed}
                      disabled={busy || !bundlePreviewCurrent || !bundlePreview.canApplyFully}
                      onChange={(event) => setBundlePartialConfirmed(event.target.checked)} />
                    {translate("Confirm partial import:")}{" "}{[...bundlePreview.repositories, ...bundlePreview.categories,
                      ...bundlePreview.agents, ...bundlePreview.agentTemplates, ...bundlePreview.agentHomes]
                      .filter((item) => item.status === 'skipped').slice(0, 12)
                      .map((item) => `${item.name}${item.reason ? ` (${item.reason})` : ''}`).join(', ')}
                  </label>
                ) : null}
              <button type="button" className="btn primary"
                disabled={busy || !bundlePreviewCurrent || !bundlePreview.canApplyFully || !bundleConfirmed
                  || ([...bundlePreview.repositories, ...bundlePreview.categories, ...bundlePreview.agents,
                    ...bundlePreview.agentTemplates, ...bundlePreview.agentHomes]
                    .some((item) => item.status === 'skipped') && !bundlePartialConfirmed)}
                onClick={() => void applyBundle()}>{translate("Apply import")}</button>
            </div>
          ) : null}
          {bundleMessage ? <div className="st-bundle-message">{bundleMessage}</div> : null}
        </section>
        {!storageAvailable ? (
          <div className="st-warning">
            {translate("Secure key storage is not available on this system. Keys can therefore not be stored; the login via the respective CLI still works.")}</div>
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
                  {authenticated ? <span className="st-badge st-badge-auth">{translate("Signed in")}</span> : null}
                  <span className="st-harness-state">
                    {diagnosing && !probe
                      ? translate("Checking… [5072c3bc]")
                      : probe
                        ? probe.installed === false
                          ? translate("Not installed [4e696368]")
                          : probe.version ?? translate("Installed")
                        : translate("Not checked [4e696368]")}
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
                      {translate("Sign in through the CLI:")}{" "}<code>{loginCommand}</code>
                      <button
                        type="button"
                        className="btn st-login-btn"
                        disabled={busy || !selectedAgentId}
                        title={selectedAgentId
                          ? translate("Opens a terminal with the login command; the login flow belongs to the CLI")
                          : translate("Select an agent first on the left")}
                        onClick={() => void openLogin(runtime)}
                      >
                        {translate("Sign in using terminal")}</button>
                    </>
                  ) : (
                    translate("Sign-in takes place at the first interactive start of the CLI.")
                  )}
                </div>
                {keyEnv ? (
                  <>
                    {authenticated && keyStatus.hasStoredKey ? (
                      <div className="st-warning st-key-warning">
                        {translate("The saved API key overwrites the existing login in ADE sessions — billing then runs through the API instead of your subscription.")}</div>
                    ) : null}
                    {keyStatus.hasStoredKey ? (
                      <div className="st-key-row">
                        <span className="st-key-saved">
                          {translate("API key saved (")}{keyEnv})
                          {keyStatus.savedAt ? ` · ${formatSavedAt(keyStatus.savedAt)}` : ''}
                        </span>
                        <button
                          type="button"
                          className="btn"
                          disabled={busy}
                          onClick={() => void clearKey(runtime)}
                        >
                          {translate("Remove")}</button>
                      </div>
                    ) : (
                      <div className="st-key-row">
                        <input
                          type="password"
                          autoComplete="off"
                          aria-label={translate("API Key for {{value1}}", { value1: LAUNCH_PROFILES[runtime].label })}
                          placeholder={translate("{{value1}} (alternative to subscription: API billing)", { value1: keyEnv })}
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
                          {translate("Save [53706569]")}</button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="st-key-none">
                    {translate("This harness does not use an API key stored by ADE.")}</div>
                )}
              </section>
            );
          })}
        </div>

        <div className="st-section-head">
          <strong>{translate("Service keys")}</strong>
          <span>
            {translate("Additional services for agents (e.g. ELEVENLABS_API_KEY) — stored encrypted and injected as an environment variable.")}</span>
        </div>
        {status?.serviceKeys.length ? (
          <ul className="st-service-list">
            {status.serviceKeys.map((key) => (
              <li key={key.name} className="st-key-row">
                <span className="st-key-saved" title={translate("Saved {{value1}}", { value1: formatSavedAt(key.savedAt) })}>
                  <code>{key.name}</code> · {scopeLabel(key.scope)}
                </span>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => void clearServiceKey(key.name)}
                >
                  {translate("Remove")}</button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="st-key-none">{translate("No service keys are stored yet.")}</div>
        )}
        <div className="st-service-add">
          <div className="st-key-row">
            <input
              type="text"
              aria-label={translate("Name of service key")}
              placeholder={translate("ELEVENLABS_API_KEY")}
              value={newKeyName}
              disabled={!storageAvailable || busy}
              onChange={(event) => setNewKeyName(event.target.value.toUpperCase())}
            />
            <input
              type="password"
              autoComplete="off"
              aria-label={translate("Value of the service key")}
              placeholder={translate("Value")}
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
              {translate("Save [53706569]")}</button>
          </div>
          <label className="st-scope-all">
            <input
              type="checkbox"
              checked={newKeyAllSessions}
              disabled={!storageAvailable || busy}
              onChange={(event) => setNewKeyAllSessions(event.target.checked)}
            />
            {translate("Available in all sessions")}</label>
          {!newKeyAllSessions ? (
            <div className="st-scope-runtimes" role="group" aria-label={translate("Harnesses for this key")}>
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
          {translate("Subscription logins (e.g. Claude Pro/Max, ChatGPT for Codex) are managed by the respective CLI itself and are also automatically valid for ADE sessions. Stored keys are encrypted with the secure storage of the operating system, are never displayed and are only transferred to the selected sessions as an environment variable.")}</div>
      </div></SettingsTabs>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={() => void runDiagnose()} disabled={diagnosing}>
          {diagnosing ? translate("Checking… [5072c3bc]") : translate("Check CLI status again")}
        </button>
        <button type="button" className="btn primary" onClick={onClose}>{translate("Close [5363686c]")}</button>
      </div>
    </Modal>
  );
}
