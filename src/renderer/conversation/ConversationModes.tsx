import { t } from '../../shared/i18n';
import type { ConversationMode } from '../../shared/conversation';
import { useLocale } from '../i18n/language';
import './conversation.css';

export function ConversationModes({ onChoose }: { onChoose(mode: ConversationMode): void }) {
  useLocale();
  return <div className="conversation-modes">
    <p>{t('What would you like to do?')}</p>
    <button id="conversation-mode-project" type="button" onClick={() => onChoose('project')}>
      <strong>{t('Project supervision')}</strong><span>{t('Review progress, discuss handoffs and prepare project work.')}</span>
    </button>
    <button id="conversation-mode-casual" type="button" onClick={() => onChoose('casual')}>
      <strong>{t('Chat & voice')}</strong><span>{t('Chat about anything and experiment with voices, presets and A/B samples.')}</span>
    </button>
  </div>;
}
