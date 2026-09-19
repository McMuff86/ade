import { useEffect, useState } from 'react';
import { dueOrganizerReminders } from '../../shared/organizer';
import { useMode } from '../stores/mode';

export function DesktopTaskReminders() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let active = true; let querying = false;
    const refresh = async () => { if (querying) return; querying = true; try {
      const result = await window.ade.invoke('organizer:query', { operation: 'list' });
      if (active && 'index' in result) setCount(dueOrganizerReminders(result.index).length);
    } catch { /* Organizer page reports read errors without blocking other work. */ } finally { querying = false; } };
    const stop = window.ade.on('organizer:changed', () => { void refresh(); });
    const timer = setInterval(() => { void refresh(); }, 10_000); void refresh();
    return () => { active = false; stop(); clearInterval(timer); };
  }, []);
  if (!count) return null;
  return <aside className="organizer-global-reminder" aria-label="Fällige Aufgaben"><span role="status">{count} Erinnerung(en) fällig.</span>
    <button type="button" onClick={() => { useMode.getState().setMode('tasks'); requestAnimationFrame(() => document.getElementById('mode-tab-tasks')?.focus()); }}>Tasks öffnen</button></aside>;
}
