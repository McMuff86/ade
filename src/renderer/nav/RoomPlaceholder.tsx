/**
 * Honest placeholder for a room whose content ships in a parallel change
 * (Aufgaben/Notizen). It states what the room is for and what it will not do,
 * so the navigation can be judged as a whole before every room is filled.
 */
import type { JSX } from 'react';
import type { AppView } from '../../shared/appViews';
import { viewLabel } from '../../shared/appNavigation';

export function RoomPlaceholder({ view }: { view: AppView }): JSX.Element {
  const task = view === 'tasks';
  return (
    <section className="room-placeholder" aria-label={viewLabel(view)}>
      <h1>{viewLabel(view)}</h1>
      <p>{task
        ? 'Persönliche Aufgaben für später oder einen Termin. Eine Aufgabe startet keinen Agenten; die Übergabe an einen Agenten ist ein eigener, sichtbarer Schritt.'
        : 'Freier Inhalt: Text, Diktat, Fotos und Skizzen, auf diesem Gerät gespeichert und mit dem PC abgeglichen.'}</p>
      <p role="status">Dieser Bereich wird gerade umgesetzt und erscheint hier, sobald er abgenommen ist.</p>
    </section>
  );
}
