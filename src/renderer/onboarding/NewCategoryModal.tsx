/**
 * New-category modal — name + optional profile photo. A category groups agents
 * around one thing you work on (a channel, a repo, a book).
 */

import { useState } from 'react';
import { Modal } from './Modal';
import { PhotoPicker } from './PhotoPicker';
import { useAppData } from '../stores/appdata';

interface NewCategoryModalProps {
  onClose: () => void;
  /** called with the created category id after a successful create. */
  onCreated?: (id: string) => void;
}

export function NewCategoryModal({ onClose, onCreated }: NewCategoryModalProps): React.ReactElement {
  const createCategory = useAppData((s) => s.createCategory);
  const [name, setName] = useState('');
  const [photo, setPhoto] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const canCreate = name.trim().length > 0 && !busy;

  const submit = async (): Promise<void> => {
    if (!canCreate) return;
    setBusy(true);
    try {
      const category = await createCategory({ name: name.trim(), photo });
      onCreated?.(category.id);
      onClose();
    } catch (err) {
      console.error('[ade] create category failed:', err);
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New category"
      subtitle="A category groups agents around one thing you work on — a channel, a repo, a book."
      onClose={onClose}
    >
      <div className="field">
        <label htmlFor="cat-name">NAME</label>
        <input
          id="cat-name"
          type="text"
          value={name}
          autoComplete="off"
          placeholder="e.g. Podcast"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
        />
      </div>

      <div className="field">
        <label>PROFILE PHOTO</label>
        <PhotoPicker value={photo} onChange={setPhoto} shape="square" name={name} />
      </div>

      <div className="modal-actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn primary" onClick={() => void submit()} disabled={!canCreate}>
          {busy ? 'Creating…' : 'Create category'}
        </button>
      </div>
    </Modal>
  );
}
