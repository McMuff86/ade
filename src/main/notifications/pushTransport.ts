import { request } from 'node:https';
import { generateRequestDetails } from 'web-push';
import type { MobilePushPayload, MobilePushSubscription } from '../../shared/remote';
import { validPushSubscription } from './pushValidation';
export type PushTransport = (subscription: MobilePushSubscription, payload: MobilePushPayload,
  keys: { publicKey: string; privateKey: string }, signal: AbortSignal) => Promise<number>;
/** Library implements RFC 8291 encryption and VAPID. Fixed HTTPS destination,
 * no redirects, no provider response bodies or endpoint-bearing errors escape. */
export const sendWebPush: PushTransport = async (subscription, payload, keys, signal) => {
  if (!validPushSubscription(subscription) || signal.aborted) throw new Error('Push not sent');
  const details = encryptedPushRequest(subscription, payload, keys);
  return new Promise<number>((resolve, reject) => {
    const fail = () => reject(new Error('Push delivery not confirmed'));
    const req = request(details.endpoint, { method: 'POST', headers: details.headers, signal }, response => {
      const status = response.statusCode ?? 0;
      response.destroy(); resolve(status);
    });
    const timer = setTimeout(() => { req.destroy(); fail(); }, 10_000); timer.unref();
    req.on('error', fail); req.on('close', () => clearTimeout(timer));
    req.end(details.body);
  });
};
export function encryptedPushRequest(subscription: MobilePushSubscription, payload: MobilePushPayload, keys: { publicKey: string; privateKey: string }) {
  if (!validPushSubscription(subscription)) throw new Error('Push not sent');
  return generateRequestDetails(subscription, JSON.stringify(payload), {
    vapidDetails: { subject: 'https://github.com/McMuff86/ade', ...keys }, TTL: 300, urgency: 'normal', topic: payload.tag,
    contentEncoding: 'aes128gcm',
  });
}
