export interface TerminalWebLink { text: string; href: string; start: number; end: number; local: boolean }

/** Only visible HTTP(S) text is linkified. OSC targets and redacted fragments
 * must never acquire a second, invisible destination. */
export function terminalWebLinks(text: string): TerminalWebLink[] {
  const links: TerminalWebLink[] = [];
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`\x00-\x1f\x7f]+/gi)) {
    let value = match[0].replace(/[.,;:!?]+$/, '');
    while (value.endsWith(')') && (value.match(/\)/g)?.length ?? 0) > (value.match(/\(/g)?.length ?? 0)) value = value.slice(0, -1);
    if (value.endsWith(']') && !value.includes('://[')) value = value.slice(0, -1);
    if (value.length > 4096 || /\[(?!::1\])|\[redacted|[\\\u200b-\u200f\u202a-\u202e\u2066-\u2069]/i.test(value)) continue;
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) continue;
      const host = url.hostname.toLowerCase().replace(/\.$/, '');
      links.push({ text: value, href: url.href, start: match.index, end: match.index + value.length,
        local: host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || host === '[::]' || host === '0.0.0.0' || /^127\./.test(host) });
    } catch { /* Invalid or redacted URL remains plain text. */ }
    if (links.length >= 100) break;
  }
  return links;
}

/** The rendered row can end halfway through a URL. Use its full visible
 * transcript counterpart, or refuse an ambiguous prefix; never open a truncation. */
export function completeTerminalLink(part: TerminalWebLink, transcript: string): TerminalWebLink | undefined {
  const links = terminalWebLinks(transcript);
  const exact = links.find(link => link.text === part.text); if (exact) return exact;
  const matches = [...new Map(links.filter(link => link.text.startsWith(part.text)).map(link => [link.href, link])).values()];
  return matches.length === 1 ? matches[0] : undefined;
}
