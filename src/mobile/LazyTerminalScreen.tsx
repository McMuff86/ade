import { t as translate } from "../shared/i18n";
import { useLocale } from "../renderer/i18n/language";
import { useEffect, useState, type ComponentProps, type ComponentType, type JSX } from 'react';
import type { TerminalScreen } from './TerminalScreen';

type Props = ComponentProps<typeof TerminalScreen>;

/** Pairing and project navigation do not need to parse the terminal renderer. */
export function LazyTerminalScreen(props: Props): JSX.Element {
  useLocale();
  const [Screen, setScreen] = useState<ComponentType<Props>>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void import('./TerminalScreen').then(module => { if (live) setScreen(() => module.TerminalScreen); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);
  if (Screen) return <Screen {...props} />;
  if (failed) return <div role="alert"><p>{translate("Terminal display could not be loaded. The session continues on the PC.")}</p>
    <button type="button" onClick={() => window.location.reload()}>{translate("Reload page")}</button></div>;
  return <p role="status">{translate("Loading terminal display…")}</p>;
}
