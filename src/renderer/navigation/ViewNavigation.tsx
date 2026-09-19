import { useRef, useState } from 'react';
import { APP_VIEWS, type AppView } from '../../shared/appViews';
import './navigation.css';

const groups: Array<{ label: string; views: AppView[] }> = [
  { label: 'Start', views: ['overview'] }, { label: 'Organisation', views: ['tasks', 'notes'] },
  { label: 'Entwicklung', views: ['projects', 'terminals', 'work', 'graph'] },
];
const paths: Record<AppView, string> = {
  overview: 'M4 7h16M4 12h10M4 17h7', tasks: 'm3 6 2 2 4-4M11 6h10M3 13h6m2 0h10M3 20h6m2 0h10',
  notes: 'M14 3H4v18h16V11M10 14l1-5 8-8 4 4-8 8z', projects: 'M3 7V5h7l2 3h9v11H3z',
  terminals: 'M3 4h18v16H3zM7 9l3 3-3 3m6 0h4', work: 'M5 3h14v18H5zM8 8h8M8 12h8m-8 4h5',
  graph: 'M10 3h4v4h-4zM3 16h4v4H3zM17 16h4v4h-4zM12 7v5M5 16l7-4 7 4',
};
export function ViewNavigation({ view, onSelect, mobile = false }: { view: AppView; onSelect(view: AppView): void; mobile?: boolean }) {
  const prefix = mobile ? 'view-tab' : 'mode-tab'; const key = `ade:nav-collapsed:${mobile ? 'mobile' : 'desktop'}`;
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(key) === 'true'; } catch { return false; } });
  const toggle = useRef<HTMLButtonElement>(null); const selected = APP_VIEWS.find(item => item.id === view)!;
  const collapse = (next: boolean) => { setCollapsed(next); try { localStorage.setItem(key, String(next)); } catch { /* Visual preference only. */ } };
  return <nav className={`ade-navigation${mobile ? ' ade-navigation-mobile' : ''}`} aria-label="Seitennavigation" onKeyDown={event => {
    if (event.key === 'Escape' && !collapsed) { event.preventDefault(); event.stopPropagation(); collapse(true); toggle.current?.focus(); }
  }}>
    <button type="button" ref={toggle} className="ade-navigation-toggle" aria-label={collapsed ? 'Navigation ausklappen' : 'Navigation einklappen'} aria-expanded={!collapsed} aria-controls={`${prefix}-navigation`}
      onClick={() => collapse(!collapsed)}><span aria-hidden="true">{collapsed ? '☰' : '‹'}</span>{collapsed && <span>{selected.label}</span>}</button>
    <div id={`${prefix}-navigation`} hidden={collapsed} role="tablist" aria-label="View mode" className={mobile ? 'm-view-switch ade-navigation-views' : 'mode-switch ade-navigation-views'}>
      {groups.map(group => <div key={group.label} className="ade-navigation-group" role="presentation"><span className="ade-navigation-label" aria-hidden="true">{group.label}</span>
        <div role="presentation" className="ade-navigation-tabs">{group.views.map(id => { const item = APP_VIEWS.find(candidate => candidate.id === id)!;
          return <button type="button" key={id} id={`${prefix}-${id}`} role="tab" aria-label={mobile ? item.label : `${item.label} view`} aria-selected={view === id}
            aria-controls={mobile ? 'mobile-view-panel' : undefined} tabIndex={view === id ? 0 : -1} className={view === id ? 'on' : ''} onClick={() => onSelect(id)}
            onKeyDown={event => {
              const index = APP_VIEWS.findIndex(candidate => candidate.id === id); const next = event.key === 'ArrowRight' ? (index + 1) % APP_VIEWS.length : event.key === 'ArrowLeft' ? (index + APP_VIEWS.length - 1) % APP_VIEWS.length : event.key === 'Home' ? 0 : event.key === 'End' ? APP_VIEWS.length - 1 : null;
              if (next === null) return; event.preventDefault(); const target = APP_VIEWS[next]!.id; onSelect(target); document.getElementById(`${prefix}-${target}`)?.focus();
            }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d={paths[id]} /></svg>{item.label}</button>;
        })}</div></div>)}
    </div>
  </nav>;
}
