import type { SessionConsumption } from '../../shared/remote';

const labels = { input: 'Input gesamt', inputUncached: 'Davon ohne Cache', cacheRead: 'Davon Cache gelesen', cacheWrite: 'Davon Cache geschrieben',
  output: 'Output gesamt', reasoning: 'Davon Reasoning' } as const;
const costLabels = { 'provider-estimate': 'Geschätzter API-Preis', 'provider-reported': 'Vom Anbieter gemeldeter Betrag', 'configured-estimate': 'Schätzung nach hinterlegtem Tarif' } as const;

export function SessionConsumptionView({ value }: { value: SessionConsumption }) {
  return <div className="session-consumption" role="region" aria-label="Sitzungsverbrauch">
    <strong>Sitzungsverbrauch · {value.ended ? 'beendet' : 'laufend'}</strong>
    <p>{value.status === 'waiting' ? 'Noch keine Verbrauchsmeldung. Unbekannt bedeutet nicht kostenlos.'
      : value.status === 'unsupported' ? 'Für diesen Start ist keine automatische Erfassung verfügbar.'
        : value.status === 'incomplete' ? 'Erfassung unvollständig. Bekannte Werte bleiben erhalten.' : `${value.events} eindeutige Verbrauchsmeldungen erfasst.`}</p>
    {value.events > 0 && <>
      <dl>{(Object.keys(labels) as Array<keyof typeof labels>).map(field => <div key={field}>
        <dt>{labels[field]}</dt><dd>{value.tokens[field] === null ? 'Unbekannt' : value.tokens[field].toLocaleString()}
          {value.tokens[field] !== null && value.missing[field] > 0 ? ' · teilweise' : ''}</dd>
      </div>)}</dl>
      <p>Cache ist im Input enthalten, Reasoning im Output. Diese Anteile nicht nochmals addieren.</p>
      {value.costs.map(cost => <p key={cost.kind}><strong>{costLabels[cost.kind]}: {cost.usd.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 6 })}</strong>
        {!cost.complete && ' · Vollständigkeit unbestätigt'}</p>)}
      {value.eventsWithoutCost > 0 && <p>{value.eventsWithoutCost} Verbrauchsmeldungen ohne Kostenangabe.</p>}
      <p>Ein API-Preis ist keine Rechnung für dein CLI-Abo.</p>
      {value.models.length > 0 && <p>Gemeldete Modelle: {value.models.join(', ')}</p>}
    </>}
    {value.speech?.map(speech => <div key={speech.product} role="region" aria-label={speech.product === 'dictation' ? 'Diktatverbrauch' : 'Stimmtestverbrauch'}>
      <strong>ElevenLabs · {speech.product === 'dictation' ? 'Diktat' : 'Stimmtest'}</strong>
      <dl>{(['complete', 'pending', 'unconfirmed', 'not-sent'] as const).filter(state => speech.requests[state] > 0).map(state => <div key={state}>
        <dt>{{ complete: 'Antwort erhalten', pending: 'Abschluss ausstehend', unconfirmed: 'Antwort unbestätigt', 'not-sent': 'Vor Versand beendet' }[state]}</dt>
        <dd>{speech.unknownAmounts?.[state] === speech.requests[state] ? 'Menge noch unbekannt'
          : <>{speech.amounts[state].toLocaleString(undefined, { maximumFractionDigits: 2 })} {speech.unit === 'audioSeconds' ? 'Sek. Audio' : 'Zeichen'}
            {!!speech.unknownAmounts?.[state] && ' · teilweise unbekannt'}</>} · {speech.requests[state]} Auftrag/Aufträge</dd>
      </div>)}</dl>
      <p>Gemessene Eingabemenge dieser Sitzung. Credits und Kosten pro Auftrag sind unbekannt. Ausstehende oder unbestätigte Aufträge können Verbrauch verursacht haben.</p>
    </div>)}
    <p>{value.notice}</p>
    <p>{value.lastReportedAt === null ? 'Noch kein Messzeitpunkt.' : `Letzte erfasste Meldung: ${new Date(value.lastReportedAt).toLocaleString()}`}</p>
  </div>;
}
