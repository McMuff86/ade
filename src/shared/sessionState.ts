import type { SessionProgramState } from './types';

interface State { title: string; status: 'running' | 'exited'; program?: SessionProgramState; launchMode?: string }

/** No CLI liveness is inferred from the selected launcher or a surviving shell. */
export function sessionStateLabel(session: State): string {
  if (session.status === 'exited') return `${session.title} · Terminal beendet`;
  const program = session.program;
  if (!program) return session.launchMode === 'shell' || session.title === 'Shell'
    ? 'Terminal offen' : `${session.title} · Terminal offen · CLI-Status unbekannt`;
  if (program.status === 'starting') return `${session.title} startet · Terminal offen`;
  if (program.status === 'running') return `${session.title} läuft · Terminal offen`;
  if (program.status === 'exited') return `${session.title} beendet · Terminal offen${program.exitCode ? ` · Exit ${program.exitCode}` : ''}`;
  return `${session.title} · CLI-Status unbekannt · Terminal offen`;
}

export function canReuseLaunch(session: State, mode: string): boolean {
  return session.status === 'running' && session.launchMode === mode
    && (mode === 'shell' || session.program?.status === 'starting' || session.program?.status === 'running');
}
