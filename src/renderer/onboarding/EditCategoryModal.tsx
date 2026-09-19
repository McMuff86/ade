import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
import { NavigationGroupField } from './NavigationGroupField';
/**
 * Existing-category settings: display name and profile photo. Structure
 * (agents, repository default, kind) is managed elsewhere and stays put.
 */

import { useState } from 'react';
import type { Category } from '../../shared/types';
import { useAppData } from '../stores/appdata';
import { DeleteAction } from './DeleteAction';
import { Modal } from './Modal';
import { PhotoPicker } from './PhotoPicker';

interface EditCategoryModalProps {
  category: Category;
  onClose: () => void;
}

export function EditCategoryModal({ category, onClose }: EditCategoryModalProps): React.ReactElement {
  useLocale();
  const updateCategory = useAppData((s) => s.updateCategory);
  const deleteCategory = useAppData((s) => s.deleteCategory);
  const [name, setName] = useState(category.name);
  const [group, setGroup] = useState(category.navigationGroup ?? '');
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
        navigationGroup: group.trim() || null,
      });
      onClose();
    } catch (err) {
      console.error('[ade] update category failed:', err);
      setSaveError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <Modal title={translate("Category settings")} subtitle={translate("Rename the category or change its photo.")} onClose={onClose}
      fallbackFocus={() => document.querySelector<HTMLElement>(`[data-category-settings="${CSS.escape(category.id)}"]`)
        ?? document.querySelector<HTMLElement>('.rail-search input')}>
      <div className="field">
        <label>{translate("Profile photo")}</label>
        <PhotoPicker value={photo} onChange={setPhoto} shape="square" name={name} />
      </div>

      <div className="field">
        <label htmlFor="edit-category-name">{translate("Name")}</label>
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

      <NavigationGroupField value={group} onChange={setGroup} disabled={busy} />
      <div className="modal-actions">
        <DeleteAction
          label={translate("Delete category")}
          consequence={category.agents.length > 0
            ? translate("Also delete {{value1}} {{value2}} ", { value1: category.agents.length, value2: category.agents.length === 1 ? translate("Agent") : translate("Agents") })
              + translate("in this category and ends their terminals. Workspaces, memory and photos ")
              + translate("remain on disk.")
            : translate("Removes the empty category from ADE.")}
          busy={busy}
          onDelete={async () => {
            await deleteCategory(category.id);
            onClose();
          }}
        />
        <button type="button" className="btn" onClick={onClose}>
          {translate("Cancel [43616e63]")}</button>
        <button
          type="button"
          className="btn primary"
          onClick={() => void submit()}
          disabled={!canSave}
        >
          {busy ? translate("Saving...") : translate("Save")}
        </button>
      </div>
    </Modal>
  );
}
