import { useCallback, useEffect, useRef, useState } from 'react';

const PREFIX = 'ade-work:';
const MAX_BYTES = 128 * 1024;
const MAX_ITEMS = 24;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 128): value is string => typeof value === 'string' && value.length <= max;
function recovery(key: string, value: unknown): boolean {
  return value !== null && (key === 'project-start' || key === 'pending-task' || key.startsWith('terminal-command:') || object(value) && value.review === true);
}
function valid(key: string, value: unknown): boolean {
  if (value === null) return key === 'project-start' || key === 'pending-task' || key === 'last-workspace' || key.startsWith('terminal-command:');
  if (key.startsWith('terminal-selection:')) return text(value);
  if (!object(value)) return false;
  if (key.startsWith('terminal-draft:')) return text(value.text, 2000) && typeof value.review === 'boolean';
  if (key === 'last-workspace') return text(value.agentId) && (value.repositoryId === null || text(value.repositoryId))
    && (value.tab === undefined || value.tab === 'files' || value.tab === 'terminal') && (value.terminalId === undefined || text(value.terminalId));
  if (key === 'project-start') return text(value.key, 64) && /^[\w-]+$/.test(value.key) && text(value.name, 80)
    && text(value.agentId) && text(value.repositoryId) && ['agent', 'project', 'workspace', 'terminal', 'done'].includes(String(value.phase))
    && (value.terminalId === undefined || text(value.terminalId));
  if (key.startsWith('terminal-command:')) return text(value.key, 64) && object(value.command)
    && text(value.command.agentId) && (value.command.repositoryId === null || text(value.command.repositoryId))
    && ['open', 'claim', 'release', 'close'].includes(String(value.command.operation));
  if (key === 'pending-task') return text(value.key, 64) && text(value.path, 200)
    && /^\/api\/v1\/(tasks|runs(?:\/[A-Za-z0-9_.:-]+\/(start|cancel))?)$/.test(value.path);
  if (key === 'task-drafts') return text(value.active, 300) && object(value.drafts) && Object.hasOwn(value.drafts, value.active)
    && Object.keys(value.drafts).length <= 200 && Object.values(value.drafts).every((draft) => object(draft)
      && ['task', 'run'].includes(String(draft.mode)) && text(draft.repositoryId) && Array.isArray(draft.agentIds) && draft.agentIds.every((id) => text(id))
      && text(draft.name, 200) && text(draft.prompt, 8000) && typeof draft.minutes === 'number' && Number.isFinite(draft.minutes) && text(draft.cost, 100));
  return false;
}
export function clearDeviceDrafts(deviceId: string): void {
  try { for (const key of Object.keys(localStorage)) if (key.startsWith(`${PREFIX}${deviceId}:`)) localStorage.removeItem(key); } catch { /* Access is still revoked. */ }
}
export function readDeviceDraft<T>(deviceId: string | null, key: string, fallback: T): T {
  if (!deviceId) return fallback;
  try {
    const raw = localStorage.getItem(`${PREFIX}${deviceId}:${key}`);
    if (!raw || raw.length > MAX_BYTES) return fallback;
    const record = JSON.parse(raw) as { at: number; value: T };
    return Number.isFinite(record.at) && (record.at > Date.now() - 30 * 86400_000 || recovery(key, record.value)) && valid(key, record.value) ? record.value : fallback;
  } catch { return fallback; }
}
export function writeDeviceDraft(deviceId: string | null, key: string, value: unknown): boolean {
  if (!deviceId) return false;
  try {
    const storageKey = `${PREFIX}${deviceId}:${key}`;
    if (value === null) { localStorage.removeItem(storageKey); return true; }
    const raw = JSON.stringify({ at: Date.now(), value });
    if (raw.length > MAX_BYTES) return false;
    // Keep recovery journals; discard only the oldest ordinary drafts at the cap.
    const keys = Object.keys(localStorage).filter((item) => item.startsWith(`${PREFIX}${deviceId}:`) && item !== storageKey);
    if (keys.length >= MAX_ITEMS) {
      const oldest = keys.filter((item) => {
        if (item.endsWith(':project-start') || item.endsWith(':pending-task') || item.includes(':terminal-command:')) return false;
        try { return JSON.parse(localStorage.getItem(item)!).value?.review !== true; } catch { return true; }
      }).sort((a, b) => {
        try { return JSON.parse(localStorage.getItem(a)!).at - JSON.parse(localStorage.getItem(b)!).at; } catch { return 0; }
      })[0];
      if (!oldest) return false; localStorage.removeItem(oldest);
    }
    localStorage.setItem(storageKey, raw); return true;
  } catch { return false; }
}
export function useDeviceDraft<T>(deviceId: string | null, key: string, fallback: T) {
  const initial = useRef(fallback); const owner = `${deviceId}:${key}`;
  const [stored, setStored] = useState(() => ({ owner, value: readDeviceDraft(deviceId, key, initial.current) }));
  const [durable, setDurable] = useState(true);
  const current = useRef(stored); current.current = stored;
  useEffect(() => {
    const next = { owner, value: readDeviceDraft(deviceId, key, initial.current) };
    current.current = next; setStored(next); setDurable(true);
  }, [deviceId, key, owner]);
  const change = useCallback((update: T | ((value: T) => T)): boolean => {
    const previous = current.current.owner === owner ? current.current.value : readDeviceDraft(deviceId, key, initial.current);
    const value = typeof update === 'function' ? (update as (value: T) => T)(previous) : update;
    const next = { owner, value }; current.current = next; setStored(next);
    const saved = writeDeviceDraft(deviceId, key, value); setDurable(saved); return saved;
  }, [deviceId, key, owner]);
  return [stored.owner === owner ? stored.value : readDeviceDraft(deviceId, key, initial.current), change, durable] as const;
}
