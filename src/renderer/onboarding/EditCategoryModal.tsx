/**
 * Existing-category settings: display name and profile photo. Structure
 * (agents, repository default, kind) is managed elsewhere and stays put.
 */

import { useState } from 'react';
import type { Category } from '../../shared/types';
import { useAppData } from '../stores/appdata';
import { Modal } from './Modal';
import { PhotoPicker } from './PhotoPicker';

interface EditCategoryModalProps {
  category: Category;
  onClose: () => void;
}

export function EditCategoryModal({ category, onClose }: EditCategoryModalProps): React.ReactElement {
  const updateCategory = useAppData((s) => s.updateCategory);
  const [name, setName] = useState(category.name);
  const [photo, setPhoto] = useState<string | undefined>(category.photo);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const canSave = name.trim().length > 0 && !busy;

  const submit = async (): Promise<void> => {
    if (!canSave) return;
    setBusy(true);
    setSaveError(null);
    try {
      await updateCategory({
        id: category.id,
        name: name.trim(),
        photo: photo ?? null,
      });
      onClose();
    } catch (err) {
      console.error('[ade] update category failed:', err);
      setSaveError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <Modal title="Category settings" subtitle="Rename the category or change its photo." onClose={onClose}>
      <div className="field">
        <label>PROFILE PHOTO</label>
        <PhotoPicker value={photo} onChange={setPhoto} shape="square" name={name} />
      </div>

      <div className="field">
        <label htmlFor="edit-category-name">NAME</label>
        <input
          id="edit-category-name"
          type="text"
          value={name}
          maxLength={200}
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
        />
      </div>

      {saveError ? <div className="modal-error" role="alert">{saveError}</div> : null}

      <div className="modal-actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={() => void submit()}
          disabled={!canSave}
        >
          {busy ? 'Saving...' : 'Save'}
        </button>
      </div>
    </Modal>
  );
}
