import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
import { useState, type JSX } from 'react';
import { Modal } from '../onboarding/Modal';
import { useAppData } from '../stores/appdata';
import { RepositorySyncPanel } from './RepositorySyncPanel';
import { useMode } from '../stores/mode';
import { useSelection } from '../stores/selection';

export function RepositorySyncModal({ repositoryId, onClose }: { repositoryId?: string; onClose: () => void }): JSX.Element {
  useLocale();
  const repositories = useAppData((state) => state.repositories);
  const [selected, setSelected] = useState(repositoryId ?? repositories[0]?.id ?? '');
  return <Modal title={translate("Synchronize the repository")} onClose={onClose} className="repo-sync-modal"
    fallbackFocus={() => Array.from(document.querySelectorAll<HTMLElement>('[data-open-git-sync]'))
      .find((node) => node.getClientRects().length > 0) ?? document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')}>
    <label className="repo-sync-source">{translate("Repository")}<select aria-label={translate("Repository for Git sync")} value={selected} onChange={(event) => setSelected(event.target.value)}>
        {repositories.map((repository) => <option key={repository.id} value={repository.id}>{repository.name}</option>)}
      </select>
    </label>
    {selected ? <RepositorySyncPanel key={selected} repositoryId={selected} onOpenWorkspace={(id) => { onClose(); useSelection.getState().setProjectWorkspace(id); useMode.getState().setMode('projects'); }} /> : <p>{translate("First, import a repository.")}</p>}
    <button type="button" className="btn" onClick={onClose}>{translate("Close")}</button>
  </Modal>;
}
