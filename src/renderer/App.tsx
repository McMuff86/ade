/**
 * App shell — three-region resizable layout:
 *   rail | center (tab strip + main area) | inspector (collapsible).
 * Inspector side is a Settings choice; default remains rail left / inspector right.
 * Panel sizes persist to localStorage via PanelGroup autoSaveId.
 * Overview, Projects, Terminals and Graph share the persisted workspace/catalog/run state.
 */

import { useEffect, useRef, useState, type JSX, type ReactNode, type RefObject } from 'react';
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels';
import { useSettings } from './stores/settings';
import { TabStrip } from './tabs/TabStrip';
import { TerminalArea } from './terminal/TerminalArea';
import { useAppData } from './stores/appdata';
import { Rail } from './rail/Rail';
import { FirstRun } from './onboarding/FirstRun';
import { RightPanel } from './rightpanel/RightPanel';
import { adjacentMode, useMode, type AppMode } from './stores/mode';
import { GraphView } from './graph/GraphView';
import { OverviewView } from './overview/OverviewView';
import { ProjectsView } from './projects/ProjectsView';
import { useSessions } from './stores/sessions';
import { useRuns } from './stores/runs';
import { useDiagnostics } from './stores/diagnostics';
import { DiagnosticsModal } from './diagnostics/DiagnosticsModal';
import { SettingsModal } from './settings/SettingsModal';
import { SessionLaunchDialog } from './sessions/SessionLaunchDialog';
import { useSessionShortcuts } from './keyboard/useSessionShortcuts';
import { ConfigHealthBanner } from './ConfigHealthBanner';
import './graph/mode-switch.css';

export function App() {
  useSessionShortcuts();
  const theme = useSettings((s) => s.theme);
  const toggleTheme = useSettings((s) => s.toggleTheme);
  const inspectorSide = useSettings((s) => s.inspectorSide);
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
          <ModeTab
            id="overview"
            label="Overview"
            selected={mode === 'overview'}
            onSelect={setMode}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 7h16M4 12h10M4 17h7" />
            </svg>
          </ModeTab>
          <ModeTab id="projects" label="Projekte" selected={mode === 'projects'} onSelect={setMode}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7V5h7l2 3h9v11H3z" /></svg>
          </ModeTab>
          <ModeTab
            id="terminals"
            label="Terminals"
            selected={mode === 'terminals'}
            onSelect={setMode}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M7 9l3 3-3 3M13 15h4" />
            </svg>
          </ModeTab>
          <ModeTab
            id="graph"
            label="Graph"
            selected={mode === 'graph'}
            onSelect={setMode}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="5" r="2.4" />
              <circle cx="5" cy="18" r="2.4" />
              <circle cx="19" cy="18" r="2.4" />
              <path d="M12 7.4v4M10.5 13l-4 3M13.5 13l4 3" />
            </svg>
          </ModeTab>
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
        {/* Quick toggle only; the deliberate choice lives in Settings. */}
        <button
          className="btn btn-icon"
          onClick={toggleTheme}
          title="Switch theme"
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
        </button>
      </header>

      <ConfigHealthBanner />

      <div className="shell" style={{ position: 'relative' }} data-inspector-side={inspectorSide}>
        {mode === 'graph' ? (
          <GraphView />
        ) : mode === 'overview' ? (
          <OverviewView />
        ) : mode === 'projects' ? (
          <ProjectsView />
        ) : (
        <TerminalsLayout
          inspectorLeft={inspectorSide === 'left'}
          firstRun={firstRun}
          inspectorOpen={rightOpen}
          inspectorRef={rightPanelRef}
          onInspectorCollapse={() => setRightOpen(false)}
          onInspectorExpand={() => setRightOpen(true)}
          onToggleInspector={toggleRightPanel}
        />
        )}
      </div>
      <DiagnosticsModal />
      <SessionLaunchDialog />
      {settingsOpen ? <SettingsModal onClose={() => setSettingsOpen(false)} /> : null}
    </div>
  );
}

function TerminalsLayout(props: {
  inspectorLeft: boolean;
  firstRun: boolean;
  inspectorOpen: boolean;
  inspectorRef: RefObject<ImperativePanelHandle | null>;
  onInspectorCollapse: () => void;
  onInspectorExpand: () => void;
  onToggleInspector: () => void;
}): JSX.Element {
  const rail = (
    <Panel
      id="rail"
      order={props.inspectorLeft ? 3 : 1}
      defaultSize={18}
      minSize={12}
      maxSize={32}
      className="rail"
    >
      <Rail />
    </Panel>
  );
  const center = (
    <Panel id="center" order={2} minSize={36} className="center">
      <div className="tabbar">
        <TabStrip />
        <div className="strip-actions">
          <button
            className={props.inspectorOpen ? 'btn btn-toggled' : 'btn'}
            onClick={props.onToggleInspector}
            title="Toggle repository inspector"
          >
            Inspector
          </button>
        </div>
      </div>
      <div className="workarea">
        {props.firstRun ? <FirstRun /> : <TerminalArea />}
      </div>
    </Panel>
  );
  const inspector = (
    <Panel
      id="right"
      order={props.inspectorLeft ? 1 : 3}
      ref={props.inspectorRef}
      defaultSize={22}
      minSize={14}
      maxSize={40}
      collapsible
      collapsedSize={0}
      onCollapse={props.onInspectorCollapse}
      onExpand={props.onInspectorExpand}
      className="rightpanel"
    >
      <RightPanel visible={props.inspectorOpen} />
    </Panel>
  );
  return (
    <PanelGroup
      direction="horizontal"
      autoSaveId={props.inspectorLeft ? 'ade:layout:inspector-left' : 'ade:layout'}
    >
      {props.inspectorLeft ? inspector : rail}
      <PanelResizeHandle className="resize-handle" />
      {center}
      <PanelResizeHandle className="resize-handle" />
      {props.inspectorLeft ? rail : inspector}
    </PanelGroup>
  );
}

function ModeTab(props: {
  id: AppMode;
  label: string;
  selected: boolean;
  onSelect: (mode: AppMode) => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      id={`mode-tab-${props.id}`}
      role="tab"
      aria-label={`${props.label} view`}
      aria-selected={props.selected}
      tabIndex={props.selected ? 0 : -1}
      className={props.selected ? 'on' : ''}
      onClick={() => props.onSelect(props.id)}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home'
          ? 'overview'
          : event.key === 'End'
            ? 'graph'
            : adjacentMode(props.id, event.key === 'ArrowLeft' ? -1 : 1);
        props.onSelect(next);
        document.getElementById(`mode-tab-${next}`)?.focus();
      }}
    >
      {props.children}
      {props.label}
    </button>
  );
}
