import { localizeAppMessage } from '../shared/i18n/appMessages';
import { t as translate } from "../shared/i18n";
import { useLocale } from "../renderer/i18n/language";
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MobileSessionInventory, MobileSupervisionDetail, MobileSupervisionView } from '../shared/remote';
import type { MobileMorningBriefing, MobileHandoffDetail } from '../shared/remote';
import type { SupervisionAction, SupervisionReceipt, SupervisionTarget } from '../shared/supervision';
import { SupervisionContent, type SupervisionController } from '../renderer/supervision/DesktopSupervision';
import { SupervisionGraph } from '../renderer/supervision/SupervisionGraph';
import type { MobileHost } from './useMobileHost';
import { workspaceError } from './AgentWorkspace';
import { Dialog } from './ui';
import { MobileConversation } from './Conversation';
import { ConversationModes } from '../renderer/conversation/ConversationModes';

export function useMobileSupervision(host: MobileHost) {
  const [view, setView] = useState<MobileSupervisionView | null>(null); const [error, setError] = useState('');
  const [inventory, setInventory] = useState<MobileSessionInventory>({ sessions: [], omitted: 0 });
  const [busy, setBusy] = useState(false); const lock = useRef(false); const live = useRef(true);
  const identity = useRef(host.identityVersion); identity.current = host.identityVersion;
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => { setView(null); setError(''); setBusy(false); setInventory({ sessions: [], omitted: 0 }); }, [host.identityVersion]);
  const refresh = useCallback(async () => {
    if (host.status !== 'online') return;
    const current = identity.current;
    try {
      const [next, sessions] = await Promise.all([
        host.request<MobileSupervisionView>('/api/v1/supervision/query', 'POST', { operation: 'overview' }),
        host.request<MobileSessionInventory>('/api/v1/terminal/sessions').catch(() => ({ sessions: [], omitted: 0 })),
      ]);
      if (!live.current || identity.current !== current) return;
      setView(previous => !previous || next.revision >= previous.revision ? next : previous); setInventory(sessions); setError('');
    } catch (reason) { if (live.current && identity.current === current) setError(workspaceError(reason)); }
  }, [host.request, host.status]);
  const command = async (action: SupervisionAction, revision: number): Promise<number> => {
    if (lock.current || host.status !== 'online') throw new Error(translate("PC is not ready."));
    lock.current = true; setBusy(true); setError(''); const current = identity.current;
    try {
      const receipt = await host.request<SupervisionReceipt>('/api/v1/supervision/command', 'POST', { ...action, revision }, crypto.randomUUID());
      if (!live.current || identity.current !== current) throw new Error(translate("Device connection has been changed."));
      await refresh(); return receipt.revision;
    } catch (reason) { if (live.current && identity.current === current) setError(workspaceError(reason)); throw reason; }
    finally { lock.current = false; if (live.current && identity.current === current) setBusy(false); }
  };
  const controller: SupervisionController = ({ view, error: host.status === 'online' ? error : translate("PC not connected. Saved views may be obsolete."), busy: busy || host.status !== 'online', refresh, command });
  return { controller, inventory, setError };
}
export function MobileSupervision({ host, repositoryId, onClose, onNavigate, fallbackId }: {
  host: MobileHost; repositoryId?: string; onClose(): void; onNavigate(target: SupervisionTarget): Promise<void>; fallbackId: string;
}) {
  useLocale();
  const { controller, inventory, setError } = useMobileSupervision(host);
  const [conversation, setConversation] = useState(false);
  const [area, setArea] = useState<'home' | 'project' | 'casual'>(repositoryId ? 'project' : 'home');
  const backToModes = () => { setArea('home'); requestAnimationFrame(() => document.getElementById(`conversation-mode-${area}`)?.focus()); };
  const targets = [...inventory.sessions.filter(s => s.projectRepositoryId || s.repositoryId).map(s => ({ repositoryId: (s.projectRepositoryId || s.repositoryId)!, target: { kind: 'session' as const, id: s.id }, label: `${s.title} · ${s.branch ?? ''}` })),
    ...host.runs.filter(r => r.repositoryId).map(r => ({ repositoryId: r.repositoryId!, target: { kind: 'run' as const, id: r.id }, label: `${r.name} · ${r.status}` }))];
  if (conversation) return <MobileConversation host={host} onClose={onClose} fallbackId={fallbackId} onBack={() => { setConversation(false); requestAnimationFrame(() => document.getElementById('mobile-conversation-open')?.focus()); }} />;
  if (area === 'casual') return <MobileConversation mode="casual" host={host} onClose={onClose} onBack={backToModes} fallbackId={fallbackId} />;
  if (area === 'home') return <Dialog key="conversation-home" title={translate('Conversations')} onClose={onClose} fallbackId={fallbackId} className="conversation-dialog"><ConversationModes onChoose={setArea} /></Dialog>;
  return <Dialog key="project-supervision" title={translate('Project supervision')} onClose={onClose} fallbackId={fallbackId} className="supervision-dialog">
    <button type="button" onClick={backToModes}>{translate('Back to conversations')}</button>
    <button id="mobile-conversation-open" type="button" onClick={() => setConversation(true)}>{translate("Talk to ADE")}</button>
    <SupervisionContent repositoryId={repositoryId} controller={controller} repositories={host.catalog?.repositories ?? []} agents={host.catalog?.agents ?? []} targets={targets}
      handoffs={{ briefing: () => host.request<MobileMorningBriefing>('/api/v1/supervision/query', 'POST', { operation: 'briefing' }),
        handoff: (projectId, handoffId) => host.request<MobileHandoffDetail>('/api/v1/supervision/query', 'POST', { operation: 'handoff', projectId, handoffId }) }}
      detail={projectId => host.request<MobileSupervisionDetail>('/api/v1/supervision/query', 'POST', { operation: 'detail', projectId })}
      draftScope={`mobile:${host.deviceId}`} onClose={onClose} onNavigate={target => { void onNavigate(target).catch(reason => setError(workspaceError(reason))); }} />
  </Dialog>;
}
export function MobileSupervisionGraph({ host, onProject, onNavigate }: { host: MobileHost; onProject(id: string): void; onNavigate(target: SupervisionTarget): Promise<void> }) {
  useLocale();
  const { controller, setError } = useMobileSupervision(host);
  useEffect(() => { void controller.refresh(); const timer = setInterval(() => void controller.refresh(), 5000); return () => clearInterval(timer); }, [controller.refresh]);
  return <>{controller.error && <p role="alert">{localizeAppMessage(controller.error)}</p>}{controller.view && <SupervisionGraph view={controller.view} onProject={onProject}
    onWork={target => { void onNavigate(target).catch(reason => setError(workspaceError(reason))); }} />}</>;
}
