# Sprache, CLI-Nutzung und Tablet-Terminal

Stand: 13. September 2026. Benutzerauftrag: laufende Stimmen-/Projektverbesserungen
abschließen und einen konkreten Ausbauplan für Diktat, Nutzungsdaten,
Terminalgeschwindigkeit und einen zweiten Tailscale-PC ausarbeiten.
Historischer Ausbauplan mit Fortschrittsabgleich vom 15. September: CLI-Übersicht
und erste native Latenzoptimierung sind geprüft; Prompteditor und Diktat sind an
Desktop/Mobile integriert. Die aktuelle Abnahme steht in den
[Diktat-Nachweisen](DICTATION_IMPLEMENTATION_RESULTS.md). Kostenjournal und
Multi-Host bleiben offene Lieferziele.

Priorisierung vom 15. September: Goal 23.1 wird jetzt nach der gemeinsamen
CLI-Arbeitsübersicht am nativen Windows-Desktop umgesetzt. Der neue
[Zielplan](CLI_WORK_AND_DICTATION_GOALS.md) konkretisiert sitzungsgebundene
Entwürfe, CLI-Übergabe und Abnahme. Mobile Diktat-Unterstützung und Goal 25 zur
Tablet-Eingabelatenz sind durch den anschliessenden Operatorauftrag verbindliche
Teile des aktiven Lieferziels.
Weiterer Auftrag vom selben Tag: Goal 24 ist ebenfalls zur Implementierung
beauftragt, einschliesslich Sitzungstokens, Cache/Reasoning, Kosten und
ElevenLabs-Einheiten. Der ergänzende [führende Verbrauchsplan](USAGE_AND_COST_GOALS.md)
definiert Quellen, Zählregeln, Proxy-Alternative und Abnahme.

## Reihenfolge und Abnahmeziele

| Priorität / Ziel | Lieferbares Ergebnis | Messbare Abnahme |
|---|---|---|
| Jetzt: Bedienung | Desktop-Stimmenwahl mit weiblicher Vorauswahl und Stimmtest; Meine ADE Projekte; kompakter Tablet-Kopf | Echte Electron-Wiedergabe, gespeicherte Auswahl, signed HTTP Hinzufügen/Entfernen, Fokus/Telefon/Tablet, persönliche Aktivierung separat dokumentiert |
| Goal 24.1: Codex-Nutzung | Konto-/Sitzungsbezug, verbraucht/übrig, echte Zeitfenster und Reset | Lokale reale Kontoabfrage gegen CLI-Anzeige vergleichen; API-only, Abo, abgelaufen, offline, mehrere Profile; keine erfundenen Werte |
| Goal 25.1: Latenzmessung | Messpunkte für Eingabe bis sichtbares Echo im echten Projekt | Je 100 Zeichen und 20 Bursts, p50/p95, native Projekt-CLI, Agent-Worktree, Shell und WSL getrennt; WLAN und mobile Route getrennt |
| Goal 23.1: Diktat | Mikrofon → Transkriptentwurf → Bearbeiten → Einfügen / Senden | PC und echtes Android-Tablet; Ablehnen der Mikrofonfreigabe, Abbruch, Verbindungsabbruch, Host-/Sitzungswechsel, mehrzeiliger Text, kein doppeltes Senden |
| Goal 25.2: Schnellere Ausgabe | Engpass aus Messung beseitigt | Ziel auf direktem WLAN-Pfad: p50 ≤ 100 ms, p95 ≤ 200 ms für Zeichen-Echo; bei langsamer Route Zusatzlatenz von ADE separat ausweisen; keine Abschwächung der Identitätsprüfung |
| Goal 24.2/24.3: Claude/Grok | Gleiche Nutzungsdarstellung mit expliziten Datenquellen | Numerische Anzeigen nur mit realem Provider-Nachweis; unbekannte/fehlende Felder bleiben unbekannt |
| Goal 28a: Zweiter ADE-PC | Sichtbarer Hostwähler und getrennte Kopplung je PC | Zwei echte PCs und Tablet; Wechsel ohne Daten-/Key-/Entwurfsvermischung, offline/revoked, Rückkehr zum ersten PC |
| Goals 30 / 29 | SSH-Preset / zeitlich begrenzte Gastfreigabe | Getrennte Ausbauschritte entsprechend bestehendem Multi-Host-Plan und Zielregister |

## Goal 23: Diktieren statt Tippen

Der Mikrofonknopf sitzt am Terminal-Entwurf auf Desktop und Mobile. Ablauf:
„Diktieren“ → „Aufnahme stoppen“ → Transkribieren → Text prüfen → „In CLI einfügen“
oder separat „An CLI absenden“. Eine Aufnahme startet nie automatisch.
Die Aufnahme zeigt Dauer, Zielhost, Projekt und Sitzung; Abbruch verwirft die
Audioaufnahme. Zielwechsel stoppen die Aufnahme und verlangen eine erneute
Auswahl. Transkripte werden nicht ungefragt an einen anderen Agent gesendet.

Erster Schnitt: begrenzte Aufnahme (z. B. maximal 60 Sekunden, tatsächliche
Byte-Grenze passend zum unterstützten Codec), danach Batch-Transkription.
ElevenLabs Scribe bietet Batch und Realtime; Deutsch ist dokumentiert.
Streaming lohnt sich erst nach einem gemessenen, zuverlässigen Grundablauf.
Der persönliche Key wurde am 15. September mit einem echten, 5,98 Sekunden langen
deutschen Scribe-v2-Aufruf erfolgreich auf Speech-to-Text-Zugriff geprüft.
TTS- und STT-Berechtigungen bleiben bei anderen Keys getrennt zu prüfen.
[ElevenLabs Transcription](https://elevenlabs.io/docs/overview/capabilities/speech-to-text).

Audio geht vom HTTPS-Tablet bzw. sandboxed Desktop an den zuständigen ADE-Host;
nur main spricht mit dem Provider. Keine ElevenLabs-Schlüssel in Browser,
Renderer oder PWA-Speicher. Eigener begrenzter Upload-Vertrag statt Aufweichen
des globalen 64-KiB-JSON-Limits. Neue Remote-Aktion braucht eigene Berechtigung,
Gerätenachweis, Idempotenz, Abbruch/TTL und redigiertes Audit. Mikrofonfreigabe
in Electron nur für den vertrauenswürdigen ADE-Renderer und nach Nutzeraktion.

„Einfügen“ darf besonders in einer Shell keine eingebetteten Zeilenumbrüche
als Befehle ausführen: vorhandene Terminalsteuerung, explizites Paste-Protokoll
und Review nutzen. Erstes MVP kann ausschließlich den ADE-Entwurf füllen;
Senden bleibt der bestehende ausdrücklich betätigte Button. Entwürfe sind
an Host-/Projekt-/Sitzungsidentität gebunden. Audio nach Transkription/Abbruch
verwerfen, keine Aufnahmen in Logs oder Run-Historie. Dateien und Quellcode
werden nicht automatisch mitgesendet.

## Goal 24: Nutzungsdaten, Anmeldung und Kosten

Gemeinsame Anzeige je Host, Provider und Profil:
„Codex · Abo-Konto erkannt“, „API-Zugang beim Start vorhanden“ oder
„Anmeldung unbestätigt“. Darunter je gemeldetem Fenster: verbraucht %, übrig %,
Fensterdauer, Reset als Ortszeit und verbleibende Zeit, Quelle und Messzeitpunkt.
Fehlende Fenster nicht ergänzen. Kontextfenster, Abo-Kontingent und API-Kosten
sind verschiedene Messgrößen. Ein gestarteter Prozess oder gespeicherter Key
beweist keine bestimmte Abrechnung des laufenden CLI-Aufrufs.

### Codex

Offizielle Schnittstellen: `account/read` für Kontoart/Plan,
`account/rateLimits/read` für Limits und `account/rateLimits/updated` für Updates.
Die Daten liefern `usedPercent`, `windowDurationMins`, `resetsAt` in Unix-Sekunden
und gegebenenfalls mehrere Limit-Buckets. Quelle:
[Codex App Server](https://learn.chatgpt.com/docs/app-server).

ADE besitzt bereits den read-only App-Server-Probeprozess. Der reale Test am
13. September um ca. 23:14 Uhr lieferte 16 % verbraucht / 84 % übrig in einem
10080-Minuten-Fenster plus Reset-Zeit. Wertfreie Quelle hinsichtlich Kontoname
und Zugangsdaten: `test-results/codex-account-probe.json`. Dies ist eine Aufnahme
des lokalen Kontos, keine universelle Quote und kein Nachweis der Terminal-Anmeldung.

Die laufende Korrektur zählt nur Keys des ausgewählten Providers; außerdem
darf ein vorhandener API-Key eine unabhängige Abo-Kontoabfrage nicht mehr
unterdrücken. Als nächster Schnitt: `account/read` integrieren und Quelle an
konkretes CLI-Profil, CODEX_HOME, Backend und Host binden. Globaler Cache nur
für das tatsächlich gleiche Konto; keine native Kontoquote für WSL ausgeben.
Keine Reset-Credits verbrauchen, keine Login-/Logout-Aufrufe und keinen
Modell-Thread zur Statusabfrage starten. Kontowechsel invalidiert den Cache.

### Claude Code

Die dokumentierte Statusline erhält `rate_limits.five_hour` und `seven_day`
mit `used_percentage` und `resets_at`. Diese Daten sind für passende Abo-/Gateway-
Konfigurationen dokumentiert und erscheinen erst nach einer API-Antwort;
CLI-Version und tatsächliche Felder am lokalen System prüfen.
[Claude Statusline](https://code.claude.com/docs/en/statusline).

Plan: einen kleinen sessiongebundenen Collector in ADE-eigenem Speicher
anschließen, nur numerische Quoten projizieren. Bestehende benutzerdefinierte
Statuslines erhalten und kombinieren, keine Projektdateien überschreiben.
Ohne Daten „Noch keine Nutzungsdaten dieser Sitzung“ und `/usage` als manueller
Einstieg. Kein Scraping privater Web-Cookies als stiller Ersatz.

### Grok Build

`/usage` ist im offiziellen Changelog belegt; Verfügbarkeit unterscheidet sich
nach Kontotyp und Version. Eine stabile öffentliche maschinenlesbare Abo-
Quotenschnittstelle ist durch die hier geprüften Quellen nicht belegt.
[Grok Build Changelog](https://x.ai/build/changelog).

Plan: installierte CLI zuerst auf dokumentierten Status-/JSON- oder Protokoll-
Zugriff prüfen. Wenn nur die TUI Werte zeigt, manuell aufgerufene `/usage`-
Ausgabe als Quelle anbieten und einen Parser ausschließlich mit Versions- und
Fixture-Nachweisen freigeben. Kein automatisches Einschieben von `/usage` in
eine arbeitende CLI. API-RPS/TPM-Limits sind kein verbleibendes Abo-Guthaben.

## Goal 25: Tablet-Latenz

Fortschreibung vom 15. September: Der Projektpfad wurde inzwischen gemessen
und optimiert; direkter Topologieabgleich, bedingte Frames und kürzere
Eingabepuffer stehen im [aktuellen CLI-/Latenz-Nachweis](CLI_WORK_LATENCY_RESULTS.md).
Die folgenden Screenshotwerte und Vermutungen dokumentieren den Ausgangspunkt.

Der Screenshot meldet 668 ms „PC-Antwort“. Das ist nicht direkt die Zeit bis
zum gezeichneten Buchstaben. ADE puffert Tasten bereits nur 16 ms; die Anzeige
fragt aktuell nach Antwort/Änderung nach 40 bzw. 100 ms erneut ab.
Frühere lokale Tests lagen teils bei 70–72 ms, native TUI-Tests bei 128/248 ms;
diese Werte sind keine Abnahme des jetzigen Tablet-Projektpfads.
[Frühere Messung](TERMINAL_LATENCY_RESULTS.md).

Konkreter Verdacht aus aktuellem Code: `RemoteWorkbenchService.resolve` und
`revalidate` rufen für unabhängige Projekte wiederholt `ProjectWorkspaceService.resolve`
auf. Dessen Git-Identitätsprüfung startet mehrere Git-Prozesse. Ein Eingabe-
oder Anzeigezyklus kann diese Kette mehrfach durchlaufen. Das ist ein
zu messender Engpass, noch keine bewiesene Ursache der 668 ms.

Messpunkte: Browser-Keydown → Queue → signierter Request → Hosteingang →
Workspaceprüfung → PTY-Write → PTY-Output → Frame → Browser-Paint. Nur Zeiten,
Bytezahlen und Revisionen protokollieren, keine getippten Inhalte. Parallel
Tailscale-Route und RTT prüfen: direkte Verbindung versus Relay. Tailscale
unterscheidet diese Verbindungsarten ausdrücklich.
[Tailscale-Verbindungstypen](https://tailscale.com/docs/reference/connection-types).

Optimierung nach Messung: redundante Prozessstarts durch dieselbe überprüfbare
Identitätsdisziplin reduzieren; frische Dateisystem-/Git-Pointer-Validierung
beibehalten, kein bloßer Pfadcache. Danach revisionsbasierte Frame-Deltas und
gezielte Push-Ausgabe evaluieren. Eingabereihenfolge, exklusiver Besitzer,
Widerruf, Audit und „höchstens einmal“ bleiben nachweisbar. Kein spekulatives
lokales Echo in fremde TUIs: Es würde Cursorsteuerung, Passwortfelder und
Completion leicht falsch darstellen. Der lokale ADE-Entwurf reagiert dagegen
sofort und ist ein sinnvoller Weg für längere Texte und Diktat.

## Zweiter PC: bestehende Goals 28–30 konkretisieren

Commit `b640c3f` vom 13. September enthält bereits den
[Multi-Host-Plan](MULTI_HOST_ACCESS_PLAN.md). Er wird weiterverwendet.
Erster nutzbarer Schritt: auf beiden PCs ADE als eigener Host, jeweils private
HTTPS-Origin über Tailscale Serve, separate Kopplung/Rechte und Hostwähler.
Ausführung, Repositories und Provider-Anmeldung bleiben jeweils am Ziel-PC.
[Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve).

Goal 28a braucht zusätzlich klare UX: Hostname permanent im Kopf, Offlinezustand,
pinning der Hostinstanz, getrennte Browserpartitionen am Desktop und Navigation
zur Ziel-Origin auf dem Tablet. Kein CORS-Aufweichen, keine Übernahme fremder
Cookies, keine Vermischung von Entwürfen und Idempotenzschlüsseln. Beim Wechsel
Eingabesteuerung freigeben bzw. geordnet ablaufen lassen. Tailscale-Mitgliedschaft
allein gewährt keine ADE-Rechte. Hostwechsel ist keine automatische Verteilung
von Runs auf mehrere PCs.

Goal 30 ist ein eigener SSH-Terminalpfad für Hosts ohne vollständiges ADE:
fester Zielhost/Benutzer, Schlüssel im OS-/SSH-Agent, bekannte Hostkeys und
expliziter Umgang mit geändertem Fingerprint; Betriebssysteme getrennt prüfen.
Goal 29 folgt für Einmal-/Gastzugriff mit Ablauf, Ziel-PC-Bestätigung und Widerruf.
Für die reale Abnahme später Ziel-PC und Betriebssystem auswählen; die
Architektur- und Fixture-Arbeit kann davor erfolgen.
