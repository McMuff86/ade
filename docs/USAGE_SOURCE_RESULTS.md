# Native Nutzungsquellen: begrenzte Proben

15. September 2026. Recherche und echte kurze CLI-Proben als Grundlage für
[Goal 24](USAGE_AND_COST_GOALS.md). **Native Quellenproben; die folgende
ADE-Integration ist gesondert in Abnahme.**
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

Noch integriert zu prüfen: normale echte interaktive Starts mit diesen Collectors,
Resume/Fork/Subagents, zwei Prozesse im selben Checkout, Wiederholung und
Neustart, grosse/rotierte Dateien, Modellwechsel, unvollständige Kosten, UI und
Budgets. Native Windows-Proben sind kein Nachweis für WSL, Linux oder macOS.
ElevenLabs bleibt eine eigene Audio-/Zeichen-/Creditquelle; der echte STT-Test
steht in den [Diktat-Nachweisen](DICTATION_IMPLEMENTATION_RESULTS.md).

Die anschliessende Implementierung besitzt 130 bestandene fokussierte Checks:
27 Normalisierung, 35 Journal, 19 Empfänger, 23 Dateiquelle und 26 Collector.
`NativeUsageService` ist an neue geschützte native Windows-CLI-Starts gebunden.
Die gemeinsame Sitzungsanzeige nutzt den vorhandenen autorisierten Terminal-
Nutzungsabruf. 28 kombinierte Electron-/Tablet-Checks bestehen mit nativen
ConPTY-CLI-Fixtures für alle drei Quellen; Log
`test-results/usage-dictation-electron-positive.log`. Zwei frühere UI-Prüfläufe
scheiterten an zu früher bzw. nicht auf den sichtbaren Tab begrenzter Auswahl;
der anschliessende vollständige Lauf ist positiv. Echte CLIs mit dem nun
integrierten Collector sind im folgenden Nachtrag erfasst; ElevenLabs-Erfassung
und das neue Gesamtverify folgen.

## Erste echte integrierte CLI-Zählerproben

15. September 2026, 03:09–03:18 UTC. Neue native CLIs wurden aus dem aktuellen
ADE-Code in jeweils einer eigenen leeren Git-Testarbeitskopie gestartet. Ein
kurzer Auftrag verlangte nur `ADE_PROBE_OK`, ohne Tools oder Dateiänderungen.
Die gezielte Promptübergabe war angenommen, die Antwort sichtbar und alle drei
Testarbeitskopien blieben sauber. Dies waren echte Provideraufrufe; die oben
genannten automatisierten Fixtures bleiben davon getrennt.

| Quelle | Erfasster Input / Output | Cache / Reasoning | Kostenaussage |
|---|---|---|---|
| Codex 0.154.0 / gpt-6-astra, erste Probe | 15.237 / 8 | 12.032 Cache gelesen, 0 geschrieben, 0 Reasoning | Keine Preisquelle; unbekannt |
| Claude Code 2.1.272 / Fable 5.1 plus Haiku-Hilfsmodell | 45.203 / 27, zwei Requests | 34.295 gelesen, 9.986 geschrieben, Reasoning unbekannt | 0,20995375 USD, vom CLI gemeldete API-Schätzung; keine Abo-Rechnung |
| Grok / grok-4.6-build | 15.084 / 58 | 640 gelesen, 0 geschrieben, 49 Reasoning als Output-Teilmenge | 0,01004904 USD, gemeldeter Betrag mit unbestätigter Vollständigkeit |

Die neue Claude-Probe ist auf **2.1.272**, während die frühere Quellenprobe
2.1.270 verwendete; diese Versionsnachweise nicht gleichsetzen. Groks sechs
Turn-Bilanzen einer zusätzlich nur numerisch geprüften bestehenden lokalen
Sitzung steigen und fallen unabhängig voneinander. `turn_completed.usage` ist
deshalb nicht als monotoner Sitzungszähler zu behandeln; ein weiterer fokussierter
Test prüft das Addieren eines kleineren Folgeturns.

**Offener Codex-Befund:** Nach dem ersten Prompt kommt ein zusätzliches
`conversation_starts`-Ereignis mit fehlender, abweichender oder nicht unterstützter
Identität. ADE ordnet es nicht der bekannten Rolloutdatei zu und markiert die
Abdeckung als unvollständig. Ein zweiter echter Auftrag bestätigt den Befund
(15.230 Input / 8 Output); ein Start ohne Modellauftrag bleibt erwartungsgemäss
ohne Zähler. Der bekannte Root-Zähler stimmt mit der exakt zugehörigen nativen
Rolloutbilanz überein. Herkunft und mögliche Zusatznutzung des anderen Ereignisses
sind noch nicht geklärt; keine vollständige Codex-Gesamtabrechnung behaupten.

Lokale Nachweise: `test-results/usage-integrated/{codex-first,codex,claude,grok}.json`,
zugehörige Screenshots und `test-results/usage-integrated-*-*.log` beziehungsweise
`usage-integrated-claude.log` / `usage-integrated-grok.log`. Die persönliche ADE-
Instanz und die vier Originalrepositorys wurden für diese Proben nicht verändert.

## ElevenLabs: echter lesender Kontenabgleich

15. September 2026, 03:37 UTC. Mit dem bestehenden verschlüsselten Service-Key
wurden zwei Analytics-Endpunkte in zwei begrenzten Leserunden zum Zeitfenster
01:05–01:08 UTC geprüft; keine neue Audioerzeugung oder Transkription.
Beide Endpunkte antworteten mit HTTP 200. Die Requestansicht enthält in diesem Fenster
einen erfolgreichen `/v1/speech-to-text`-Aufruf um 01:06:30 UTC.

Die Usageansicht liefert für den zugehörigen Minuten-Bucket **2 Credits**,
**0,0996666667 Audiominuten** und **0,0003654444 USD** bei einer Nutzung.
Die Dauer entspricht den 5,98 Sekunden des früheren echten STT-Tests. Dies ist
ein belegter zeitlicher Kontenabgleich, keine garantierte Preiszuweisung über
eine einzelne Request-ID und keine vollständige Aborechnung.

Der tatsächliche Tabellenvertrag weicht vom Beispiel der Dokumentation ab:
`total_usage` hat die Einheit `credits`, `total_minutes` die Einheit `min`,
`total_cost` die Einheit `usd`. `total_charge_count` hat keine angegebene Einheit
und wird deshalb nicht als Credits, Tokens oder Geld interpretiert. Request-
Analytics liefert unter anderem Event-/Tracekennungen; die Beispielspalte
`request_id` fehlt. Implementierung muss Spalten und Einheiten prüfen, statt
Positionsannahmen oder eine erfundene Request-ID-Zuordnung zu verwenden.

Quelle: [Workspace-Analytics](https://elevenlabs.io/docs/api-reference/analytics/workspace/usage),
[Request-Analytics](https://elevenlabs.io/docs/api-reference/analytics/workspace/requests).
Lokaler Nachweis: `test-results/usage-elevenlabs-account-probe.json`.
Der Probebericht enthält ausgewählte Zahlen, Zeitpunkte und das relative
Endpointmuster; keine Schlüssel, User-/Workspace-IDs, Querystrings, Prompts
oder Audiodaten. Dieser Abgleich ist noch keine integrierte Produktfunktion.

## Integrierte Erfassung: aktuelle Prüfungen

Der anschliessende Windows-Prüflauf besteht **2.956 Vertragschecks in 70 Suiten**
und den Produktionsbuild. Davon decken 130 die nativen Zähler, das Journal,
OTLP, exakte Dateiquellen und den Collector ab; weitere 36 prüfen Sprachversuche
und deren tatsächliche Einbindung in `DictationService` und `SpeechService`.
Der kombinierte Electron-/HTTPS-Browserablauf besteht **32 Checks**: echte ADE-
CLI-Starts mit lokalen Provider-Fixtures, Input/Cache/Reasoning, Kostenlücken,
Mikrofonaufnahme, Diktatdauer am ursprünglichen Ziel, Tabletanzeige und Fokus.
Der erste Gesamtversuch brach später an einer Startnachweis-Fixture ab: ihre
alte Bedingung „keine Argumente“ passte nicht zu den neuen Startargumenten.
Nach Anpassung besteht der komplette Terminal-Driver erneut 204 Checks. Ein
erneuter vollständiger Gesamtversuch steht noch aus. Der Operator wünscht jetzt
einen gesicherten Build zum eigenen Tablet-Test und danach Pause; [Handoff](HANDOFF.md).

Vor dem STT-/TTS-Aufruf speichert ADE einen Versuch. Erfolg, unbestätigter
Ausgang und Abbruch vor Versand aktualisieren denselben Versuch ohne doppelte
Menge. Ein Speicherfehler nach erfolgreicher Antwort verwirft das bezahlte
Transkript nicht; nach Neustart bleibt der Abschluss stattdessen ausstehend.
Eine nicht beschreibbare Erfassung blockiert einen neuen bezahlten Versand.
Das sind lokale Vertragsnachweise mit Provider-Fixtures; die echten Anbieter-
und Kontenproben stehen ausdrücklich separat oben.
