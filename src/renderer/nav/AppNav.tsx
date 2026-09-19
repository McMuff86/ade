/**
 * Grouped primary navigation, identical on desktop and tablet.
 * Captions name the group inline ("Organisation  Aufgaben Notizen"), so the
 * row reads like a sentence instead of seven equal pills. Arrow keys move
 * across every tab regardless of group; Home/End jump to the ends.
 */
import type { JSX, ReactNode } from 'react';
import { APP_NAV_GROUPS, adjacentView, viewLabel } from '../../shared/appNavigation';
import { APP_VIEWS, type AppView } from '../../shared/appViews';
import './nav.css';

const ICONS: Record<AppView, ReactNode> = {
  overview: <path d="M4 7h16M4 12h10M4 17h7" />,
  tasks: <path d="m3 6 2 2 4-4M11 6h10M3 13h6m2 0h10M3 20h6m2 0h10" />,
  notes: <path d="M14 3H4v18h16V11M10 14l1-5 8-8 4 4-8 8z" />,
  projects: <path d="M3 7V5h7l2 3h9v11H3z" />,
  terminals: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3M13 15h4" /></>,
  work: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="m8 11 2 2 5-5M8 17h8" /></>,
  graph: <><circle cx="12" cy="5" r="2.4" /><circle cx="5" cy="18" r="2.4" /><circle cx="19" cy="18" r="2.4" /><path d="M12 7.4v4M10.5 13l-4 3M13.5 13l4 3" /></>,
};

export function NavIcon({ view }: { view: AppView }): JSX.Element {
  return <svg className="appnav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[view]}</svg>;
}

export function AppNav(props: {
  current: AppView;
  onSelect: (view: AppView) => void;
  /** Element id prefix: desktop uses mode-tab-*, tablet view-tab-*. */
  idPrefix: string;
  /** id of the panel the tabs control (tablet). */
  controls?: string;
  className?: string;
}): JSX.Element {
  const { current, onSelect, idPrefix } = props;
  const focusTab = (view: AppView) => document.getElementById(`${idPrefix}-${view}`)?.focus();
  return (
    <nav className={`appnav ${props.className ?? ''}`} aria-label="Bereiche">
      <div className="appnav-list" role="tablist" aria-label="Bereiche">
        {APP_NAV_GROUPS.map((group) => (
          <div key={group.id} className="appnav-group" role="presentation" data-group={group.id}>
            {group.id !== 'home' && <span className="appnav-caption" aria-hidden="true">{group.label}</span>}
            {group.views.map((view) => (
              <button
                key={view}
                id={`${idPrefix}-${view}`}
                type="button"
                role="tab"
                aria-selected={current === view}
                aria-controls={props.controls}
                tabIndex={current === view ? 0 : -1}
                className={current === view ? 'appnav-tab on' : 'appnav-tab'}
                onClick={() => onSelect(view)}
                onKeyDown={(event) => {
                  const next = event.key === 'ArrowRight' ? adjacentView(view, 1)
                    : event.key === 'ArrowLeft' ? adjacentView(view, -1)
                      : event.key === 'Home' ? APP_VIEWS[0].id
                        : event.key === 'End' ? APP_VIEWS[APP_VIEWS.length - 1]!.id : null;
                  if (!next) return;
                  event.preventDefault();
                  onSelect(next);
                  focusTab(next);
                }}
              >
                <NavIcon view={view} />
                <span className="appnav-label">{viewLabel(view)}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </nav>
  );
}
