import { useEffect, useRef, useState, type RefObject } from 'react';
import type { MobileDictationTarget, MobileTerminalImage } from '../shared/remote';
import type { TerminalPromptCapability } from '../shared/terminalPrompt';
import { terminalPngDimensions, TERMINAL_IMAGE_MAX_BYTES, TERMINAL_IMAGE_MAX_PIXELS } from '../shared/terminalImages';
import type { MobileHost } from './useMobileHost';
import type { PromptSender } from './PromptDialog';
import { Dialog } from './ui';
import { MobileClientError } from './client';

async function prepareImage(file: Blob): Promise<Blob> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || !file.size || file.size > TERMINAL_IMAGE_MAX_BYTES) throw new Error('Ein PNG-, JPEG- oder WebP-Bild bis 8 MiB auswählen.');
  const bitmap = await createImageBitmap(file);
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width > 16384 || bitmap.height > 16384 || bitmap.width * bitmap.height > TERMINAL_IMAGE_MAX_PIXELS) throw new Error('Das Bild ist zu gross. Höchstens 24 Megapixel auswählen.');
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d'); if (!context) throw new Error('Bildvorschau ist in diesem Browser nicht verfügbar.');
    context.drawImage(bitmap, 0, 0);
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Bild konnte nicht vorbereitet werden.')), 'image/png'));
    terminalPngDimensions(new Uint8Array(await png.arrayBuffer())); return png;
  } finally { bitmap.close(); }
}

export function TerminalImageButton({ host, target, capability, enabled, send, eventRoot }: {
  host: MobileHost; target: MobileDictationTarget; capability?: TerminalPromptCapability; enabled: boolean;
  send: PromptSender; eventRoot: RefObject<HTMLElement | null>;
}) {
  const button = useRef<HTMLButtonElement>(null); const picker = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false); const [png, setPng] = useState<Blob>(); const [preview, setPreview] = useState('');
  const [text, setText] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [phase, setPhase] = useState<'idle' | 'preparing' | 'uploading' | 'sending'>('idle');
  const [uncertain, setUncertain] = useState(false);
  const upload = useRef<{ key: string; image?: MobileTerminalImage } | undefined>(undefined);
  const version = useRef(0); const live = useRef(true); const locked = useRef(false);
  const bound = useRef(target).current;
  const allowed = enabled && capability?.available === true;
  const allowedRef = useRef(allowed); allowedRef.current = allowed;
  useEffect(() => { live.current = true; return () => { live.current = false; version.current++; }; }, []);
  useEffect(() => { if (!png) { setPreview(''); return; } const url = URL.createObjectURL(png); setPreview(url); return () => URL.revokeObjectURL(url); }, [png]);
  const select = async (file: Blob) => {
    if (locked.current) return;
    const own = ++version.current; setOpen(true); setPhase('preparing'); setError(''); setNotice(''); setPng(undefined); upload.current = undefined;
    try { const result = await prepareImage(file); if (live.current && own === version.current) { setPng(result); upload.current = { key: crypto.randomUUID() }; } }
    catch (reason) { if (live.current && own === version.current) setError(reason instanceof Error ? reason.message : 'Bild konnte nicht gelesen werden.'); }
    finally { if (live.current && own === version.current) setPhase('idle'); }
  };
  const selectRef = useRef(select); selectRef.current = select;
  useEffect(() => {
    const root = eventRoot.current; if (!root) return;
    const paste = (event: ClipboardEvent) => {
      const file = [...(event.clipboardData?.files ?? [])].find(item => item.type.startsWith('image/'));
      if (!file || !allowedRef.current) return;
      event.preventDefault(); event.stopPropagation(); void selectRef.current(file);
    };
    root.addEventListener('paste', paste, true); return () => root.removeEventListener('paste', paste, true);
  }, [eventRoot]);
  const clipboard = async () => {
    setError('');
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) { const type = item.types.find(value => ['image/png', 'image/jpeg', 'image/webp'].includes(value)); if (type) { await select(await item.getType(type)); return; } }
      setError('Kein Bild in der Zwischenablage. Screenshot über „Bild auswählen“ öffnen.');
    } catch { setError('Bildeinfügen ist hier nicht erlaubt. Screenshot über „Bild auswählen“ öffnen.'); }
  };
  const deliver = async () => {
    if (locked.current || !allowedRef.current || !png || !upload.current || uncertain) return;
    locked.current = true; setPhase('uploading'); setError(''); setNotice('');
    let dispatched = false;
    try {
      const prepared = upload.current;
      if (!prepared.image) {
        const bytes = new Uint8Array(await png.arrayBuffer()); let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 16384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
        prepared.image = await host.request<MobileTerminalImage>('/api/v1/terminal/images', 'POST', { ...bound, pngBase64: btoa(binary) }, prepared.key);
      }
      if (!live.current) return;
      if (!allowedRef.current) throw new Error('Eingabe wurde übernommen oder Verbindung verloren. Bild bleibt zur Prüfung erhalten.');
      setPhase('sending'); dispatched = true;
      await send(text.trim() || 'Bitte sieh dir diesen Screenshot an.', 'submit', crypto.randomUUID(), [prepared.image.id]);
      if (live.current) { setNotice('Bild und Nachricht übergeben.'); setPng(undefined); setText(''); upload.current = undefined; }
    } catch (reason) {
      if (live.current) {
        if (dispatched) setUncertain(true);
        // A definitive upload rejection has no replayable success. A lost
        // response keeps its original key so retry cannot duplicate the file.
        else if (reason instanceof MobileClientError && [400, 403, 404, 422].includes(reason.status)) upload.current = { key: crypto.randomUUID() };
        setError(dispatched ? 'Übergabe nicht bestätigt. Bitte im Terminal prüfen; Bild und Nachricht werden nicht automatisch erneut gesendet.'
          : reason instanceof Error ? reason.message : 'Bildübertragung fehlgeschlagen. Erneut versuchen.');
      }
    } finally { locked.current = false; if (live.current) setPhase('idle'); }
  };
  return <>
    <button ref={button} className="voice-icon-button" aria-label="Bild hinzufügen" disabled={!allowed}
      title={!capability?.available ? capability?.reason ?? 'Bildübergabe wird geprüft.' : !enabled ? 'Zuerst die Terminal-Eingabe übernehmen.' : 'Screenshot oder Bild hinzufügen'}
      onClick={event => { event.currentTarget.focus(); setOpen(true); }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8" cy="8" r="1.5" /><path d="m3 17 5-5 4 4 4-6 5 7" /></svg>
    </button>
    {open && <Dialog title="Bild und Nachricht" className="m-terminal-image-dialog" restoreFocusTo={() => button.current}
      onClose={() => { if (!locked.current) { version.current++; setPhase('idle'); setOpen(false); } }}>
      <p>Screenshot aus Galerie oder Dateien auswählen. Das Bild wird mit deiner Nachricht an diese Codex-Sitzung übergeben.</p>
      <input ref={picker} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Screenshot auswählen" disabled={phase !== 'idle' || uncertain}
        onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void select(file); }} />
      <div className="m-terminal-image-actions"><button disabled={phase !== 'idle' || uncertain} onClick={() => picker.current?.click()}>Bild auswählen</button>
        <button disabled={phase !== 'idle' || uncertain} onClick={() => void clipboard()}>Bild einfügen</button></div>
      {preview && <figure><img src={preview} alt="Vorschau des ausgewählten Screenshots" /><figcaption>Screenshot · {Math.ceil((png?.size ?? 0) / 1024)} KiB</figcaption></figure>}
      {!png && phase === 'idle' && !notice && <p>Noch kein Bild ausgewählt.</p>}
      <label>Nachricht zum Bild<textarea aria-label="Nachricht zum Bild" value={text} maxLength={12000} disabled={phase !== 'idle' || uncertain} onChange={event => setText(event.target.value)} placeholder="Was soll ich auf dem Screenshot prüfen oder ändern?" /></label>
      {phase !== 'idle' && <p role="status">{phase === 'preparing' ? 'Bild wird vorbereitet…' : phase === 'uploading' ? 'Bild wird zum PC übertragen…' : 'Bild und Nachricht werden übergeben…'}</p>}
      {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
      {!allowed && <p role="status">Verbindung oder Eingabebesitz fehlt. Entwurf bleibt erhalten.</p>}
      <button className="m-primary" disabled={!allowed || !png || phase !== 'idle' || uncertain} onClick={() => void deliver()}>Bild und Nachricht senden</button>
      {uncertain && <><button onClick={() => { setOpen(false); }}>Im Terminal prüfen</button>
        <button onClick={() => { setUncertain(false); setPng(undefined); setText(''); setError(''); upload.current = undefined; }}>Geprüft – neuen Entwurf beginnen</button></>}
    </Dialog>}
  </>;
}
