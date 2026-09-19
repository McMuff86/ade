import { t as translate } from "./i18n";
/** Imported Markdown belongs to the ADE identity, never to a leased repository. */
export interface AgentBehaviorProfile {
  instructions: string;
  documents: Array<{ id: string; name: string; text: string }>;
}

export const MAX_PROFILE_INSTRUCTIONS_CHARS = 8_000;
export const MAX_PROFILE_DOCUMENT_CHARS = 8_000;
export const MAX_PROFILE_DOCUMENTS = 8;
export const MAX_PROFILE_TOTAL_CHARS = 24_000;
export const MAX_PROFILE_DOCUMENT_ID_CHARS = 128;
export const MAX_PROFILE_DOCUMENT_NAME_CHARS = 100;

function record(value: unknown, keys: string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => keys.includes(key));
}

export function isValidAgentBehaviorProfile(value: unknown): value is AgentBehaviorProfile {
  if (!record(value, ['instructions', 'documents']) || typeof value.instructions !== 'string'
    || value.instructions.length > MAX_PROFILE_INSTRUCTIONS_CHARS || value.instructions.includes('\0')
    || !Array.isArray(value.documents) || value.documents.length > MAX_PROFILE_DOCUMENTS) return false;
  let total = value.instructions.length;
  const ids = new Set<string>();
  for (const document of value.documents) {
    if (!record(document, ['id', 'name', 'text']) || typeof document.id !== 'string'
      || !/^[A-Za-z0-9_-]{1,128}$/.test(document.id) || ids.has(document.id)
      || typeof document.name !== 'string' || document.name.length > MAX_PROFILE_DOCUMENT_NAME_CHARS
      || !/^[\p{L}\p{N}_][\p{L}\p{N} _.-]*\.md$/iu.test(document.name)
      || typeof document.text !== 'string' || document.text.length > MAX_PROFILE_DOCUMENT_CHARS
      || document.text.includes('\0')) return false;
    ids.add(document.id);
    total += document.text.length;
  }
  return total <= MAX_PROFILE_TOTAL_CHARS;
}

/** Return a detached, canonical copy, preserving the explicitly assigned order. */
export function validateAgentBehaviorProfile(value: unknown): AgentBehaviorProfile {
  if (!isValidAgentBehaviorProfile(value)) throw new Error(translate("ade: Invalid profile statements or markdown documents. Limits: 8 documents, 8000 characters each, together 24000 characters."));
  return { instructions: value.instructions, documents: value.documents.map(({ id, name, text }) => ({ id, name, text })) };
}
