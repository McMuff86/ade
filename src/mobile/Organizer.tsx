import { t as translate } from "../shared/i18n";
import { useLocale } from "../renderer/i18n/language";
import { useMemo, useRef } from 'react';
import { OrganizerPage, type OrganizerPagePort } from '../renderer/organizer/OrganizerPage';
import { organizerCommandKey, type OrganizerKind, type OrganizerQueryResult } from '../shared/organizer';
import type { MobileDictationResult, MobileHostState, MobileOrganizerDictation, MobileCommandResult } from '../shared/remote';
import type { MobileHost } from './useMobileHost';
import { workspaceError } from './AgentWorkspace';
import { MobileClientError } from './client';

export function MobileOrganizer({ host, access, kind, onKind, onRun }: { host: MobileHost; access: MobileHostState | null; kind: OrganizerKind; onKind(kind: OrganizerKind): void; onRun(id: string): void }) {
  useLocale();
  const current = useRef(host); current.current = host;
  const port = useMemo<OrganizerPagePort>(() => {
    const identity = host.identityVersion; const device = host.deviceId;
    const guard = () => { if (identity !== current.current.identityVersion || device !== current.current.deviceId) throw new Error(translate("Device connection has been changed.")); };
    const request = async <T,>(path: string, input: unknown, key?: string): Promise<T> => { guard(); const result = await current.current.request<T>(path, 'POST', input, key); guard(); return result; };
    const query = (input: unknown) => request<OrganizerQueryResult>('/api/v1/organizer/query', input);
    const dictation = (input: MobileOrganizerDictation, key?: string) => request<MobileDictationResult>('/api/v1/organizer/dictation', input, key);
    return {
      list: async () => { const result = await query({ operation: 'list' }); if (!('index' in result)) throw new Error(translate("List missing.")); return result.index; },
      detail: async id => { const result = await query({ operation: 'detail', id }); if (!('entry' in result)) throw new Error(translate("Entry missing.")); return result; },
      sequence: async writerId => { const result = await query({ operation: 'writer', writerId }); if (!('sequence' in result)) throw new Error(translate("Sync state is missing.")); return result.sequence; },
      save: input => request('/api/v1/organizer/command', input, organizerCommandKey(input)),
      wasRejected: error => error instanceof MobileClientError && [400, 403, 404, 409, 422].includes(error.status),
      recording: {
        microphone: async () => { guard(); },
        prepare: async documentId => { const result = await dictation({ operation: 'prepare', documentId }, crypto.randomUUID()); if (!('jobId' in result)) throw new Error(translate("Recording target is missing.")); return result; },
        start: async jobId => { await dictation({ operation: 'stream-start', jobId }, `${jobId}-start`); },
        chunk: async (jobId, sequence, audioBase64) => { await dictation({ operation: 'stream-chunk', jobId, sequence, audioBase64 }, `${jobId}:${sequence}`); },
        finish: async jobId => { await dictation({ operation: 'stream-finish', jobId }, `${jobId}-finish`); },
        query: async jobId => { const result = await dictation({ operation: 'query', jobId }); if (!('state' in result)) throw new Error(translate("Dictation status is missing.")); return result.state; },
        cancel: async jobId => { await dictation({ operation: 'cancel', jobId }, `${jobId}-cancel`); },
      },
      submit: async input => { const result = await request<MobileCommandResult>('/api/v1/tasks', { agentId: input.agentId, repositoryId: input.repositoryId, prompt: input.prompt }, input.key); current.current.acceptRun(result.run); return { runId: result.run.id }; },
      describe: workspaceError,
    };
  }, [host.identityVersion, host.deviceId]);
  const online = host.status === 'online';
  return <OrganizerPage key={`${host.deviceId}:${host.identityVersion}`} kind={kind} scope={`mobile:${host.deviceId}`} port={port} online={online}
    canRead={!online || access?.capabilities?.includes('organizer:read') === true} canWrite={!online || access?.capabilities?.includes('organizer:write') === true}
    canDictate={access?.capabilities?.includes('dictation:transcribe') === true} repositories={host.catalog?.repositories ?? []} agents={host.catalog?.agents ?? []} onKind={onKind} onRun={onRun} />;
}
