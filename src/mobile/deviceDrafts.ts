import { useCallback, useEffect, useRef, useState } from 'react';
import { validWorkspaceSelection } from '../shared/projectWorkspaceRequests';
import { validProjectLaunch, validSessionChoice } from '../shared/sessionLaunch';
import { validProjectBranchAction } from '../shared/projectBranches';
import { validProjectGitAction, validProjectGitPath } from '../shared/projectGit';
import { validProjectPublishPreview } from '../shared/projectPublish';

const PREFIX = 'ade-work:';
const MAX_BYTES = 128 * 1024;
const MAX_ITEMS = 24;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 128): value is string => typeof value === 'string' && value.length <= max;
function recovery(key: string, value: unknown): boolean {
  return value !== null && (key === 'project-opening' || key === 'project-start' || key.startsWith('project-publish:') || key.startsWith('project-git:') || key.startsWith('project-file:') || key.startsWith('project-branch:') || key.startsWith('project-workspace:') || key === 'pending-task' || key.startsWith('terminal-command:') || object(value) && value.review === true);
}
function valid(key: string, value: unknown): boolean {
  if (value === null) return key === 'project-opening' || key === 'project-selected' || key === 'open-project' || key.startsWith('project-publish:') || key.startsWith('project-git:') || key.startsWith('project-file:') || key.startsWith('project-branch:') || key.startsWith('project-workspace:') || key === 'project-start' || key === 'pending-task' || key === 'last-workspace' || key.startsWith('terminal-command:');
  if (key === 'project-selected') return text(value, 36) && /^[a-f0-9-]{36}$/.test(value);
  if (key === 'open-project') return text(value);
  if (key.startsWith('terminal-selection:')) return text(value);
  if (!object(value)) return false;
  if (key.startsWith('project-publish:')) return text(value.key, 64) && /^[\w-]+$/.test(value.key) && validProjectPublishPreview(value.preview)
    && value.preview.workspaceId === key.slice('project-publish:'.length);
  if (key.startsWith('project-git:')) return text(value.key, 64) && /^[\w-]+$/.test(value.key) && object(value.preview)
    && text(value.preview.id, 36) && /^[a-f0-9-]{36}$/.test(value.preview.id) && value.preview.workspaceId === key.slice('project-git:'.length)
    && validProjectGitAction(value.preview.action) && Array.isArray(value.preview.affected) && value.preview.affected.length <= 500 && value.preview.affected.every((path) => text(path, 400))
    && [value.preview.head, value.preview.targetHead].every((sha) => sha === null || text(sha, 64) && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha))
    && text(value.preview.projectName, 200) && text(value.preview.branch, 200) && typeof value.preview.expiresAt === 'number' && Number.isFinite(value.preview.expiresAt);
  if (key.startsWith('project-file:')) return text(value.key, 64) && /^[\w-]+$/.test(value.key) && object(value.input)
    && validWorkspaceSelection(value.input) && value.input.projectWorkspaceId === key.slice('project-file:'.length) && validProjectGitPath(value.input.path)
    && text(value.input.text, 24 * 1024) && [value.input.workspaceVersion, value.input.revision].every((part) => text(part, 64) && /^[a-f0-9]{64}$/.test(part));
  if (key.startsWith('project-branch:')) return text(value.key, 64) && /^[\w-]+$/.test(value.key) && object(value.preview)
    && text(value.preview.id, 36) && /^[a-f0-9-]{36}$/.test(value.preview.id)
    && value.preview.workspaceId === key.slice('project-branch:'.length) && validProjectBranchAction(value.preview.action)
    && typeof value.preview.expiresAt === 'number' && Number.isFinite(value.preview.expiresAt)
    && text(value.preview.projectName, 200) && text(value.preview.fromBranch, 200) && text(value.preview.toBranch, 200) && typeof value.preview.separate === 'boolean';
  if (key === 'project-opening') return text(value.key, 64) && /^[\w-]+$/.test(value.key) && text(value.entryId, 33)
    && /^p[a-f0-9]{32}$/.test(value.entryId) && text(value.name, 200);
  if (key.startsWith('terminal-draft:')) return text(value.text, 2000) && typeof value.review === 'boolean';
  if (key.startsWith('project-workspace:')) return text(value.key, 64) && /^[\w-]+$/.test(value.key) && text(value.agentId)
    && ['agent', 'workspace'].includes(String(value.phase));
  if (key === 'last-workspace') return text(value.agentId) && (value.repositoryId === null || text(value.repositoryId))
    && (value.tab === undefined || value.tab === 'files' || value.tab === 'terminal') && (value.terminalId === undefined || text(value.terminalId));
  if (key === 'project-start') return text(value.key, 64) && /^[\w-]+$/.test(value.key) && text(value.name, 80)
    && (value.agentId === undefined || text(value.agentId)) && text(value.repositoryId) && ['agent', 'project', 'workspace', 'terminal', 'done'].includes(String(value.phase))
    && (value.projectWorkspaceId === undefined || text(value.projectWorkspaceId, 36) && /^[a-f0-9-]{36}$/.test(value.projectWorkspaceId))
    && (value.terminalId === undefined || text(value.terminalId));
  if (key.startsWith('terminal-command:')) return text(value.key, 64) && object(value.command)
    && validWorkspaceSelection(value.command)
    && (!value.command.projectWorkspaceId || value.command.operation !== 'open' || validSessionChoice(value.command) && validProjectLaunch(value.command))
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
        if (item.endsWith(':project-opening') || item.endsWith(':project-start') || item.includes(':project-publish:') || item.includes(':project-git:') || item.includes(':project-file:') || item.includes(':project-branch:') || item.includes(':project-workspace:') || item.endsWith(':pending-task') || item.includes(':terminal-command:')) return false;
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
