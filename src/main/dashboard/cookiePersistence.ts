/**
 * Session-cookie persistence for dashboard partitions (pure, Electron-free).
 *
 * Browsers restore session cookies across restarts ("continue where you left
 * off"); Electron drops them on quit, which logs users out of dashboards that
 * authenticate via expiry-less cookies (observed with the Hermes Control UI,
 * while OpenClaw's localStorage token survives). When a dashboard window
 * closes, ADE rewrites its session cookies with a bounded expiry so the next
 * launch is still signed in.
 */

/** Mirrors Electron's Cookie / CookiesSetDetails without importing electron. */
export interface StoredCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  session?: boolean;
  sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict';
}

export interface PersistedCookie {
  url: string;
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict';
  expirationDate: number;
}

export const SESSION_COOKIE_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * Convert one session cookie into its persistent equivalent, or null when the
 * cookie is already persistent or too malformed to rebuild. Host-only cookies
 * (domain without a leading dot) must be re-set via URL alone — passing
 * `domain` would widen them to subdomains.
 */
export function toPersistentCookie(
  cookie: StoredCookie,
  nowSeconds: number,
): PersistedCookie | null {
  if (cookie.session !== true) return null;
  const host = (cookie.domain ?? '').replace(/^\./, '');
  if (!host) return null;
  const domainCookie = cookie.domain?.startsWith('.') === true;
  return {
    url: `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path ?? '/'}`,
    name: cookie.name,
    value: cookie.value,
    ...(domainCookie ? { domain: cookie.domain } : {}),
    path: cookie.path ?? '/',
    secure: cookie.secure ?? false,
    httpOnly: cookie.httpOnly ?? false,
    sameSite: cookie.sameSite ?? 'unspecified',
    expirationDate: nowSeconds + SESSION_COOKIE_TTL_SECONDS,
  };
}
