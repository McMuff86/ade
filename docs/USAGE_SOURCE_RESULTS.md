# Native Nutzungsquellen: begrenzte Proben

15. September 2026. Recherche und echte kurze CLI-Proben als Grundlage für
[Goal 24](USAGE_AND_COST_GOALS.md). **Noch keine integrierte ADE-Zählerfunktion.**
Die Proben liefen nativ unter Windows, in jeweils neuen temporären Ordnern, mit
bestehender CLI-Anmeldung und ausdrücklichem Auftrag ohne Tools/Dateiänderungen.
Die Telemetrie wurde nur für diese Prozesse auf einen lokalen Loopback-Empfänger
gesetzt. Globale Benutzerkonfigurationen und Inferenz-Endpunkte blieben erhalten.
Content-Schalter waren ausgeschaltet; aufbewahrt wurden nur ausgewählte
numerische Felder, technische Ereignisnamen und Sitzungskennungen.

## Codex 0.154.0

`codex exec --json` exportiert OTLP/HTTP-JSON über eine pro Aufruf gesetzte
`otel.exporter`-Option. `OTEL_EXPORTER_OTLP_LOGS_HEADERS` übergibt den lokalen
Empfängerschlüssel erfolgreich als Umgebungsvariable. Die Gegenprobe mit dem
Text `${ADE_USAGE_TOKEN}` in TOML-`headers` übertrug diesen Text unverändert:
Eine angenommene Variableninterpolation wäre in dieser Version falsch.

Die Probe um 01:32 UTC enthält eine eindeutige `conversation.id`, Modell
`gpt-6-astra` und einen abschliessenden Tokenstand:

| Input gesamt | Cache-Lesen (Teilmenge) | Cache-Schreiben | Output gesamt | Reasoning (Teilmenge) |
|---|---|---|---|---|
| 15.731 | 12.288 | 0 | 9 | 0 |

Diese Werte stimmen zwischen `turn.completed.usage` auf stdout und
`event_msg / token_count / info.total_token_usage` in der **exakt über die
Conversation-ID gefundenen** eigenen Rolloutdatei überein.

Eine wichtige Gegenprobe: OTLP exportierte zuvor ein weiteres
`codex.sse_event` mit `event.kind=response.completed`, 12.439 Input und 0 Output.
Einfach alle `response.completed` zu addieren widerspräche der CLI-Schlussbilanz.
Für die Integration deshalb den strukturierten kumulativen Rollout-Zähler bzw.
den ohnehin besessenen App-Server-Thread bevorzugen. OTel kann die neu gestartete
interaktive CLI eindeutig mit ihrem Thread verbinden; eine beliebige zuletzt
geänderte Datei oder ein fremder App Server reicht dafür nicht.

Quellen: [Codex-Telemetrie](https://learn.chatgpt.com/docs/config-file/config-advanced#observability-and-telemetry),
[Exportertypen des geprüften Quellstands](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/otel/src/config.rs).
Lokaler Nachweis: `test-results/usage-codex-env-probe.json`.

## Claude Code 2.1.270

Die Headless-Probe um 01:37 UTC exportiert `claude_code.api_request` per
OTLP/HTTP-JSON. Ein eigener `--session-id` und ein Empfängerschlüssel aus der
Umgebung binden sie eindeutig. Zwei Modelle liefen innerhalb desselben Auftrags:

| Modell | Input ohne Cache | Cache lesen | Cache schreiben | Output | Gemeldete Schätzung USD |
|---|---|---|---|---|---|
| claude-haiku-4-5-20251001 | 913 | 0 | 0 | 18 | 0,001003 |
| claude-fable-5-1 | 2 | 13.015 | 4.208 | 18 | 0,08833375 |

Die Summe **0,08933675 USD** stimmt mit `total_cost_usd` der CLI überein.
Das ist deren Schätzung zum Listenpreis, kein Beleg einer entsprechenden
zusätzlichen Abbuchung im Claude-Max-Abo. Nur den Hauptmodell-Aufruf zu zählen
würde den Hilfsaufruf unterschlagen. `cost_usd_micros` rundet auf Millionstel;
beide Kostenfelder dürfen nicht addiert werden.

OTLP enthält Request-IDs, aber in dieser Probe keinen separaten Reasoning-Zähler.
Die über **denselben Request** zugeordnete Assistant-Zeile der eigenen Sessiondatei
meldet dagegen `output_tokens_details.thinking_tokens=0`; die finale
`modelUsage`-Bilanz enthält ebenfalls `thinkingTokens`. Diese ergänzende Quelle
ist versionsabhängig. Ohne entsprechende Meldung bleibt Reasoning unbekannt.

Quelle: [Claude Code Monitoring](https://code.claude.com/docs/en/monitoring-usage).
Lokaler Nachweis: `test-results/usage-claude-env-probe.json`.

## Grok 1.0.13

Die Probe um 01:39 UTC verwendet `GROK_EXTERNAL_OTEL=1`, den OTLP-Logexporter
und **HTTP/Protobuf**. Das separate Opt-in sowie der Empfängerschlüssel aus
`OTEL_EXPORTER_OTLP_LOGS_HEADERS` funktionieren mit der installierten CLI.
`grok_code.api_request` meldet für das ausgewählte Modell `grok-4.6`:
**5.280 Input, 37 Output, 128 Cache-Lesen und 26 Reasoning**.

Der eigene native `updates.jsonl`-Eintrag `sessionUpdate=turn_completed`
bestätigt diese Werte mit `params.sessionId`, `prompt_id` und `_meta.eventId`.
Er enthält zusätzlich Cache-Schreiben 0, einen Modellaufruf und die Modellkennung
`grok-4.6-build` im Breakdown. Requestmodell und gemeldetes Abrechnungsmodell
daher getrennt erhalten. Das Input-Feld dieser ACP-Quelle ist **einschliesslich
Cache**; das dokumentierte Headless-Ergebnis projiziert dagegen Input ohne Cache.
Die beiden Formen dürfen nicht mit derselben Additionsregel behandelt werden.

Der native Eintrag enthält `costUsdTicks=36006000`. Die beigelegte Dokumentation
definiert **10^10 Ticks pro USD**, also 0,0036006 USD. Kostenvollständigkeit und
Abrechnungsart brauchen weiterhin einen eigenen Vertrag; ein teilweise gemeldeter
Betrag wird nicht zur vollständigen Rechnung erklärt. Insbesondere liefert das
kompatible Messages-Streamingformat bei unbekannten Kosten teilweise 0, während
das normale JSON-Format fehlende/partielle Kosten auslassen kann.

Weitere Abweichung von der allgemeinen Beschreibung: In dieser Probe tragen
Start und Ende eine `session.id`, das API-Ereignis aber nicht. Eine pro Prozess
gebundene Empfängeridentität bleibt daher notwendig. Der Dateieintrag besitzt
zusätzlich eine eindeutige Ereignis-ID für Replay-Abgleich. API-Ereignis und
Turn-Bilanz sind alternative Ansichten desselben Verbrauchs, keine zwei Kosten.

Primärquelle: mit Grok 1.0.13 ausgelieferte `docs/user-guide/24-monitoring-usage.md`
und `14-headless-mode.md`; Protobuf-Vertrag im
[OpenTelemetry-Logschema](https://github.com/open-telemetry/opentelemetry-proto/blob/main/opentelemetry/proto/logs/v1/logs.proto).
Lokaler Nachweis: `test-results/usage-grok-env-probe.json`.

## Konsequenz für die Implementierung

Ein Inferenz-Reverse-Proxy ist für diese ersten Zähler nicht erforderlich.
Native Ereignisse und eindeutig zugeordnete Laufzeitdateien liefern die nötigen
Werte. Ein begrenzter lokaler Collector soll nur die für ADE gestarteten Prozesse
annehmen, Fremdinhalte sofort verwerfen und ein numerisches Journal führen.
OTel darf keine globalen Telemetrieziele oder persönlichen Logins umschreiben.

Noch zu implementieren/prüfen: normale interaktive Starts mit diesen Collectors,
Resume/Fork/Subagents, zwei Prozesse im selben Checkout, Wiederholung und
Neustart, grosse/rotierte Dateien, Modellwechsel, unvollständige Kosten, UI und
Budgets. Native Windows-Proben sind kein Nachweis für WSL, Linux oder macOS.
ElevenLabs bleibt eine eigene Audio-/Zeichen-/Creditquelle; der echte STT-Test
steht in den [Diktat-Nachweisen](DICTATION_IMPLEMENTATION_RESULTS.md).
