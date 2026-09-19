import { localizeAppMessage } from '../shared/i18n/appMessages';
import { t as translate } from "../shared/i18n";
import { useLocale } from "../renderer/i18n/language";
import { useRef, useState, type ReactNode } from 'react';
import { terminalWebLinks, type TerminalWebLink } from '../shared/terminalLinks';
import { Dialog } from './ui';

export function LinkedTerminalText({ text, onLocal }: { text: string; onLocal: () => void }): ReactNode {
  useLocale();
  const output: ReactNode[] = []; let offset = 0;
  for (const link of terminalWebLinks(text)) {
    output.push(text.slice(offset, link.start));
    output.push(link.local ? <button key={link.start} className="m-terminal-local-link" onClick={onLocal}>{link.text}</button>
      : <a key={link.start} href={link.href} target="_blank" rel="noopener noreferrer">{link.text}</a>);
    offset = link.end;
  }
  output.push(text.slice(offset)); return output;
}

export function TerminalLinksDialog({ text, onClose, opener }: { text: string; onClose: () => void; opener: () => HTMLElement | null }) {
  useLocale();
  // Freeze the list while reading it; terminal refreshes must not move the target of a tap.
  const links = useRef([...new Map(terminalWebLinks(text).map(link => [link.href, link])).values()]).current;
  const [notice, setNotice] = useState(''); const [error, setError] = useState('');
  const copy = async (link: TerminalWebLink) => {
    setError(''); setNotice('');
    try { await navigator.clipboard.writeText(link.text); setNotice(translate("Link copied.")); }
    catch { setError(translate("Copying is not allowed. Hold down address and copy.")); }
  };
  return <Dialog title={translate("Links in the terminal")} onClose={onClose} restoreFocusTo={opener} className="m-terminal-links-dialog">
    {!links.length && <p>{translate("No web links in the terminal output yet.")}</p>}
    {links.map(link => <div className="m-terminal-link-item" key={link.href}>
      <p className="m-terminal-link-address">{link.text}</p>
      {link.local ? <p>{translate("This address belongs to the PC. For the tablet you need the shared project address, for example via Tailscale.")}</p>
        : <a className="m-button" href={link.href} target="_blank" rel="noopener noreferrer" aria-label={translate("Open: {{value1}}", { value1: link.text })}>{translate("Open [c3966666]")}</a>}
      <button aria-label={translate("Copy: {{value1}}", { value1: link.text })} onClick={() => void copy(link)}>{translate("Copy")}</button>
    </div>)}
    {notice && <p role="status">{localizeAppMessage(notice)}</p>}{error && <p role="alert">{localizeAppMessage(error)}</p>}
  </Dialog>;
}
