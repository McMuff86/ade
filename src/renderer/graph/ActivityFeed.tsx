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
import { mergeActivityLines } from '../../shared/activity';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [following, setFollowing] = useState(true);
  const hostRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);

  useEffect(() => {
    let live = true;
    setLines([]);
    setLoading(true); setError(false); followRef.current = true; setFollowing(true);
    if (!sessionId) {
      // Archived source: the persisted per-task feed, one read, no live tail.
      if (taskId) {
        void window.ade
          .invoke('runTask:activity', { taskId })
          .then((snapshot) => {
            if (live) setLines(snapshot.lines.slice(-2000));
          })
          .catch(() => { if (live) setError(true); }).finally(() => { if (live) setLoading(false); });
      }
      else setLoading(false);
      return () => {
        live = false;
      };
    }
    const unsubscribe = window.ade.on('pty:activity', (payload) => {
      if (!live || payload.sessionId !== sessionId) return;
      setLines((current) => mergeActivityLines(current, payload.lines));
    });
    void window.ade
      .invoke('pty:activitySnapshot', { sessionId })
      .then((snapshot) => {
        if (!live) return;
        setLines((current) => mergeActivityLines(snapshot.lines, current));
      })
      .catch(() => { if (live) setError(true); }).finally(() => { if (live) setLoading(false); });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [sessionId, taskId, reload]);

  useEffect(() => {
    const host = hostRef.current;
    if (host && followRef.current) host.scrollTop = host.scrollHeight;
  }, [lines]);

  const onScroll = (): void => {
    const host = hostRef.current;
    if (!host) return;
    followRef.current = host.scrollHeight - host.scrollTop - host.clientHeight < 24;
    setFollowing(followRef.current);
  };

  return (
    <div ref={hostRef} className="gactivity" onScroll={onScroll} tabIndex={0} role="log" aria-label="Agent-Aktivität" aria-live="off" aria-busy={loading}>
      {loading && <p role="status">Aktivität wird geladen…</p>}
      {error && <p role="alert">Aktivität konnte nicht geladen werden. <button onClick={() => setReload((value) => value + 1)}>Erneut laden</button></p>}
      {!following && <button onClick={() => { followRef.current = true; setFollowing(true); if (hostRef.current) hostRef.current.scrollTop = hostRef.current.scrollHeight; }}>Zum neuesten Eintrag</button>}
      {lines.length === 0 && !loading && !error && (
        <div className="gactivity-empty">
          {sessionId
            ? 'Warte auf die erste Aktivität des Agenten…'
            : 'Keine aufgezeichnete Aktivität für diesen Task.'}
        </div>
      )}
      {lines.map((line, index) => (
        <div key={line.sequence ?? index} className={`gactivity-line ${line.kind}`}>
          <span className="gactivity-glyph">{GLYPH[line.kind]}</span>
          {line.at !== undefined && <span className="gactivity-time">{new Date(line.at).toLocaleTimeString('de-CH')}</span>}
          <span className="gactivity-text">{line.text}</span>
        </div>
      ))}
    </div>
  );
}
