# Laufende CLI-Arbeit und Diktat: nächste ADE-Ziele

Aktuelle Operatorentscheidung: Checkpoint inklusive Handoff committen/pushen,
Windows-Build starten, eine ADE-Instanz für seinen Tablet-Test offen lassen und
danach pausieren. Fortsetzung erst nach Rückmeldung. [Prüfstand und offene Punkte](HANDOFF.md)
sind führend; offene Goals sind keine als fertig gemeldete Lieferung.

Stand: 15. September 2026. Der Operator hat die bereinigte Projektordnung
bestätigt und die Ziele für CLI-Übersicht und ElevenLabs-Übergabe beauftragt.
Ein gemeinsames Umsetzungsziel ist in der Codex-Zielverwaltung aktiv. Die
folgenden Meilensteine bleiben bis zur gemeinsamen Abnahme aktiv. Die Desktop-
CLI-Arbeitsliste, erste native Latenzoptimierung und Diktat auf Desktop/Mobile
bestehen die vollständige Code-Abnahme mit **3.735 Checks**; das Windows-Paket
besteht zehn weitere Checks. Reale ElevenLabs- und native Codex-/Claude-/Grok-
Promptproben sind erfolgreich. Der frühere CLI-Checkpoint `b2e134e`/`5ea3b3c`
ist gesichert und gepusht. Persönliche Aktivierung steht wegen einer offenen
WSL-Sitzung aus. Der Diktatstand ist inzwischen als **`128b503`** auf `origin/main`
gesichert, Remote-SHA abgeglichen. Die anschliessenden Orientierungsdetails aus
Goal 27.2 sind implementiert und fokussiert geprüft. Das begrenzte Verbrauchsjournal
und die native CLI-/Diktat-Sitzungsanzeige sind inzwischen angebunden; Projekt-/
Monatssummen und Budgets bleiben offen. Physische Tablet-/WAN-Abnahme ist gesondert.
[CLI-Nachweise](CLI_WORK_LATENCY_RESULTS.md), [Diktat-Nachweise](DICTATION_IMPLEMENTATION_RESULTS.md).

Erweiterung des aktiven Ziels auf weiteren Operatorauftrag: die Dokumentation
vollständig gegen den aktuellen Code und die tatsächlichen Abnahmen prüfen
und synchronisieren. Der verlangte Sicherungscommit/-push hat Vorrang vor
weiterer Produktarbeit; der abschliessende Doku-Abgleich folgt auf den finalen
Implementierungsstand und ist Teil der Fertigstellung.

Weitere verbindliche Erweiterung: Diktat muss auch mobil auf dem Tablet
funktionieren. Goal 25 zur Eingabelatenz ist jetzt ebenfalls aktiver Lieferumfang.
Desktop zuerst ist nur die Implementierungsreihenfolge; Desktop allein erfüllt
den Auftrag nicht. Ziel ist unmittelbar sichtbarer lokal getippter Entwurf und
eine gemessen möglichst reaktive echte CLI-Anzeige auf dem Tablet.

Zusätzlicher verbindlicher Operatorauftrag: **Goal 24 Verbrauch und Kosten**.
Codex, Claude Code, Grok und ElevenLabs erhalten eine nachvollziehbare
Verbrauchserfassung mit Sitzungs-/Projektbezug, Cache-/Reasoning-Aufschlüsselung
wo gemeldet, Kostenschätzung und Abgleich mit Anbieterwerten. Dieser Ausbau ist
zu implementieren und gehört zum aktiven Ziel; Details und Quellstrategie in
[Verbrauch und Kosten](USAGE_AND_COST_GOALS.md). Er ersetzt die laufenden
Diktat-/Latenzarbeiten nicht.

## Zielbild und Reihenfolge

ADE zeigt, wo meine Arbeit läuft, was ich prüfen muss und wie ich direkt in
dieselbe Sitzung zurückkehre. Projekt, Arbeitskopie und CLI bleiben unabhängig
von einem optionalen Coding-Profil. Die vier Originalprojekte und die bestehenden
WSL-Assistenten bleiben Grundlage. Kein erneuter Aufbau fester Agent-Bindings.

| Reihenfolge | Meilenstein | Sichtbares Ergebnis |
|---|---|---|
| 1 | Goal 27.1: gemeinsame CLI-Arbeitsliste | Laufende Projektsitzungen und eigene Terminals in Work; kompakter Ausschnitt in Overview; ein Klick zurück in die konkrete Sitzung |
| 2 | Goal 27.2: Orientierung und Wechsel | Aussagekräftige Sitzungsnamen, Projekt-/CLI-/Statusfilter, Original oder Worktree, Branch und neue Ausgabe; verständliche Projektkarten |
| 3 | Goal 23.1a: Promptentwurf | Mehrzeiliger editierbarer Entwurf mit festem Sitzungsziel und kontrollierter Übergabe an die CLI |
| 4 | Goal 23.1b: ElevenLabs-Diktat | Mikrofon → Aufnahme stoppen → Transkript prüfen → an die ausgewählte CLI übergeben |
| 4a | Goal 23.1c: mobiles Diktat | Derselbe Ablauf über die gekoppelte HTTPS-Tablet-Oberfläche mit festem Zielhost und Eingabebesitz |
| 4b | Goal 25: Tablet-Eingabelatenz | Messung Taste → CLI-Echo → sichtbarer Frame; Engpässe beseitigen, sofortiger lokaler Textentwurf |
| 4c | Goal 24: Verbrauch und Kosten | Zähler und Herkunft pro Sitzung/Projekt/Anbieter; ElevenLabs-Einheiten; Kosten-/Budgetübersicht auf PC und Tablet |
| 5 | Gemeinsame Abnahme | Vertragsprüfungen, echte Electron-/Playwright-Abläufe, vollständiges `pnpm verify` und geprüfter Windows-Build |
| 6 | Dokumentationsabgleich | Architektur, Spezifikation, Bedienung, Status, Roadmap und Übergabe stimmen mit dem geprüften Code und den aktiven Goals überein |

Goal 23 wird aus dem bestehenden [Sprachplan](VOICE_USAGE_TERMINAL_PLAN.md)
fortgeführt. Die Umsetzung beginnt am nativen Windows-Desktop und umfasst
anschliessend die mobile Oberfläche und reale Tablet-Abnahme. Windows
mit WSL-Backend, native Linux/WSLg und macOS sind getrennte Ausführungsmodelle.

## Goal 27: eine Übersicht für den täglichen Projektwechsel

Work erhält eine gemeinsame Einstiegsfläche für interaktive CLI-Sitzungen und
Managed Runs. Beide bleiben als unterschiedliche Arbeitsarten erkennbar. Der
Graph zeigt weiterhin koordinierte Runs; normale CLI-Sitzungen brauchen keinen
synthetischen Run und keine zusätzliche Agent-Zuweisung.

Eine interaktive Zeile zeigt einen vom Benutzer editierbaren Arbeitstitel,
Projekt, Originalordner oder Worktree, Branch, CLI und optionales Startprofil.
Backend und ein tatsächlich bekannter Modellwert werden sichtbar; unbekannte
Modelle werden nicht aus einem Profil oder Terminaltitel erraten. Der Titel
beschreibt zunächst eine Sitzung: Mehrere Prompts in derselben CLI werden nicht
als automatisch erkannte, getrennte Aufgaben ausgegeben.

Der aktuelle Code liefert bereits `SessionMeta`, `SessionProgramState`,
`sessionStateLabel`, Sitzungshydrierung und den Wechsel über
`openProjectSession`. Die neue gemeinsame `CliWorkPanel`-Liste baut auf diesen
Sitzungsidentitäten auf; Work rendert sie zusätzlich zur Managed-Run-Liste und
Overview kompakt zusätzlich zum bisherigen Verlauf. Sie benötigt keine neue IPC.

Verbindliche Anzeigen:

- „CLI startet“, „CLI läuft“, „CLI beendet · Terminal offen“, „Terminal beendet“
  und „Status unbekannt“ bleiben unterscheidbar.
- „Wartet auf dich“ oder „Aufgabe erledigt“ nur bei belastbarem Laufzeitereignis
  oder ausdrücklicher Benutzer-Markierung. Ein ruhiges Terminal beweist keinen
  Wartestatus; Exit 0 beweist keine fachlich gelöste Aufgabe.
- Letzte Ausgabe und vom Benutzer noch nicht angesehene Aktivität dürfen
  Aufmerksamkeit anzeigen. Ausgabeinhalte werden nicht ungefragt als Prompt-
  oder Ergebnisvorschau in eine globale Liste kopiert.
- „Fortsetzen“ aktiviert dieselbe Sitzung, das passende Projekt und den
  Terminalfokus. Ein zusätzlicher Prozess braucht die Aktion „Neue Sitzung“.
- Reload verbindet erneut mit vorhandenen Sitzungen. Nach einem vollständigen
  ADE-Neustart werden unterbrochene Sitzungen als solche benannt; eine neue CLI
  wird nicht als wiederhergestellter alter Prozess dargestellt.

Die vier Projektkarten zeigen den vorhandenen Originalworkspace statt der
irreführenden Aussage „Noch kein Agent-Workspace“. Projektaktionen öffnen den
gewählten Arbeitsort. Eigene Profil-Homes und die WSL-Assistenten bleiben klar
bezeichnet. Die Projektübersicht beginnt mit „Meine ADE Projekte“ und merkt sich
eine ausdrücklich gewählte Ansicht „Alle“ auf diesem Gerät. Der gesamte gefundene
Ordnerbestand bleibt dadurch erreichbar. Der mobile Promptdialog zeigt auch bei
profilfreien Starts den konkreten Projektnamen aus der geprüften Workspace-Zuordnung.
Diese Folgeänderung ist separat fokussiert geprüft; der obige Paketstand gehört
noch zum vorherigen Diktatmeilenstein.

## Goal 23.1: Text und Sprache an die richtige Sitzung

Der Textentwurf ist die Grundlage für Tastatureingabe und Diktat. Sichtbar sind
Projekt, Branch und CLI, beispielsweise „An Claude Code · RhinoSheetMetal · main“.
Die Zielidentität wird beim Erstellen des Entwurfs gebunden. Neue Ausgaben oder
ein Projektwechsel dürfen den Entwurf weder umleiten noch überschreiben.
Entwürfe werden pro Ziel gehalten und bei einem Versandfehler erhalten; eine
lokale Wiederherstellung wird explizit begrenzt, mit Löschmöglichkeit und ohne
Prompttexte in Run-Journal, Diagnoselogs oder Telemetrie.

Der Benutzer nimmt auf, stoppt, prüft das Transkript und betätigt die
Übergabeaktion. Es gibt keine automatische Aufnahme und kein automatisches
Senden nach der Transkription. Zunächst eine begrenzte Batch-Aufnahme, zum
Beispiel höchstens 60 Sekunden; Audio-, Antwort- und Textgrenzen werden als
gemeinsamer Vertrag festgelegt. Live-Streaming und Wake Word sind spätere Ideen.

Technische Grundlage ist ElevenLabs `POST /v1/speech-to-text` mit Audio-Upload
und explizitem Transkriptionsmodell. Die aktuelle Referenz verwendet `scribe_v2`;
Deutsch ist dokumentiert. Der persönliche STT-Zugriff ist separat mit einem echten
5,98-Sekunden-Aufruf bestätigt; ein TTS-Test allein würde dies nicht beweisen.
[API-Referenz](https://elevenlabs.io/docs/api-reference/speech-to-text/convert),
[Sprachunterstützung](https://elevenlabs.io/docs/overview/capabilities/speech-to-text).

Aufnahme erfolgt im freigegebenen ADE-Renderer, der Providerzugriff in main.
Nur Audio und gewählte Transkriptionsoptionen werden übergeben; keine
Repositorydateien oder Gesprächsverläufe. Main hält den Schlüssel, begrenzt die
Daten und erlaubt Abbruch. Lokale Rohaufnahmen werden nach Verarbeitung oder
Abbruch verworfen. Provider-Aufbewahrung wird davon getrennt beschrieben:
die ElevenLabs-Referenz beschränkt `enable_logging=false` auf Enterprise;
ADE darf keine allgemeine Speicherungslosigkeit beim Anbieter versprechen.
[Aufbewahrungsoption](https://elevenlabs.io/docs/api-reference/speech-to-text/convert).

Die CLI-Übergabe benötigt einen geschützten Start: Die früheren PTY-Starts liessen
nach dem CLI-Ende eine Shell offen. Die privaten Lifecycle-Marker
in `InteractiveProgram` sind Beobachtung, keine sichere Eingabeberechtigung.
Ein Statuscheck allein verhindert nicht, dass die CLI unmittelbar danach
endet und gepufferte Eingabe bei PowerShell oder Bash landet. Daher gehört
ein nachweisbarer, laufzeitgebundener Eingabepfad zur Abnahme. Unterstützte
Transporte erhalten diesen Vertrag; bei unbekannter oder beendeter CLI bleibt
der Text im Entwurf. Ein universeller Versand durch blindes `pty:write` ist
keine akzeptierte Ersatzlösung. Implementiert ist dieser Schutz für neue native
Windows-Codex/Claude/Grok-Starts: Die aufrufende Shell endet mit der CLI;
Paste und abschliessendes Enter werden mit erneuter Autorisierung serialisiert.
WSL-/Custom-/Assistentenstarts behalten ihre bisherigen Startwege und bleiben
für die strukturierte Promptübergabe gesperrt.

„In die CLI einfügen“ und „Absenden“ brauchen getrennte, getestete Semantik für
mehrzeiligen Text und TUI-Paste. Der verfügbare Eingabebesitz wird in main geprüft.
Ziel-/Prozesswechsel invalidieren die Übergabe. Eine Versand-ID verhindert
doppelte Übergaben bei Doppelklick oder Wiederholung; ein unbekannter Ausgang
wird nicht als sicher ungesendet behandelt. Bestätigung bedeutet zunächst
„an die Sitzung übergeben“, nicht „vom Modell verarbeitet“.

Mikrofon-, STT- und Entwurfsverträge erweitern die schmalen bestehenden Grenzen.
Neue IPCs werden klassifiziert, Fehler redigiert und Renderer-Ereignisse zentral
versendet. Die bestehende Remote-Command-Allowlist wird dafür nicht erweitert.
Mobile Audio verwendet einen eigenen begrenzten Upload-Vertrag mit
Geräteidentität, Berechtigung und Idempotenz; Desktop-Unterstützung impliziert
keine Remote-Freigabe. Die separate Gerätefreigabe `dictation:transcribe` ist
erforderlich. Die Browserabnahme dieses Ablaufs ersetzt keine physische
Tablet-Mikrofonprobe; Nachweise stehen im verlinkten Implementierungsbericht.

## Goal 25: reaktive Tablet-Terminals

Die Messung unterscheidet Hardwaretastatur und Bildschirmtastatur, einzelne
Zeichen und Bursts, native Windows-CLI und WSL sowie direkten LAN-/Tailscale-
Pfad und Verbindungen unterwegs. Erfassen: Eingabe, Warteschlange, signierter
Request, Hostprüfung, PTY-Write/-Output, Frame und Darstellung. Keine getippten
Inhalte in Messlogs. p50/p95, Roundtrip-Zeit, Ausgabefrequenz und verwendeter
Netzpfad gehören zum Ergebnis. Ziel auf direktem Pfad: p50 ≤ 100 ms und
p95 ≤ 200 ms; die tatsächliche Netzwerkgrenze und zusätzliche ADE-Latenz
werden separat ausgewiesen. Keine pauschale Null-Latenz-Zusage unterwegs.

Der lokale Promptentwurf reagiert sofort und puffert lange Texte vor ihrer
expliziten Übergabe. Für den Terminalpfad zunächst wiederholte Git-/Workspace-
Prozessprüfungen, Polling, Frame-Erzeugung und Eingabebündelung messen. Danach
gezielt überflüssige Arbeit beseitigen, die Vertrauensprüfung erhalten und
revisionsbasierte Updates oder Push prüfen. Kein paralleles Vollbildpolling,
das ältere Antworten über neuere Frames schreibt.

Der Vorschlag lokales Echo wird an den tatsächlichen TUI-Fällen geprüft:
Cursorbewegung, Backspace, Completion, IME/Composition, Passwortfelder,
Eingabebesitzwechsel und Ausgabe während des Tippens. Optimistische Zeichen
dürfen weder doppelt erscheinen noch verdeckte Eingabe preisgeben. Ein
unsicherer Echo-Modus wird nicht als Latenzverbesserung freigegeben; stattdessen
den verlässlichen lokalen Entwurf und schnellere echte Rückmeldung liefern.

## Abnahme: der tatsächliche Alltag

| Fall | Erwartetes Ergebnis |
|---|---|
| Vier Projekte, mehrere CLIs und zwei Aufgaben im selben Repo | Eindeutige Arbeitszeilen; Original und Task-Worktree unterscheidbar |
| Work → Projekt → Git → andere Sitzung → zurück | Gleiches Sitzungsziel, vorhandener Terminalverlauf und richtiger Fokus; kein Doppelstart |
| CLI endet, Shell bleibt offen | Korrekte Anzeige; Entwurf wird nicht an die Shell geschickt |
| Neuer Start derselben CLI nach Aufnahmebeginn | Altes Entwurfsziel wird nicht automatisch auf den neuen Prozess umgebogen |
| Desktop/Tablet-Eingabebesitz wechselt | Unberechtigter Versand scheitert ohne Verlust des Entwurfs |
| Mikrofon abgelehnt, stumm, abgezogen oder Aufnahme abgebrochen | Verständlicher Zustand, Aufnahme endet; Tippen bleibt möglich |
| STT-Key fehlt, 401/403, Limit, Timeout, übergrosse Antwort | Begrenzter, redigierter Fehler; keine falsche Erfolgsmeldung |
| Mehrzeiliger Text, Sonderzeichen, Doppelklick, verspätete Antwort | Texttreue, richtige Zielidentität und höchstens eine Übergabe |
| Projekt-/Ansichtswechsel während Aufnahme/Transkription | Keine fremde Sitzung erhält den Text; Entwurf bleibt nachvollziehbar |
| Reload und vollständiger App-Neustart | Tatsächliche Prozesslage erkennbar; keine erfundene Wiederaufnahme |
| Tastatur, schmale Ansicht und Dialogabbruch | Sichtbarer Fokus, erreichbare Aktionen und sinnvolle Rückkehr |

Zuerst lokale Fixtures für reproduzierbare Fehlerfälle; danach native
Electron-/Playwright-Prüfung, begrenzte echte ElevenLabs-Transkription und
gesondert ausgewiesene Runtime-Proben. Kein Modellauftrag allein zum Prüfen
der Arbeitsliste. Vor Abschluss `pnpm verify` und Windows-Build. Persönliche
Aktivierungen bündeln und laufende Benutzerarbeit erhalten.

## Weitere Verbesserungen nach diesen beiden Lieferungen

| Priorität | Vorschlag | Warum er diesem Workflow hilft |
|---|---|---|
| Hoch | Sichtbarer Git-Abgleich je Arbeitskopie | Basis/Ziel, eigene Commits, Rückstand, lokale Änderungen und Zeitpunkt des letzten Fetch anzeigen; bewusster Pfad „aktualisieren“, „lokal übernehmen“ oder „PR“. Keine automatische Synchronisation älterer Worktrees. |
| Hoch | Gemeinsamer Schnellwechsler | Nach Projekt, Arbeitstitel, CLI und Branch suchen; letzte Sitzungen und bevorzugte Projekte direkt aktivieren. Tastenkürzel dürfen native CLI-Befehle nicht verschlucken. |
| Hoch | Ruhige Aufmerksamkeitshinweise | Neue Ausgabe, bestätigte Rückfrage, Prozessende und Prüfbedarf unterscheiden; Klick führt zur Ursache. Keine Fokusübernahme bei jeder Terminalausgabe. |
| Mittel | Aufgabenkarte mit nächstem Schritt | Ziel, Arbeitskopie, Test-/Build-Ergebnis und offene Entscheidung auch nach einem CLI-Ende sichtbar halten; benutzerbestätigte Zusammenfassung statt erfundener Fortschritt. |
| Mittel | Klare Regeln bei zwei Schreibern im selben Checkout | Sichtbar machen, wenn zwei ADE-CLIs denselben Ordner ändern können; eigene Arbeitskopie anbieten. Externe Cursor-Prozesse nur als erkannt melden, wenn dafür eine belastbare Quelle besteht. |
| Mittel | Projektaktionen für Build, Tests und Vorschau | Pro Projekt nachvollziehbare Aktionen und Ergebnisse. Vorhandene Skripte nutzen; CLI und Task-Kontext bleiben sichtbar. Rhino-Integration benötigt eine eigene lokale Abnahme. |
| Später | Wiederaufnahme nach App-/PC-Neustart | Prozessende, gespeicherten CLI-Verlauf und providerabhängiges Resume getrennt behandeln. Erst nach einem getesteten Resume-Vertrag automatisch anbieten. |
| Später | Einfache Übergabe zwischen Codex, Claude und Grok | Geprüfte Kurzbeschreibung, Dateien und offene Fragen als expliziter neuer Auftrag; kein behaupteter automatischer Transfer des Modellgesprächs. |

Diese Zusatzideen sind priorisierte Vorschläge. Sie erweitern nicht automatisch
das aktive Lieferziel. Verbrauchsanzeigen und zweiter PC bleiben in den
bereits vorhandenen Goals; Goal 24 und Goal 25 sind inzwischen ausdrücklich
aktiver Lieferumfang. Main-Chef-Delegation aus Goal 26 ist hingegen
ein eigener späterer Schritt.

## Verbindlicher Dokumentationsabgleich

Die gesamte Dokumentationsstruktur wird inventarisiert: README/Einstieg,
ARCHITECTURE, SPEC, USER_GUIDE, STATUS, ROADMAP, HANDOFF, Plattformpläne,
Featurepläne und Ergebnisberichte. Eine Prüfliste ordnet Aussagen ihrer
Codequelle, ausführbaren Abnahme und zeitlichen Gültigkeit zu.

- Begriffe Projekt, Originalcheckout, Task-Worktree, Agent-Profil, interaktive
  Sitzung und Managed Run durchgängig abgleichen.
- Dokumentierte Startwege, Schaltflächen, CLI-/Modellauswahl, Git-Aktionen,
  Sprache und Wiederaufnahme mit dem tatsächlich vorhandenen Ablauf vergleichen.
- Architekturgrenzen, IPC-/Remote-Verträge, Authentifizierung, Speicherung,
  Lifecycle und Plattformunterstützung gegen ihre Implementierungen prüfen.
- Goals 1–27 und Unterziele auf Status, Abhängigkeiten, doppelte Ziele und
  widersprüchliche Prioritäten prüfen. Eine Nummer und ein führender Plan je Ziel;
  Kurzfassungen verlinken dorthin. Keine geplante Funktion als geliefert markieren.
- Aktuelle STATUS-/ROADMAP-/HANDOFF-Einstiege aktualisieren. Historische
  Ergebnisberichte behalten ihre damaligen Ergebnisse mit Datum/Commitbezug;
  spätere Aktivierungen werden als Nachtrag verlinkt statt vergangene Prüfungen
  nachträglich auf einen anderen Codebestand zu beziehen.
- Befehle, Dateipfade und interne Links prüfen. Lokale persönliche Betriebsdaten
  und externe Backups von der portablen Projektdokumentation unterscheiden.
- Alte Angaben zu „nicht neu gestartet“, offenen Tests oder nicht implementierten
  Funktionen gegen spätere belegte Ergebnisse auflösen. Unerledigte Prüfungen
  bleiben ausdrücklich offen; Dokumentationsarbeit ersetzt keine Laufzeitabnahme.

Fertig, wenn ein nachvollziehbarer Abgleichbericht mit Quellen und verbleibenden
Grenzen vorliegt und die führenden Dokumente dieselbe aktuelle Produktgeschichte
erzählen. Bei weiteren Codeänderungen wird dieser Abgleich erneut aktualisiert.
