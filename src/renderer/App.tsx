/**
 * App shell — three-region resizable layout:
 *   rail | center (tab strip + main area) | inspector (collapsible).
 * Inspector side is a Settings choice; default remains rail left / inspector right.
 * Panel sizes persist to localStorage via PanelGroup autoSaveId.
 * Overview, Projects, Terminals and Graph share the persisted workspace/catalog/run state.
 *
 * Title bar order (shared with the tablet, see shared/appNavigation.ts):
 *   logotype · rooms (Übersicht | Organisation | Entwicklung) · laufende Arbeit · Verwaltung
 */

import { lazy, Suspense, useEffect, useRef, useState, type JSX, type RefObject } from 'react';
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels';
import { useSettings } from './stores/settings';
import { TabStrip } from './tabs/TabStrip';
import { TerminalArea } from './terminal/TerminalArea';
import { useAppData } from './stores/appdata';
import { Rail } from './rail/Rail';
import { FirstRun } from './onboarding/FirstRun';
import { SetupModal } from './onboarding/SetupModal';
import { RightPanel } from './rightpanel/RightPanel';
import { useMode } from './stores/mode';
import { GraphView } from './graph/GraphView';
import { OverviewView } from './overview/OverviewView';
import { ProjectsView } from './projects/ProjectsView';
import { WorkView } from './work/WorkView';
import { useSessions, TERMINAL_HOME_GROUP } from './stores/sessions';
import { useSessionLaunch } from './stores/sessionLaunch';
import { useRuns } from './stores/runs';
import { useDiagnostics } from './stores/diagnostics';
import { DiagnosticsModal } from './diagnostics/DiagnosticsModal';
import { SettingsModal } from './settings/SettingsModal';
import { SessionLaunchDialog } from './sessions/SessionLaunchDialog';
import { useSessionShortcuts } from './keyboard/useSessionShortcuts';
import { ConfigHealthBanner } from './ConfigHealthBanner';
import { SessionNavigationContext, SessionSwitchButton } from './sessions/SessionSwitcher';
import { DesktopSessionSwitcher } from './sessions/DesktopSessionSwitcher';
import { DesktopSupervision } from './supervision/DesktopSupervision';
import { SupervisionButton, SupervisionContext } from './supervision/SupervisionGraph';
import { AppNav } from './nav/AppNav';
import { DesktopTaskReminders } from './organizer/DesktopTaskReminders';
const DesktopOrganizer = lazy(() => import('./organizer/DesktopOrganizer').then(module => ({ default: module.DesktopOrganizer })));

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
  const repositoryCount = useAppData((s) => s.repositories.length);
  useEffect(() => {
    void loadAppData();
    void hydrateSessions();
    void loadRuns();
  }, [loadAppData, hydrateSessions, loadRuns]);
  const firstRun = appLoaded && categoryCount === 0;

  const rightPanelRef = useRef<ImperativePanelHandle>(null);
  const [rightOpen, setRightOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [supervision, setSupervision] = useState<{ repositoryId?: string } | null>(null);
  const openProjects = () => { setSetupOpen(false); setMode('projects');
    requestAnimationFrame(() => document.getElementById('mode-tab-projects')?.focus()); };

  const toggleRightPanel = (): void => {
    const panel = rightPanelRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) panel.expand();
    else panel.collapse();
  };

  return (
    <SupervisionContext.Provider value={repositoryId => setSupervision({ repositoryId })}><SessionNavigationContext.Provider value={() => setSwitcherOpen(true)}><div className="app">
      <header className="titlebar">
        <span className="logotype">
          ade<span className="logotype-cursor">_</span>
        </span>

        <AppNav current={mode} onSelect={setMode} idPrefix="mode-tab" />

        <span className="spacer" />

        {/* Quick session switching is about the work in flight, not a room: it
            sits apart from the navigation and from administration. */}
        <div className="titlebar-session" role="group" aria-label="Laufende Arbeit">
          <SessionSwitchButton id="desktop-session-switch" />
          <SupervisionButton id="desktop-supervision" />
        </div>

        <div className="titlebar-admin" role="group" aria-label="Verwaltung">
          <span className="titlebar-caption" aria-hidden="true">Verwaltung</span>
          <button id="ade-setup" className="btn btn-quiet" onClick={() => setSetupOpen(true)}>Einrichtung</button>
          <button
            className="btn btn-quiet"
            onClick={() => setSettingsOpen(true)}
            title="Darstellung, verbundene Geräte, Harness-Anmeldung und API-Schlüssel"
          >
            Einstellungen
          </button>
          <button className="btn btn-quiet" onClick={() => showDiagnostics()} title="CLI-Verfügbarkeit und Anmeldung prüfen">
            Diagnose
          </button>
          {/* Quick toggle only; the deliberate choice lives in Einstellungen. */}
          <button
            className="btn btn-quiet btn-icon"
            onClick={toggleTheme}
            title="Darstellung wechseln"
            aria-label={theme === 'dark' ? 'Zur hellen Darstellung wechseln' : 'Zur dunklen Darstellung wechseln'}
          >
            <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
          </button>
        </div>
      </header>

      <ConfigHealthBanner />
      <DesktopTaskReminders />

      <div className="shell" style={{ position: 'relative' }} data-inspector-side={inspectorSide}>
        {mode === 'tasks' || mode === 'notes' ? (
          <Suspense fallback={<p role="status">Aufgaben und Notizen werden geladen…</p>}><DesktopOrganizer kind={mode === 'tasks' ? 'task' : 'note'} /></Suspense>
        ) : mode === 'graph' ? (
          <GraphView />
        ) : mode === 'overview' ? (
          firstRun && repositoryCount === 0 ? <FirstRun onSetup={() => setSetupOpen(true)} onProjects={openProjects} allowCategory={false} /> : <OverviewView />
        ) : mode === 'work' ? (
          <WorkView />
        ) : mode === 'projects' ? (
          <ProjectsView />
        ) : (
        <TerminalsLayout
          inspectorLeft={inspectorSide === 'left'}
          firstRun={firstRun}
          onSetup={() => setSetupOpen(true)}
          onProjects={openProjects}
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
      {setupOpen && <SetupModal onClose={() => setSetupOpen(false)} onProjects={openProjects} />}
      {switcherOpen && <DesktopSessionSwitcher onClose={() => setSwitcherOpen(false)} />}
      {supervision && <DesktopSupervision repositoryId={supervision.repositoryId} onClose={() => setSupervision(null)} />}
    </div></SessionNavigationContext.Provider></SupervisionContext.Provider>
  );
}

function TerminalsLayout(props: {
  inspectorLeft: boolean;
  firstRun: boolean;
  onSetup: () => void;
  onProjects: () => void;
  inspectorOpen: boolean;
  inspectorRef: RefObject<ImperativePanelHandle | null>;
  onInspectorCollapse: () => void;
  onInspectorExpand: () => void;
  onToggleInspector: () => void;
}): JSX.Element {
  const hasHomeSessions = useSessions((state) => !!state.orderByAgent[TERMINAL_HOME_GROUP]?.length);
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
          <button className="btn" onClick={() => useSessionLaunch.getState().open(null)}>Terminal öffnen</button>
          <button
            className={props.inspectorOpen ? 'btn btn-toggled' : 'btn'}
            onClick={props.onToggleInspector}
            title="Repository-Inspector ein- oder ausblenden"
          >
            Inspector
          </button>
        </div>
      </div>
      <div className="workarea">
        {props.firstRun && !hasHomeSessions ? <FirstRun onSetup={props.onSetup} onProjects={props.onProjects} /> : <TerminalArea />}
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
