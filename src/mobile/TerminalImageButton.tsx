import { localizeAppMessage } from '../shared/i18n/appMessages';
import { t as translate } from "../shared/i18n";
import { useLocale } from "../renderer/i18n/language";
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { MobileDictationTarget, MobileTerminalImage } from '../shared/remote';
import type { TerminalPromptCapability } from '../shared/terminalPrompt';
import { terminalPngDimensions, TERMINAL_IMAGE_MAX_BYTES, TERMINAL_IMAGE_MAX_PIXELS } from '../shared/terminalImages';
import type { MobileHost } from './useMobileHost';
import type { PromptSender } from './PromptDialog';
import { Dialog } from './ui';
import { MobileClientError } from './client';
import { NoteImagePicker } from './NoteImagePicker';

async function prepareImage(file: Blob): Promise<Blob> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || !file.size || file.size > TERMINAL_IMAGE_MAX_BYTES) throw new Error(translate("Select a PNG, JPEG or WebP image up to 8 MiB."));
  const bitmap = await createImageBitmap(file);
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width > 16384 || bitmap.height > 16384 || bitmap.width * bitmap.height > TERMINAL_IMAGE_MAX_PIXELS) throw new Error(translate("The image is too large. Select at most 24 megapixels."));
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d'); if (!context) throw new Error(translate("Image preview is not available in this browser."));
    context.drawImage(bitmap, 0, 0);
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error(translate("The picture could not be prepared."))), 'image/png'));
    terminalPngDimensions(new Uint8Array(await png.arrayBuffer())); return png;
  } finally { bitmap.close(); }
}

export function TerminalImageButton({ host, target, capability, enabled, send, eventRoot }: {
  host: MobileHost; target: MobileDictationTarget; capability?: TerminalPromptCapability; enabled: boolean;
  send: PromptSender; eventRoot: RefObject<HTMLElement | null>;
}) {
  useLocale();
  const button = useRef<HTMLButtonElement>(null); const picker = useRef<HTMLInputElement>(null);
  const message = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false); const [png, setPng] = useState<Blob>(); const [preview, setPreview] = useState('');
  const [text, setText] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [phase, setPhase] = useState<'idle' | 'preparing' | 'uploading' | 'sending'>('idle');
  const [uncertain, setUncertain] = useState(false); const [notesOpen, setNotesOpen] = useState(false);
  const upload = useRef<{ key: string; image?: MobileTerminalImage } | undefined>(undefined);
  const version = useRef(0); const live = useRef(true); const locked = useRef(false);
  const bound = useRef(target).current;
  const allowed = enabled && capability?.available === true;
  const allowedRef = useRef(allowed); allowedRef.current = allowed;
  useEffect(() => { live.current = true; return () => { live.current = false; version.current++; }; }, []);
  useEffect(() => { if (!png) { setPreview(''); return; } const url = URL.createObjectURL(png); setPreview(url); return () => URL.revokeObjectURL(url); }, [png]);
  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const revealMessage = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (document.activeElement === message.current) message.current?.scrollIntoView({ block: 'nearest' });
      });
    };
    window.visualViewport?.addEventListener('resize', revealMessage);
    window.visualViewport?.addEventListener('scroll', revealMessage);
    return () => {
      cancelAnimationFrame(frame);
      window.visualViewport?.removeEventListener('resize', revealMessage);
      window.visualViewport?.removeEventListener('scroll', revealMessage);
    };
  }, [open]);
  const select = async (file: Blob) => {
    if (locked.current) return;
    const own = ++version.current; setOpen(true); setPhase('preparing'); setError(''); setNotice(''); setPng(undefined); upload.current = undefined;
    try { const result = await prepareImage(file); if (live.current && own === version.current) { setPng(result); upload.current = { key: crypto.randomUUID() }; } }
    catch (reason) { if (live.current && own === version.current) setError(reason instanceof Error ? reason.message : translate("Could not read the image.")); }
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
      setError(translate("No image in the clipboard. Open screenshot via \"Select image\"."));
    } catch { setError(translate("Image insertion is not allowed here. Open screenshot via \"Select image\".")); }
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
      if (!allowedRef.current) throw new Error(translate("Entry has been taken over or connection lost. Image remains for checking."));
      setPhase('sending'); dispatched = true;
      await send(text.trim() || translate("Please take a look at this screenshot."), 'submit', crypto.randomUUID(), [prepared.image.id]);
      if (live.current) { setNotice(translate("Passed image and message.")); setPng(undefined); setText(''); upload.current = undefined; }
    } catch (reason) {
      if (live.current) {
        if (dispatched) setUncertain(true);
        // A definitive upload rejection has no replayable success. A lost
        // response keeps its original key so retry cannot duplicate the file.
        else if (reason instanceof MobileClientError && [400, 403, 404, 422].includes(reason.status)) upload.current = { key: crypto.randomUUID() };
        setError(dispatched ? translate("Delivery has not been confirmed. Check the terminal; the image and message will not be sent again automatically.")
          : reason instanceof Error ? reason.message : translate("Image transfer failed. Try again."));
      }
    } finally { locked.current = false; if (live.current) setPhase('idle'); }
  };
  return <>
    <button ref={button} className="voice-icon-button" aria-label={translate("Add image")} disabled={!allowed}
      title={!capability?.available ? capability?.reason ?? translate("Checking image handoff.") : !enabled ? translate("Take control of terminal input first.") : translate("Add screenshot or image")}
      onClick={event => { event.currentTarget.focus(); setOpen(true); }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8" cy="8" r="1.5" /><path d="m3 17 5-5 4 4 4-6 5 7" /></svg>
    </button>
    {open && <Dialog title={translate("Image and message")} className="m-terminal-image-dialog" restoreFocusTo={() => button.current}
      onClose={() => { if (!locked.current) { version.current++; setPhase('idle'); setOpen(false); } }}>
      <p>{translate("Select a screenshot from gallery or files, or a photo or sheet from your notes. The image goes to this session with your message.")}</p>
      <input ref={picker} type="file" accept="image/png,image/jpeg,image/webp" aria-label={translate("Select the screenshot")} disabled={phase !== 'idle' || uncertain}
        onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void select(file); }} />
      <div className="m-terminal-image-actions"><button disabled={phase !== 'idle' || uncertain} onClick={() => picker.current?.click()}>{translate("Select the image")}</button>
        <button disabled={phase !== 'idle' || uncertain} onClick={() => void clipboard()}>{translate("Insert picture")}</button>
        <button disabled={phase !== 'idle' || uncertain} aria-expanded={notesOpen} onClick={() => setNotesOpen(value => !value)}>{translate("From the notes")}</button></div>
      {notesOpen && <NoteImagePicker scope={`mobile:${host.deviceId}`} disabled={phase !== 'idle' || uncertain} onPick={(blob) => { setNotesOpen(false); void select(blob); }} onClose={() => setNotesOpen(false)} />}
      {preview && <figure><img src={preview} alt={translate("Preview of the selected screenshot")} /><figcaption>{translate("Screenshot ·")}{" "}{Math.ceil((png?.size ?? 0) / 1024)}{" "}{translate("KiB")}</figcaption></figure>}
      {!png && phase === 'idle' && !notice && <p>{translate("No picture selected yet.")}</p>}
      <label>{translate("Image message")}<textarea ref={message} aria-label={translate("Image message")} value={text} maxLength={12000} disabled={phase !== 'idle' || uncertain} onChange={event => setText(event.target.value)} placeholder={translate("What should I check or change on the screenshot?")} /></label>
      {phase !== 'idle' && <p role="status">{phase === 'preparing' ? translate("The picture is being prepared…") : phase === 'uploading' ? translate("Uploading image to the PC…") : translate("Sending image and message…")}</p>}
      {error && <p role="alert">{localizeAppMessage(error)}</p>}{notice && <p role="status">{localizeAppMessage(notice)}</p>}
      {!allowed && <p role="status">{translate("Connection or input ownership is missing. Draft remains intact.")}</p>}
      <button className="m-primary" disabled={!allowed || !png || phase !== 'idle' || uncertain} onClick={() => void deliver()}>{translate("Send picture and message")}</button>
      {uncertain && <><button onClick={() => { setOpen(false); }}>{translate("Check terminal")}</button>
        <button onClick={() => { setUncertain(false); setPng(undefined); setText(''); setError(''); upload.current = undefined; }}>{translate("Checked – start a new draft")}</button></>}
    </Dialog>}
  </>;
}
