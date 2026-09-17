import { useMemo, useRef, useState } from 'react';
import { ConversationPanel } from '../renderer/conversation/ConversationPanel';
import { mobileConversationPort } from './conversationPort';
import type { MobileHost } from './useMobileHost';
import { Dialog } from './ui';

export function MobileConversation({ host, onClose, onBack, fallbackId }: { host: MobileHost; onClose(): void; onBack(): void; fallbackId: string }) {
  const current = useRef(host); current.current = host;
  const [capability, setCapability] = useState<{ deviceId: string | null; epoch: number; canWrite: boolean } | null>(null);
  const port = useMemo(() => mobileConversationPort(() => current.current, canWrite => setCapability({ deviceId: host.deviceId, epoch: host.identityVersion, canWrite })), [host.identityVersion, host.deviceId]);
  const canWrite = capability?.deviceId === host.deviceId && capability?.epoch === host.identityVersion && capability.canWrite;
  const profiles = (host.catalog?.agents ?? []).filter(a => a.runtime === 'codex' && (!a.homeExecutionBackend || a.homeExecutionBackend === 'native'));
  return <Dialog title="ADE-Gespräch" onClose={onClose} fallbackId={fallbackId} className="conversation-dialog">
    <ConversationPanel key={`${host.deviceId}:${host.identityVersion}`} port={port} profiles={profiles} draftScope={`mobile:${host.deviceId ?? 'unpaired'}`}
      online={host.status === 'online'} canWrite={canWrite} onClose={onClose} onBack={onBack} />
  </Dialog>;
}
