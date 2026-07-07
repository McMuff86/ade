/**
 * App shell — three-region resizable layout:
 *   left rail | center (tab strip + main area) | right panel (collapsible).
 * Panel sizes persist to localStorage via PanelGroup autoSaveId.
 * The regions are placeholders; Phase B1/B2/C fill them in.
 */

import { useRef, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels';
import { useSettings } from './stores/settings';
import { TabStrip } from './tabs/TabStrip';
import { TerminalArea } from './terminal/TerminalArea';

export function App() {
  const theme = useSettings((s) => s.theme);
  const toggleTheme = useSettings((s) => s.toggleTheme);

  const rightPanelRef = useRef<ImperativePanelHandle>(null);
  const [rightOpen, setRightOpen] = useState(true);

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
        <span className="spacer" />
        {/* temporary toggle — settings UI replaces this later */}
        <button className="btn" onClick={toggleTheme} title="Switch theme">
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>
      </header>

      <div className="shell">
        <PanelGroup direction="horizontal" autoSaveId="ade:layout">
          <Panel id="rail" order={1} defaultSize={18} minSize={12} maxSize={32} className="rail">
            <div className="placeholder">
              <div className="placeholder-title">Categories and agents</div>
              <div className="placeholder-sub">Rail lands in Phase B2</div>
            </div>
          </Panel>

          <PanelResizeHandle className="resize-handle" />

          <Panel id="center" order={2} minSize={36} className="center">
            <div className="tabbar">
              <TabStrip />
              <div className="strip-actions">
                <button
                  className={rightOpen ? 'btn btn-toggled' : 'btn'}
                  onClick={toggleRightPanel}
                  title="Toggle right panel"
                >
                  Changes
                </button>
              </div>
            </div>
            <div className="workarea">
              <TerminalArea />
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
            <div className="placeholder">
              <div className="placeholder-title">Files / Changes</div>
              <div className="placeholder-sub">Git panel lands in Phase C</div>
            </div>
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
}
