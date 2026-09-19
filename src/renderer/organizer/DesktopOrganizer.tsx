import { OrganizerPage, type OrganizerPagePort } from './OrganizerPage';
import { useAppData } from '../stores/appdata';
import { useMode } from '../stores/mode';
import { useRuns } from '../stores/runs';
import { ORGANIZER_REJECTED, type OrganizerKind } from '../../shared/organizer';

const port: OrganizerPagePort = {
  list: async () => { const result = await window.ade.invoke('organizer:query', { operation: 'list' }); if (!('index' in result)) throw new Error('Liste fehlt.'); return result.index; },
  detail: async id => { const result = await window.ade.invoke('organizer:query', { operation: 'detail', id }); if (!('entry' in result)) throw new Error('Eintrag fehlt.'); return result; },
  sequence: async writerId => { const result = await window.ade.invoke('organizer:query', { operation: 'writer', writerId }); if (!('sequence' in result)) throw new Error('Abgleichstand fehlt.'); return result.sequence; },
  save: input => window.ade.invoke('organizer:command', input),
  wasRejected: error => error instanceof Error && error.message.includes(ORGANIZER_REJECTED),
  recording: {
    microphone: allow => window.ade.invoke('dictation:microphone', { allow }),
    prepare: documentId => window.ade.invoke('organizer:dictationPrepare', { documentId }),
    start: jobId => window.ade.invoke('dictation:streamStart', { jobId }),
    chunk: (jobId, sequence, audioBase64) => window.ade.invoke('dictation:streamChunk', { jobId, sequence, audioBase64 }),
    finish: jobId => window.ade.invoke('dictation:streamFinish', { jobId }),
    query: jobId => window.ade.invoke('dictation:query', { jobId }),
    cancel: jobId => window.ade.invoke('dictation:cancel', { jobId }),
  },
  submit: async input => { const result = await window.ade.invoke('runTask:submit', { commandId: input.key, agentId: input.agentId, repositoryId: input.repositoryId, prompt: input.prompt }); await useRuns.getState().refresh(); return { runId: result.run.id }; },
  describe: error => error instanceof Error ? error.message.replace(ORGANIZER_REJECTED, '') : 'Der Vorgang konnte nicht bestätigt werden.',
};
export function DesktopOrganizer({ kind }: { kind: OrganizerKind }) {
  const repositories = useAppData(s => s.repositories); const agents = useAppData(s => s.agents);
  return <OrganizerPage kind={kind} scope="desktop" port={port} online canRead canWrite canDictate repositories={repositories} agents={Object.values(agents)}
    onKind={next => useMode.getState().setMode(next === 'task' ? 'tasks' : 'notes')}
    onRun={id => { useRuns.getState().setActiveRun(id); useMode.getState().setMode('graph'); }} />;
}
