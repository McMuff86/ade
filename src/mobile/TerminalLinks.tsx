import { useRef, useState, type ReactNode } from 'react';
import { terminalWebLinks, type TerminalWebLink } from '../shared/terminalLinks';
import { Dialog } from './ui';

export function LinkedTerminalText({ text, onLocal }: { text: string; onLocal: () => void }): ReactNode {
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
  // Freeze the list while reading it; terminal refreshes must not move the target of a tap.
  const links = useRef([...new Map(terminalWebLinks(text).map(link => [link.href, link])).values()]).current;
  const [notice, setNotice] = useState(''); const [error, setError] = useState('');
  const copy = async (link: TerminalWebLink) => {
    setError(''); setNotice('');
    try { await navigator.clipboard.writeText(link.text); setNotice('Link kopiert.'); }
    catch { setError('Kopieren nicht erlaubt. Adresse gedrückt halten und kopieren.'); }
  };
  return <Dialog title="Links im Terminal" onClose={onClose} restoreFocusTo={opener} className="m-terminal-links-dialog">
    {!links.length && <p>Noch keine Weblinks in der Terminalausgabe.</p>}
    {links.map(link => <div className="m-terminal-link-item" key={link.href}>
      <p className="m-terminal-link-address">{link.text}</p>
      {link.local ? <p>Diese Adresse gehört zum PC. Für das Tablet brauchst du die freigegebene Projektadresse, zum Beispiel über Tailscale.</p>
        : <a className="m-button" href={link.href} target="_blank" rel="noopener noreferrer" aria-label={`Öffnen: ${link.text}`}>Öffnen</a>}
      <button aria-label={`Kopieren: ${link.text}`} onClick={() => void copy(link)}>Kopieren</button>
    </div>)}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
  </Dialog>;
}
