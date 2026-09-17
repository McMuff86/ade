# ADE-Agent: laufende Umsetzung

17. September 2026, Ausgangscommit `465b639`. Autorisierter Implementierungsauftrag
für [Goals 26/27/33](MAIN_AGENT_GOALS.md). Der erste Codex-Tablet-Testbuild ist
seit 17. September 22:20 CEST persönlich aktiviert; der Gesamtauftrag mit weiteren
Anbietern, Autonomie und Sprachausgabe bleibt offen.
Wiederaufnahme am selben Abend: Adi priorisiert den ersten Codex-Ablauf zum
Tablet-Test. [Lieferfolge und aktuelles Goal](TABLET_CODEX_GOAL.md).
Commit und Push sind nach abgeschlossener Umsetzung/Abnahme ausdrücklich
beauftragt. [Update zu Hause und Erhalt des lokalen Profils](HOME_UPDATE.md).
[Native Fähigkeiten je Verbindung](MAIN_AGENT_CAPABILITIES.md) und
[nächste technische Anbindung](MAIN_AGENT_NEXT.md) halten die verbleibenden
Adapter-/Koordinatorarbeiten getrennt von bereits geprüften UI-Bausteinen fest.

## Implementierte Bausteine und Nachweise

- **Erster Codex-Tablet-Auftrag:** Fünf zusätzliche Domänenwerkzeuge bereiten
  Übergaben/Aufträge vor und lesen Profile, Auftragszustände und Ergebnisse.
  Nur eine ausdrückliche UI-Bestätigung speichert die Übergabe oder startet den
  Kind-Run. Begrenzter dauerhafter Elternbeleg vor Seiteneffekt, Kind-IDs vor
  Queue-Zulassung, Rechteprüfung bis unmittelbar vor Prozessstart und reine
  Wiederherstellung ohne erneuten Dispatch. Graph-Beziehung wird daraus
  abgeleitet. Ergebnisse/Rückfragen erscheinen im selben PC-/Tablet-Dialog.
  Fachverträge **46/0**, signierter Host-Zugang **22/0**, Gesprächsdriver **55/0**.
  Native Produktionswerkzeuge plus isolierter Codex-Task-Launcher **11/0**:
  echte Übergabe, Resume, Frage/Antwort, Datei und Ergebnisrückkanal; keine
  Behauptung eines nativen PTY-/Queue-Tests. Aktuelle Koordinator-Policy **35/0**,
  native Konfigurationsprobe **3/0** mit zwei übernommenen, ausdrücklich
  deaktivierten MCP-Einträgen. Globale Codex-Konfiguration unverändert.
  [Tablet-Pilot und Gesamtabnahme](TABLET_CODEX_GOAL.md).
  Finale Gesamtabnahme am 17. September 19:07–19:32 CEST **Exit 0**:
  drei TypeScript-Projekte, **89 Suiten / 3.652 Prüfungen**, Produktionsbuild,
  sämtliche Electron-/Browser-/Visualdriver. Source-ID `b05242ffd1f239a77f72`.

- **33.2, erster Textdialog:** PC/Tablet **ADE-Betreuung → Mit ADE sprechen**
  braucht kein Projektterminal. Eigener dauerhafter Verlauf, native Codex-Fortsetzung,
  Rückfragen, Unterbrechen, Beenden und getrennte Entwürfe. IPC bleibt desktop-only;
  signierte Host-Routen gehen ausschliesslich über `AdeApplicationService` und
  verlangen vollständige Projektfreigabe, `read`/`workspace:read`, für Befehle
  zusätzlich `runs:write`, Ledger und Audit. Fünf lesende
  ADE-Werkzeuge liefern belegte Projektstände und vollständige Übergaben in
  begrenzten Textabschnitten. Bestätigte Codex-Aufträge ergänzt der obige Pilot.
  Gesprächsservice **52/0**, Werkzeug-/IPC-Grenzen **15/0**, Entwürfe **22/0**,
  Remote **48/0**, Text-/Diktatdialog Electron/Browser **44/0** mit lokalem Protokollpeer,
  Typecheck grün. Native Produktionsanbindung **4/0**:
  Eine unabhängig erzeugte Übergabe wird über die echten ADE-Werkzeuge gelesen;
  beobachtet `gpt-5.6-sol`/`high`, vollständige Antwort dauerhaft gespeichert,
  neuer nativer Prozess erinnert den ersten Benutzermarker. Nachweise unter
  `coordinator-conversation-native.json`/`.log`. Kein Nutzerprojekt verändert.
  Zwei Gespräche behalten getrennte Entwürfe und Modellkontexte. UUIDs können
  nicht aus dem ADE-Arbeitsordner ausbrechen; derselbe native Thread darf nicht
  zwei ADE-Gesprächen gehören. Shutdown wartet auf das tatsächliche Prozessende.
  Kapazitätsprüfung reserviert die vollständige Antwort vor dem Modellstart.
  Der gemeinsame Dialog speichert offene Create-/Send-IDs vor dem Versand und
  stellt sie nach Schliessen/Reload wieder her. Bestätigte Abweisungen erlauben
  Korrekturen; verlorene Antworten behalten ihren Key. Private Eingabetexte gehen
  nicht an das Tablet zurück; Modellantworten werden vollständig redigiert und
  dann in Unicode-sichere Seiten aufgeteilt. Alte Antworten lädt der Benutzer
  ausdrücklich, die letzte automatisch. Gerätewechsel und Rechteverlust
  verwerfen den flüchtigen Detailcache. Terminalunabhängiges Diktat ist angebunden:
  eigene Gesprächsbindung, flüchtige Audioübertragung, lokale Vorschau und explizites
  Übernehmen in die Nachricht. Bei Wechsel bleibt der Teiltext beim ursprünglichen
  Gespräch. Recorder **28/0**, bestehender Remote-Terminal-Diktatweg **47/0**,
  Sicherheitsprüfung **284/0**. Gemeinsame Sprach-Bedienabnahme **44/0** bestanden;
  Sprachausgabe und Aktivierung per Zuruf bleiben offen.

- **27.3:** Gemeinsamer Button **Arbeit wechseln** auf Desktop, Tablet und im
  geöffneten Tablet-Projekt. Suche nach Projekt/Sitzung/CLI/Branch; Auswahl
  revalidiert das bestehende Ziel. Desktop-PTY-ID und undurchsichtige Remote-ID
  bleiben getrennt. Navigation startet keinen Prozess und übernimmt keine Eingabe.
  Gemeinsame Anzeigeprojektion ohne Workspace-Pfade; mindestens 44 CSS-Pixel
  grosse Touchflächen, Lade-/Fehler-/Leerzustände, Fokus-Rückgabe und Escape.
  Späte Antworten nach Schliessen oder einer neueren Graph-Auswahl ändern die
  Navigation nicht. Explizite Projekt-/Sitzungswahl zeigt die Terminalausgabe;
  der globale Kopf bleibt ausserhalb des Projekt-Scrollbereichs erreichbar.
- Projektwechsel verwirft keine noch sichtbare Live-Diktatvorschau: beim Beenden
  der Aufnahme bleibt sie am ursprünglichen Entwurf und wird als unvollständig
  gekennzeichnet. Unbestätigte Sendungen bleiben zur Prüfung gesperrt.
- **26.6:** Expliziter Gesprächsmodus in `CodexAppServerProcess`, zusätzlich zum
  unveränderten Einzeltask-Vertrag. Serialisierte weitere Nachrichten, bestätigte
  Unterbrechung und `thread/read` vor `thread/resume`; Workspace und native Thread-ID
  müssen passen. Alte/fremde/doppelte Turn-Ereignisse gelangen nicht in die neue
  Antwort. Kein automatisches Wiederholen nach unbestätigtem Start. Maximal 512
  Turns je Prozess; native Fortsetzung und neue Arbeit bleiben verschiedene Aktionen.
  Dynamische ADE-Werkzeuge verwenden den nativen `item/tool/call`-Rückkanal:
  Kontextprüfung, gemeinsame Ausführung doppelter Requests, Abbruchsignal und
  begrenzte Antworten. Die native Probe bestätigt diesen Rückkanal nach Resume;
  der Koordinatormodus prüft zusätzlich CLI-Version, effektive Konfiguration und
  read-only ohne Netzwerk vor dem ersten Turn. Native Ausführungswerkzeuge sind
  dort deaktiviert. Ein Test-Schreibauftrag erzeugt keine Datei; danach arbeitet
  das ADE-Werkzeug weiterhin. Der Desktop-Dialog nutzt diesen Vertrag jetzt mit
  lesenden Projektwerkzeugen; bestätigte Aktionen ergänzt der obige Pilot.
- **26.2:** Revisionsgebundener, begrenzter Betreuungsplan in
  `userData/ade/supervision.json`, ausserhalb der Projektordner. Bis 64 Projekte,
  64 explizite Sitzungs-/Run-Verbindungen je Projekt, 512 quittierte Befehle,
  2 MiB Dateigrenze. Atomare Speicherung; beschädigte Originale, Dateiänderungen
  und Links werden abgewiesen. Profil und Projektmodi werden gespeichert;
  Metadatenänderungen starten/stoppen keine Arbeit. Zusammenfassung enthält
  Auftragsdigest/Länge, vollständiger Auftrag nur über Detailabfrage.
  Fünf Desktop-IPC-Kanäle mit exakter Validierung und klassifizierten Rechten.
  **ADE-Betreuung** ist global auf Desktop/Tablet erreichbar. Gemeinsames Formular
  mit projektspezifischen Entwürfen und explizitem Laden bei veralteter Revision.
  Der Graph zeigt die gespeicherten Projekt-/Arbeitsverbindungen; Desktop als
  einklappbare Übersicht über dem bisherigen Run-Canvas. Sitzungslinks öffnen
  die bestehende Sitzung. Die Moduswahl ist bisher ein Betreuungsplan, noch keine
  automatische Ausführung.
- Mobile `POST /api/v1/supervision/query` und `/command` rufen ausschliesslich
  `AdeApplicationService` auf. Gerätesignatur, aktueller Gerätestatus und
  Projekt-/Profilfreigaben werden geprüft; Änderungen brauchen `runs:write`
  und einen dauerhaften Idempotenzschlüssel. Geräte mit ausgewählten Ressourcen
  können das globale ADE-Profil nicht ändern. Sitzungslinks verwenden die erneut
  validierte Remote-Terminalinventur und deren undurchsichtige IDs. Kein zusätzlicher
  PTY-/Shell-Zugriff. Auftragstext erscheint nur in einer redigierten Detailabfrage;
  Audit und Quittungen enthalten keine Auftragsinhalte.
- **33.1, erster Baustein:** **Für nächste Session merken** speichert explizite
  Übergaben mit Projekt, optionaler Arbeitsquelle und nächstem Schritt. Store v2
  migriert v1 ohne sofortige Dateiänderung. Höchstens 1.024 Übergaben innerhalb
  der 2-MiB-Grenze; keine automatische Löschung. **Morgenüberblick laden** zeigt
  verknüpfte Arbeitsstände, offene Fragenzahlen und Notizen mit expliziter
  Detailabfrage. Vorschläge priorisieren Rückfragen, Fehler und offene Übergaben;
  sie starten keine Arbeit und behaupten keinen unbelegten Fortschritt.
  Desktop-/Tablet-Flows prüfen Entwürfe, Reload, Lesen und projektgenauen Statuswechsel.

| Prüfung | Ergebnis | Evidenzart |
|---|---|---|
| `test-session-navigation.ts` | 14/0 | Anzeige-/Identitätsverträge |
| `test-supervision-navigation.ts` | 8/0 | Verspätete Antworten nach Schliessen, genaue Zielidentität, Branchwechsel, fehlender Run und positive Abschlusskontrollen |
| `test-prompt-drafts.ts` | 18/0 | Entwurfsspeicher |
| `test-remote-terminal-electron.ts --session-navigation-only` | 51/0 | Electron, Chromium, echte PTYs, deterministische Sitzungen; zehnmal A→B→C→A, gleicher Prozessbestand, Entwurf, Geschwistersitzung, Reload, Fokus, persistierte Betreuung, Graph-Links, Übergaben, Tablet-Bearbeitung, sichtbares Zielterminal und kompakter Desktop-Kopf; 1280×800/800×1280/390×844/800×600 |
| `test-dictation-electron.ts` | 63/0 | Echte Browseraufnahme mit Anbieterfixture; Abbruch, Live-Vorschau, verlorene Quittung, positiver Abschluss |
| `test-codex-conversations.ts` | 22/0 | Deterministisches Stdio-Protokoll, Fortsetzung/Abbruch/Neustart, Werkzeug-Rückkanal, Koordinatorprüfung vor dem ersten Turn und negative Identitätskontrollen |
| `test-coordinator-codex-policy.ts` | 33/0 | Feste Startparameter, Versions-/Konfigurations-/Sandboxprüfung; abweichende Berechtigungen werden abgewiesen |
| `test-coordinator-codex-policy-native.ts` | 3/0 | Installierte CLI bestätigt Version, wirksame Startkonfiguration und read-only ohne Netzwerk; kein Modellturn |
| `test-codex-conversations-native.ts --coordinator` | 5/0 | Installierte CLI mit eingeschränktem Koordinatorvertrag; Kontext, Resume, ADE-Werkzeug, kein natives Schreibwerkzeug und anschliessender positiver Werkzeugaufruf |
| `test-codex-dynamic-tools.ts` | 18/0 | Korrelations- und Wiederholungsgrenzen, Abbruch, Ergebnislimit, kein wiederholter Seiteneffekt |
| `test-run-questions.ts` | 26/0 | Bisheriger Task-/Fragevertrag bleibt erhalten |
| `test-codex-conversations-native.ts` | 4/0 | Installierte Codex-CLI 0.154.0, natives Windows, `gpt-5.6-sol`, Reasoning `high`, read-only; zweite Nachricht sowie neuer Prozess erinnern einen zufälligen Marker; nach Resume liefert ein dynamisches ADE-Werkzeug einen unabhängig erzeugten Marker |
| `test-supervision.ts` | 26/0 | Dauerhafte Verbindungen, Scope, Revision, Replay, Drift, UTF-8- und Speichergrenzen |
| `test-remote-supervision.ts` | 30/0 | Geräte-/Ressourcenrechte, Revision/Replay, private Inhalte, Übergaben und Profilwiderruf während einer Inventur |
| `test-handoffs.ts` | 20/0 | Dauerhafte Übergaben, Originalbezug, Detailgrenze, Migration, Vorschläge, negative Projektkontrollen |
| `test-terminal-workspace-identity.ts` | 17/0 | Unter Windows Junction und Datei-Hardlink an HEAD, falsche Git-Zuordnung und abschliessender positiver Scope; Unix prüft weiterhin Dateisymlink |
| `test-claude-conversations-native.ts` | 3/0 | Installierte Claude Code 2.1.274, natives Windows, beobachtet `claude-opus-5[1m]`, `plan`/`safe-mode`/`restricted`; neuer Prozess setzt exakte selbst erzeugte Session-ID fort und erinnert Prüfmarker; native Werkzeugliste leer |

Typecheck erfolgreich. Logs unter `test-results/main-agent-planning/`; native
Modellantworten werden im Nachweis nicht als Testfixture bezeichnet. Native
Gesprächsprobe ist bewusst separat von `pnpm verify`. Protokollgrundlage: lokal
von Codex 0.154.0 erzeugtes JSON-Schema und die
[offizielle App-Server-Dokumentation](https://learn.chatgpt.com/docs/app-server).
Claude-Probe nach lokaler CLI-Hilfe und [offizieller CLI-Referenz](https://code.claude.com/docs/en/cli-reference).
Sie verwendet direkte Prozessargumente (einschliesslich leerem `--tools`), eigene
temporäre Projektidentität und keine fremde Benutzersitzung. Sie belegt weder
ADE-Workspace-Prüfung noch Rückfragen oder Unterbrechung eines Claude-Adapters.

## Offene Abnahme

Früherer vollständiger Lauf: `test-results/main-agent-planning/verify-dialog.log`,
Exit 1. Typecheck, **84 Suiten / 3.472 Prüfungen** und Build bestanden; der
Tablet-Terminaldriver hatte **207/1** bei der Sitzungsmenge nach Schliessen.
Isolierter Home-Flow **42/0**; der Driver wartet zusätzlich auf die neue
Auswahlbestätigung. Eine Codex-Fixture verdrängte später ihren Startmarker durch
Ausgabe des langen Profilprompts; die Terminalanzeige der Fixture ist nun
begrenzt, vollständiger Argumentnachweis bleibt in der Fixture-Datei.
Nach Korrektur der Fixture und Warten auf tatsächliche Auswahl/Bildausgabe besteht
der volle Terminaldriver **208/0** (`remote-terminal-positive.log`, Exit 0).
Der anschliessende Unit-Lauf besteht mit **86 Suiten / 3.532 Prüfungen**
(`unit-conversation-tablet.log`, Exit 0). Gemeinsame Navigation mit Betreuung
weiterhin **51/0**; Textdialog auf PC/Tablet zunächst **33/0**. Mit Gesprächsaufnahme
besteht der Dialog inzwischen **44/0** (`conversation-voice-fixed.log`, Exit 0).
Für den vom Benutzer gewünschten Haltepunkt endete `verify-checkpoint.log` mit
Exit 1 bei Workspace-CLI/Clipboard (12/1); isoliert derselbe Fehler. Vorher:
Typecheck, 87 Suiten/3.580 Prüfungen, Build, Dialog 44/0, Navigation 51/0,
voller Terminaldriver 208/0 und Run-Inspektion 27/0 bestanden. Die übrigen Driver
bestanden danach einzeln: Projekt-Git 22/0, Latenz 6/0, Veröffentlichung 12/0,
Einrichtung 38/0 und visuelle Vergleiche 22/0. Ursache der leeren Zwischenablage und vollständige
Gesamtabnahme bleiben offen. [Kontexthandoff](CONTEXT_HANDOFF_2026-09-17.md).

Die Codex-Verbindung ist als globaler PC-/Tablet-Dialog mit bestätigten
Projektaufträgen verdrahtet. Ereignisgesteuerte Koordination, tatsächliche
Unteragenten im Graph, Sprachausgabe und Aktivierung bleiben offen.
Der strukturierte Morgenüberblick bleibt auf PC/Tablet verfügbar. Der neue
Desktop-Dialog kann dessen Inhalte über lesende Werkzeuge abfragen; native
Produktionsprobe **4/0**, separat vom deterministischen Electron-Driver.
Claude-Fortsetzung ist separat nativ geprüft, aber nicht als ADE-Gesprächsadapter
angebunden; `grok` wurde im aktuellen Windows-PATH
nicht gefunden. Gemischte native CLI-Abnahme und physisches Samsung-Tablet sind
noch nicht nachgewiesen.

Der frühere `pnpm verify`-Lauf unter `verify-final.log` hat alle drei
TypeScript-Projekte, **82 Suiten / 3.411 Prüfungen** und Produktionsbuild
bestanden; der Electron-Workflow stoppte bei **196/1** an einer vorzeitigen
Modellauswahlprüfung. Nach gezieltem Warten auf die endgültige Option besteht
der Workflow erneut **197/0**. Der inzwischen ergänzte Dialog braucht einen
neuen vollständigen Gesamtlauf. Die Bedienwege sind zuvor einzeln
bestanden, einschliesslich Vorlesen **35/0**, Computer **21/0**, Langzeitdiktat
**63/0**, Projekt-/Betreuungswechsel **51/0** und Setup **38/0**. Noch kein
abgeschlossener Gesamtnachweis.

Vorherige Läufe fanden zu frühe Fokus-/Zwischenzustandsprüfungen in Testdrivern,
eine vorzeitige Codex-Prozessbereinigung und die fehlende Windows-Berechtigung
zum Erstellen von Dateisymlinks. Die Prüfungen warten jetzt auf beobachtete
Zustände; Windows prüft echte Junctions und Datei-Hardlinks ohne Tests zu
überspringen. Zwei Layoutfehler sind behoben: Der Desktop-Kopf wächst mit seinen
Aktionen, Projekte scrollen darunter, und bewusstes Öffnen/Wechseln zeigt das
Terminal. Hintergrundausgabe scrollt nicht. Sieben visuell geprüfte Windows-
Referenzbilder berücksichtigen die 17 Pixel höhere Kopfleiste. Die vorherigen
Logs bleiben unter `test-results/main-agent-planning/` erhalten.
