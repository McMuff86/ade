/**
 * App shell — three-region resizable layout:
 *   left rail | center (tab strip + main area) | right panel (collapsible).
 * Panel sizes persist to localStorage via PanelGroup autoSaveId.
 * Terminals and Graph are two views over the same persisted catalog/run state.
 */

import { useEffect, useRef, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels';
import { useSettings } from './stores/settings';
import { TabStrip } from './tabs/TabStrip';
import { TerminalArea } from './terminal/TerminalArea';
import { useAppData } from './stores/appdata';
import { Rail } from './rail/Rail';
import { FirstRun } from './onboarding/FirstRun';
import { RightPanel } from './rightpanel/RightPanel';
import { useMode } from './stores/mode';
import { GraphView } from './graph/GraphView';
import { useSessions } from './stores/sessions';
import { useRuns } from './stores/runs';
import { useDiagnostics } from './stores/diagnostics';
import { DiagnosticsModal } from './diagnostics/DiagnosticsModal';
import { SettingsModal } from './settings/SettingsModal';
import { useSessionShortcuts } from './keyboard/useSessionShortcuts';
import './graph/mode-switch.css';

export function App() {
  useSessionShortcuts();
  const theme = useSettings((s) => s.theme);
  const toggleTheme = useSettings((s) => s.toggleTheme);
  const mode = useMode((s) => s.mode);
  const setMode = useMode((s) => s.setMode);
  const showDiagnostics = useDiagnostics((s) => s.show);

  // Phase B2: load persisted categories/agents once at app start.
  const loadAppData = useAppData((s) => s.load);
  const hydrateSessions = useSessions((s) => s.hydrate);
  const loadRuns = useRuns((s) => s.load);
  const appLoaded = useAppData((s) => s.loaded);
  const categoryCount = useAppData((s) => s.categories.length);
  useEffect(() => {
    void loadAppData();
    void hydrateSessions();
    void loadRuns();
  }, [loadAppData, hydrateSessions, loadRuns]);
  const firstRun = appLoaded && categoryCount === 0;

  const rightPanelRef = useRef<ImperativePanelHandle>(null);
  const [rightOpen, setRightOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const toggleRightPanel = (): void => {
    const panel = rightPanelRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) panel.expand();
    else panel.collapse();
  };

  return (
    <div className="app">
      <header className="titlebar">
        <span className="logotype">
          ade<span className="logotype-cursor">_</span>
        </span>
        <span className="titlebar-sub">agentic development environment</span>

        <div className="mode-switch" role="tablist" aria-label="View mode">
          <button
            id="mode-tab-terminals"
            role="tab"
            aria-selected={mode === 'terminals'}
            tabIndex={mode === 'terminals' ? 0 : -1}
            className={mode === 'terminals' ? 'on' : ''}
            onClick={() => setMode('terminals')}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === 'Home' ? 'terminals' : 'graph';
              setMode(next);
              requestAnimationFrame(() => document.getElementById(`mode-tab-${next}`)?.focus());
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M7 9l3 3-3 3M13 15h4" />
            </svg>
            Terminals
          </button>
          <button
            id="mode-tab-graph"
            role="tab"
            aria-selected={mode === 'graph'}
            tabIndex={mode === 'graph' ? 0 : -1}
            className={mode === 'graph' ? 'on' : ''}
            onClick={() => setMode('graph')}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === 'End' ? 'graph' : 'terminals';
              setMode(next);
              requestAnimationFrame(() => document.getElementById(`mode-tab-${next}`)?.focus());
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="5" r="2.4" />
              <circle cx="5" cy="18" r="2.4" />
              <circle cx="19" cy="18" r="2.4" />
              <path d="M12 7.4v4M10.5 13l-4 3M13.5 13l4 3" />
            </svg>
            Graph
          </button>
        </div>

        <span className="spacer" />
        <button
          className="btn"
          onClick={() => setSettingsOpen(true)}
          title="Harness sign-in status and API keys"
        >
          Settings
        </button>
        <button className="btn" onClick={() => showDiagnostics()} title="Check CLI and authentication">
          Diagnostics
        </button>
        {/* temporary toggle — settings UI replaces this later */}
        <button className="btn" onClick={toggleTheme} title="Switch theme">
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>
      </header>

      <div className="shell" style={{ position: 'relative' }}>
        {mode === 'graph' ? (
          <GraphView />
        ) : (
        <PanelGroup direction="horizontal" autoSaveId="ade:layout">
          <Panel id="rail" order={1} defaultSize={18} minSize={12} maxSize={32} className="rail">
            {/* Phase B2 rail (categories + agents + onboarding modals). */}
            <Rail />
          </Panel>

          <PanelResizeHandle className="resize-handle" />

          <Panel id="center" order={2} minSize={36} className="center">
            <div className="tabbar">
              <TabStrip />
              <div className="strip-actions">
                <button
                  className={rightOpen ? 'btn btn-toggled' : 'btn'}
                  onClick={toggleRightPanel}
                  title="Toggle repository inspector"
                >
                  Inspector
                </button>
              </div>
            </div>
            <div className="workarea">
              {/* First-run replaces the center only while zero categories exist. */}
              {firstRun ? <FirstRun /> : <TerminalArea />}
            </div>
          </Panel>

          <PanelResizeHandle className="resize-handle" />

          <Panel
            id="right"
            order={3}
            ref={rightPanelRef}
            defaultSize={22}
            minSize={14}
            maxSize={40}
            collapsible
            collapsedSize={0}
            onCollapse={() => setRightOpen(false)}
            onExpand={() => setRightOpen(true)}
            className="rightpanel"
          >
            <RightPanel visible={rightOpen} />
          </Panel>
        </PanelGroup>
        )}
      </div>
      <DiagnosticsModal />
      {settingsOpen ? <SettingsModal onClose={() => setSettingsOpen(false)} /> : null}
    </div>
  );
}
