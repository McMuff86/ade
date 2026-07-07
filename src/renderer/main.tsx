import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ThemeProvider } from './theme/ThemeProvider';
import { useSelection } from './stores/selection';
import { useSessions } from './stores/sessions';
import { useSettings } from './stores/settings';
import './theme/tokens.css';
import './app.css';

// Dev-only handles for CDP-driven verification / integration smoke tests.
// Stripped from production builds (import.meta.env.DEV is false there).
if (import.meta.env.DEV) {
  (window as unknown as { __ade?: unknown }).__ade = {
    useSelection,
    useSessions,
    useSettings,
  };
}

const container = document.getElementById('root');
if (!container) throw new Error('missing #root element');

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
