import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type ProgramSignal = { status: 'running' } | { status: 'unknown' } | { status: 'exited'; exitCode: number };

/** Private per-launch framing, removed before replay, xterm, and wire redaction.
 * This is observational telemetry, never authorization to mutate a workspace.
 * Only the original foreground call is tracked, not later manual shell input.
 */
export class ProgramSignalReader {
  private pending = '';
  private started = false;
  private ended = false;
  private readonly prefix: string;
  constructor(nonce: string, private readonly signal: (value: ProgramSignal) => void) {
    this.prefix = `\x1b]777;ade-cli;${nonce};`;
  }
  push(data: string): string {
    let input = this.pending + data; this.pending = ''; let output = '';
    while (input) {
      const begin = input.indexOf(this.prefix);
      if (begin < 0) {
        let keep = Math.min(this.prefix.length - 1, input.length);
        while (keep > 0 && !this.prefix.startsWith(input.slice(-keep))) keep--;
        this.pending = keep ? input.slice(-keep) : '';
        return output + input.slice(0, input.length - keep);
      }
      output += input.slice(0, begin); input = input.slice(begin);
      const end = input.indexOf('\x07', this.prefix.length);
      if (end < 0 && input.length < this.prefix.length + 64) { this.pending = input; return output; }
      if (end < 0 || end > this.prefix.length + 64) {
        output += input[0]; input = input.slice(1); continue;
      }
      const payload = input.slice(this.prefix.length, end);
      if (payload === 'start') {
        if (!this.started && !this.ended) { this.started = true; this.signal({ status: 'running' }); }
      } else if (payload === 'unknown') {
        if (this.started && !this.ended) { this.ended = true; this.signal({ status: 'unknown' }); }
      } else if (/^end;-?\d{1,10}$/.test(payload) && Number.isSafeInteger(Number(payload.slice(4)))
        && Math.abs(Number(payload.slice(4))) <= 2147483648) {
        if (this.started && !this.ended) { this.ended = true; this.signal({ status: 'exited', exitCode: Number(payload.slice(4)) }); }
      } else output += input.slice(0, end + 1);
      input = input.slice(end + 1);
    }
    return output;
  }
  flush(): string { const remaining = this.pending; this.pending = ''; return remaining; }
}

const quotePs = (value: string): string => `'${value.replace(/'/g, "''")}'`;
const quoteSh = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;

export function programWrapper(command: string, platform: 'win32' | 'posix', nonce: string): string {
  if (!/^[a-f0-9]{32}$/.test(nonce)) throw new Error('ade: invalid program marker');
  if (platform === 'win32') return [
    `[Console]::Write(([char]27) + ']777;ade-cli;${nonce};start' + ([char]7))`,
    '$adeCliExit = $null',
    'try {',
    '  $global:LASTEXITCODE = 0',
    `  & {\n${command}\n  }`,
    '  $adeCliSuccess = $?',
    '  $adeCliExit = if ($adeCliSuccess) { $global:LASTEXITCODE } elseif ($global:LASTEXITCODE) { $global:LASTEXITCODE } else { 1 }',
    '} catch { $adeCliExit = 1; throw } finally {',
    `  $adeCliResult = if ($null -eq $adeCliExit) { 'unknown' } else { 'end;' + [string]$adeCliExit }`,
    `  [Console]::Write(([char]27) + ']777;ade-cli;${nonce};' + $adeCliResult + ([char]7))`,
    '}',
  ].join('\n');
  return [
    `printf '\\033]777;ade-cli;${nonce};start\\007'`,
    // A subshell keeps user-authored exit/exec from replacing the tracking shell.
    '(\n' + command + '\n)',
    'ade_cli_exit=$?',
    `printf '\\033]777;ade-cli;${nonce};end;%s\\007' "$ade_cli_exit"`,
    'unset ade_cli_exit',
  ].join('\n');
}

export async function prepareProgram(command: string, platform: 'win32' | 'posix',
  backendPath: (path: string) => Promise<string>): Promise<{ nonce: string; args?: string[]; initialCommand?: string; dispose(): void }> {
  const nonce = randomBytes(16).toString('hex');
  const directory = mkdtempSync(join(tmpdir(), 'ade-interactive-'));
  const file = join(directory, platform === 'win32' ? 'launch.ps1' : 'launch.sh');
  const dispose = (): void => {
    // Only remove the one known file and then its empty directory, never recurse.
    try { rmSync(file, { force: true }); rmdirSync(directory); } catch { /* best effort on shutdown */ }
  };
  try {
    writeFileSync(file, programWrapper(command, platform, nonce), { encoding: 'utf8', mode: 0o600 });
    const path = await backendPath(file);
    return platform === 'win32'
      ? { nonce, args: ['-NoLogo', '-NoExit', '-Command', `& ([scriptblock]::Create([IO.File]::ReadAllText(${quotePs(path)})))`], dispose }
      : { nonce, initialCommand: `source ${quoteSh(path)}`, dispose };
  } catch (error) { dispose(); throw error; }
}
