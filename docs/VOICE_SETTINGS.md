# Goal 33.0b — Stimme und Tempo persönlich einstellen

**Aktueller Folgestand (18. September):** Die beauftragte Umstellung auf Eleven v3
verwendet Text to Dialogue WebSocket. Dort ist nur Stabilität unterstützt; die
anderen Regler dieses historischen v2-Vertrags sind nicht mehr wirksam.
Stimmenwahl bleibt erhalten. [Aktueller Vertrag und Nachweise](ELEVEN_V3_RESULTS.md).

**Aktiviert:** Der geprüfte Release **35c3eec** mit Source-ID **71abb464e4bc9b4196cc** ist seit 16. September 2026, 14:48 CEST persönlich aktiv (PID 52412). Stimmen-Tab, Standardtempo 0.85 und passive WSL-Erkennung sind auf Desktop und ausgeliefertem Tablet-Bundle bestätigt. Profile, Projekte und Kopplung erhalten. [Aktivierung, Sicherung und Nachweise](VOICE_SETTINGS_ACTIVATION.md). Die folgenden ausstehenden Aktivierungsangaben sind historisch.

Der Operator wünscht nach der Hörprobe ein langsameres Tempo und einen eigenen
Stimmen-Tab auf PC und Tablet. Am 16. September 2026 auf die direkt von ElevenLabs
angebotenen Parameter begrenzt; kein Pitch-/Tonhöhen-Effekt.

## Bedienung und Vertrag

**Settings/Einstellungen → Stimme → Stimmen laden** zeigt Stimmenwahl und
die gemeinsamen Regler. Das neue Standardtempo ist **0.85** (vorher 0.95).
Bestehende gespeicherte Einstellungen haben Vorrang.

| Regler | Bereich | ADE-Standard |
|---|---|---|
| Tempo | 0.70–1.20 | 0.85 |
| Stabilität | 0–1 | 0.90 |
| Stimmähnlichkeit | 0–1 | 0.75 |
| Stil | 0–1 | 0 |
| Speaker Boost | aus/ein | ein |

**Stimme testen** verwendet den aktuellen Entwurf ohne ihn zu speichern.
**Parameter speichern** schreibt die Werte im persönlichen Hostprofil und macht
sie für die Computer-Begrüssung und weitere Stimmtests auf PC und Tablet wirksam.
**Änderungen verwerfen** stellt den gespeicherten Stand wieder her.
**Ruhiger Computer** lädt die obigen Werte als noch zu speichernden Entwurf.
Die bestehende Stimmenwahl wird weiterhin sofort gespeichert; Projekt-/Agent-
Stimmen behalten ihren Vorrang, ihre Ausspracheparameter folgen dem globalen Stand.
Beim Verlassen des Tabs endet die Wiedergabe; ungespeicherte Reglerwerte werden
verworfen. Pfeiltasten sowie Home/End wechseln die Tabs; native Regler bleiben
per Tastatur bedienbar. Lade-, Fehler-, Offline- und offene Aktionszustände sind
sichtbar. Die Desktop-Ansicht hält Tabwahl und Schliessen ausserhalb der Scrollfläche.

Die Werte entsprechen den [ElevenLabs-Stimmparametern](https://elevenlabs.io/docs/api-reference/voices/settings/get)
und dem dokumentierten [Tempo-Bereich](https://elevenlabs.io/docs/help-center/product/core-capabilities/text-to-speech/can-i-change-the-pace-of-the-voice).
Sie gelten pro Syntheseanfrage; keine Änderung der ElevenLabs-Kontoeinstellungen.
Die tatsächliche Stimmwirkung bleibt vom gewählten Modell und der Stimme abhängig.

## Grenzen und Speicherung

`Settings.speechTuning` ist optional, vollständig und streng begrenzt validiert.
Ältere Profile erhalten die gemeinsamen Standardwerte ohne Migration. Keine
beliebigen Providerparameter oder vom Client gelieferten TTS-Texte. Main bildet
die fünf freigegebenen Felder explizit auf `voice_settings` ab und verwendet pro
Anfrage einen separaten Snapshot. Nur der feste Stimmtest darf einen ungespeicherten
Entwurf verwenden; die Computer-Begrüssung liest immer den gespeicherten Stand.

Bestehende IPC-Verträge `speech:configure` und `speech:test` werden erweitert;
ihre Policy-Klassifizierung bleibt bestehen. Der Tabletpfad bleibt innerhalb
`AdeApplicationService.remoteSpeech`, `speech:control`, signierter Gerätebeweise,
Idempotenz und Audit. Nur das Ziel `default` darf globale Parameter speichern;
beschränkt freigegebene Geräte erhalten dadurch keine globalen Schreibrechte.
Der wiederherstellbare Browserauftrag umfasst auch den Parameterentwurf, sodass
ein verlorener Stimmtest-Beleg keinen neuen bezahlten Auftrag erzeugt. Audio
bleibt kurzlebig und an das anfragende Gerät gebunden.

## Abnahme

Fokussiert bestanden: 65 Präferenz-/Parameterverträge, 56 Sprachverträge,
21 Desktop-UI- und 36 Tablet-Browserprüfungen; drei TypeScript-Projekte und Build.
Geprüft sind Grenzen, ungültige Felder, Widerruf, Vorschau ohne Speichern,
wirksame gespeicherte Begrüssung, Tab-/Dialogfokus, schmale Ansichten und
Wiederaufnahme nach verlorenem Beleg. Provider und Audio stammen aus Fixtures.
Der Diktatdriver wartet beim Schliessen jetzt begrenzt auf die tatsächliche
Fokusrückgabe, statt diese im selben Renderwechsel sofort abzufragen.

Der vollständige Lauf `pnpm verify` vom 16. September 2026 (14:08–14:31 CEST) ist bestanden: drei TypeScript-Projekte, 72 Suiten / 3.183 Fachchecks, Produktionsbuild und sämtliche Electron-/Browser-/Layoutdriver. Sprach-UI: Desktop 21/0, Computer 18/0, Diktat 64/0, Tablet-Stimme 36/0. Geprüfter Quellstand: `93ca8ad`, Source-ID `71abb464e4bc9b4196cc`. Log und Exit-Beleg liegen unter `test-results/voice-settings-verify.log` und `test-results/voice-settings-verify-exit.json` im isolierten Checkout. Persönliche Aktivierung steht noch aus; der Status der zweiten interaktiven ADE-Sitzung ist ungeklärt.

Die vollständige Abnahme wird in `test-results/voice-settings-checkout` auf
Branch `codex/voice-settings` durchgeführt. Der zuerst im Hauptcheckout
gestartete Lauf wurde wegen paralleler Implementierung der nächsten Vorlesefunktion
unterbrochen. Diese fremden Änderungen bleiben im Hauptcheckout erhalten und
sind nicht Bestandteil dieses Lieferstands. Der separate Checkout enthält auch
die Korrektur für Tab/Shift+Tab mit dem ausgewählten Einstellungs-Tab.

Der erste isolierte Gesamtlauf fand einen bestehenden Testclient-Randfall im
OTLP-Verbrauchsempfänger: Bei der vorzeitigen HTTP-413-Antwort auf einen zu
grossen Upload meldete Undici ECONNRESET. Der Test prüft die deklarierte
Übergrösse nun vor dem Upload mit dem nativen HTTP-Client und prüft zusätzlich
den Abbruch eines tatsächlich zu grossen Chunked-Streams. Der Empfänger selbst
bleibt unverändert; alle 20 Empfängerchecks einschliesslich abschliessender
gültiger Meldung bestehen. Negativer Gesamtlauf:
`test-results/voice-settings-verify-usage-failure.log`.

Der abschliessende Lauf enthält auch die passive WSL-Erkennung aus
[der Hermes-Diagnose](HERMES_WSL_DIAGNOSIS.md). Eine erste Typprüfung des neuen
Prozess-Fixtures fand falsch typisierte schreibbare Streams; diese wurden
korrigiert und im anschliessenden vollständigen positiven Lauf geprüft.
