import { ECDH } from 'node:crypto';
import type { MobilePushCommand, MobilePushSubscription } from '../../shared/remote';
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).length === allowed.length && Object.keys(v).every(k => allowed.includes(k));
const b64 = (v: unknown, bytes: number) => typeof v === 'string' && /^[A-Za-z0-9_-]+$/.test(v) && Buffer.from(v, 'base64url').length === bytes && Buffer.from(v, 'base64url').toString('base64url') === v;
export function validPushSubscription(value: unknown): value is MobilePushSubscription {
  if (!record(value) || !keys(value, ['endpoint', 'keys']) || typeof value.endpoint !== 'string' || value.endpoint.length > 2048
    || !record(value.keys) || !keys(value.keys, ['p256dh', 'auth']) || !b64(value.keys.p256dh, 65) || !b64(value.keys.auth, 16)) return false;
  try {
    const url = new URL(value.endpoint);
    // Android Chrome's browser push provider. Never accept arbitrary URLs from
    // a device: push subscriptions must not become a host-side HTTP proxy.
    if (url.protocol !== 'https:' || url.hostname !== 'fcm.googleapis.com' || url.port || url.username || url.password || url.hash || url.search
      || !/^\/(?:fcm\/send|wp)\/[A-Za-z0-9_:\-]+$/.test(url.pathname)) return false;
    ECDH.convertKey(Buffer.from(value.keys.p256dh as string, 'base64url'), 'prime256v1');
    return true;
  } catch { return false; }
}
export function validPushCommand(value: unknown): value is MobilePushCommand {
  if (!record(value)) return false;
  if (value.operation === 'disable' || value.operation === 'test') return keys(value, ['operation']);
  return value.operation === 'enable' && keys(value, ['operation', 'subscription', 'preferences', 'locale'])
    && (value.locale === 'de' || value.locale === 'en') && validPushSubscription(value.subscription)
    && record(value.preferences) && keys(value.preferences, ['question', 'error', 'result'])
    && Object.values(value.preferences).every(v => typeof v === 'boolean') && Object.values(value.preferences).some(Boolean);
}
