import { useEffect, useState, type ComponentProps, type ComponentType, type JSX } from 'react';
import type { TerminalScreen } from './TerminalScreen';

type Props = ComponentProps<typeof TerminalScreen>;

/** Pairing and project navigation do not need to parse the terminal renderer. */
export function LazyTerminalScreen(props: Props): JSX.Element {
  const [Screen, setScreen] = useState<ComponentType<Props>>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void import('./TerminalScreen').then(module => { if (live) setScreen(() => module.TerminalScreen); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);
  if (Screen) return <Screen {...props} />;
  if (failed) return <div role="alert"><p>Terminalanzeige konnte nicht geladen werden. Die Sitzung läuft am PC weiter.</p>
    <button type="button" onClick={() => window.location.reload()}>Seite erneut laden</button></div>;
  return <p role="status">Terminalanzeige wird geladen…</p>;
}
