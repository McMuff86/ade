/**
 * Single mount point for the onboarding modals. Reads the shared onboarding
 * store and renders whichever modal is open. Mounted once (from the rail) so
 * both the rail buttons and the first-run card can drive it.
 */

import { useAppData } from '../stores/appdata';
import { EditAgentModal } from './EditAgentModal';
import { EditCategoryModal } from './EditCategoryModal';
import { NewAgentModal } from './NewAgentModal';
import { NewCategoryModal } from './NewCategoryModal';
import { useOnboarding } from './useOnboarding';
import './onboarding.css';

export function OnboardingModals(): React.ReactElement | null {
  const open = useOnboarding((s) => s.open);
  const close = useOnboarding((s) => s.close);
  const agents = useAppData((s) => s.agents);
  const categories = useAppData((s) => s.categories);

  if (!open) return null;
  if (open.kind === 'category') return <NewCategoryModal onClose={close} />;
  if (open.kind === 'categorySettings') {
    const category = categories.find((candidate) => candidate.id === open.categoryId);
    return category ? <EditCategoryModal category={category} onClose={close} /> : null;
  }
  if (open.kind === 'agentSettings') {
    const agent = agents[open.agentId];
    return agent ? <EditAgentModal agent={agent} onClose={close} /> : null;
  }
  return <NewAgentModal onClose={close} categoryId={open.categoryId} />;
}
