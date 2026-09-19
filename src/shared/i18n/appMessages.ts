import { de } from './de';
import { en } from './en';
import { t, type MessageKey } from './index';

// Legacy IPC serialises Error.message only. Match ADE's own catalogue after the
// main-process redaction boundary; never translate arbitrary response/user text.
const exact = new Map<string, MessageKey>();
interface Pattern { key: MessageKey; expression: RegExp; names: string[]; prefix: string }
const patterns: Pattern[] = [];
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const key of Object.keys(en) as MessageKey[]) {
  for (const text of [en[key], de[key]]) {
    const slots = [...text.matchAll(/\{\{(\w+)\}\}/g)];
    if (!slots.length) { if (!exact.has(text)) exact.set(text, key); continue; }
    // A short label such as "Task {{value1}}" must not match unrelated prose.
    if (text.replace(/\{\{\w+\}\}/g, '').length < 16) continue;
    let expression = '^'; let position = 0;
    for (const slot of slots) { expression += escape(text.slice(position, slot.index)) + '([\\s\\S]*?)'; position = slot.index! + slot[0].length; }
    expression += escape(text.slice(position)) + '$';
    patterns.push({ key, expression: new RegExp(expression), names: slots.map(slot => slot[1]!), prefix: text.slice(0, slots[0]!.index) });
  }
}

/** Only for app-owned notices/errors. Never use for notes, prompts or terminal output. */
export function localizeAppMessage(value: string): string;
export function localizeAppMessage(value: string | null | undefined): string | null | undefined;
export function localizeAppMessage(value: string | null | undefined): string | null | undefined {
  if (!value || value.length > 4_000) return value;
  const key = exact.get(value);
  if (key) return t(key);
  const prefix = value.match(/^(?:Error invoking remote method '[^']+':\s*)?(?:Error:\s*)?(?:\[ADE_[A-Z_]+\]\s*)?/u)?.[0] ?? '';
  if (prefix) return prefix + localizeAppMessage(value.slice(prefix.length));
  for (const pattern of patterns) {
    if (pattern.prefix && !value.startsWith(pattern.prefix)) continue;
    const match = pattern.expression.exec(value);
    if (match) return t(pattern.key, Object.fromEntries(pattern.names.map((name, index) => [name, match[index + 1]!])));
  }
  return value;
}
