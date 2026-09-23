import { t as translate } from "../../shared/i18n";
import { useLocale } from "../i18n/language";
import type { JSX } from 'react';
import { useSettings } from '../stores/settings';

/**
 * Settings → Usage: the one consent switch for reading Claude account limits
 * through the Claude CLI sign-in on this PC. Off by default; the Overview and
 * the tablet then show the `/usage` hint instead of figures.
 */
export function UsageSettingsSection(): JSX.Element {
  useLocale();
  const enabled = useSettings((state) => state.claudeAccountUsage);
  const setEnabled = useSettings((state) => state.setClaudeAccountUsage);
  return <section className="st-usage-section" aria-labelledby="st-usage-heading" data-testid="settings-usage">
    <h3 id="st-usage-heading">{translate("Usage")}</h3>
    <p className="st-help">{translate("Codex account limits come from the locally signed-in Codex CLI. Claude Code keeps its limits only in the Anthropic account; ADE can read them with the Claude CLI sign-in stored on this PC when you allow it here.")}</p>
    <label className="st-check">
      <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
      <span>{translate("Read Claude account limits through the Claude CLI sign-in")}</span>
    </label>
    <p className="st-help">{translate("ADE then asks the Anthropic account for the same percentages /usage shows, at most once per minute, and shows them on the Overview here and on the tablet. The sign-in stays on this PC; ADE never shows or sends the token. Switch it off at any time.")}</p>
  </section>;
}
