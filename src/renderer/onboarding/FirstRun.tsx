/**
 * First-run empty state — shown in the center area when there are no
 * categories yet. A calm card that launches the same New-category flow.
 */

import { useOnboarding } from './useOnboarding';
import './onboarding.css';

export function FirstRun(): React.ReactElement {
  const openNewCategory = useOnboarding((s) => s.openNewCategory);

  return (
    <div className="firstrun">
      <div className="firstrun-card">
        <div className="firstrun-title">Create your first category</div>
        <div className="firstrun-sub">
          A category groups agents around one thing you work on — a channel, a repo, a book.
          Add agents to it and each gets its own workspace, skills and memory.
        </div>
        <button type="button" className="btn primary firstrun-cta" onClick={openNewCategory}>
          + New category
        </button>
      </div>
    </div>
  );
}
