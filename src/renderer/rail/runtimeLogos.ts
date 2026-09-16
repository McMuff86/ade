import type { RuntimeId } from '../../shared/types';
const codex = new URL('../assets/runtime-logos/codex.svg?no-inline', import.meta.url).href;
const claude = new URL('../assets/runtime-logos/claude.svg?no-inline', import.meta.url).href;
const grok = new URL('../assets/runtime-logos/grok.svg?no-inline', import.meta.url).href;

/** Bundled vector marks stay sharp at any display density and work offline. */
export function runtimeLogo(runtime?: RuntimeId): string | undefined {
  return runtime === 'codex' ? codex : runtime === 'claude' ? claude : runtime === 'grok' ? grok : undefined;
}
