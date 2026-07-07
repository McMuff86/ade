/**
 * Profile-photo picker: file input (png/jpg/webp) → photo:import → stores the
 * returned filename. Preview renders through ade-photo:// so alpha is honoured
 * exactly as it will appear in the rail. Falls back to an initials avatar.
 */

import { useRef, useState } from 'react';
import { Avatar } from '../rail/Avatar';

const ACCEPT = 'image/png,image/jpeg,image/webp';
const MAX_BYTES = 10 * 1024 * 1024;

/** ArrayBuffer → base64 without blowing the call stack on large files. */
function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

interface PhotoPickerProps {
  /** current stored filename (undefined = none chosen). */
  value?: string;
  onChange: (file: string | undefined) => void;
  /** preview shape + fallback avatar shape. */
  shape: 'round' | 'square';
  /** name used for the initials fallback preview. */
  name: string;
}

export function PhotoPicker({
  value,
  onChange,
  shape,
  name,
}: PhotoPickerProps): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = (): void => inputRef.current?.click();

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    setError(null);

    if (file.size > MAX_BYTES) {
      setError('Image is larger than 10 MB.');
      return;
    }
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const result = await window.ade.invoke('photo:import', {
        bytesBase64: toBase64(buf),
        mime: file.type || 'image/png',
      });
      onChange(result.file);
    } catch (err) {
      console.error('[ade] photo import failed:', err);
      setError('Could not import that image.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="photo-picker">
      <Avatar name={name || '?'} photo={value} shape={shape} size={52} />
      <div className="photo-picker-actions">
        <button type="button" className="btn" onClick={pick} disabled={busy}>
          {busy ? 'Importing…' : value ? 'Change photo' : 'Upload photo'}
        </button>
        {value ? (
          <button type="button" className="btn" onClick={() => onChange(undefined)} disabled={busy}>
            Remove
          </button>
        ) : null}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          onChange={onFile}
          style={{ display: 'none' }}
          aria-hidden="true"
          tabIndex={-1}
        />
      </div>
      {error ? <div className="photo-picker-error">{error}</div> : null}
    </div>
  );
}
