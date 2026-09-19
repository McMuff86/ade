import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
import { useEffect, useRef } from 'react';
import { desktopSessionNavigation } from '../../shared/sessionNavigation';
import { useAppData } from '../stores/appdata';
import { useMode } from '../stores/mode';
import { useSessions } from '../stores/sessions';
import { openCliSession } from '../work/openCliSession';
import { Modal } from '../onboarding/Modal';
import { SessionSwitcher } from './SessionSwitcher';

export function DesktopSessionSwitcher({ onClose }: { onClose(): void }) {
  useLocale();
  const { sessions, hydrated, error, hydrate } = useSessions(); const live = useRef(true);
  const { repositories, agents } = useAppData();
  useEffect(() => { live.current = true; void hydrate(true); return () => { live.current = false; }; }, [hydrate]);
  return <Modal title={translate("Switch work")} onClose={onClose} className="session-switch-dialog" fallbackFocus={() => document.getElementById(`mode-tab-${useMode.getState().mode}`)}>
    <SessionSwitcher items={desktopSessionNavigation(Object.values(sessions), repositories, agents)} loading={!hydrated}
      error={error?.source === 'recovery' ? error.message : ''} onRefresh={() => void hydrate(true)} onClose={onClose}
      onSelect={async id => { await openCliSession(id, () => live.current); if (live.current) { onClose(); requestAnimationFrame(() => document.getElementById(`mode-tab-${useMode.getState().mode}`)?.focus()); } }} />
  </Modal>;
}
