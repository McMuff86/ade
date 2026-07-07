/**
 * Single mount point for the onboarding modals. Reads the shared onboarding
 * store and renders whichever modal is open. Mounted once (from the rail) so
 * both the rail buttons and the first-run card can drive it.
 */

import { NewAgentModal } from './NewAgentModal';
import { NewCategoryModal } from './NewCategoryModal';
import { useOnboarding } from './useOnboarding';
import './onboarding.css';

export function OnboardingModals(): React.ReactElement | null {
  const open = useOnboarding((s) => s.open);
  const close = useOnboarding((s) => s.close);

  if (!open) return null;
  if (open.kind === 'category') return <NewCategoryModal onClose={close} />;
  return <NewAgentModal onClose={close} categoryId={open.categoryId} />;
}
