export const HOST_API_LOOPBACK = '127.0.0.1' as const;
export const DEFAULT_HOST_API_PORT = 4317;
export const MIN_HOST_API_TOKEN_CHARS = 32;
export const MAX_HOST_API_TOKEN_CHARS = 128;
const HOST_API_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

export type HostApiConfig =
  | { enabled: false }
  | {
      enabled: true;
      host: typeof HOST_API_LOOPBACK;
      port: number;
      token: string;
    };

export function parseHostApiConfig(
  env: Readonly<Record<string, string | undefined>>,
): HostApiConfig {
  if (env['ADE_HOST_API_ENABLED'] !== '1') return { enabled: false };

  const token = env['ADE_HOST_API_TOKEN'] ?? '';
  if (
    token.length < MIN_HOST_API_TOKEN_CHARS
    || token.length > MAX_HOST_API_TOKEN_CHARS
    || !HOST_API_TOKEN_PATTERN.test(token)
  ) {
    throw new Error(
      `ade: host API token must contain ${MIN_HOST_API_TOKEN_CHARS}-${MAX_HOST_API_TOKEN_CHARS} URL-safe ASCII characters`,
    );
  }

  const rawPort = env['ADE_HOST_API_PORT'];
  const port = rawPort === undefined ? DEFAULT_HOST_API_PORT : Number(rawPort);
  if (!Number.isInteger(port) || port < 1_024 || port > 65_535) {
    throw new Error('ade: host API port must be an integer between 1024 and 65535');
  }

  return {
    enabled: true,
    host: HOST_API_LOOPBACK,
    port,
    token,
  };
}

/**
 * Read the bootstrap secret exactly once, then remove it from the ambient
 * environment so subsequently launched agent processes cannot inherit it.
 */
export function consumeHostApiConfig(env: Record<string, string | undefined>): HostApiConfig {
  try {
    return parseHostApiConfig(env);
  } finally {
    delete env['ADE_HOST_API_TOKEN'];
  }
}
