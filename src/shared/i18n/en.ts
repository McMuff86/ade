import { messagesEn } from './messages.en';
/** English is the source catalog and fallback for future languages. */
export const en = {
  ...messagesEn,
  'language.title': 'Language',
  'language.description': 'Choose the interface language for this device. Your content and terminal output keep their original language.',
  'language.savedLocally': 'The language is active on this device. Saving the PC preference failed.',
  'language.storageUnavailable': 'The language is active for this session. Browser storage is unavailable.',
} as const;
