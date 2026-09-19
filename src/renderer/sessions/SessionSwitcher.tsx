import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
import { createContext, useContext, useRef, useState } from 'react';
import { filterSessionNavigation, type SessionNavigationItem } from '../../shared/sessionNavigation';
import './sessionSwitcher.css';

export const SessionNavigationContext = createContext<(() => void) | null>(null);
export function SessionSwitchButton({ id }: { id?: string }) {
  useLocale();
  const open = useContext(SessionNavigationContext);
  return open ? <button id={id} className="session-switch-trigger" type="button" onClick={event => { event.currentTarget.focus(); open(); }}>{translate("Switch work")}</button> : null;
}
export function SessionSwitcher({ items, loading, error, online = true, omitted = 0, onRefresh, onSelect, onClose }: {
  items: SessionNavigationItem[]; loading: boolean; error: string; online?: boolean; omitted?: number;
  onRefresh(): void; onSelect(id: string): Promise<void>; onClose(): void;
}) {
  useLocale();
  const [search, setSearch] = useState(''); const [selecting, setSelecting] = useState<string>();
  const [selectionError, setSelectionError] = useState(''); const lock = useRef(false);
  const visible = filterSessionNavigation(items, search);
  const choose = async (id: string) => {
    if (lock.current || !online) return;
    lock.current = true; setSelecting(id); setSelectionError('');
    try { await onSelect(id); }
    catch (reason) { setSelectionError(reason instanceof Error ? reason.message : translate("The session could not be opened.")); }
    finally { lock.current = false; setSelecting(undefined); }
  };
  return <div className="session-switcher">
    <p>{translate("Open an existing session.")}</p>
    <label>{translate("Search for a project or session")}<input type="search" value={search} onChange={event => setSearch(event.target.value)} aria-label={translate("Search sessions")} /></label>
    {!online && <p role="status">{translate("PC not connected. The session list may be obsolete.")}</p>}
    {loading && <p role="status">{translate("Checking sessions…")}</p>}
    {(error || selectionError) && <p role="alert">{selectionError || error}</p>}
    {!loading && !error && !visible.length && <p>{items.length ? translate("Not a suitable session. Change search.") : translate("No sessions yet. Open a project or a terminal.")}</p>}
    <ul>{visible.map(item => <li key={item.id}>
      <button type="button" data-session-id={item.id} disabled={!online || !!selecting} onClick={() => void choose(item.id)}
        aria-label={translate("Choose session: {{value1}} · {{value2}} · {{value3}}", { value1: item.project, value2: item.title, value3: item.id.slice(0, 8) })}>
        <strong>{item.project}</strong><span>{item.title}{item.detail && ` · ${item.detail}`}</span>
        <small>{selecting === item.id ? translate("Opening session…") : item.status}</small>
      </button>
    </li>)}</ul>
    {omitted > 0 && <p>{translate("Further or unreachable sessions are hidden.")}</p>}
    <div className="session-switch-actions"><button type="button" disabled={loading || !online || !!selecting} onClick={onRefresh}>{translate("Refresh sessions")}</button><button type="button" onClick={onClose}>{translate("Close")}</button></div>
  </div>;
}
