/**
 * ActivityFeed — live, readable view of what a managed task is doing.
 *
 * Print-mode CLIs buffer their human output until exit, so the raw PTY shows
 * nothing while a task works. Main renders the runtime's JSON event stream into
 * activity lines; this subscribes to them (snapshot first, then live) and
 * auto-follows the tail unless the user has scrolled up to read.
 */

import { useEffect, useRef, useState, type JSX } from 'react';
import type { ActivityLine } from '../../shared/ipc';

const GLYPH: Record<ActivityLine['kind'], string> = {
  init: '◇',
  thinking: '✻',
  text: '▸',
  tool: '⚙',
  result: '■',
  error: '✕',
};

export function ActivityFeed({ sessionId, taskId }: { sessionId?: string; taskId?: string }): JSX.Element {
  const [lines, setLines] = useState<ActivityLine[]>([]);
  const hostRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);

  useEffect(() => {
    let live = true;
    setLines([]);
    if (!sessionId) {
      // Archived source: the persisted per-task feed, one read, no live tail.
      if (taskId) {
        void window.ade
          .invoke('runTask:activity', { taskId })
          .then((snapshot) => {
            if (live) setLines(snapshot.lines);
          })
          .catch(() => undefined);
      }
      return () => {
        live = false;
      };
    }
    const unsubscribe = window.ade.on('pty:activity', (payload) => {
      if (!live || payload.sessionId !== sessionId) return;
      setLines((current) => [...current, ...payload.lines]);
    });
    void window.ade
      .invoke('pty:activitySnapshot', { sessionId })
      .then((snapshot) => {
        if (!live) return;
        // Snapshot first, live events appended after: duplicates are avoided
        // because the snapshot is taken before any event of this subscription
        // can render, and main never replays past lines on the event channel.
        setLines((current) => [...snapshot.lines, ...current]);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      unsubscribe();
    };
  }, [sessionId, taskId]);

  useEffect(() => {
    const host = hostRef.current;
    if (host && followRef.current) host.scrollTop = host.scrollHeight;
  }, [lines]);

  const onScroll = (): void => {
    const host = hostRef.current;
    if (!host) return;
    followRef.current = host.scrollHeight - host.scrollTop - host.clientHeight < 24;
  };

  return (
    <div ref={hostRef} className="gactivity" onScroll={onScroll}>
      {lines.length === 0 && (
        <div className="gactivity-empty">
          {sessionId
            ? 'Warte auf die erste Aktivität des Agenten…'
            : 'Keine aufgezeichnete Aktivität für diesen Task.'}
        </div>
      )}
      {lines.map((line, index) => (
        <div key={index} className={`gactivity-line ${line.kind}`}>
          <span className="gactivity-glyph">{GLYPH[line.kind]}</span>
          <span className="gactivity-text">{line.text}</span>
        </div>
      ))}
    </div>
  );
}
