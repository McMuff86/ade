import { t as translate } from "./i18n";
import { validPromptText } from './dictation';

export interface TerminalPromptRequest {
  sessionId: string;
  commandId: string;
  text: string;
  mode: 'insert' | 'submit';
}
export type TerminalPromptCapability = { available: true } | { available: false; reason: string };
export interface TerminalPromptReceipt { accepted: true; replayed: boolean }

export function terminalPromptBytes(text: string, mode: 'insert' | 'submit'): string {
  if (!validPromptText(text) || (mode !== 'insert' && mode !== 'submit')) throw new Error(translate("Invalid Prompt Text."));
  return `\x1b[200~${text.replace(/\r\n?/g, '\n')}\x1b[201~${mode === 'submit' ? '\r' : ''}`;
}

export function validTerminalPrompt(value: unknown): value is TerminalPromptRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Object.keys(item).length === 4 && ['sessionId', 'commandId', 'text', 'mode'].every(key => Object.hasOwn(item, key))
    && typeof item.sessionId === 'string' && /^s[a-z0-9]{1,127}$/.test(item.sessionId)
    && typeof item.commandId === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(item.commandId)
    && validPromptText(item.text) && (item.mode === 'insert' || item.mode === 'submit');
}
