import { localizeAppMessage } from '../shared/i18n/appMessages';
import { t as translate } from "../shared/i18n";
import { useLocale } from "../renderer/i18n/language";
import { useRef, useState, type ReactNode } from 'react';
import { terminalWebLinks, type TerminalWebLink } from '../shared/terminalLinks';
import type { MobileTerminalHyperlink } from '../shared/remote';
import { Dialog } from './ui';

export function LinkedTerminalText({ text, onLocal, hyperlinks = [], onEmbedded }: { text: string; onLocal: () => void;
  hyperlinks?: MobileTerminalHyperlink[]; onEmbedded?: (link: MobileTerminalHyperlink) => void }): ReactNode {
  useLocale();
  const output: ReactNode[] = []; let offset = 0;
  const embedded = hyperlinks.filter(link => text.slice(link.start, link.end) === link.text);
  const links = [...embedded, ...terminalWebLinks(text).filter(link => !embedded.some(item => link.start < item.end && link.end > item.start))].sort((a, b) => a.start - b.start);
  for (const link of links) {
    output.push(text.slice(offset, link.start));
    output.push(embedded.includes(link) ? <button key={link.start} className="m-terminal-local-link" onClick={event => { event.currentTarget.focus(); onEmbedded?.(link); }}>{link.text}</button>
      : link.local ? <button key={link.start} className="m-terminal-local-link" onClick={onLocal}>{link.text}</button>
      : <a key={link.start} href={link.href} target="_blank" rel="noopener noreferrer">{link.text}</a>);
    offset = link.end;
  }
  output.push(text.slice(offset)); return output;
}

export function TerminalLinksDialog({ text, hyperlinks = [], selected, onClose, opener }: { text: string; hyperlinks?: MobileTerminalHyperlink[];
  selected?: MobileTerminalHyperlink; onClose: () => void; opener: () => HTMLElement | null }) {
  useLocale();
  // Freeze the list while reading it; terminal refreshes must not move the target of a tap.
  const links = useRef(selected ? [selected] : [...new Map([...hyperlinks, ...terminalWebLinks(text)].map(link => [link.href, link])).values()].slice(0, 100)).current;
  const [notice, setNotice] = useState(''); const [error, setError] = useState('');
  const copy = async (link: TerminalWebLink) => {
    setError(''); setNotice('');
    try { await navigator.clipboard.writeText(link.href); setNotice(translate("Link copied.")); }
    catch { setError(translate("Copying is not allowed. Hold down address and copy.")); }
  };
  return <Dialog title={translate("Links in the terminal")} onClose={onClose} restoreFocusTo={opener} className="m-terminal-links-dialog">
    {!links.length && <p>{translate("No web links in the terminal output yet.")}</p>}
    {links.map(link => <div className="m-terminal-link-item" key={link.href}>
      {link.text !== link.href && <p>{link.text}</p>}
      <p className="m-terminal-link-address">{link.href}</p>
      {link.local ? <p>{translate("This address belongs to the PC. For the tablet you need the shared project address, for example via Tailscale.")}</p>
        : <a className="m-button" href={link.href} target="_blank" rel="noopener noreferrer" aria-label={translate("Open: {{value1}}", { value1: link.href })}>{translate("Open [c3966666]")}</a>}
      <button aria-label={translate("Copy: {{value1}}", { value1: link.href })} onClick={() => void copy(link)}>{translate("Copy")}</button>
    </div>)}
    {notice && <p role="status">{localizeAppMessage(notice)}</p>}{error && <p role="alert">{localizeAppMessage(error)}</p>}
  </Dialog>;
}
