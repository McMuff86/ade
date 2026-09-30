import type { IBufferCell, Terminal } from '@xterm/headless';
import { terminalWebLinks, type TerminalWebLink } from '../../shared/terminalLinks';
import { redactForWire } from '../errors';

/** OSC destinations were not visible text: reject, rather than repair, anything
 * redaction changes (also percent-encoded secrets/paths). Never return raw OSC. */
export function safeTerminalHyperlink(uri: string): TerminalWebLink | undefined {
  if (!uri || uri.length > 4096) return;
  let decoded = uri;
  for (let depth = 0; depth < 4; depth++) {
    if (redactForWire(decoded, 4096) !== decoded || /[\s\x00-\x1f\x7f-\x9f\\\u200b-\u200f\u202a-\u202e\u2066-\u2069]/.test(decoded)) return;
    let next: string;
    try { next = decodeURIComponent(decoded); } catch { return; }
    if (next === decoded) {
      const decodedLink = terminalWebLinks(decoded)[0];
      if (decodedLink?.start !== 0 || decodedLink.end !== decoded.length) return;
      const link = terminalWebLinks(uri)[0];
      return link?.start === 0 && link.end === uri.length ? link : undefined;
    }
    decoded = next;
  }
  // Excessively nested encoding is deliberately unsupported.
  return;
}

/** Pinned @xterm/headless 6.0.0 has no public cell hyperlink API. Keep the small
 * read-only adapter here, covered by real parser tests, and fail closed when its
 * shape changes. The parser's own cell IDs handle repaint, wrapping and erasure;
 * guessing labels from old OSC events would associate stale destinations. */
export function terminalHyperlinkReader(term: Terminal): (cell: IBufferCell) => TerminalWebLink | undefined {
  const service = (term as unknown as { _core?: { _oscLinkService?: { getLinkData?: (id: number) => { uri?: unknown } | undefined } } })._core?._oscLinkService;
  const cache = new Map<number, TerminalWebLink | undefined>();
  return cell => {
    if (cell.isInvisible() || typeof service?.getLinkData !== 'function') return;
    const id = (cell as unknown as { extended?: { urlId?: unknown } }).extended?.urlId;
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return;
    if (cache.has(id)) return cache.get(id);
    if (cache.size >= 1000) return;
    let link: TerminalWebLink | undefined;
    try {
      const uri = service.getLinkData(id)?.uri;
      link = typeof uri === 'string' ? safeTerminalHyperlink(uri) : undefined;
    } catch { /* Unsupported parser internals must only disable embedded links. */ }
    cache.set(id, link); return link;
  };
}
