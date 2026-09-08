import { useState, type JSX } from 'react';
import { Modal } from '../onboarding/Modal';
import { useAppData } from '../stores/appdata';
import { RepositorySyncPanel } from './RepositorySyncPanel';

export function RepositorySyncModal({ repositoryId, onClose }: { repositoryId?: string; onClose: () => void }): JSX.Element {
  const repositories = useAppData((state) => state.repositories);
  const [selected, setSelected] = useState(repositoryId ?? repositories[0]?.id ?? '');
  return <Modal title="Repository synchronisieren" onClose={onClose} className="repo-sync-modal"
    fallbackFocus={() => Array.from(document.querySelectorAll<HTMLElement>('[data-open-git-sync]'))
      .find((node) => node.getClientRects().length > 0) ?? document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')}>
    <label className="repo-sync-source">Repository
      <select aria-label="Repository für Git-Abgleich" value={selected} onChange={(event) => setSelected(event.target.value)}>
        {repositories.map((repository) => <option key={repository.id} value={repository.id}>{repository.name}</option>)}
      </select>
    </label>
    {selected ? <RepositorySyncPanel key={selected} repositoryId={selected} /> : <p>Importiere zuerst ein Repository.</p>}
    <button type="button" className="btn" onClick={onClose}>Schliessen</button>
  </Modal>;
}
