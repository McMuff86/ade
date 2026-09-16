# Audit: 60 Sekunden auf 5 Minuten Live-Diktat

Stand: 16. September 2026. Auftrag: die während der Tablet-Arbeit entstandenen
Änderungen prüfen und den noch nötigen Abschluss bestimmen.

**Fortsetzung:** Der folgende Bericht hält den damaligen Auditstand fest.
Der Startfristfehler ist inzwischen unter [Goal 32](LONG_DICTATION_GOALS.md)
korrigiert: Mikrofonvorbereitung vor Provideraufbau, eigene erste-Audio-Frist
und volle 300 Sekunden nach verzögertem Start. Aktuelle Abnahme und Aktivierung
stehen im Goal-Nachweis; die frühere negative Probe bleibt als Beleg erhalten.

## Gespeichert und aktiv

- Die Fünf-Minuten-Änderungen sind im Arbeitsbaum erhalten, noch nicht committed.
- Persönlich läuft weiter `dist/ollama-logo-ea14c18`, PID **49556**, sourceId
  **7bc2bd085b4f34107413**. Der ausgelieferte Desktop-Text nennt 60 Sekunden;
  der ausgelieferte AudioWorklet begrenzt weiterhin auf `16000 * 60` Samples.
  Der Tablet-Client stammt aus demselben Release. Neuladen allein aktiviert die
  Fünf-Minuten-Änderung daher noch nicht.
- Der frühere Gesamtprüflauf in `test-results/live-dictation-limit-verify.log`
  endet am Zeitpunkt des Logo-Neustarts mit `Ctrl+C` und Exit **3221225786**.
  Er ist kein vollständiger positiver Abnahmenachweis. Gespeicherte Quelltexte
  und fokussierte Testergebnisse sind vorhanden.

## Bereits implementiert

- Gemeinsame Live-Dauer **300 Sekunden**, Browser-Aufnahmetimer, Worklet-Samples,
  Hauptprozess-Audiomenge, UI-Text und UI-Zähler für Desktop und Tablet.
- **1.172 Audiopakete**, passender IPC-/Remote-Vertrag, längere Aufnahmetickets
  und eine **305-Sekunden-Verbindungsfrist**.
- Bestätigte Textabschnitte bleiben erhalten, Zwischenstände ersetzen nur den
  laufenden Abschnitt. Alle 20 Sekunden Audio wird eine Bestätigung angefordert;
  Stoppen wartet auf noch offene Bestätigungen. Weiterhin maximal 12.000 Zeichen.
- Verbrauchserfassung und Journal akzeptieren gemessene 300 Sekunden und
  erhalten den Abschluss beim erneuten Laden. Batch-Aufnahme bleibt bei 60 Sekunden.
- Die Abschnittsstrategie stimmt mit der [ElevenLabs-Dokumentation](https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/transcripts-and-commit-strategies)
  überein: mehrere bestätigte Abschnitte pro Sitzung und regelmässige manuelle
  Bestätigung. Die frühere 60-Sekunden-Grenze stammt aus ADE.

## Frisch geprüft

- Drei TypeScript-Projekte: **bestanden**.
- Produktionsbuild mit dem Arbeitsstand: **bestanden**, nicht persönlich aktiviert.
- Live-Diktat: **73 Checks**, inklusive exakt 300 Sekunden PCM, Paketgrenze,
  Textabschnitten, Fristen sowie 300-Sekunden-Verbrauch und Journal-Wiederaufnahme.
- Remote-Diktat: **47 Checks**, inklusive aller 1.172 Paketnummern, wiederholbarer
  Quittungen, Gerätebindung und entzogener Berechtigungen.
- Sprachverbrauch **36**, Verbrauchsjournal **35**, Aufnahmetickets **21 Checks**:
  bestanden.
- Electron-/Tablet-Browser: **61 Checks bestanden**, Exit 0. Gemessen wurden
  **61,152 Sekunden** Desktop- und **65,432 Sekunden** Tablet-Audio; Textübernahme,
  Verbrauch, Verbindungsverlust, Abbruch und abschliessende Wiederaufnahme positiv.
  Im ersten Lauf bestanden 60 Checks; die abschliessende positive
  Wiederaufnahme scheiterte, weil der Test alten Entwurfstext als neue Vorschau
  erkannte und vor 0,1 Sekunden stoppte. Der Test wartet jetzt auf tatsächlich
  neu angehängte Vorschau. Ein zweiter Lauf scheiterte an der Audiomengenprüfung;
  dessen genaue Zähler waren nicht gesichert. Die Fixture wartet jetzt zusätzlich
  auf gemessene Audiosekunden und sichert die Zähler. Die vollständige dritte
  Wiederholung besteht einschliesslich ihrer positiven Schlusskontrolle.
- Desktop und Tablet verwenden echtes Chromium/AudioWorklet, simulierte
  Mikrofone und kontrollierte Providerantworten. Keine neue kostenpflichtige
  ElevenLabs-Aufnahme und kein Test auf dem physischen Tablet.

Logs: `test-results/dictation-limit-audit-{live,remote,usage,types-final,build}.log`,
`test-results/dictation-limit-audit-ui.log`, `dictation-limit-audit-ui-final.log`
und die positive Wiederholung `test-results/dictation-limit-audit-ui-confirmed.log`.
Gemessene Audiozähler: `test-results/dictation/long-audio-requests.json`.
Screenshots: `test-results/dictation/{desktop,tablet}-live-over60.png`.

## Reproduzierbarer Restfehler vor Freigabe

`LiveDictationService.ts` startet die 305-Sekunden-Frist bei `session_started`.
`PromptComposer.tsx` öffnet diesen Stream vor `LiveDictationRecorder.start()`;
erst dort wird die Browser-Mikrofonfreigabe angefragt. Wartezeit für diese
Freigabe verbraucht damit die Aufnahmefrist.

Kontrollierte Probe mit echtem Servicecode und simulierter Uhr: **20 Sekunden
Wartezeit vor dem ersten Audiopaket → Abbruch nach 285 Sekunden Audio**, statt
eines ordentlichen Abschlusses nach 300 Sekunden. Ergebnis:
`test-results/dictation-limit-audit-start-delay.json`; ausführbare Probe:
`pnpm exec tsx test-results/probe-dictation-start-delay.ts`.
Das ist ein negativer Befund, kein bestandener Schutztest.

Vor Freigabe Mikrofonbereitschaft und Aufnahmefrist trennen: Die erlaubte
Aufnahmedauer soll nicht durch die Freigabe verkürzt werden; Verbindungsaufbau
und untätige Verbindungen brauchen weiterhin eigene Grenzen. Dazu einen
Regressionstest mit verzögerter Mikrofonfreigabe ergänzen.

## Noch zu tun

1. Den nachgewiesenen Startfrist-Randfall korrigieren und positiv nachprüfen.
2. `pnpm verify` auf dem abschliessenden gemeinsamen Stand vollständig ausführen.
3. Diktat-Änderungen committen, geprüften Release aktivieren und ADE neu starten.
4. Tablet-Seite aktualisieren; mit persönlichem Mikrofon eine längere Aufnahme
   samt Stoppen und vollständigem Text kontrollieren.

Dieser Audit hat die laufende persönliche ADE-Instanz nicht neu gestartet und
keine Produktionslogik geändert. Ergänzt wurden der Tablet-Dauertest,
eindeutiges Warten auf neue Sprache und gemessene Audiodauer in der Test-Fixture
sowie diese Nachweise. Die Produktionsquellen blieben während des Audits stabil.
