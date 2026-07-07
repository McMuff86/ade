/**
 * Onboarding modal state — shared so the rail ("+ New category" / "+ Add
 * agent"), and the first-run empty-state card all drive the same flow. The
 * modal host (<OnboardingModals/>) reads this; callers just open/close.
 */

import { create } from 'zustand';

export type OnboardingModal =
  | { kind: 'category' }
  | { kind: 'agent'; categoryId?: string };

interface OnboardingState {
  open: OnboardingModal | null;
  openNewCategory: () => void;
  openNewAgent: (categoryId?: string) => void;
  close: () => void;
}

export const useOnboarding = create<OnboardingState>((set) => ({
  open: null,
  openNewCategory: () => set({ open: { kind: 'category' } }),
  openNewAgent: (categoryId) => set({ open: { kind: 'agent', categoryId } }),
  close: () => set({ open: null }),
}));
