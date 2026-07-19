const PROVIDER_REPOSITORY = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

/** Parse one credential-free GitHub owner/repository identity from a remote URL. */
export function parseGithubRepository(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim();
  let path = '';
  if (/^git@github\.com:/i.test(trimmed)) {
    path = trimmed.replace(/^git@github\.com:/i, '');
  } else {
    try {
      const url = new URL(trimmed);
      if (!['https:', 'ssh:'].includes(url.protocol)
          || url.hostname.toLowerCase() !== 'github.com') return null;
      path = url.pathname.replace(/^\/+/, '');
    } catch {
      return null;
    }
  }
  const repository = path.replace(/\.git$/i, '').replace(/\/+$/, '');
  return PROVIDER_REPOSITORY.test(repository) ? repository : null;
}

/** Host-qualified value prevents ambient GH_HOST from redirecting a provider read. */
export function githubRepository(providerRepository: string): string {
  if (!PROVIDER_REPOSITORY.test(providerRepository)) {
    throw new Error('ade: invalid GitHub repository identity');
  }
  return `github.com/${providerRepository}`;
}

/** Extract the first bounded, credential-free github.com Pull Request URL. */
export function firstSafeGithubPullUrl(value: string): string | null {
  const match = value.match(/https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+/i);
  if (!match) return null;
  try {
    const url = new URL(match[0]);
    return url.hostname.toLowerCase() === 'github.com' && !url.username && !url.password
      ? url.toString().replace(/\/$/, '')
      : null;
  } catch {
    return null;
  }
}

/** Revalidate a PR URL against the provider identity and, optionally, number. */
export function safeGithubPullRequestUrl(
  value: string,
  repository: string,
  expectedNumber?: number,
): string | null {
  if (!PROVIDER_REPOSITORY.test(repository)) return null;
  const safe = firstSafeGithubPullUrl(value);
  if (!safe) return null;
  try {
    const url = new URL(safe);
    const segments = url.pathname.split('/').filter(Boolean);
    const number = Number.parseInt(segments[3] ?? '', 10);
    return segments.length === 4
      && `${segments[0]}/${segments[1]}`.toLowerCase() === repository.toLowerCase()
      && segments[2] === 'pull'
      && Number.isInteger(number)
      && number > 0
      && (expectedNumber === undefined || number === expectedNumber)
      ? safe
      : null;
  } catch {
    return null;
  }
}
