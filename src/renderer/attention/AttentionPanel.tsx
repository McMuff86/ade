import { useEffect, useRef, useState } from 'react';
import { t } from '../../shared/i18n';
import { useLocale } from '../i18n/language';
import { ATTENTION_GROUPS, type AttentionGroup, type AttentionRow, type AttentionSnapshot, type AttentionTarget } from '../../shared/attention';
import { formatRelativeTime } from '../../shared/overviewFormat';
import './attention.css';

const groupLabel = (group: AttentionGroup) => ({ 'needs-you': t('Needs you'), working: t('Working'), review: t('Ready for review'), interrupted: t('Interrupted work'), unknown: t('Unknown work state') })[group];
const reasonLabel = (reason: AttentionRow['reason']) => ({ question: t('A confirmed question awaits your answer.'), approval: t('A review or approval is pending.'),
  'run-active': t('Managed work is active.'), 'process-active': t('CLI process started or running; model activity is not inferred.'),
  completed: t('Managed work reports completion. Review its result.'), failed: t('Work reported an error. Inspect the details.'),
  cancelled: t('Work was cancelled.'), lost: t('The previous host lost this session. Nothing was replayed.'),
  unknown: t('No confirmed agent state. Silence does not mean completion.'), ended: t('The terminal ended; this does not prove task completion.'),
  handoff: t('An open handoff is waiting in the morning overview.') })[reason];

/** Same accessible decision surface on desktop and tablet. Navigation delegates
 * to existing detail views; this overview never sends input or takes a lease. */
export function AttentionPanel({ identity, online = true, query, onOpen }: {
  identity: string; online?: boolean; query(): Promise<AttentionSnapshot>; onOpen(target: AttentionTarget, current: () => boolean): Promise<void> | void;
}) {
  useLocale();
  const [snapshot, setSnapshot] = useState<AttentionSnapshot | null>(null);
  const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState<string | null>(null);
  const epoch = useRef(0); const pending = useRef(false); const navigation = useRef(false);
  const queryRef = useRef(query); queryRef.current = query;
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    const generation = ++epoch.current; pending.current = false; navigation.current = false;
    setSnapshot(null); setError(''); setOpening(null); setLoading(online);
    const refresh = async () => {
      if (!online || pending.current || generation !== epoch.current) return;
      pending.current = true;
      try {
        const next = await queryRef.current();
        if (generation === epoch.current) { setSnapshot(next); setError(''); }
      } catch { if (generation === epoch.current) { setSnapshot(null); setError(t('The work overview could not be loaded. Refresh before opening work.')); } }
      finally { if (generation === epoch.current) { pending.current = false; setLoading(false); } }
    };
    refreshRef.current = refresh;
    void refresh(); const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 5000);
    return () => { epoch.current++; clearInterval(timer); };
  }, [identity, online]);
  const open = async (row: AttentionRow) => {
    if (!row.target || navigation.current || !online) return;
    const generation = epoch.current; navigation.current = true; setOpening(row.id); setError('');
    try { await onOpen(row.target, () => generation === epoch.current); }
    catch { if (generation === epoch.current) setError(t('This work could not be opened. Refresh and check its current state.')); }
    finally { if (generation === epoch.current) { navigation.current = false; setOpening(null); } }
  };
  return <section className="attention-panel" aria-label={t('Your next decisions')} data-testid="attention-panel">
    <header><div><h2>{t('Your next decisions')}</h2><p>{t('Confirmed questions, results and interruptions across your projects.')}</p></div>
      <button type="button" disabled={!online || !!opening} onClick={() => void refreshRef.current()}>{t('Refresh work overview')}</button></header>
    {!online ? <p role="status">{t('PC offline. Reconnect to check work; no action is queued.')}</p>
      : loading ? <p role="status">{t('Loading work overview…')}</p> : null}
    {error && <p role="alert">{error}</p>}
    {online && snapshot && <>
      {!snapshot.rows.length && <p>{t('No current decisions or recorded work yet.')}</p>}
      {snapshot.omitted > 0 && <p>{t('This overview is limited. Open the project for additional work.')}</p>}
      <div className="attention-groups">{ATTENTION_GROUPS.map(group => {
        const rows = snapshot.rows.filter(row => row.group === group);
        if (!rows.length) return null;
        return <section key={group} aria-label={groupLabel(group)} data-attention-group={group}>
          <h3>{groupLabel(group)} <span>{rows.length}</span></h3>
          <ul>{rows.map(row => <li key={row.id} data-attention-id={row.id}>
            <strong>{row.title}</strong>{row.project && <span>{row.project}</span>}
            <p>{reasonLabel(row.reason)}{row.pendingQuestions > 0 ? ` (${row.pendingQuestions})` : ''}</p>
            <small>{row.activityAt === null ? t('Last activity unknown') : `${row.activityKind === 'output' ? t('Last confirmed output') : row.activityKind === 'start' ? t('Session started') : t('Last confirmed state')}: ${formatRelativeTime(snapshot.observedAt, row.activityAt)}`}</small>
            <button type="button" disabled={!row.target || !!opening && opening !== row.id} aria-disabled={opening === row.id || undefined}
              aria-busy={opening === row.id || undefined} onClick={event => { event.currentTarget.focus(); void open(row); }} aria-label={t('Open work: {{title}}', { title: row.title })}>
              {opening === row.id ? t('Opening work…') : !row.target ? t('Work is no longer available.')
                : row.target.kind === 'project' ? t('Open project') : row.target.kind === 'supervision' ? t('Review handoff')
                  : row.reason === 'question' ? t('Open question') : row.group === 'review' ? t('Review result') : t('Inspect work')}
            </button>
          </li>)}</ul>
        </section>;
      })}</div>
    </>}
  </section>;
}
