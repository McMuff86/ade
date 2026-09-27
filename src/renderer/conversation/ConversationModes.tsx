import { t } from '../../shared/i18n';
import type { ConversationMode } from '../../shared/conversation';
import { useLocale } from '../i18n/language';
import type { JSX } from 'react';
import './conversation.css';

/** Same stroke grammar as the navigation icons: 24-unit box, 1.8 stroke, round joins. */
const MODE_ICONS: Record<ConversationMode, JSX.Element> = {
  // A project folder with a check: looking after projects.
  project: <path d="M3 7V5h7l2 3h9v11H3zM8.5 13.5l2.5 2.5 4.5-4.5" />,
  // A speech bubble carrying a sound wave: talking, by text or voice.
  casual: <path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-5 4v-4H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM9 9.5v2M12 8v5M15 9.5v2" />,
};

export function ConversationModes({ onChoose }: { onChoose(mode: ConversationMode): void }) {
  useLocale();
  const mode = (id: ConversationMode, title: string, text: string) => <button id={`conversation-mode-${id}`} type="button" onClick={() => onChoose(id)}>
    <span className="conversation-mode-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{MODE_ICONS[id]}</svg>
    </span>
    <span className="conversation-mode-text"><strong>{title}</strong><span>{text}</span></span>
  </button>;
  return <div className="conversation-modes">
    <p>{t('What would you like to do?')}</p>
    {mode('project', t('Project supervision'), t('Review progress, discuss handoffs and prepare project work.'))}
    {mode('casual', t('Chat & voice'), t('Chat about anything and experiment with voices, presets and A/B samples.'))}
  </div>;
}
