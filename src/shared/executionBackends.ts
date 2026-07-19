/** Stable execution-backend identifiers persisted in repository scopes. */

export type ExecutionBackendId = 'native' | `wsl:${string}`;

export const NATIVE_EXECUTION_BACKEND: ExecutionBackendId = 'native';

/**
 * WSL distribution names are passed as one argv value, never interpolated into
 * a shell command. The remaining restrictions keep ids bounded, printable and
 * unambiguous when serialized as `wsl:<distribution>`.
 */
export function isWslDistributionName(value: unknown): value is string {
  return typeof value === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/.test(value)
    && value.trim() === value;
}

export function wslExecutionBackend(distribution: string): ExecutionBackendId {
  if (!isWslDistributionName(distribution)) {
    throw new Error('ade: invalid WSL distribution name');
  }
  return `wsl:${distribution}`;
}

export function isExecutionBackendId(value: unknown): value is ExecutionBackendId {
  if (value === NATIVE_EXECUTION_BACKEND) return true;
  return typeof value === 'string'
    && value.startsWith('wsl:')
    && isWslDistributionName(value.slice('wsl:'.length));
}

export function normalizeExecutionBackendId(value: unknown): ExecutionBackendId {
  return isExecutionBackendId(value) ? value : NATIVE_EXECUTION_BACKEND;
}

export function wslDistribution(backend: ExecutionBackendId): string | null {
  return backend === NATIVE_EXECUTION_BACKEND ? null : backend.slice('wsl:'.length);
}

export function executionBackendPlatform(
  backend: ExecutionBackendId,
  hostPlatform: NodeJS.Platform = process.platform,
): 'win32' | 'posix' {
  return backend === NATIVE_EXECUTION_BACKEND && hostPlatform === 'win32' ? 'win32' : 'posix';
}
