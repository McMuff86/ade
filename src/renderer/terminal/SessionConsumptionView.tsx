import { localizeAppMessage } from '../../shared/i18n/appMessages';
import { intlLocale } from '../../shared/i18n';
import { t as translate } from "../../shared/i18n";
import { localizedLabels } from "../../shared/i18n/labels";
import { useLocale } from "../i18n/language";
import type { SessionConsumption } from '../../shared/remote';

const labels = localizedLabels(() => ({ input: translate("Total input"), inputUncached: translate("Of which uncached"), cacheRead: translate("Of which cache reads"), cacheWrite: translate("Of which cache writes"),
  output: translate("Total output"), reasoning: translate("Of which reasoning") } as const));
const costLabels = localizedLabels(() => ({ 'provider-estimate': translate("Estimated API price"), 'provider-reported': translate("Amount reported by the provider"), 'configured-estimate': translate("Estimation according to the tariff") } as const));

export function SessionConsumptionView({ value }: { value: SessionConsumption }) {
  useLocale();
  return <div className="session-consumption" role="region" aria-label={translate("Session usage")}>
    <strong>{translate("Session usage ·")}{" "}{value.ended ? translate("ended") : translate("in progress")}</strong>
    <p>{value.status === 'waiting' ? translate("Not yet a usage report. Unknown is not free.")
      : value.status === 'unsupported' ? translate("Automatic capture is not available for this start.")
        : value.status === 'incomplete' ? translate("Acquisition incomplete. Known values are retained.") : translate("{{value1}} unique usage reports recorded.", { value1: value.events })}</p>
    {value.events > 0 && <>
      <dl>{(Object.keys(labels) as Array<keyof typeof labels>).map(field => <div key={field}>
        <dt>{labels[field]}</dt><dd>{value.tokens[field] === null ? translate("Unknown") : value.tokens[field].toLocaleString(intlLocale())}
          {value.tokens[field] !== null && value.missing[field] > 0 ? translate(" · partial") : ''}</dd>
      </div>)}</dl>
      <p>{translate("Cache tokens are included in input; reasoning tokens are included in output. Do not add these again.")}</p>
      {value.costs.map(cost => <p key={cost.kind}><strong>{costLabels[cost.kind]}: {cost.usd.toLocaleString(intlLocale(), { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 6 })}</strong>
        {!cost.complete && translate(" · Completeness unconfirmed")}</p>)}
      {value.eventsWithoutCost > 0 && <p>{value.eventsWithoutCost}{" "}{translate("Usage reports without cost indication.")}</p>}
      <p>{translate("An API price is not an invoice for your CLI subscription.")}</p>
      {value.models.length > 0 && <p>{translate("Reported models:")}{" "}{value.models.join(', ')}</p>}
    </>}
    {value.speech?.map(speech => <div key={speech.product} role="region" aria-label={speech.product === 'dictation' ? translate("Dictation usage") : translate("Voice test usage")}>
      <strong>{translate("ElevenLabs ·")}{" "}{speech.product === 'dictation' ? translate("Dictation") : speech.product === 'speech-reply' ? translate("Read the answer") : translate("Voice test")}</strong>
      <dl>{(['complete', 'pending', 'unconfirmed', 'not-sent'] as const).filter(state => speech.requests[state] > 0).map(state => <div key={state}>
        <dt>{{ complete: translate("Response received"), pending: translate("Completion pending"), unconfirmed: translate("Reply unconfirmed"), 'not-sent': translate("Ended before sending") }[state]}</dt>
        <dd>{speech.unknownAmounts?.[state] === speech.requests[state] ? translate("Quantity still unknown")
          : <>{speech.amounts[state].toLocaleString(intlLocale(), { maximumFractionDigits: 2 })} {speech.unit === 'audioSeconds' ? translate("Sec. Audio") : translate("Characters")}
            {!!speech.unknownAmounts?.[state] && translate(" · partially unknown")}</>} · {speech.requests[state]}{" "}{translate("Job(s)")}</dd>
      </div>)}</dl>
      <p>{translate("Measured input of this session. Credits and costs per job are unknown. Pending or unconfirmed jobs may have caused usage.")}</p>
    </div>)}
    <p>{localizeAppMessage(value.notice)}</p>
    <p>{value.lastReportedAt === null ? translate("No measurement time yet.") : translate("Last recorded report: {{value1}}", { value1: new Date(value.lastReportedAt).toLocaleString(intlLocale()) })}</p>
  </div>;
}
