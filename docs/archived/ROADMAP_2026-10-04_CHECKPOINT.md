> Archiviert am 2026-10-04. Historischer Nachweis; damalige nächste Schritte sind keine aktuellen Aufträge.
> Aktueller Einstieg: [Status](../STATUS.md), [Roadmap](../ROADMAP.md), [Handoff](../HANDOFF.md).
> Der Inhalt bleibt unverändert erhalten; relative Links wurden an den Archivort angepasst.

# ADE delivery roadmap — gelieferte Abschnitte bis 25. September 2026 (Checkpoint)

## Tablet-Stabilisierung und bestätigter Arbeitsstart

Umgesetzt: grösserer dauerhafter Aktionsspeicher, gespeicherte Projektprofile bei
CLI-Shortcuts, sichtbare Übernahmefehler und Gesprächsvorschlag mit Projektanlage
plus Erstauftrag. Direct/Observe kann mit der Auftragsbestätigung auf Koordinieren
wechseln. Details und Nachweise: [Tablet-Recovery](TABLET_RECOVERY_2026-09-25.md).
Offen bleiben die physische Tablet-Abnahme, der vollständige aktuelle `pnpm verify`
sowie ein gesonderter Aufbewahrungsvertrag für dauerhaft wachsende Belegspeicher.
10.000 Belege sind ein höheres endliches Limit; keine unbegrenzte Autonomie.

## Persönlicher Test zuerst: Projektanlage im Gespräch

Der Ablauf Agentenvorschlag → „Projekt aus Kontext anlegen“ mit PROJECT.md und
AGENTS.md ist für den sofortigen manuellen Test umgesetzt. Danach sind gezielte
Vertrags-/Browserprüfungen und `pnpm verify` offen; keine automatische weitere
Arbeitsausführung. [Details](../CONVERSATION_PROJECT_CREATION.md).

## Aktiviert: Codex-Gespräche folgen der installierten PC-Version

Projektbetreuung und Plaudern & Stimme auf PC/Tablet verwenden die installierte
stabile Codex-CLI ab 0.154.0 mit erneuter Konfigurationsprüfung je Verbindung.
0.155.1 ist mit echten Gesprächen und Tablet-/Desktop-Fortsetzung belegt.
Künftige Versionen bleiben von der Bestätigung des ADE-Vertrags abhängig.
Gesamtprüfung auf Nutzerwunsch beendet; keine neue Audio-/Samsung-Abnahme.
[Details und Nachweise](../CODEX_VERSION_COMPATIBILITY.md).

## Implementiert: Deutsch/Englisch, Gespräche und Stimmenstudio

Erweiterbare Sprachkataloge und sofortige Geräte-Sprachwahl sowie die getrennten
Bereiche Projektbetreuung und Plaudern & Stimme umgesetzt. Freie Gesprächsverläufe,
Diktat, modellabhängige Stimmregler, lokale Vorlagen und ausdrücklich ausgelöste
A/B-Hörproben sind im Build enthalten. Eine Laufzeitabnahme dieser Erweiterung ist
offen: Der Nutzer hat Tests und Typecheck ausdrücklich zurückgestellt.
Folgearbeit: weitere Sprachen nach redaktioneller Übersetzung, engere reine
Gesprächsrechte für Tablets und persönliche Hörprobe/UX-Abnahme.
[Funktions- und Schnittstellenbeschreibung](../LANGUAGES_AND_CONVERSATIONS.md).

## Zusammengeführt und aktiviert: UI Next Level

Drei Bereiche, deutsche Namen, gruppierte Graph-Aktionen, kompakter Terminalkopf
und Verbindungsdialog mit den echten Aufgaben-/Notizen-Seiten verbunden. Gemeinsamer
Build am 19. September um **23:28 CEST** aktiviert, Kopplungen erhalten.
Keine Merge-Tests auf Nutzerwunsch. [Nachweise und Folgearbeit](../UI_UX_NEXT_LEVEL.md).

## Implementiert: persönliche Tasks, Notes und Button-Gruppen

Gemeinsame Desktop-/Tablet-Seiten mit Offline-Erfassung, Konfliktkopien, Diktat,
Foto/Skizze, Export, Erinnerung und ausdrücklicher Agentenübergabe implementiert.
Navigation und Graph-Aktionen gruppiert. Fokussierte Store-/Cache-, Browser- und
native Windows-Electron-Prüfungen bestanden; noch keine repositoryweite Abnahme.
Der Nutzer hat um 22:24 CEST einen Zwischenbuild aktiviert und den grossen
Testlauf ausdrücklich zurückgestellt. Zum Abschluss wurden auch weitere
Einzelprüfungen ausdrücklich abbestellt; Build, Aktivierung und Git-Abschluss
erfolgen mit diesem dokumentierten Prüfvorbehalt. [Vertrag und Nachweise](../TASKS_NOTES.md).

## Abgenommen: mehr Terminalfläche auf dem Tablet

Projektbereich einklappen, Aktualisierung und Branches kompakt anordnen.
Tastaturbedienung, Fokus, Wiederaufnahme und responsive Darstellung abgenommen;
vollständiges `pnpm verify` am **19. September, 14:28 CEST** bestanden. Um
**21:31 CEST** persönlich aktiviert; aktuelles Mobile-Bundle über private HTTPS
bestätigt, bestehende Kopplungen und persönliche Konfiguration erhalten.
[Umfang und Prüfstand](../TABLET_PROJECT_LAYOUT.md).

## Abgeschlossen: Pairing wiederherstellen und Tablet-Änderungen abschliessen

Volles Zugriffsprotokoll unter Erhalt der Geräte und Idempotenzbarrieren
archiviert; QR-/Code-Kopplung wiederhergestellt. Links/Bilder und aufgeteilte
Browser-Builds abgenommen, persönliche Instanz mit erhaltenem Profil aktiviert.
Vollständiges `pnpm verify` am **19. September, 11:15 CEST** bestanden.
Projekt-/Linkzugriff vom physischen Tablet vom Nutzer bestätigt; die separate
Netzwechsel-Rückmeldung steht noch aus.
[Bedienung und Nachweise](../MOBILE_PAIRING_RECOVERY.md).

## Abgeschlossen: Links und Screenshots im Tablet-Terminal

Links direkt antippen oder über die Linkliste öffnen/kopieren; Screenshots aus
Galerie oder Zwischenablage mit Vorschau und Nachricht in die laufende Codex-Sitzung
übergeben. Vollständiges `pnpm verify`, Build und ausdrücklich beauftragter
ADE-Neustart mit erhaltenen Tablet-Kopplungen am 19. September abgeschlossen.
[Vertrag und Nachweise](../TERMINAL_MEDIA.md).

## Abgeschlossene Stabilisierung: nativer Tablet-Auftrag

Den bisherigen getrennten Codex-/Oberflächennachweis um einen durchgängigen
nativen Driver ergänzen. Der Test fand Profil-/Memory-Injektion in Projektdateien
beim Einzelauftragsstart. Korrigiert über direkten Kontext; Electron-Negativkontrolle
**55/2**, positive Kontrolle **57/0**, native Wiederholung **16/0** inklusive
Verbindungswechsel und Host-Neustart. Vollständiges `pnpm verify` bestanden;
am 18. September um **04:15 CEST** aktiviert, Source `5cf7ef2ca9b2b4a1ad54`.
Der physische Samsung-Alltag und die Hörabnahme bleiben die nächsten Schritte.
[Nachweise](TABLET_CODEX_NATIVE_RESULTS.md).

## Aktueller Zusatzauftrag: Eleven v3 und Aussprache

Standardstimme Sarah mit Eleven v3 über Text to Dialogue WebSocket; kurzes A in
Adi. Vollständiges `pnpm verify` bestanden und am 18. September um **03:25 CEST**
aktiviert, Source `5f58bdaefddb8640de7b`. Zusätzlich sind verlorene Terminalaktionen
bei gleichzeitigen Heartbeats behoben. Echte produktive Sarah-Probe bestätigt;
physische Tablet- und Hörabnahme bleiben die nächsten Schritte.
[Vertrag und Nachweise](ELEVEN_V3_RESULTS.md).

## Anschlussblock: Wiederaufnahme und Orientierung (18. September 2026)

Explizit beauftragt nach dem aktivierten Shell-Build: sichtbare Wiederaufnahme
im Tastaturmodus, Eingabepause bei veralteter Anzeige, keine automatische
Besitzübernahme oder Wiederholung, erreichbare Workspace-Info und exakter
Stammordner am PC. Fokussiert **29/0**, vollständiges `pnpm verify` bestanden,
persönlich aktiviert am 18. September um 01:54 CEST.
[Nachweise und Aktivierung](TABLET_RECOVERY_RESULTS.md). Danach bleibt der
physische Samsung-Alltagsdurchlauf die wichtigste noch offene Abnahme.

## Aktuell: Rückmeldung aus dem physischen Tablet-Test

Cursor-/Textprojektion der Shell korrigieren und die letzten fünf Commits direkt
in der PC-/Tablet-Git-Ansicht einblendbar machen. Nach Abnahme den persönlichen
Build mit ausdrücklicher Neustartfreigabe ersetzen — **abgenommen und am
18. September um 00:17 CEST aktiviert**. Der physische Samsung-Test
der Korrektur bleibt separat; Chromium-IME-Automation ersetzt ihn nicht.
[Nachweise und Betriebsstand](TABLET_SHELL_RESULTS.md).
Die vorgeschlagene Reihenfolge danach: physischer Tablet-Alltag, vollständiger
Codex-Auftrag samt Wiederanlauf, bessere Workspace-/Sitzungsorientierung und
einfachere Updates. [Konkrete Abnahmekriterien](../TABLET_STABILITY_NEXT.md).

## Aktueller Lieferabschnitt: zuerst Codex auf dem Tablet

Adi hat am 17. September die Wiederaufnahme und zuerst den Codex-Ablauf beauftragt.
Übergaben, ausdrücklich bestätigte Projektaufträge, Rückfragen/Ergebnisse und
dauerhafte Graph-Zuordnung sind implementiert; Gesprächsbedienung **55/0**,
native Codex-Probe **11/0**. Finale Gesamtabnahme **Exit 0**, drei TypeScript-Projekte,
89 Suiten / 3.652 Prüfungen und alle Bedien-/Visualdriver. Persönlicher Testbuild
seit 22:20 CEST aktiviert, einschliesslich isoliertem Testprojekt und geprüftem
privatem HTTPS-Zugang ([Lieferplan](../TABLET_CODEX_GOAL.md)). Danach physische Tablet-Abnahme
mit [diesem Ablauf](../TABLET_CODEX_TEST.md). Claude/Grok, automatische weitere
Projektarbeit, native Unteragentenbeziehungen und Sprachausgabe bleiben eigene
Lieferabschnitte. Die übergeordneten Goals 26/27/33 sind damit nicht vollständig
abgeschlossen. Die folgende ursprüngliche Pilotliste beschreibt deren Restumfang.

## Nächster Pilot: ein ADE-Agent, drei Projekte (17. September 2026)

[Vorbereitete Goals und Abnahmen](../MAIN_AGENT_GOALS.md), auf Basis des
[aktuellen Audits](../MAIN_AGENT_BASELINE.md). [Umsetzung und Einzelprüfungen](../MAIN_AGENT_IMPLEMENTATION.md)
laufen: Sitzungswechsel, native Codex-Fortsetzung, Betreuungsplan und explizite
Graph-Verbindungen sind vorhanden. Explizite Abendübergaben/Morgenüberblick sind
angebunden; ein erster Modelldialog auf PC/Tablet mit dauerhaftem Verlauf und lesenden
Projektwerkzeugen ist verdrahtet. Terminalunabhängiges Gesprächsdiktat ist
angebunden; steuernde Aktionen, Sprachausgabe und Aktivierung bleiben offen.
Offene Lieferverträge:

1. **26.6:** Fähigkeiten und Identität je CLI/Sitzungstyp nachweisen;
   vorhandene Testlücken schliessen.
2. **27.3:** Projekt-/Sitzungswechsel auf PC und Tablet durchgängig prüfen und
   vereinfachen, mit stabilen Entwürfen, Eingabebesitz und ohne Doppelstarts.
3. **26.2–26.4:** dauerhafte Zuständigkeit, getrennte parallele Projektarbeit,
   eigenständiges Brainstorming sowie Rückfragen und Ergebnisse verbinden.
4. **26.7/26.8:** gemeinsame Graph-Beziehungen und direkte Übernahme durch den
   Benutzer; Betreuung pro Projekt optional.
5. **33.1/33.2:** Abendübergabe, Morgenüberblick und globaler Text-/Sprachdialog
   ohne Terminalvoraussetzung; **33.3** ergänzt natürliche Unterbrechung.
6. Durchgängigen nativen Codex-/Grok-/Claude-Pilot, vollständiges `pnpm verify`
   und physischen Tablet-Test abnehmen. Andere Backends separat belegen.

Die bestehenden Goal-Nummern werden fortgeführt. Die automatische
Agentenkoordination ist noch nicht geliefert; kein Gesamtgoal abgeschlossen.

## Antwort anhören aktiviert (16. September 2026)

Der Release **e9e032d** mit Source-ID **e876a22034d56525fe7b** ist seit
17:36 CEST persönlich aktiv. **Antwort anhören** ist auf PC und
Tablet verfügbar; auf dem Tablet steht der Button neben **Prompt / Diktat**.
Text prüfen/bearbeiten, dann ausdrücklich **Anhören**; Stoppen und Wiederholung
verwenden den bestehenden Sprachdialog und die gespeicherten Stimmparameter.

Alle Prüfungen des `pnpm verify`-Rezepts (17:08–17:33 CEST) sind bestanden:
drei TypeScript-Projekte, 74 Suiten / 3.232 Fachprüfungen, Produktionsbuild und
sämtliche Electron-/Browser-/Layoutdriver. Nach einem Windows-Aufruffehler wurden
die letzten sieben Driver einzeln auf unverändertem Code und Build ausgeführt;
`pnpm verify` selbst hat Exit 1. Der Vorlesedriver besteht 34 Prüfungen.
6 Profile, 5 Projekte und 1 Gerätekopplung(en) sind erhalten;
das private HTTPS-Tablet liefert das aktuelle Bundle.
[Aktivierung und Nachweise](REPLY_SPEECH_ACTIVATION.md) · [Bedienung und Verträge](../REPLY_SPEECH.md).

Der globale Button **Sprachsteuerung** bleibt ein
[Vorschlag für den nächsten Ausbau](../VOICE_COMPANION_PROPOSAL.md).
Die folgenden Aktivierungsangaben beschreiben frühere Releases.

## Stimmen-Tab und WSL-Fix aktiviert (16. September 2026)

Der geprüfte Release **35c3eec** mit Source-ID **71abb464e4bc9b4196cc** ist seit 16. September 2026, 14:48 CEST persönlich aktiv (PID 52412). Stimmen-Tab, Standardtempo 0.85 und passive WSL-Erkennung sind auf Desktop und ausgeliefertem Tablet-Bundle bestätigt. Profile, Projekte und Kopplung erhalten. [Aktivierung, Sicherung und Nachweise](VOICE_SETTINGS_ACTIVATION.md). Die folgenden ausstehenden Aktivierungsangaben sind historisch.

## Stimmen-Tab und WSL-Fix vollständig geprüft (16. September 2026)

Der vollständige Lauf `pnpm verify` vom 16. September 2026 (14:08–14:31 CEST) ist bestanden: drei TypeScript-Projekte, 72 Suiten / 3.183 Fachchecks, Produktionsbuild und sämtliche Electron-/Browser-/Layoutdriver. Sprach-UI: Desktop 21/0, Computer 18/0, Diktat 64/0, Tablet-Stimme 36/0. Geprüfter Quellstand: `93ca8ad`, Source-ID `71abb464e4bc9b4196cc`. Log und Exit-Beleg liegen unter `test-results/voice-settings-verify.log` und `test-results/voice-settings-verify-exit.json` im isolierten Checkout. Persönliche Aktivierung steht noch aus; der Status der zweiten interaktiven ADE-Sitzung ist ungeklärt.

[Stimmparameter](../VOICE_SETTINGS.md) · [Hermes-Diagnose](HERMES_WSL_DIAGNOSIS.md).

## Passive WSL discovery / Hermes (16 September 2026)

WSL discovery hotfix: passive enumeration implemented and regression checked; full verification and personal activation pending. Persistent availability of personal WSL services remains an operator concern. [Diagnose und Nachweise](HERMES_WSL_DIAGNOSIS.md).

## Goal 33.0b — Stimmen-Tab

Native ElevenLabs-Regler, Vorschau und gemeinsame Speicherung auf PC/Tablet
implementiert; langsamerer Standard 0.85. Fokussiert geprüft, Gesamtabnahme und
persönliche Aktivierung folgen. [Vertrag](../VOICE_SETTINGS.md).

## Live-Diktat bis 5 Minuten

Eigene Zeit-, Sample-, Paket- und Ticketgrenzen für PC und Tablet angehoben;
mehrere bestätigte Textabschnitte mit vollständigem Stop-Abschluss implementiert.
Startfrist-Randfall korrigiert und mit 79 Live-Vertragschecks geprüft.
Computer-Hotfix **06cd6ea** mit langem Diktat aktiviert; Gesamtabnahme unter [Goal 32](../LONG_DICTATION_GOALS.md) bestanden.

## Goal 33 — Erster Computer-Test, danach Sprachdialog

33.0 implementiert „Computer testen“ auf PC und Tablet: explizit aktivieren,
Computer sagen, persönliche Begrüssung mit Standardstimme hören. Als geprüfte
Vorschau aktiviert; die Gesamtabnahme des ersten Computer-Tests ist bestanden.
Die auf Operatorwunsch ruhigere Computerstimme ist implementiert und fokussiert
geprüft, eine echte Hörprobe liegt vor. Der Gesamtlauf stoppt beim Tablet-Fokus
nach Diktatdialogschluss; persönliche Klangbeurteilung und Aktivierung stehen aus.
Danach persönliche Begrüssung und belegter Arbeitsrückblick, begrenzte
Bedienabsichten und schliesslich Unterbrechen/Gerätewechsel. Gemeinsamer
Dialog auf PC und Tablet; [Vorschlag und Abnahmekriterien](../VOICE_COMPANION_PROPOSAL.md).
Stand 27. September 2026: kurze Begrüssung mit Host-Speicher und automatisches
Zurückholen der Tablet-Eingabe beim Sitzungswechsel sind implementiert und
geprüft; die Aktivierung und Adis Tablet-Urteil stehen aus
([§10](../VOICE_SEAMLESS_UX_PROPOSAL.md)).

## Ollama-Profillogo abgeschlossen

Das offizielle SVG ergänzt das Desktop-/Tablet-Logosystem. Profilprüfungen und
vollständiges `pnpm verify` bestanden; Codecommit **ea14c18** gebaut und auf dem
persönlichen Windows-Host aktiviert. [Nachweise](OLLAMA_LOGO_RESULTS.md).

## Abgeschlossenes Goal 31 — Ollama-Coding-Harness wählen

**31.1** ergänzt die Auswahl Codex CLI/Qwen Code und persistierte Profile;
**31.2** liefert Start-, Berechtigungs-, Profil- und Ergebnisverträge;
**31.3** umfasst reale PC-/Tablet-/Modellproben, Gesamtprüfung und Aktivierung.
Beide Auswahlpfade und Qwen3-Coder-Dateibearbeitung sind fokussiert positiv
geprüft. `pnpm verify` besteht vollständig mit 72 Suiten / 3.088 Fachchecks,
Build und allen App-/Browser-/Visualprüfungen. Codecommit **3b0bddd**, finaler
Build und persönlicher Neustart sind abgeschlossen: ADE PID **15628**, alle
Profile, Projekte und die Gerätekopplung erhalten; Tablet-Seite HTTP 200.
[Detaillierter Liefervertrag](../OLLAMA_HARNESS_GOALS.md). Andere Goals bleiben
unverändert; Goal 6 bleibt ausschliesslich native Codex-Validierung.

## Vorherige Lieferung

Aktuelle Operatorrückmeldung: neuer Build funktioniert. Live-Diktat wird auch
auf dem Tablet gebraucht; Codex, Claude Code und Grok erhalten scharfe
Profilbilder. Tablet-Live-Anbindung und gebündelte Vektorlogos sind implementiert
und mit 57 durchgehenden Diktatchecks geprüft; `pnpm verify` besteht vollständig.
Codecommit **441f0ce**, finaler Build und persönlicher Neustart sind abgeschlossen.
Profile, Projekte und Gerätekopplung sind erhalten; Tablet-Seite mit HTTP 200
erreichbar. Persönlicher Tablet-Mikrofontest bleibt offen.
[Stand und Nachweise](LIVE_DICTATION_RESULTS.md).

Neue Operatorrückmeldung: Diktat funktioniert wie gewünscht; Arbeit mit Ollama-
Anbindung und sichtbaren verfügbaren Modellen fortsetzen. Ollama-Coding über die
Codex CLI und direkter Modellchat sind implementiert und fokussiert geprüft.
Gesamtprüfung in zwei Teilläufen bestanden; persönliche Aktivierung nach
Neustartfreigabe abgeschlossen: Ollama-Profil mit `qwen3-coder:30b` und 13 sichtbaren
Modellen. Sicherung und Betriebszustand stehen im [Handoff](../HANDOFF.md).
Interaktive Ollama-Verbrauchserfassung bleibt offen; bisherige native
Codex-/Claude-/Grok-Erfassung verwendet CLI-Quellen, keinen Reverse Proxy.
[Ollama-Nachweise](OLLAMA_RESULTS.md). Andere offene Ziele bleiben offen.

## Aktives Ziel: laufende CLI-Arbeit und Diktat (15. September 2026)

Operator bestätigt die neue Ordnung der vier Originalprojekte und beauftragt
die nächsten Goals: **Goal 27** führt interaktive CLI-Sitzungen in Work/Overview
zusammen; **Goal 23.1 Desktop** ergänzt einen sitzungsgebundenen Promptentwurf
und ElevenLabs-Diktat mit gezielter CLI-Übergabe. Reihenfolge: Arbeitsliste,
Orientierung/Wechsel, Textentwurf, Diktat, vollständige Abnahme und Windows-Build.
Desktop-Arbeitsliste, erste native Latenzoptimierung und Diktat bestehen die
vollständige Code-Abnahme mit 3.735 Checks; Windows-Paket mit zehn weiteren
Checks geprüft. Reale ElevenLabs-/Codex-/Claude-/Grok-Proben sind erfolgreich.
Der frühere CLI-Checkpoint `b2e134e`/`5ea3b3c` ist gepusht; persönliche Aktivierung
der neuen Lieferung wegen offener WSL-Sitzung ausstehend. Auch Diktatcommit
`128b503` ist inzwischen gepusht. Die anschliessende erste Projektansicht und der
mobile Prompt-Projektname sind fokussiert geprüft. Das native Verbrauchsjournal
ist mit neuen CLI-Starts und der PC-/Tablet-Sitzungsanzeige verbunden und besteht
130 native Vertragschecks. ElevenLabs-STT-/TTS-Versuche sind mit weiteren 36
Vertragschecks angebunden, samt sitzungsbezogenen Audiosekunden und getrennten
Antwortzuständen. Die neue Gesamtabnahme und der weitere Goal-24-Ausbau laufen noch.
[CLI-Nachweise](CLI_WORK_LATENCY_RESULTS.md), [Diktat-Nachweise](DICTATION_IMPLEMENTATION_RESULTS.md).
Erweiterung: Goal 23.1 umfasst auch mobiles Tablet-Diktat; Goal 25 zur Messung
und Optimierung der Tablet-Terminal-Latenz ist ebenfalls aktiver Lieferumfang.
Die Desktop-Lieferung allein erfüllt diesen erweiterten Auftrag nicht.
Weiterer Auftrag: **Goal 24** um die implementierbare Verbrauchs-/Kostenbilanz
für Codex, Claude Code, Grok und ElevenLabs erweitern. Zähler, Quelle und
Abrechnung unterscheiden; [führender Plan](../USAGE_AND_COST_GOALS.md).
Zusätzlich beauftragt: vollständiger Dokumentationsabgleich gegen Code,
Abnahmen und Zielstruktur; dieser ist Teil der abschliessenden Lieferung.
[Umfang, Abnahmekriterien und weitere priorisierte Verbesserungen](../CLI_WORK_AND_DICTATION_GOALS.md).

Die folgenden Liefernotizen sind datierte Meilensteine. Frühere Pendenzen und
Prozess-IDs beschreiben den jeweiligen damaligen Stand; aktueller Betrieb steht
in [HANDOFF](../HANDOFF.md), eindeutige Zielnummern im [Zielregister](../GOAL_REGISTRY.md).

## CLI direkt im Workspace und Terminal-Bedienung

Workspace-Auswahl ohne Agent-Zuweisung, direkte Codex-/Claude-/Shell-Aktionen,
optionale Profile und Desktop-Terminalwerkzeuge sind implementiert.
Die vollständige UI-/Gesamtabnahme ist bestanden und in
[Workspace-Terminals](WORKSPACE_TERMINALS_RESULTS.md) dokumentiert.

## Desktop/Tablet-Bedienung angleichen

Work wird auch am PC als eigener Reiter mit derselben Filterauswahl angeboten.
Profile können über die normalen PC-Agent-Einstellungen bearbeitet werden,
einschließlich Anweisungen, Markdown-Kopien und Stimme. Umsetzung und neue
Electron-Prüfungen sind abgeschlossen; `pnpm verify` ist vollständig grün.
Abnahme und persönliche Aktivierung um 06:49 Uhr sind in
`WORK_PARITY_RESULTS.md` dokumentiert. Die übrigen Sprach-, Quoten- und
Mehr-PC-Meilensteine bleiben separat geplant.

## Sprache, Projektauswahl und Terminal-Bedienung

### Bisheriger Meilenstein: mobile Stimme und wirksame Agent-Profile

Benutzerauftrag vom 13. September, 23:57 Uhr: nach der aktuellen Abnahme
weiterarbeiten und Aktivierungen zu spürbaren Verbesserungen bündeln.
Keine Neustarts im 5–10-Minuten-Takt; Commit/Push, Build und persönlicher
Neustart erfolgen pro sinnvollem Meilenstein.

- **Goal 23.0a:** globale Stimmenwahl und fester Stimmtest auf dem Tablet;
  Provider-Key bleibt am PC, eigene begrenzte Remote-Berechtigung. Implementiert,
  fokussiert geprüft, persönlich seit 14. September 00:54 Uhr aktiviert;
  vollständige Prüfkette in zwei Teilläufen bestanden (Details in HANDOFF).
- **Goal 23.0b:** optionale Stimmen pro Agent und Projekt. Auflösung:
  explizite Agent-Stimme → Projekt-Stimme → ADE-Standard; bei einer normalen
  CLI ohne Agent-Profil gilt Projekt → Standard. „Erben“ ist ausdrücklich
  auswählbar; die Oberfläche zeigt die wirksame Stimme und ihre Herkunft.
  Implementiert und geprüft; mobile Standard-, Agent- und Projektwahl sowie
  Zurücksetzen und Vererbung bestehen die Browser- und Domain-Abnahme.
- **Goal 26.1a:** Agent-Profil mit Spezialisierung, konkreten Arbeitsanweisungen
  und zuweisbaren Markdown-Dateien. Bestehende Repository-Anweisungen bleiben
  wirksam; Identitätsanweisungen liegen außerhalb geleaster Repositories.
  Editor und native Transportanbindung implementiert, geprüft und seit
  14. September 02:41 Uhr persönlich aktiviert (`661b41a`).
  Echte einmalige Codex-/Claude-Proben bestätigen Profilmarker in `exec`/`-p`;
  interaktiver ADE-Lifecycle wird separat geprüft.
- **Goal 26.1b:** Kontextansicht zeigt Herkunft, Reihenfolge, Version/Digest
  und tatsächlich beim Start verwendete Anweisungen. Profiländerungen gelten
  für neue Sitzungen; laufende Sitzungen erhalten einen Versionshinweis.
  Start-Digest/Quellen, expliziter Vergleich und eingefrorener Sitzungstext sind
  angebunden; 39 Electron-Prüfungen bestanden. Gesamtabnahme vollständig grün.
- **Goal 26.1c:** Profil vom Agenten und Projekt aus bearbeiten/auswählen;
  spezialisierter Agent oder normale Codex-/Claude-CLI bleibt eine bewusste
  Auswahl. Eine Rollenbeschreibung ist keine zusätzliche Systemberechtigung.
  Native Windows-Codex-/Claude-Profile geliefert; weitere Runtime-Transporte
  benötigen eigene Nachweise. Projektübergreifende Main-Chef-Delegation bleibt
  Goal 26.2 ff. gemäß Koordinationsplan.

Abnahme: Desktop und Tablet, Vererbung/Zurücksetzen/Neuladen, fehlende Stimmen,
widerrufene und eingeschränkte Geräte, bestehende Sitzungen, tatsächlicher
CLI-Kontext sowie unveränderte Projekt-AGENTS.md und Agentbindungen.

Desktop-Stimmenwahl/Stimmtest, Meine ADE Projekte und einklappbare mobile
Terminal-Bedienung werden im aktuellen Arbeitsstand umgesetzt und geprüft.
Erweiterungen: **Goal 23 Diktat**, **Goal 24 belastbare CLI-Nutzungsdaten**,
**Goal 25 gemessene Tablet-Latenz**. Reihenfolge, Quellen und messbare
Abnahmekriterien stehen im [Ausbauplan](../VOICE_USAGE_TERMINAL_PLAN.md).
Der bestehende [Multi-Host-Plan mit Goals 28–30](../MULTI_HOST_ACCESS_PLAN.md)
bleibt Grundlage für einen zweiten Tailscale-PC; konkrete erste Abnahme ist
Hostwechsel zwischen zwei getrennt gekoppelten ADE-Hosts.
Diese Ausbauziele sind geplant, keine Freigabe bereits unterstützter Funktionen.

**Goal 26 Main Chef** ergänzt zuweisbare, versionierte Markdown-Anweisungen,
Projektverantwortliche und einen Koordinationsauftrag über getrennte Runs je
Repository. Der vom Benutzer angeforderte Sub-Agent hat dazu den
[Main-Chef-Plan](../MAIN_CHEF_COORDINATION_PLAN.md) erstellt. Erste Lieferung:
Anweisungen zuweisen und wirksamen Kontext vor dem Start anzeigen; danach
namensbasierte Projektauswahl und begrenzte Delegation.

## Tablet-Bedienung und einzelne Projekte

PC-Import einzelner Projekte, gespeicherte Tablet-Seitenbreiten und korrigierte
PWA-Startnavigation sind implementiert. Chromium-Prüfungen decken externe
Navigation und Wiederanmeldung mit Geräteschlüssel ab. Der reale Android-PWA-
Launcher bleibt eine Geräteabnahme. [Details](TABLET_POLISH_RESULTS.md).

## Mobile Commit-Details

Commit-Metadaten, Dateistatistik und historische Datei-Diffs sind umgesetzt und
auf Tablet-/Smartphone-Größen mit Chromium geprüft. Persönliche Aktivierung
erfolgte am 13. September um 21:17 Uhr. Gesamtabnahme bleibt durch den bereits
bekannten Codex-Quota-Fixture-Timeout offen; Commit-Prüfungen bestehen.
[Nachweise](../MOBILE_COMMIT_DETAILS.md).

## Linke Navigation anordnen

Sichtbarer Desktop-Modus für Projekt-, Obergruppen- und Agent-Reihenfolge
implementiert und im echten Windows-Electron geprüft (zwölf Anordnen-Checks).
Gesamtabnahme bleibt durch den Codex-Quota-Fixture-Timeout offen. Persönliche
Aktivierung samt Anordnung und fehlenden Profilbildern erfolgte am 13. September,
20:53 Uhr, auf ausdrücklichen Benutzerauftrag.
[Nachweise](RAIL_ORDERING_RESULTS.md).

## Historischer Zwischenstand: Terminal, Aboanzeige und Git-Bedienung (13. September)

Vom Benutzer angeforderter Zwischencommit für den PC-Abgleich. Native Codex-
Quotaabfrage und Bedienhilfen sind implementiert; Gesamtprüfung, Latenzmessung
und persönliche Aktivierung stehen aus. Claude/Grok bieten den CLI-Einstieg.
[Fortsetzung](../WORKSPACE_IMPROVEMENTS.md).

## Terminalverlauf (13. September 2026)

Direkter mobiler Verlauf und ruhige Leseposition sind implementiert und fokussiert
geprüft. Vollständige Abnahme und Aktivierung der persönlichen Instanz stehen noch
aus. [Nachweise und Grenzen](TERMINAL_SCROLL_RESULTS.md).


## Abgeschlossen: Terminals, Übernahme und Obergruppen (13. September 2026)

Freie Terminals, CLI-Auswahl, Projektbrowser und geprüfte Workspace-Zuweisung
sind auf Desktop/Mobile umgesetzt. Dazu kommen die geprüfte Übernahme älterer
Änderungen, optionale Agent-Obergruppen und das Löschen abgeschlossener Runs auf
Mobile. Vollständiges `pnpm verify`: **3.018 Checks bestanden** — 48 fokussierte
Suiten mit 2.329 Checks und 689 reale Electron-/Browser-Prüfungen, einschliesslich
22 visueller Vergleiche. Alle drei TypeScript-Projekte und Produktionsbuild bestehen.
RhinoLayoutTools enthält die in Rhino 8/9 geprüfte FastenerPlace-Palette auf
`main`, nach `origin/main` gepusht als `5c4b820`.
ADE-Code ist als `bab7df7` nach `origin/main` gepusht. Seit 12:48 Uhr
Europe/Zurich läuft genau eine geprüfte ADE-Instanz (PID **53592**); die bisherige
Instanz 35068 ist beendet. Hermes Agent, OpenClaw und GrokBuild liegen unter
**Agent-Systeme**. Sechs Agenten, fünf Projekte und die Gerätekopplung sind erhalten.
Private Mobile-HTTPS-Auslieferung stimmt per SHA-256 mit dem geprüften Build
überein. Mobile einmal neu laden. Dieser Betrieb ersetzt die älteren Einträge unten.
[Übernahme-Vertrag](../WORKSPACE_INTEGRATION.md) · [Teilziele und Evidenz](../INTEGRATION_NAVIGATION_GOALS.md).

## Projekte durchsuchen und Workspace-Zuweisung (12. September 2026)

Mobiler Projektbrowser mit Vorschau und bestätigter Workspace-Zuweisung ist
implementiert und unter Windows mit **2.880 Checks** vollständig abgenommen.
Genau eine persönliche ADE-Instanz wurde mit dem geprüften Stand neu gestartet.
[Workspace assignment](../WORKSPACE_ASSIGNMENT.md).

## Freie Terminals und Mobile-Terminalansicht (12. September 2026)

Aktuelle Ergänzung: direkte native Home-Terminals ohne Agent/Projekt und ein
eigener Mobile-Reiter mit Agent-/Sitzungsnavigation, CLI-Auswahl und Darstellung.
Native Windows-Abnahme mit **2.828 Checks** und Start genau einer geprüften
ADE-Instanz abgeschlossen. Siehe [Terminal workspace](../TERMINAL_WORKSPACE.md).

## Tablet-Arbeitsplatz: Windows-Abnahme und Neustart (12. September 2026)

Freigaben, Startwiederholung, native Codex-Rückfragen mit Live-Aktivität sowie
haltbare Ergebnisdateien und Ergebnisseiten sind implementiert. Vollständiges
`pnpm verify`: 2.770 Prüfungen bestanden, zusätzlich 5 reale Codex-Prüfungen.
Die geprüfte ADE-Kopie läuft mit dem persönlichen Profil; private HTTPS-Adresse,
bestehende Samsung-Kopplung, fünf Projekte und sechs Agentenprofile sind geprüft.
Physisches Samsung/DeX und das nicht antwortende Ubuntu bleiben offen.
[Teilziele](../TABLET_WORKSPACE_GOALS.md), [Abnahme und Operatorzustand](TABLET_WORKSPACE_RESULTS.md).
Die darunter genannten älteren Gesamtprüfungen gelten für ihre damaligen Stände.

Status: 2026-09-11. [Capabilities](../STATUS.md), [project workflow tasks](../PROJECT_WORKFLOW_GOALS.md)
and [current product review](../research/ADE_PRODUCT_REVIEW_2026-09-10.md) have distinct roles.
Intermediate delivery notes are preserved in the [checkpoint archive](ROADMAP_2026-09-10_CHECKPOINT.md).

## Delivered baseline from September 11

September 11 follow-up S0–S3 is delivered: guided desktop setup, explicit grant
presets and Mobile orientation/build identity. Full pnpm verify passed with
2,651 checks, including 26 focused and 37 real setup-flow checks. The verified
ADE release has restarted with pairing/Serve preserved. Evidence and task commits:
[ONBOARDING_GOALS](../ONBOARDING_GOALS.md). The September 10 project workflow remains
the earlier baseline below.

Project root → checkout/branch → optional-profile CLI → Git commit/merge/push/PR
is implemented for native Windows. T7 adds observed run-file changes and downloads
from Graph and project Results. T6 completed the guide, documentation audit and
full `pnpm verify` with 2,588 passing checks. Task commits form one final delivery;
the operator build and publication are recorded in HANDOFF. The extra WSL
lifecycle recheck remains blocked at a read-only readiness probe.

## Delivered follow-up: live run activity and questions

The September 11 follow-up delivered sequenced activity, native Codex questions
on desktop/mobile, result-file storage and retained-history pagination. Its
later full Windows verification and personal-host activation are recorded in
[TABLET_WORKSPACE_RESULTS](TABLET_WORKSPACE_RESULTS.md). The earlier listener
collision and pending restart are historical observations, not current blockers.
Separate WSL lifecycle evidence must not be inferred from native Windows tests;
the subsequently checked Sentinel/Hermes entry points are recorded in HANDOFF.

## Conversation project follow-up, 2026-09-25

Conversation-to-project setup: complete the automated regression evidence for the existing preview/confirm flow, including PROJECT.md, AGENTS.md, explicitly private GitHub publication and continuation into a fresh conversation. Keep implementation launch as a separate concrete job.
