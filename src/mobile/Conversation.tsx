import { t as translate } from "../shared/i18n";
import { useLocale } from "../renderer/i18n/language";
import { useMemo, useRef, useState } from 'react';
import { ConversationPanel } from '../renderer/conversation/ConversationPanel';
import { mobileConversationPort } from './conversationPort';
import type { MobileHost } from './useMobileHost';
import { Dialog } from './ui';
import type { ConversationMode } from '../shared/conversation';

export function MobileConversation({ host, onClose, onBack, fallbackId, mode = 'project' }: { host: MobileHost; onClose(): void; onBack(): void; fallbackId: string; mode?: ConversationMode }) {
  useLocale();
  const current = useRef(host); current.current = host;
  const [capability, setCapability] = useState<{ deviceId: string | null; epoch: number; canWrite: boolean } | null>(null);
  const port = useMemo(() => mobileConversationPort(() => current.current, canWrite => setCapability({ deviceId: host.deviceId, epoch: host.identityVersion, canWrite })), [host.identityVersion, host.deviceId]);
  const canWrite = capability?.deviceId === host.deviceId && capability?.epoch === host.identityVersion && capability.canWrite;
  const profiles = (host.catalog?.agents ?? []).filter(a => a.runtime === 'codex' && (!a.homeExecutionBackend || a.homeExecutionBackend === 'native'));
  return <Dialog title={mode === 'casual' ? translate('Chat & voice') : translate("ADE conversation")} onClose={onClose} fallbackId={fallbackId} className="conversation-dialog">
    <ConversationPanel key={`${host.deviceId}:${host.identityVersion}:${mode}`} mode={mode} port={port} profiles={profiles} draftScope={`mobile:${host.deviceId ?? 'unpaired'}${mode === 'casual' ? ':casual' : ''}`}
      online={host.status === 'online'} canWrite={canWrite} onClose={onClose} onBack={onBack} />
  </Dialog>;
}
