import { t as translate } from "../../shared/i18n";
import { createHash } from 'node:crypto';
import { chmodSync, closeSync, lstatSync, mkdirSync, mkdtempSync, openSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Agent } from '../../shared/types';
import type { ExecutionBackendId } from '../../shared/executionBackends';
import { MAX_SNAPSHOT_CHARS, type AgentInstructionsSnapshot } from '../memory/agentInstructions';
import { assertNoLinks } from '../repositories/pathDiscipline';

/** Conservative UTF-16 bound below CreateProcessW's 32767-character limit,
 * reserving space for the resolved executable/npm wrapper and its fixed args. */
export const MAX_PROFILE_NATIVE_COMMAND_CHARS = 28_000;

export interface ProfileLaunchInput {
  agent: Agent;
  snapshot: AgentInstructionsSnapshot;
  /** Trusted command from ADE's fixed runtime resolver; never user shell text. */
  command: string;
  /** ADE-owned directory outside every execution workspace. */
  scratchRoot: string;
  /** Actual execution workspace; defaults to the identity's own workspace. */
  workspaceDir?: string;
  executionBackend: ExecutionBackendId;
  platform?: NodeJS.Platform;
  /** Main must resolve the effective Codex config (including project/profile
   * layers) before setting this. Empty means verified absence, not unknown.
   * This helper does not inspect config and cannot establish that prerequisite.
   * developer_instructions is an optional additional instruction string;
   * replacing it blindly could discard a user's existing additional guidance.
   * Built-in model instructions are never replaced via model_instructions_file.
   * https://developers.openai.com/codex/config-reference/ */
  codexDeveloperInstructions?: { mode: 'append-verified'; existing: string };
}

export interface PreparedProfileLaunch {
  command: string;
  snapshotPath: string;
  /** Removes only this invocation's known files and then its empty directory. */
  dispose(): void;
}

const quotePs = (text: string): string => `'${text.replace(/'/g, "''")}'`;
const hash = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** JSON basic-string escapes are TOML-compatible for valid Unicode strings. */
function tomlString(text: string): string {
  if (text.includes('\0') || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text)) {
    throw new Error(translate("ade: Profile text contains invalid Unicode characters."));
  }
  // JSON permits DEL unescaped, TOML basic strings do not.
  return JSON.stringify(text).replace(/\u007f/g, '\\u007f');
}

function windowsArgument(text: string): string {
  return `"${text.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"`;
}

function outsideWorkspace(root: string, workspace: string): void {
  const path = relative(resolve(workspace), root);
  if (!path || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))) {
    throw new Error(translate("ade: Profile snapshots must be stored outside the workspace."));
  }
}

/** Native Windows transport only. This proves argument/file delivery, not that
 * a particular installed CLI/model consumed the instructions. Caller owns the
 * actual CLI compatibility probe and the lifetime through process termination. */
export function prepareProfileLaunch(input: ProfileLaunchInput): PreparedProfileLaunch {
  const { agent, snapshot, command } = input;
  if (input.executionBackend !== 'native' || (input.platform ?? process.platform) !== 'win32') {
    throw new Error(translate("ade: Profile instructions are only natively transferred under Windows for this start."));
  }
  const qwen = agent.runtime === 'ollama' && agent.ollamaMode === 'coding' && agent.ollamaHarness === 'qwen-code';
  if (agent.customCommand?.trim() || (!['codex', 'claude'].includes(agent.runtime) && !qwen)) {
    throw new Error(translate("ade: Profile instructions require a supported Codex, Claude or Qwen code start without their own start command."));
  }
  if (!command.trim() || command.includes('\0') || /developer_instructions|append-system-prompt|model_instructions_file/i.test(command)) {
    throw new Error(translate("ade: Profilestart requires an unchanged ADE runtime command without additional instruction options."));
  }
  if (typeof snapshot.content !== 'string' || snapshot.content.length > MAX_SNAPSHOT_CHARS
    || snapshot.chars !== snapshot.content.length || hash(snapshot.content) !== snapshot.sha256) {
    throw new Error(translate("ade: Profile snapshot is invalid or has since been changed."));
  }
  // Validate Unicode for file transport too; never silently replace invalid text.
  tomlString(snapshot.content);
  let argument: string | undefined;
  if (qwen) {
    argument = snapshot.content;
    if (windowsArgument(argument).length + command.length > MAX_PROFILE_NATIVE_COMMAND_CHARS) {
      throw new Error(translate("ade: Profile instructions exceed the safe Windows invocation limit of 28,000 characters. Shorten the profile."));
    }
  }
  if (agent.runtime === 'codex') {
    const baseline = input.codexDeveloperInstructions;
    if (baseline?.mode !== 'append-verified' || typeof baseline.existing !== 'string') {
      throw new Error(translate("ade: Existing Codex Developer statements have not yet been verified. Profilstart might overwrite them."));
    }
    if (baseline.existing.length + snapshot.content.length > MAX_SNAPSHOT_CHARS) {
      throw new Error(translate("ade: Profile statements, along with the existing instructions, exceed the secure Windows call limit."));
    }
    const complete = baseline.existing ? `${baseline.existing}\n\n${snapshot.content}` : snapshot.content;
    // Whitespace before the TOML value is semantically inert and makes the
    // PowerShell 5.1 native marshaller quote the complete argument before it
    // encounters any escaped double quotes within that value.
    argument = `developer_instructions= ${tomlString(complete)}`;
    if (windowsArgument(argument).length + command.length > MAX_PROFILE_NATIVE_COMMAND_CHARS) {
      throw new Error(translate("ade: Profile instructions exceed the safe Windows invocation limit of 28,000 characters. Shorten the profile."));
    }
  }
  if (!isAbsolute(input.scratchRoot)) throw new Error(translate("ade: Profile storage requires an absolute ADE path."));
  const root = resolve(input.scratchRoot);
  outsideWorkspace(root, input.workspaceDir ?? agent.workspaceDir);
  outsideWorkspace(root, agent.workspaceDir);
  assertNoLinks(root);
  mkdirSync(root, { recursive: true });
  assertNoLinks(root);
  const directory = mkdtempSync(join(root, 'profile-'));
  const snapshotPath = join(directory, 'PROFILE.md');
  const argumentPath = join(directory, 'CODEX_ARGUMENT.txt');
  const created: string[] = [];
  const dispose = (): void => {
    // No recursive cleanup: refuse substituted links and leave unknown files.
    try {
      assertNoLinks(directory);
      for (const file of created) {
        try {
          assertNoLinks(file);
          const stat = lstatSync(file);
          if (!stat.isFile() || stat.nlink !== 1) continue;
          chmodSync(file, 0o600);
          unlinkSync(file);
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
      rmdirSync(directory);
    } catch { /* Safe best-effort disposal; no private text or host paths in diagnostics. */ }
  };
  const write = (path: string, content: string): void => {
    assertNoLinks(path);
    const fd = openSync(path, 'wx', 0o600);
    created.push(path);
    try { writeFileSync(fd, content, 'utf8'); } finally { closeSync(fd); }
    chmodSync(path, 0o400);
  };
  try {
    write(snapshotPath, snapshot.content);
    let prepared: string;
    if (argument !== undefined) {
      write(argumentPath, argument);
      // Windows PowerShell 5.1 forwards raw embedded quotes incorrectly to native
      // executables. Quote for its legacy argv marshaller; PowerShell 7's standard
      // marshaller receives the original argument. Neither path evaluates content.
      const expression = [
        '(& {',
        `$adeProfileArg = [IO.File]::ReadAllText(${quotePs(argumentPath)}, [Text.Encoding]::UTF8);`,
        "if ($PSVersionTable.PSVersion -lt [version]'7.3' -or $PSNativeCommandArgumentPassing -eq 'Legacy') {",
        String.raw`$adeProfileNeedsQuotes = $adeProfileArg -match '\s';`,
        String.raw`$adeProfileArg = [regex]::Replace($adeProfileArg, '(\\*)"', '$1$1\"');`,
        String.raw`if ($adeProfileNeedsQuotes) { [regex]::Replace($adeProfileArg, '(\\+)$', '$1$1') } else { $adeProfileArg }`,
        '} else { $adeProfileArg }',
        '})',
      ].join(' ');
      prepared = `${command} ${qwen ? '--append-system-prompt' : '-c'} ${expression}`;
    } else {
      prepared = `${command} --append-system-prompt-file ${quotePs(snapshotPath)}`;
    }
    if (prepared.length > MAX_PROFILE_NATIVE_COMMAND_CHARS) throw new Error(translate("ade: Profile start exceeds the secure Windows call limit."));
    return { command: prepared, snapshotPath, dispose };
  } catch (error) { dispose(); throw error; }
}
