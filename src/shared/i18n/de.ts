import type { en } from './en';
import { messagesDe } from './messages.de';
export const de: Record<keyof typeof en, string> = {
  ...messagesDe,
  'language.title': 'Sprache',
  'language.description': 'Wähle die Sprache der Oberfläche für dieses Gerät. Deine Inhalte und die Terminalausgabe behalten ihre ursprüngliche Sprache.',
  'language.savedLocally': 'Die Sprache ist auf diesem Gerät aktiv. Die PC-Einstellung konnte nicht gespeichert werden.',
  'language.storageUnavailable': 'Die Sprache gilt für diese Sitzung. Der Browser-Speicher ist nicht verfügbar.',
};
