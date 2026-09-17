import { createContext, useContext, useRef, useState } from 'react';
import { filterSessionNavigation, type SessionNavigationItem } from '../../shared/sessionNavigation';
import './sessionSwitcher.css';

export const SessionNavigationContext = createContext<(() => void) | null>(null);
export function SessionSwitchButton({ id }: { id?: string }) {
  const open = useContext(SessionNavigationContext);
  return open ? <button id={id} className="session-switch-trigger" type="button" onClick={event => { event.currentTarget.focus(); open(); }}>Arbeit wechseln</button> : null;
}
export function SessionSwitcher({ items, loading, error, online = true, omitted = 0, onRefresh, onSelect, onClose }: {
  items: SessionNavigationItem[]; loading: boolean; error: string; online?: boolean; omitted?: number;
  onRefresh(): void; onSelect(id: string): Promise<void>; onClose(): void;
}) {
  const [search, setSearch] = useState(''); const [selecting, setSelecting] = useState<string>();
  const [selectionError, setSelectionError] = useState(''); const lock = useRef(false);
  const visible = filterSessionNavigation(items, search);
  const choose = async (id: string) => {
    if (lock.current || !online) return;
    lock.current = true; setSelecting(id); setSelectionError('');
    try { await onSelect(id); }
    catch (reason) { setSelectionError(reason instanceof Error ? reason.message : 'Sitzung konnte nicht geöffnet werden.'); }
    finally { lock.current = false; setSelecting(undefined); }
  };
  return <div className="session-switcher">
    <p>Eine bestehende Sitzung öffnen.</p>
    <label>Projekt oder Sitzung suchen<input type="search" value={search} onChange={event => setSearch(event.target.value)} aria-label="Sitzungen durchsuchen" /></label>
    {!online && <p role="status">PC nicht verbunden. Die Sitzungsliste kann veraltet sein.</p>}
    {loading && <p role="status">Sitzungen werden geprüft…</p>}
    {(error || selectionError) && <p role="alert">{selectionError || error}</p>}
    {!loading && !error && !visible.length && <p>{items.length ? 'Keine passende Sitzung. Suche ändern.' : 'Noch keine Sitzungen. Ein Projekt oder ein Terminal öffnen.'}</p>}
    <ul>{visible.map(item => <li key={item.id}>
      <button type="button" data-session-id={item.id} disabled={!online || !!selecting} onClick={() => void choose(item.id)}
        aria-label={`Sitzung wählen: ${item.project} · ${item.title} · ${item.id.slice(0, 8)}`}>
        <strong>{item.project}</strong><span>{item.title}{item.detail && ` · ${item.detail}`}</span>
        <small>{selecting === item.id ? 'Sitzung wird geöffnet…' : item.status}</small>
      </button>
    </li>)}</ul>
    {omitted > 0 && <p>Weitere oder nicht erreichbare Sitzungen sind ausgeblendet.</p>}
    <div className="session-switch-actions"><button type="button" disabled={loading || !online || !!selecting} onClick={onRefresh}>Sitzungen aktualisieren</button><button type="button" onClick={onClose}>Schliessen</button></div>
  </div>;
}
