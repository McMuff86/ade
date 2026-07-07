/**
 * ThemeProvider — stamps data-theme on <html> and hydrates settings from the
 * persisted config on mount. All colors resolve via theme/tokens.css.
 */

import { useEffect, type ReactNode } from 'react';
import { useSettings } from '../stores/settings';

export function ThemeProvider({ children }: { children: ReactNode }): ReactNode {
  const theme = useSettings((s) => s.theme);
  const hydrate = useSettings((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
  }, [theme]);

  return children;
}
