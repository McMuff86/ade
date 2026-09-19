import { localizeAppMessage } from '../shared/i18n/appMessages';
import { t as translate } from "../shared/i18n";
import { useLocale } from "../renderer/i18n/language";
import { useEffect, useRef, useState } from 'react';
import type { MobileSessionInventory, MobileTerminalState } from '../shared/remote';
import { mobileSessionNavigation } from '../shared/sessionNavigation';
import { SessionSwitcher } from '../renderer/sessions/SessionSwitcher';
import type { MobileHost } from './useMobileHost';
import { Dialog } from './ui';
import { terminalTarget, type TerminalTarget } from './Terminals';
import { workspaceError } from './AgentWorkspace';

export function MobileSessionSwitcher({ host, onSelect, onClose, fallbackId }: {
  host: MobileHost; onSelect(target: TerminalTarget): void; onClose(): void; fallbackId: string;
}) {
  useLocale();
  const [inventory, setInventory] = useState<MobileSessionInventory>({ sessions: [], omitted: 0 });
  const [error, setError] = useState(''); const [loading, setLoading] = useState(true); const [revision, setRevision] = useState(0);
  const live = useRef(true); const generation = useRef(0);
  useEffect(() => { live.current = true; return () => { live.current = false; generation.current++; }; }, []);
  useEffect(() => {
    const current = ++generation.current; setInventory({ sessions: [], omitted: 0 }); setError('');
    if (host.status !== 'online') { setLoading(false); return; }
    setLoading(true);
    void host.request<MobileSessionInventory>('/api/v1/terminal/sessions').then(result => {
      if (live.current && generation.current === current) setInventory(result);
    }).catch(reason => { if (live.current && generation.current === current) setError(workspaceError(reason)); })
      .finally(() => { if (live.current && generation.current === current) setLoading(false); });
  }, [host.request, host.status, host.identityVersion, revision]);
  return <Dialog title={translate("Switch work")} onClose={onClose} fallbackId={fallbackId} className="session-switch-dialog">
    <SessionSwitcher items={mobileSessionNavigation(inventory.sessions, host.catalog)} loading={loading} error={localizeAppMessage(error)}
      online={host.status === 'online'} omitted={inventory.omitted} onRefresh={() => setRevision(value => value + 1)} onClose={onClose}
      onSelect={async id => {
        const session = inventory.sessions.find(item => item.id === id); if (!session) throw new Error(translate("Session no longer exists. Update list."));
        const target = terminalTarget(session); const { expectedBranch, ...query } = target;
        const current = generation.current;
        try {
          const state = await host.request<MobileTerminalState>('/api/v1/terminal/query', 'POST', query);
          if (!live.current || current !== generation.current) return;
          if (state.selected?.id !== id || expectedBranch !== undefined && state.selected.branch !== expectedBranch) throw new Error(translate("Session or branch has changed. List update."));
          onSelect(target);
        } catch (reason) { throw new Error(workspaceError(reason)); }
      }} />
  </Dialog>;
}
