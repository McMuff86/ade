# Goal 24: Verbrauch und Kosten nachvollziehbar erfassen

Stand: 15. September 2026. Expliziter zusätzlicher Operatorauftrag; **zu
implementieren**, noch keine gelieferte sitzungsübergreifende Verbrauchserfassung.
Teil des aktiven [CLI-/Diktat-Ziels](CLI_WORK_AND_DICTATION_GOALS.md), nach bzw.
zusammen mit den laufenden Goals 27, 23.1 und 25. Die bestehenden
[Quoten-Meilensteine](VOICE_USAGE_TERMINAL_PLAN.md#goal-24-nutzungsdaten-anmeldung-und-kosten)
werden erweitert, nicht durch eine zweite Zielnummer ersetzt.

## Sichtbares Ergebnis

PC und Tablet zeigen Verbrauch für die aktuelle Sitzung, das Projekt und den
gewählten Zeitraum, aufgeschlüsselt nach Host, Backend, Provider und tatsächlich
gemeldetem Modell. Laufende Daten sind vorläufig; beim Ende kommt die verfügbare
Schlussbilanz hinzu. Neustart und Fortsetzen verlieren keine schon erfassten Werte.

- LLM: Input, Output, Cache-Lesen, gegebenenfalls Cache-Schreiben und separat
  gemeldete Reasoning-Tokens. Felder ohne Quelle bleiben unbekannt.
- ElevenLabs: Diktat/STT und Sprachausgabe/TTS getrennt; verarbeitete Audiodauer,
  Zeichen oder Credits entsprechend der jeweiligen Anbieterquelle. Keine
  künstliche Umrechnung von Audiosekunden in LLM-Tokens.
- Kosten: **gemeldeter Verbrauch**, **geschätzter Preis**, **gemeldete Abrechnung**
  und **verbleibendes Abo-/Kontingentfenster** getrennt. Ein Abo ist keine
  Einzelabrechnung jeder Sitzung zum API-Listenpreis. Unbekannt bedeutet nicht 0.
- Projekt-/Tages-/Monatsansicht, Budgetwarnungen, Datenstand und Datenabdeckung.
  Harte Limits nur dort ausweisen, wo der Transport sie tatsächlich durchsetzt.
  Ein laufender CLI-/Providerauftrag kann nach einer Warnung weiter kosten.

## Quellen zuerst nutzen

| Anbieter | Erster Integrationspfad | Abnahmegrenze |
|---|---|---|
| Codex | Strukturierte Thread-/Turn-Nutzung; dokumentiertes `thread/tokenUsage/updated`; passende lokale Laufzeitdaten bzw. Schlussbilanz nur mit eindeutiger Sitzungsbindung | Installierte CLI-Version und reale Felder prüfen; ein separater Probe-App-Server sieht nicht automatisch die Nutzung beliebiger anderer CLI-Prozesse |
| Claude Code | Strukturierte Statusline-/Laufzeitdaten und gegebenenfalls versionierter Session-Collector | `cost.total_cost_usd` ist eine Schätzung; Kontextfensterwerte sind keine kumulierte Sitzungssumme. Bestehende Statusline erhalten; Reasoning-Aufwand ist kein Reasoning-Tokenzähler |
| Grok | Dokumentiertes Usage-Objekt bzw. native strukturierte CLI-Daten; Schlussbilanzparser nur mit Versionsfixtures | xAI-API-Usage beweist nicht, dass ein normaler Grok-Build-Abo-Aufruf dieselben Felder exportiert; Lücken ausdrücklich anzeigen |
| ElevenLabs | ADE kennt die eigenen STT-/TTS-Anfragen; Provider-Response-/Usage-/Billing-Daten ergänzen und abgleichen | Modell, Produkt, Dauer/Zeichen/Credits und Tarifstand erfassen; parallele Nutzung ausserhalb ADE nicht als Verbrauch einer ADE-Sitzung verbuchen |

Offizielle Ausgangsquellen, am 15. September geöffnet:
[Codex App Server](https://learn.chatgpt.com/docs/app-server),
[Claude Code Statusline](https://code.claude.com/docs/en/statusline),
[xAI Usage und Cache-Abrechnung](https://docs.x.ai/developers/advanced-api-usage/prompt-caching/usage-and-pricing),
[ElevenLabs Billing](https://elevenlabs.io/docs/overview/administration/billing).
Das sind mögliche Integrationsquellen, noch keine ADE-Runtime-Abnahme.

Die bestehenden Managed-Run-Adapter normalisieren bereits Input/Output/Kosten
(`claudeStream.ts`, `grokStream.ts`, `RunTaskUsage`). Die interaktive CLI-Liste
enthält bisher keine verlässliche Nutzungsbilanz. `CodexAccountUsage` erfasst
Kontingentfenster und ersetzt keinen Sitzungszähler. Diese Unterschiede bleiben
auch nach dem Ausbau sichtbar.

## Zählregeln und Datenhaltung

Ein main-eigenes, begrenztes Nutzungsjournal enthält Zahlen, Einheiten, Provider-
Request-/Thread-/Turn-Identität, ADE-Sitzungsbezug, Modell, Zeit und Quellenversion.
Keine Prompts, Antworten, Audiodateien, Cookies oder Schlüssel in Kostenlogs.
Remote bekommt nur erlaubte, pfadfreie Projektionen; keine fremden Projekte.

Ein Collector darf die Sitzung nicht anhand des Ordnernamens oder der zuletzt
geänderten Logdatei erraten. Mehrere CLIs im selben Checkout, Resume/Fork,
Subagents und native/WSL-Homes brauchen einen belegbaren Identitätsvertrag.
Ein nicht eindeutig zuordenbarer Datensatz bleibt unzugeordnet.

Kumulative Zähler werden als Snapshots verarbeitet und nur einmal in Deltas
umgerechnet. Schlussbilanz, Streaming-Ereignis und erneut eingelesene Datei
dürfen denselben Verbrauch nicht mehrfach addieren. Resume braucht einen
Startstand; rückgesetzte Zähler und Modellwechsel getrennte Segmente. Cache-
und Reasoning-Felder sind je nach Provider Teilmengen anderer Zähler. Pro
Provider definieren, welche Felder disjunkt sind; kein pauschales Aufsummieren.
Kontextbelegung und geschätzte Textlänge sind kein gemessener API-Verbrauch.

Preisschätzungen halten Währung, Modell-/Tarifversion, Gültigkeitsdatum sowie
Cache-, Reasoning-, Tool- und gegebenenfalls Schnellmodusregeln fest. Historische
Werte nicht stillschweigend mit neuen Tarifen überschreiben. Abos, vorausbezahlte
Credits, zusätzliche Nutzung und API-Abrechnung getrennt halten. Abgebrochene
oder unbeantwortete Requests können trotzdem berechnet sein: unbekannter
Ausgang darf nicht als kostenloser Erfolg erscheinen.

## Reverse Proxy als gezielte Alternative

Vorgeschlagene Reihenfolge: native Nutzungsereignisse → sitzungsgebundener
Collector → unterstützter API-Gateway/Reverse-Proxy nur bei nachgewiesener Lücke.
Ein Gateway kann providerseitige Usage-Responses zentral erfassen, wenn die CLI
einen eigenen API-Endpunkt unterstützt. Er sieht nur tatsächlich durchgeleitete
Requests; reine Antwortlängen liefern keine korrekten Cache-/Reasoning-Werte.
CLI-Abo-/OAuth-Pfade sind separat zu prüfen. Deshalb keine globale Umstellung
des Benutzerverkehrs oder Änderung persönlicher Logins als Voraussetzung.

Ein optionaler ADE-Gateway benötigt explizite Sitzungskennung, erhaltenes
Streaming, Idempotenz, begrenzte Metadaten und messbar geringe Zusatzlatenz.
Kein TLS-Mitm, keine Promptprotokollierung, kein zusätzliches Provider-Modell-
Request nur zum Zählen. Die Wahl wird anhand realer CLI-Nachweise dokumentiert.

## Verbindliche Abnahme

Providerweise Golden Fixtures plus begrenzter echter Vergleich mit CLI-
Schlussbilanz bzw. Anbieter-Dashboard. Wiederholte Events, verlorene Antworten,
Resume/Fork, zwei Sessions im selben Projekt, mehrere Projekte, Modellwechsel,
native/WSL-Trennung, Offline-/Keyfehler, unbekannte Felder und Tarifwechsel prüfen.
Für ElevenLabs einen bekannten STT-/TTS-Aufruf separat mit Anbieterverbrauch
abgleichen; ein Kontostandsdelta bei konkurrierender Nutzung ist kein genauer
Einzelnachweis. UI-Tests für Filter, Budgetwarnung, schmale Tablet-Ansicht und
fehlende Daten. Vollständiges `pnpm verify`, Build und Dokumentationsabgleich
gehören zum Gesamtziel. Keine Gesamtsumme ohne sichtbare Abdeckung der Quellen.
