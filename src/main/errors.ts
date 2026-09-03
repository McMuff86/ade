/**
 * The single redaction funnel for text that leaves the main process: IPC
 * error replies, backend stderr embedded in error messages, publication
 * bodies and the pty:create argv log all pass through here. Pure (no
 * Electron import) so the contract tests can exercise it directly.
 */

/** Longest error message an IPC reply may carry back to the renderer. */
export const MAX_IPC_ERROR_CHARS = 2_000;

/** Environment names whose values are treated as secrets wherever they appear. */
const SECRET_ENV_NAME = /^(?:[A-Za-z_][A-Za-z0-9_]*)?(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?)[A-Za-z0-9_]*$/i;

/**
 * Known vendor key shapes. Each alternative is anchored on a stable vendor
 * prefix so ordinary identifiers (commit SHAs, run ids) are left intact.
 */
const VENDOR_KEY_PATTERN = new RegExp([
  String.raw`\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}`,
  String.raw`\bxai-[A-Za-z0-9_-]{16,}`,
  String.raw`\bAIza[0-9A-Za-z_-]{30,}`,
  String.raw`\bgithub_pat_[A-Za-z0-9_]+`,
  String.raw`\bgh[pousr]_[A-Za-z0-9_]+`,
  String.raw`\bxox[abprs]-[A-Za-z0-9-]{10,}`,
].join('|'), 'g');

/** `NAME=value` where NAME looks like a credential slot (argv, env dumps, logs). */
const SECRET_ASSIGNMENT_PATTERN =
  /\b((?:[A-Za-z_][A-Za-z0-9_]*)?(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?)[A-Za-z0-9_]*)=("?)([^\s"',;]+)\2/gi;

export function isSecretEnvName(name: string): boolean {
  return SECRET_ENV_NAME.test(name);
}

/**
 * Strip credentials and control characters from free text. Idempotent and
 * bounded in effect: it never removes anything that is not matched by one of
 * the credential shapes above, so paths and identifiers survive.
 */
export function redactSensitiveText(value: string): string {
  return value
    .replace(/https?:\/\/[^/@\s]+:[^@/\s]+@/gi, 'https://[credentials]@')
    .replace(VENDOR_KEY_PATTERN, '[credential]')
    .replace(SECRET_ASSIGNMENT_PATTERN, '$1=[credential]')
    .replace(/\bauthorization\s*:\s*[^\r\n]+/gi, 'authorization: [credential]')
    .replace(/\bbearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [credential]')
    .replace(/\b(token|password|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[credential]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

/** Redact every element of an argv before it is logged. */
export function redactArgs(args: readonly string[]): string[] {
  return args.map((arg) => redactSensitiveText(arg));
}

/**
 * Environment fields for a log line: secret-named fields show only their
 * name, everything else passes through the text redactor.
 */
export function redactEnvForLog(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    out[name] = isSecretEnvName(name) ? '[credential]' : redactSensitiveText(value);
  }
  return out;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  const detail = error as { stderr?: unknown; message?: unknown } | null;
  if (detail && typeof detail === 'object') {
    if (typeof detail.stderr === 'string' && detail.stderr.trim()) return detail.stderr.trim();
    if (typeof detail.message === 'string') return detail.message;
  }
  return String(error);
}

/**
 * Error text that is safe to hand to a renderer or persist in a journal:
 * redacted, control-character free and bounded.
 */
export function redactedErrorMessage(error: unknown, max = MAX_IPC_ERROR_CHARS): string {
  return redactSensitiveText(errorMessage(error)).slice(0, max);
}

/** Redacted message plus stack for the main-process log (never for a renderer). */
export function redactedErrorDetail(error: unknown, max = 4_000): string {
  const detail = error instanceof Error && error.stack ? error.stack : errorMessage(error);
  return redactSensitiveText(detail).slice(0, max);
}

/**
 * Rebuild an error for the IPC reply. Electron serializes only the message,
 * so the redacted message is the entire payload the renderer receives; the
 * original (unredacted) error stays in the main process for logging.
 */
export function toIpcError(error: unknown): Error {
  const safe = new Error(redactedErrorMessage(error));
  safe.name = error instanceof Error && error.name ? error.name : 'Error';
  return safe;
}
