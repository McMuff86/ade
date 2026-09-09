import { createContext, useEffect, useState } from 'react';

export const TabletKeyboardContext = createContext(false);

/** Chrome's visual viewport shrinks when the software keyboard opens. */
export function useTabletViewport(): boolean {
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      document.documentElement.style.setProperty('--tablet-height', `${viewport?.height ?? window.innerHeight}px`);
      document.documentElement.style.setProperty('--tablet-top', `${viewport?.offsetTop ?? 0}px`);
      // Browser chrome is much smaller than a keyboard. Pinch zoom also shrinks
      // the visual viewport, but must not be mistaken for keyboard input.
      setKeyboardOpen(!!viewport && Math.abs(viewport.scale - 1) < 0.05
        && window.innerHeight - viewport.height > Math.max(160, window.innerHeight * 0.2));
    };
    update(); viewport?.addEventListener('resize', update); viewport?.addEventListener('scroll', update); window.addEventListener('resize', update);
    return () => { viewport?.removeEventListener('resize', update); viewport?.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, []);
  return keyboardOpen;
}
