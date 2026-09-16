import type { MobileHost } from './useMobileHost';
import type { MobileReplyRequest, MobileReplyResult, MobileTerminalSelection } from '../shared/remote';
import type { ReplySpeechPort } from '../renderer/terminal/ReplySpeechButton';

/** Keep retry keys for this dialog; neither source text nor audio enters browser storage. */
export function mobileReplyPort(request: MobileHost['request'], target: MobileTerminalSelection & { terminalId: string }): ReplySpeechPort {
  const keys = new Map<string, string>();
  const send = (body: MobileReplyRequest) => {
    if (body.operation === 'prepare') return request<MobileReplyResult>('/api/v1/terminal/speech', 'POST', body, crypto.randomUUID());
    const fingerprint = JSON.stringify(body);
    if (keys.size >= 32 && !keys.has(fingerprint)) keys.delete(keys.keys().next().value!);
    if (!keys.has(fingerprint)) keys.set(fingerprint, crypto.randomUUID());
    return request<MobileReplyResult>('/api/v1/terminal/speech', 'POST', body, body.operation === 'read' ? undefined : keys.get(fingerprint));
  };
  return {
    prepare: input => send({ operation: 'prepare', target, ...input }),
    speak: replyId => send({ operation: 'speak', replyId }),
    read: replyId => send({ operation: 'read', replyId }),
    cancel: replyId => send({ operation: 'cancel', replyId }),
  };
}
