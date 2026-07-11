/** Pure URL allow-list helpers shared by window navigation and IPC checks. */

function parsed(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function normalizedPath(url: URL): string {
  return url.pathname.replace(/\/+$/, '') || '/';
}

/** Only the configured Vite origin/path or the exact packaged renderer is trusted. */
export function isTrustedRendererUrl(
  value: string,
  devUrl: string | undefined,
  packagedUrl: string,
): boolean {
  const actual = parsed(value);
  if (!actual || actual.username || actual.password) return false;

  if (devUrl) {
    const expected = parsed(devUrl);
    if (!expected || !['http:', 'https:'].includes(actual.protocol)) return false;
    return actual.origin === expected.origin && normalizedPath(actual) === normalizedPath(expected);
  }

  const expected = parsed(packagedUrl);
  if (!expected || actual.protocol !== 'file:') return false;
  return actual.origin === expected.origin && normalizedPath(actual) === normalizedPath(expected);
}

/** Links may leave ADE only through an ordinary web browser URL. */
export function isSafeExternalUrl(value: string): boolean {
  const url = parsed(value);
  return Boolean(
    url
    && ['https:', 'http:'].includes(url.protocol)
    && !url.username
    && !url.password,
  );
}
