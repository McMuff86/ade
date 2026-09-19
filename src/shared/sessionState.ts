import { t as translate } from "./i18n";
import type { SessionProgramState } from './types';

interface State { title: string; status: 'running' | 'exited'; program?: SessionProgramState; launchMode?: string }

/** No CLI liveness is inferred from the selected launcher or a surviving shell. */
export function sessionStateLabel(session: State): string {
  if (session.status === 'exited') return translate("{{value1}} · Terminal ended", { value1: session.title });
  const program = session.program;
  if (!program) return session.launchMode === 'shell' || session.title === 'Shell'
    ? translate("Terminal open") : translate("{{value1}} · Terminal open · CLI status unknown", { value1: session.title });
  if (program.status === 'starting') return translate("{{value1}} starting · Terminal open", { value1: session.title });
  if (program.status === 'running') return translate("{{value1}} running · Terminal open", { value1: session.title });
  if (program.status === 'exited') return translate("{{value1}} ended · Terminal open{{value2}}", { value1: session.title, value2: program.exitCode ? ` · Exit ${program.exitCode}` : '' });
  return translate("{{value1}} · CLI status unknown · Terminal open", { value1: session.title });
}

export function canReuseLaunch(session: State, mode: string): boolean {
  return session.status === 'running' && session.launchMode === mode
    && (mode === 'shell' || session.program?.status === 'starting' || session.program?.status === 'running');
}
