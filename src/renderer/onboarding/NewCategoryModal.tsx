import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
import { NavigationGroupField } from './NavigationGroupField';
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
  useLocale();
  const createCategory = useAppData((s) => s.createCategory);
  const [name, setName] = useState('');
  const [group, setGroup] = useState('');
  const [photo, setPhoto] = useState<string | undefined>(undefined);
  const [repoPath, setRepoPath] = useState<string | undefined>(undefined);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canCreate = name.trim().length > 0 && !busy;

  const pickRepo = async (): Promise<void> => {
    setRepoError(null);
    try {
      const result = await window.ade.invoke('dialog:pickFolder');
      if (!result.path) return; // cancelled
      if (!result.isRepo) {
        setRepoError('That folder is not a git repository.');
        return;
      }
      setRepoPath(result.path);
    } catch (err) {
      console.error('[ade] pick repo failed:', err);
      setRepoError('Could not open the folder picker.');
    }
  };

  const submit = async (): Promise<void> => {
    if (!canCreate) return;
    setBusy(true);
    try {
      const category = await createCategory({ name: name.trim(), photo, repoPath, navigationGroup: group.trim() || undefined });
      onCreated?.(category.id);
      onClose();
    } catch (err) {
      console.error('[ade] create category failed:', err);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={translate("New category")}
      subtitle={translate("A category groups agents around something you work on: a channel, repository or book.")}
      onClose={onClose}
    >
      <div className="field">
        <label htmlFor="cat-name">{translate("Name")}</label>
        <input
          id="cat-name"
          type="text"
          value={name}
          autoComplete="off"
          placeholder={translate("e.g. Podcast")}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
        />
      </div>

      <div className="field">
        <label>{translate("Profile photo")}</label>
        <PhotoPicker value={photo} onChange={setPhoto} shape="square" name={name} />
      </div>

      <div className="field">
        <label>{translate("LINK A GIT REPOSITORY (OPTIONAL)")}</label>
        <div className="repo-picker">
          <button type="button" className="btn" onClick={() => void pickRepo()} disabled={busy}>
            {repoPath ? translate("Change folder") : translate("Choose folder")}
          </button>
          {repoPath ? (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setRepoPath(undefined);
                setRepoError(null);
              }}
              disabled={busy}
            >
              {translate("Remove [52656d6f]")}</button>
          ) : null}
          <span className="repo-path" title={repoPath ?? ''}>
            {repoPath ?? 'No repository — agents get a plain workspace folder.'}
          </span>
        </div>
        {repoError ? <div className="repo-error">{repoError}</div> : null}
        {repoPath ? (
          <div className="repo-hint">{translate("Each agent gets its own worktree + branch under this repo.")}</div>
        ) : null}
      </div>

      <NavigationGroupField value={group} onChange={setGroup} disabled={busy} />
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onClose}>
          {translate("Cancel [43616e63]")}</button>
        <button type="button" className="btn primary" onClick={() => void submit()} disabled={!canCreate}>
          {busy ? translate("Creating…") : translate("Create category")}
        </button>
      </div>
    </Modal>
  );
}
