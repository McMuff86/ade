import type { JSX } from 'react';
import type { MobileCatalog } from '../shared/remote';
import { Avatar } from '../renderer/rail/Avatar';
import { runtimeVisual } from '../renderer/graph/runtimeGlyphs';
import { Dialog } from './ui';
import type { MobileHost, PendingCommand } from './useMobileHost';

export interface WorkDraft { mode: 'task' | 'run'; repositoryId: string; agentIds: string[]; name: string; prompt: string; minutes: number; cost: string }
export const emptyDraft = (): WorkDraft => ({ mode: 'task', repositoryId: '', agentIds: [], name: '', prompt: '', minutes: 30, cost: '' });

export function PendingNotice({ host, onRetry }: { host: MobileHost; onRetry: (command: PendingCommand) => void }): JSX.Element | null {
  if (!host.pending || host.busy) return null;
  return <section className="m-uncertain" aria-label="Unbestätigter Auftrag"><h3>Antwort noch unklar</h3>
    <p>Der Auftrag könnte bereits angenommen worden sein. Ein erneuter Versuch verwendet dieselbe Vorgangs-ID.</p>
    <div className="m-actions"><button disabled={host.status !== 'online'} onClick={() => { if (host.pending) onRetry(host.pending); }}>Diesen Auftrag erneut prüfen</button>
      <button onClick={host.dismissPending}>Run-Liste selbst prüfen</button></div>
  </section>;
}

export function WorkComposer({ draft, setDraft, catalog, host, onSend, onClose }: {
  draft: WorkDraft; setDraft: (draft: WorkDraft) => void; catalog: MobileCatalog | null; host: MobileHost;
  onSend: (command: PendingCommand) => void; onClose: () => void;
}): JSX.Element {
  const run = draft.mode === 'run';
  const patch = (value: Partial<WorkDraft>) => setDraft({ ...draft, ...value });
  const limit = run ? 1000 : 8000;
  const disabled = !host.canSubmit || !draft.repositoryId || !draft.prompt.trim() || draft.prompt.length > limit
    || (run ? draft.agentIds.length < 2 || !draft.name.trim() : draft.agentIds.length === 0);
  return <Dialog title={run ? 'Neuer Run' : 'Neue Aufgabe'} onClose={onClose} fallbackId="mobile-title" className="m-composer-dialog">
    <p className="m-dialog-intro">{run ? 'Agents zusammenstellen, Ziel und Budget festlegen. Danach den vorbereiteten Run starten.' : 'Repository und Agent wählen. Die Aufgabe wird auf deinem PC ausgeführt.'}</p>
    {host.error && <p className="m-alert" role="alert">{host.error}</p>}
    {host.status !== 'online' && <p className="m-notice" role="status">Offline. Dein Entwurf bleibt erhalten; zum Senden wieder verbinden.</p>}
    <PendingNotice host={host} onRetry={onSend} />
    {!catalog ? <p role="status">Projekte und Agents werden geladen…</p> : !catalog.repositories.length || !catalog.agents.length
      ? <p className="m-empty-copy">Am PC zuerst ein Repository und einen Agent in ADE einrichten.</p>
      : <form onSubmit={(event) => {
        event.preventDefault(); if (disabled) return;
        const payload = !run ? { agentId: draft.agentIds[0], repositoryId: draft.repositoryId, prompt: draft.prompt,
          ...(draft.name.trim() ? { name: draft.name.trim() } : {}) }
          : { name: draft.name.trim(), goal: draft.prompt, repositoryId: draft.repositoryId,
            participants: draft.agentIds.map((agentId, index) => ({ agentId, role: index === 0 ? 'orchestrator' : index === 1 ? 'lead' : 'worker',
              ...(index > 0 ? { teamId: 'mobile-team', teamName: 'Mobile Team' } : {}) })),
            budget: { maxConcurrentTasks: Math.min(2, draft.agentIds.length), maxTaskMinutes: draft.minutes, maxCostUsd: draft.cost ? Number(draft.cost) : null } };
        onSend({ path: run ? '/api/v1/runs' : '/api/v1/tasks', payload, key: crypto.randomUUID() });
      }}>
        <fieldset disabled={host.busy || !!host.pending}><legend>Auftragsart</legend>
          <div className="m-mode-choice"><label><input type="radio" name="mode" checked={!run} onChange={() => patch({ mode: 'task', agentIds: draft.agentIds.slice(0, 1) })} />Einzelaufgabe</label>
            <label><input type="radio" name="mode" checked={run} onChange={() => patch({ mode: 'run' })} />Managed Run</label></div>
          <label>Repository<select aria-label="Repository" value={draft.repositoryId} onChange={(event) => patch({ repositoryId: event.target.value })} required>
            {catalog.repositories.map((repo) => <option key={repo.id} value={repo.id}>{repo.name}{repo.verified ? '' : ' · ungeprüft'}</option>)}</select></label>
          {!run ? <label>Agent<select aria-label="Agent" value={draft.agentIds[0] ?? ''} onChange={(event) => patch({ agentIds: [event.target.value] })} required>
            <option value="" disabled>Agent wählen</option>{catalog.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {runtimeVisual(agent.runtime).label}</option>)}</select></label>
            : <fieldset className="m-roster"><legend>Agents · Reihenfolge bestimmt die Rollen</legend>{catalog.agents.map((agent) => {
              const index = draft.agentIds.indexOf(agent.id);
              return <label className="m-roster-agent" key={agent.id}><input type="checkbox" aria-label={agent.name} checked={index >= 0}
                onChange={(event) => patch({ agentIds: event.target.checked ? [...draft.agentIds, agent.id] : draft.agentIds.filter((id) => id !== agent.id) })} />
                <Avatar name={agent.name} size={28} /><span><strong>{agent.name}</strong><small>{runtimeVisual(agent.runtime).label}</small></span>
                <span className="m-role">{index === 0 ? '1 · Koordination' : index === 1 ? '2 · Lead' : index > 1 ? `${index + 1} · Worker` : ''}</span></label>;
            })}</fieldset>}
          <label>{run ? 'Run-Name' : 'Name (optional)'}<input value={draft.name} onChange={(event) => patch({ name: event.target.value })} maxLength={80} required={run} /></label>
          <label>{run ? 'Ziel' : 'Aufgabe'}<textarea aria-label={run ? 'Ziel' : 'Aufgabe'} value={draft.prompt} onChange={(event) => patch({ prompt: event.target.value })}
            rows={5} maxLength={limit} required placeholder="Was soll ADE für dich erledigen?" /></label>
          <p className={draft.prompt.length > limit ? 'm-error-copy' : 'm-field-note'}>{draft.prompt.length.toLocaleString('de-CH')} / {limit.toLocaleString('de-CH')} Zeichen{draft.prompt.length > limit ? ' · Bitte kürzen; der Entwurf wurde erhalten.' : ''}</p>
          {run && <div className="m-budget-fields"><label>Minuten pro Aufgabe<input type="number" min={1} max={1440} required value={draft.minutes} onChange={(event) => patch({ minutes: Number(event.target.value) })} /></label>
            <label>Kostenlimit USD (optional)<input type="number" min="0.01" step="0.01" value={draft.cost} onChange={(event) => patch({ cost: event.target.value })} /></label></div>}
          {run && draft.agentIds.length < 2 && <p className="m-field-note">Mindestens zwei Agents wählen: Koordination und Umsetzung.</p>}
          <div className="m-actions"><button className="m-primary" disabled={disabled}>{host.busy ? 'Wird bestätigt…' : run ? 'Run vorbereiten' : 'Aufgabe starten'}</button>
            <button type="button" onClick={onClose}>Entwurf behalten und schliessen</button></div>
        </fieldset>
      </form>}
  </Dialog>;
}
