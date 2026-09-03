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

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * True when the cookie would be sent to the dashboard origin: host-only
 * cookies must match the host exactly, domain cookies (leading dot) the host
 * or one of its subdomains, and Secure cookies need an https (or loopback)
 * origin. Persistence is granted to these cookies only — a login redirect
 * through a foreign identity provider must not earn that origin 30 days of
 * storage inside an ADE partition.
 */
export function cookieBelongsToOrigin(cookie: StoredCookie, origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  const domain = (cookie.domain ?? '').toLowerCase();
  if (!host || !domain) return false;
  if (cookie.secure && url.protocol !== 'https:' && !LOCAL_HOSTS.has(host)) return false;
  if (domain.startsWith('.')) {
    const bare = domain.slice(1);
    return host === bare || host.endsWith(`.${bare}`);
  }
  return host === domain;
}

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
