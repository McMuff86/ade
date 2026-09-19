import { t as translate } from "../../shared/i18n";
import { homedir } from 'node:os';
import { lstatSync } from 'node:fs';
import { assertNoLinks } from '../repositories/pathDiscipline';

/** Host chooses the start directory. Never accept a path from a remote client. */
export function terminalHome() {
  const workspaceDir = homedir();
  assertNoLinks(workspaceDir);
  const stat = lstatSync(workspaceDir, { bigint: true });
  if (!stat.isDirectory()) throw new Error(translate("ade: User directory is not available."));
  return { workspaceDir, executionBackend: 'native' as const, rootIdentity: `${stat.dev}:${stat.ino}` };
}
