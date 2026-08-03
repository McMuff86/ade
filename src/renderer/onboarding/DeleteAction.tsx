/**
 * Two-step delete for a modal footer.
 *
 * Deleting a category or an agent had no affordance at all: `category:delete`
 * and `agent:delete` were handled in main and exposed on the store, but no
 * component ever called them, so the only way to remove anything was an agent
 * or devtools invoking the channel directly.
 *
 * The confirmation is inline rather than a native dialog so it can say what
 * actually happens — which for a category includes its agents — and so the
 * whole flow stays drivable in the E2E.
 */

import { useState } from 'react';

interface DeleteActionProps {
  /** Verb shown on the resting button, e.g. "Agent löschen". */
  label: string;
  /** What the user is about to lose. Shown only in the armed state. */
  consequence: string;
  busy: boolean;
  onDelete: () => Promise<void>;
}

export function DeleteAction({
  label, consequence, busy, onDelete,
}: DeleteActionProps): React.ReactElement {
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const run = async (): Promise<void> => {
    setDeleting(true);
    setError(null);
    try {
      await onDelete();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setArmed(false);
    } finally {
      setDeleting(false);
    }
  };

  if (!armed) {
    return (
      <div className="modal-delete">
        <button
          type="button"
          className="btn danger-quiet"
          disabled={busy || deleting}
          onClick={() => { setArmed(true); setError(null); }}
        >
          {label}
        </button>
        {error ? <span className="modal-delete-error" role="alert">{error}</span> : null}
      </div>
    );
  }

  return (
    <div className="modal-delete is-armed">
      <span className="modal-delete-consequence">{consequence}</span>
      <button type="button" className="btn" disabled={deleting} onClick={() => setArmed(false)}>
        Abbrechen
      </button>
      <button
        type="button"
        className="btn danger"
        disabled={deleting}
        onClick={() => void run()}
      >
        {deleting ? 'Löschen…' : 'Endgültig löschen'}
      </button>
    </div>
  );
}
