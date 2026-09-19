# ADE — Agentic Development Environment · Product Spec

## Persönliche Tasks und Notes

Tasks und Notes sind eigenständige persönliche Seiten, getrennt von ausführbaren
Agentenaufträgen. Ein Titel genügt zur Erfassung. Projektzuordnung ist optional.
Tasks können Beschreibung, Checkliste, Fotos, Fälligkeit und Erinnerung besitzen;
Ansichten zeigen alle, heutige/überfällige, geplante, spätere und erledigte Aufgaben
sowie fällige Erinnerungen. Eine Fälligkeit startet keinen Agenten. Die ausdrückliche
Übergabe zeigt Projekt, Agent und Auftragstext; bestätigte Aufträge bleiben verlinkt.
Erledigt-Status und Run-Ergebnis sind unabhängig.

Notes kombinieren Text, Diktat, Fotos und editierbare Zeichnung. Stift/Finger,
Radierer für ganze Striche, Rückgängig/Wiederholen, Foto als Hintergrund und
Tastaturzeichnung sind vorgesehen. PNG gibt die Zeichnung aus, PDF Text/Bilder/
Zeichnung und Markdown den Text. Eine Notiz oder ein Textausschnitt kann als neue
Aufgabe übernommen werden; die Notiz bleibt erhalten.

Bearbeitung speichert zuerst auf dem Gerät, anschließend auf dem PC. Offline-
Erfassung braucht keine neue Kopplung. Gleichzeitige Änderungen bleiben als zwei
Fassungen erhalten. Fehler dürfen weder erfolgreichen Abgleich behaupten noch
den sichtbaren Entwurf beim Seitenwechsel verwerfen. Diktat benötigt Verbindung
und gesonderte Freigabe; Vorschau vor Übernahme, kein automatischer Agentenstart.

Navigation gruppiert Start, Organisation und Entwicklung; die Darstellung lässt
sich einklappen. Graph unterscheidet Run, Ergebnisse, Verwaltung, Steuerung und
Ansicht. Der Arbeitsauftrag und Prüfstand stehen in [TASKS_NOTES.md](TASKS_NOTES.md);
die vollständige Abnahme ist auf Nutzerwunsch noch zurückgestellt.

## Kompakter Projektbereich auf dem Tablet

Der Projektkopf kann eingeklappt werden und gibt seinen Platz dem Terminal.
Titel, Verbindungsstatus und Workspace-Info bleiben erreichbar. Die lokale
Ansicht bleibt beim Neuladen erhalten; offene Branch-Quittungen bleiben sichtbar.
Aktualisierung und Branches teilen sich mit der Bereichswahl eine umbrechende
Aktionsleiste. [Bedienung und Abnahme](TABLET_PROJECT_LAYOUT.md).

## Tablet verbinden und gemeinsamen Build starten

QR-Link und manueller Code sind alternative Wege für dieselbe fünf Minuten
gültige Einmalkopplung. Zuhause und unterwegs gilt dieselbe private HTTPS-Adresse,
mit verbundenem Tailscale auf PC und Tablet. Im bereits gekoppelten Browser ist
keine neue Kopplung beim Netzwerkwechsel nötig. Sichere Geräteablage muss zusätzlich
zur HTTPS-Verbindung verfügbar sein; ein volles gültiges Zugriffsprotokoll wird
begrenzt archiviert, ohne Geräteschlüssel zu verwerfen. `pnpm build` erstellt beide
Oberflächen; `pnpm start` startet den vorhandenen gemeinsamen Stand.
[Bedienung und Prüfstand](MOBILE_PAIRING_RECOVERY.md).

## Tablet-Terminal: Links und Bilder

Weblinks aus sichtbarer Terminalausgabe werden per Touch und im Textverlauf
bedienbar; eine Linkliste bietet Öffnen/Kopieren und Hinweise für lokale
PC-Adressen. Codex-Sitzungen erhalten einen Bilddialog mit Dateiauswahl,
Clipboard-Alternative, Vorschau, Nachricht und ausdrücklichem Senden. Rechte,
Sitzungsbindung, unklare Versandquittungen und Fokuswechsel sind Teil des
[Vertrags](TERMINAL_MEDIA.md). Der Ablauf wird für jede Plattform getrennt geprüft.

## Zentraler ADE-Agent (Umsetzung läuft, 17. September 2026)

Der erste Codex-Tablet-Ablauf ist implementiert: Im globalen Gespräch ausdrücklich
eine Übergabe oder Projektaufgabe vorbereiten lassen. **Übergabe prüfen → Übergabe
speichern** legt die Notiz dauerhaft beim Projekt ab. **Auftrag starten** bestätigt
genau einen vorbereiteten Codex-Auftrag; **Vorschlag verwerfen** verwirft ihn.
Projektaufgaben brauchen **Koordinieren** und ein natives Codex-Profil mit Modell
und Reasoning. Brainstorming, Diktieren und Vorschläge starten keine Projektarbeit.
Die zugehörige Karte zeigt tatsächlichen Zustand, vollständiges Ergebnis und
beantwortbare Rückfragen. Neuladen oder verlorene Bestätigungsantworten erzeugen
keinen zweiten Auftrag. Der Graph behält dessen Projektbeziehung; diese abgeleitete
Beziehung lässt sich nicht als normale manuelle Verknüpfung entfernen.
Ein neuer Werkzeugvertrag oder geänderte Projektrechte benötigen **Neues
ADE-Gespräch**. [Tablet-Test und Grenzen](TABLET_CODEX_TEST.md).

ADE soll morgens den belegten Stand mehrerer Projekte und ausdrücklich
gespeicherte Abendübergaben zusammenfassen und einen nächsten Schritt vorschlagen.
Projekt 1 arbeitet in einer eigenen Codex-Sitzung, Projekt 2 brainstormt in
einer eigenen Grok-Sitzung und Projekt 3 setzt seine Claude-Code-Arbeit fort.
ADE betreut Projekt 1 und 3 parallel und vermittelt Rückfragen und Ergebnisse.
Direkte Arbeit im einzelnen Projekt und optionale ADE-Betreuung bleiben möglich.

Der globale Text-/Spracheinstieg benötigt kein zuvor geöffnetes Projekt oder
Terminal. Graph, Work, Projekte und Terminals sollen auf PC und Tablet dieselben
zugeordneten Arbeiten öffnen, ohne Doppelstart, Zielwechsel eines Entwurfs oder
implizite Eingabeübernahme. Einfache Touch-Navigation und sichtbare Kontextwahl
sind Teil der Abnahme. Unteragenten werden nur bei nachgewiesener Zuordnung
angezeigt. **Arbeit wechseln** und der dauerhafte Betreuungsplan mit expliziten
Sitzungs-/Run-Verbindungen sind auf PC/Tablet implementiert und fokussiert geprüft.
Die gespeicherten Modi starten noch keine automatische Arbeit. Ein erster
Textdialog auf PC/Tablet liest Projektstände und Übergaben über ADE-Werkzeuge und
bewahrt seinen Verlauf. Geräte benötigen die vollständige Projektfreigabe;
verlorene Sendequittungen werden mit derselben Vorgangs-ID geprüft. Gesprächsdiktat
ohne Terminal ist angebunden: Vorschau prüfen, in die Nachricht übernehmen und
ausdrücklich senden. Wechsel stoppt die Aufnahme und bewahrt den bisherigen
Teil beim ursprünglichen Gespräch. Sprachwiedergabe, Aktivierung per Zuruf und
ereignisgesteuerte Koordination bleiben offen. **Für nächste Session
merken** speichert eine explizite Projektübergabe samt nächstem Schritt.
**Morgenüberblick laden** zeigt verknüpfte Arbeitsstände, offene Übergaben und
einen Vorschlag; vollständige Notizen werden über **Übergabe lesen** geöffnet.
Diese Aktionen starten keine Projektarbeit. Erledigte Übergaben bleiben lesbar.
[Umsetzungsstand und Nachweise](MAIN_AGENT_IMPLEMENTATION.md);
[Goals und Pilot](MAIN_AGENT_GOALS.md), [vorhandene Fähigkeiten](MAIN_AGENT_BASELINE.md).

## Antwort anhören

PC und Tablet bieten in interaktiven Terminals **Antwort anhören**. Markierung
oder Ausschnitt werden als bearbeitbarer Entwurf geöffnet; nach Prüfung startet
**Anhören** mit der gespeicherten Stimme und ihren Parametern. Stoppen und
kostenfreies Wiederholen desselben Audios gehören dazu. Keine behauptete automatische
Erkennung der letzten Agentenantwort. [Grenzen und Nachweise](REPLY_SPEECH.md).

## Passive WSL discovery / Hermes (16 September 2026)

Listing execution environments must not start WSL distributions. Registration makes a backend selectable; only an explicit backend operation may start it and validate runtime health. [Diagnose und Nachweise](HERMES_WSL_DIAGNOSIS.md).

## Persönliche Stimme (Goal 33.0b)

Ein eigener Stimmen-Tab auf PC und Tablet bietet Tempo (0.70–1.20), Stabilität,
Stimmähnlichkeit, Stil und Speaker Boost. Vorschau verwendet ungespeicherte
Reglerwerte; Speichern gilt global auch für die Computer-Begrüssung. Standardtempo
0.85. Stimmenwahl und vorhandene Projekt-/Agent-Vererbung bleiben bestehen.
Kein Pitch-Effekt; [Bedienung und Vertrag](VOICE_SETTINGS.md).

## Computer-Sprachtest (Goal 33.0)

Im Prompt-/Diktatfenster auf PC und Tablet aktiviert **Computer testen** einen
begrenzten Sprachtest. **Computer** oder **Hey Computer** löst nach isolierter
Live-Erkennung eine kurze persönliche Begrüssung aus, passend zur Tageszeit des PCs
und gesprochen mit der ADE-Standardstimme. Text bleibt sichtbar. Abbruch stoppt
Aufnahme und Ausgabe; Replay verwendet dieselbe Audiodatei. Andere Diktat- und
Sendeaktionen sind währenddessen gesperrt. Der CLI-Entwurf bleibt unverändert.
Der Test hört höchstens 20 Sekunden zu und endet bei geschlossenem/verborgenem
Fenster oder verlorener Verbindung. Freigaben für Diktat, Terminalsteuerung und
Stimmtests gelten auch hier. Arbeitsrückblick und weitere Sprachaktionen sind
eine spätere Ausbaustufe; [Goal 33](VOICE_COMPANION_PROPOSAL.md).

Die gewünschte Anmutung orientiert sich am Voyager-Computer: ruhig, sachlich,
gleichmässige Betonung und leicht reduziertes Tempo. Die Begrüssung lautet
„Guten Morgen/Tag/Abend, Adi. Schön, dass du da bist. Was kann ich für dich tun? Wähle nach dieser Begrüssung ‚Diktieren‘ und beschreibe, wobei ich dich unterstützen soll. Deinen Text kannst du anschliessend prüfen und an die ausgewählte Sitzung senden.“ Stimmvorschau
und Computer-Test verwenden dieselbe Abstimmung auf der ausgewählten Stimme.
Die konkrete Klangähnlichkeit wird durch eine persönliche Hörprobe beurteilt.

## Work und Profile auf Desktop und Tablet

Am Desktop stehen interaktive Sitzungen unter **CLI-Arbeit** in Work und
Overview: Projekt, Originalordner/Worktree, Startbranch, CLI, Backend, optionales
Startprofil und tatsächlich bekannter Startmodellwert. Eigene Titel, Suche und
Filter erleichtern den Wechsel. **Sitzung öffnen** wählt dieselbe Sitzung ohne
Doppelstart; ein inzwischen geänderter Projektbranch wird als Konflikt erklärt.
**Neue Ausgabe** ist eine Beobachtung, kein erfundener Aufgabenfortschritt.
CLI-Ende, offene Shell, geschlossenes Terminal und unbekannter Status bleiben
unterscheidbar. Managed Runs haben ihre eigene Liste. Mobile behält seine
bestehende Sitzungs-/Continue-Work-Navigation; keine vollständige Desktop-Parität
dieser neuen Arbeitsliste behaupten.

Mobile Terminals zeigen bestätigte PTY-Ausgabe. Kurze aktive Abfrageintervalle,
ausgelassene unveränderte Bilddaten und Prozessscope-Prüfungen ohne Git-Start
pro Taste verkürzen die Rückmeldung. Die lokale Messung ist keine pauschale
Tablet-/WAN-Latenzzusage. Der unten beschriebene Diktatablauf ist implementiert;
das Kostenjournal bleibt ein aktives Ausbauziel. Im aktuellen Arbeitsstand
ergänzt „Sitzungsverbrauch“ den Terminal-Nutzungsabruf für neue native
Windows-Codex-/Claude-/Grok-Starts: Input/Output, darin enthaltene Cache-/Reasoning-
Anteile, Datenlücken und getrennt bezeichnete API-Schätzungen/Anbieterbeträge.
Die Anzeige wird am PC und Tablet geteilt. Kontingente, Gesamtbudget und
Einzelabrechnung bleiben verschiedene Angaben; unbekannte Werte sind nicht 0.
ElevenLabs-Diktat zählt die geprüften Audiosekunden dieser Sitzung, Stimmtests die
übergebenen Zeichen. Beantwortete, ausstehende, unbestätigte und vor Versand
beendete Aufträge bleiben getrennt. Das erzeugt keine geschätzten LLM-Tokens oder
erfundenen Einzelpreise. Projekt-/Zeitsummen, Kontenansicht, Budgets und vollständige
Wiederaufnahmeabdeckung sind noch offen. Die neue Verdrahtung ist separat vom
Diktat-Paket in Abnahme.

Beide Oberflächen bieten die Navigation Overview, Projekte, Terminals, Work,
Graph in derselben Reihenfolge. Work zeigt Runs mit Suche nach Name, Projekt
oder Agent sowie Projekt-, Agent- und Statusfilter (alle/offen/beendet).
Run-Auswahl öffnet Details; am PC ist zusätzlich der direkte Wechsel zum selben
Run im Graph möglich. „Neue Aufgabe“ sendet einen einzelnen Auftrag für einen
Agenten in einem Projekt; „Neuer Run“ öffnet die Team-Zusammenstellung.
Fehlgeschlagene Aufgabenübermittlung kann mit identischem Auftragsschlüssel
wiederholt werden. Die Work-Liste und Profilauswahl starten keine CLI.

Die normalen PC-„Agent settings“ enthalten denselben Editor für Arbeitsweise,
Anweisungen, geordnete Markdown-Kopien, Vorschau und Agent-Stimme wie Profilkarte
und Tablet. Anweisungen werden mit „Profilanweisungen speichern“ gespeichert;
das allgemeine „Save“ speichert die übrigen Agent-Einstellungen. Neue Sitzungen
übernehmen die gespeicherten Anweisungen nach den bestehenden Profilregeln.

## Stimmen und Meine ADE Projekte

Die Projektliste beginnt mit „Meine ADE Projekte“. Eine bewusst gewählte Ansicht
„Alle“ bleibt beim Wiederöffnen erhalten; fehlender Browser-Speicher verhindert
das Filtern nicht. Der mobile Promptdialog benennt den tatsächlich zugeordneten
Projekt-Workspace auch dann, wenn die CLI ohne Agent-Profil gestartet wurde.

Desktop Settings bietet „Sprachausgabe · ElevenLabs“: Stimmen laden, Stimme
auswählen, „Stimme testen“ und Wiedergabe stoppen. Die Auswahl wird gespeichert;
ohne bisherige Wahl wird eine verfügbare weibliche Stimme vorgeschlagen. Ein
kurzer deutscher Testsatz wird nur nach Betätigung erzeugt. Fehlender Key,
fehlende Provider-Rechte, leere Listen und Wiedergabefehler sind sichtbar.
„Prompt / Diktat“ ist im Terminal als eigener, sitzungsgebundener Editor
implementiert. „Diktieren“ streamt auf PC und Tablet bis zu 5 Minuten an
ElevenLabs; „Aufnahme stoppen“ schliesst die laufenden Textabschnitte ab.
Die Mikrofonfreigabe erfolgt vor dem Provideraufbau und verbraucht keine
Aufnahmezeit. Ohne erstes Audio endet eine bereite Verbindung nach 30 Sekunden;
ab dem ersten Paket gilt eine feste Hostfrist von 305 Sekunden.
Bestätigte Abschnitte bleiben neben dem ersetzbaren Zwischenstand erhalten;
das gesamte Transkript ist auf 12.000 Zeichen begrenzt. Die Dauer ist eine
ADE-Grenze, kein behauptetes ElevenLabs-Limit. Der kompatible Batch-Pfad bleibt
auf 60 Sekunden begrenzt. Der Text bleibt vor der Übergabe editierbar. „In CLI
einfügen“ fügt ein, „An CLI absenden“ ergänzt Enter. Ein unbestätigter Versand
bleibt sichtbar und wird nicht automatisch wiederholt. Der Entwurf wird auf
diesem Gerät gespeichert; Aufnahme und API-Key werden dort nicht gespeichert.
Am Tablet benötigt Diktat die eigene Gerätefreigabe sowie Browser-Mikrofonzugriff.
Geschützte Promptziele sind neu gestartete native Windows-Codex/Claude/Grok-CLIs
mit aktivem mehrzeiligem Paste. Tatsächliche Providerabnahme bleibt separat:
[Implementierungsnachweis](DICTATION_IMPLEMENTATION_RESULTS.md).

Mobile bietet einen sichtbaren Zugang „Einstellungen“ mit Stimmenwahl und
Stimmtest. Die Gerätefreigabe „Stimmen wählen und ElevenLabs-Stimmtests
ausführen“ wird am PC vergeben. Die Auswahl gilt auf diesem ADE-Host.
Agentenprofile und Projekt-Einstellungen bieten eine eigene Stimme oder
„Erben“: Agent → Projekt → ADE-Standard. Die wirksame Stimme und ihre Herkunft
sind sichtbar. Nach einer verlorenen Antwort lässt sich derselbe Stimmtest
erneut prüfen; ein neuer kostenpflichtiger Test erfordert eine neue Aktion.
Ein Antippen des Profilbilds öffnet eine größere Ansicht mit Schließen,
Escape und Fokusrückgabe. Diese vergrößert das ausgelieferte Vorschaubild.
Ohne persönliches Foto zeigen Codex/OpenAI, Claude, Grok und Ollama auf Desktop
und Tablet lokal gebündelte, scharf skalierende SVG-Logos. Eigene Fotos haben
Vorrang; das Logo folgt der Runtime des Profils.

Desktop und Mobile zeigen unter Projekte „Alle“ / „Meine ADE Projekte“.
Hinzufügen und Entfernen ändern die persönliche ADE-Auswahl auf diesem Host;
Dateien, Git, Terminals und Verlauf bleiben erhalten. Die Overview-Projektkarten
und Projekt-Shortcuts zeigen diese Auswahl. Laufende Sitzungen bleiben unter
Weiterarbeiten erreichbar. Ein neu entdeckter Ordner wird durch bloßes Öffnen
nicht automatisch zur Auswahl hinzugefügt. Am PC nimmt ein Ordnerdialog auch
bestehende Git-Projekte außerhalb des Projekt-Stamms auf. Mobile benötigt zum
Ändern der Auswahl die Projektverwaltung und volle Ressourcenfreigabe.

Die mobile Terminal-Kopfzeile bündelt Verbindung, Eingabebesitzer und
Nutzungsdetails. „Sitzung & Workspace“ klappt Start-/Workspace-Bedienelemente
ein und aus; die Einstellung bleibt auf dem Gerät erhalten. Nutzungsanzeigen
benennen CLI und Datenquelle, vorhandene API-Zugänge, unbestätigte Anmeldung,
gemeldete Abo-Fenster, verbrauchten/restlichen Anteil und Reset-Zeit.
Ein vorhandener Key beweist keine tatsächliche API-Abrechnung.

## Run-Verlauf auf Mobile löschen

In den Run-Details erscheint **Run löschen** für abgeschlossene, fehlgeschlagene
und abgebrochene Runs. Die endgültige Entfernung aus dem Verlauf verlangt eine
Bestätigung; Projektdateien und Workspaces bleiben erhalten. Aktive Leases und
externe Veröffentlichungsnachweise sperren die Löschung. Sie benötigt ein
gekoppeltes Gerät mit `runs:write` und vollständiger Ressourcenfreigabe. Bei
Antwortverlust wird derselbe Auftrag nach Neuladen erneut geprüft. Eine bestätigte
Löschung entfernt den Run auch aus Work und Graph und setzt den Tastaturfokus auf
die aktive Navigation zurück. Desktop behält seine vorhandene Löschfunktion.

## Geprüfte Übernahme älterer Workspace-Änderungen

Desktop und Mobile bieten im Git-Abgleich **Änderungen übernehmen…**.
Benutzer wählen einen Quell-Workspace und einzelne Dateien, vergleichen Basis,
Quelle und Ziel und bereiten eine unabhängige Arbeitskopie vor. Gespeicherte
Berichte führen zu Datei-/Konfliktbearbeitung, ausführbaren Projektprüfungen und
ausdrücklicher Commit-/Fast-forward-Freigabe. Erfolgreiche Tests ersetzen keine
fachliche oder Rhino-Liveprüfung. Quelle und ungewählte Inhalte bleiben erhalten.
Veränderte Basis, belegte Workspaces, Konflikte und fehlender Testnachweis sperren
die Übernahme. Mobile-Anfragen bleiben nach Antwortverlust mit demselben
Idempotenzschlüssel prüfbar. [Bedienung und Grenzen](WORKSPACE_INTEGRATION.md).

## Agent-Obergruppen

Bestehende Kategorien können optional einer benannten Obergruppe zugeordnet
werden. Es gibt genau eine zusätzliche Ebene. Desktop-Terminals und mobile
Terminals zeigen dieselbe Hierarchie, mit Suche und gespeicherter Auf-/Zuklapp-
Auswahl. Desktop-Kategorieeinstellungen und die mobile Verwaltung unter Agents
erlauben einen bestehenden oder neuen Gruppennamen; leer entfernt die Zuordnung.
Agent-Identitäten, Projektzuordnung und Graph-Rollen bleiben erhalten.
[Aktiver Implementierungs- und Abnahmeauftrag](INTEGRATION_NAVIGATION_GOALS.md).

## Mobile Projekt- und Workspace-Zuweisung

Die Projekt-Auswahl bietet **Projekte durchsuchen…**, einschliesslich bisher
unregistrierter Git-Projekte im konfigurierten Stammordner. **Prüfen** zeigt
Git-Zuordnung, Branch, lokale Änderungen und Belegung ohne Mutation; erst
**Workspace zuweisen** bestätigt die Auswahl für mobile Dateien und Terminals.
Die Anzeige unterscheidet die vorhandene Zuordnung von **Nicht belegt**.
Details, Grenzen und Abnahme: [Workspace assignment](WORKSPACE_ASSIGNMENT.md).

## Freie Terminals auf Desktop und Mobile

Desktop **Terminal öffnen** offers a **Workspace** chooser with native home and
discovered projects. A project launch displays its actual branch and opens the
independent workspace, without a mandatory agent. Its three quick actions open
Codex, Claude Code or a shell; a saved agent profile is an explicit option.
Matching live sessions are reused; **Zusätzliche Sitzung starten** creates another.
Project session tabs support Left/Right/Home/End, Ctrl+PageUp/PageDown and
Ctrl+Shift+T/W. Exited terminals retain output and offer restart. Active project
selection survives switching to Git and back; live sessions recover on reload.

Desktop terminals offer selection copy, clipboard paste, search (Ctrl+Shift+F,
Enter/Shift+Enter, Escape to close and restore input focus), history start/live
navigation and font sizes 11–24 px. Font preference survives reload. Search is
limited to the retained xterm buffer. Paste is disabled while another device
owns input and for exited terminals. Existing Ctrl+C selection/SIGINT and
clipboard-image forwarding semantics are retained.

**Terminal öffnen** starts a native host-home shell or a discovered CLI without
requiring an agent or project. Desktop **Freie Terminals** and Mobile **Terminals**
expose these same main-owned sessions. Mobile includes agent/session navigation,
CLI choice, exclusive input ownership, close confirmation, expanded terminal,
font size and a theme that also updates xterm. Phone navigation collapses into
**Agents und Sitzungen**. The close confirmation stays open and waits while a
terminal request is in flight; it cannot silently discard an accepted click.
The terminal grant plus all-resource access is required
for free home sessions. Detailed scope and validation: [TERMINAL_WORKSPACE](TERMINAL_WORKSPACE.md).

## Tablet-Arbeitsplatz: Windows-Abnahme und Neustart (12. September 2026)

Freigaben, Startwiederholung, native Codex-Rückfragen mit Live-Aktivität sowie
haltbare Ergebnisdateien und Ergebnisseiten sind implementiert. Vollständiges
`pnpm verify`: 2.770 Prüfungen bestanden, zusätzlich 5 reale Codex-Prüfungen.
Die geprüfte ADE-Kopie läuft mit dem persönlichen Profil; private HTTPS-Adresse,
bestehende Samsung-Kopplung, fünf Projekte und sechs Agentenprofile sind geprüft.
Physisches Samsung/DeX und das nicht antwortende Ubuntu bleiben offen.
[Teilziele](TABLET_WORKSPACE_GOALS.md), [Abnahme und Operatorzustand](TABLET_WORKSPACE_RESULTS.md).
Die darunter genannten älteren Gesamtprüfungen gelten für ihre damaligen Stände.

## First setup without an agent profile

Desktop **Einrichtung** joins project root, native CLI/sign-in checks, optional
tablet pairing and device permissions. Users can move among these steps or open
Projects directly. An empty ADE profile offers project setup without requiring
a category. Existing agents and Settings remain available. Saving a folder does
not install or launch a CLI; sign-in occurs through the chosen CLI in a project.
Pairing and each grant retain their explicit confirmation. Failed checks replace
stale success with an actionable retry state.

Device grants offer **Projektarbeit auswählen**, **Dateilesen auswählen** and
**Push/PR auswählen**. These only add checkboxes to the local draft; users review
and save explicitly. Project work excludes publishing and host restart.
Mobile **Settings → Einrichtung auf diesem Gerät** lists exact missing switches
for a chosen intention and links to Projects or Graph. It distinguishes missing
root configuration, unavailable metadata, failed refresh and offline cached data.
Existing grants do not prove CLI authentication. **Build-Stand** displays the
host and browser source/dependency identifiers. Known differences give manual
update guidance; missing legacy identifiers are unknown. No automatic reload
or permission change occurs. Closing Settings and opening the next view preserve
keyboard focus; narrow displays remain usable.

## Run files on Graph and projects

Graph offers **Dateien dieses Runs** directly; project workspaces offer
**Ergebnisse** for their latest runs, on desktop and tablet. File rows identify
the originating task and distinguish observed new/modified/deleted files,
agent-reported files and unknown legacy provenance. Unchanged files are optional.
Images preview; spreadsheets, PDF and other regular files can be downloaded
individually (16 MiB/file). Chrome can then open a download with a compatible app.
ADE does not render spreadsheets or arbitrary document content inside the Graph.

Saved downloads use the captured completion bytes. Other downloads use the
current original task workspace; later changes are marked. Deleted files without
a saved copy retain evidence without a working download. If a current workspace
file changes after listing, the download asks users to refresh the file list
and open it again; it does not misreport this conflict as an outdated ADE host.
Missing baselines never become an invented run delta. The selected project branch
does not silently receive changes from a task worktree. Capture/list limits and
unavailable workspaces are visible. This slice is native Windows evidence; WSL
binary result browsing beyond the supported types remains separate work.
New native tasks save changed completion files by SHA-256 outside the config:
16 MiB/file, 100 files/task, 2 GiB total storage. Saved downloads retain the
completion bytes after later workspace edits/deletion and require current device
and resource grants. Missing/tampered blobs fail closed; incomplete captures are
explicit. Retained project history has 20-run cursor pages. Cold JSON run archives
remain operator files; this change does not introduce archive import.

## Project Git completion

Inside an independent project workspace, **Terminal** and **Git** are distinct
sections. Git shows the actual branch, HEAD, changed/staged/conflicting files and
diffs. Select files, enter a message, review and explicitly commit that selection.
An active terminal must be ended before Git mutations. Small supported files can
be edited with optimistic conflict protection. Merge remains open for review;
resolve files, mark them resolved and explicitly finish, or review an abort.
Fetch and reviewed fast-forward are separate operations. Missing permissions,
unsupported files, stale previews and uncertain replies explain the next action.
Mobile recovery reuses the original receipt; no blind duplicate commit/save.
**Push und Pull Request** adds an explicit publication stage. Choose a configured
remote, inspect its actual destination, then review and push the exact branch
commit. GitHub PR preparation selects target branch, title, complete description
and draft status; the branch must already be pushed. Existing matching PRs are
reused. Publication needs its own device grant. Completion displays the confirmed
commit/time; **Remote-Stand prüfen** reads current state and links existing PRs.

## Mobile run results

Open a Work run or select a Graph agent, then use **Aktivität**, **Ergebnis** or
**Dateien**. Activity distinguishes recorded task status from the observed process
and reports last output, received bytes and bounded CLI steps. It does not simulate
progress. Standard structured CLI answers survive reload/restart; older runs may
lack an answer and explain that explicitly. Exit 0 alone is not proof of fulfillment.

Signed devices with workspace read access can preview PNG/JPEG/WebP and download
bounded regular files from saved completion captures or the original task workspace.
The list distinguishes observed changes and unknown/reported older provenance.
Unsaved file availability depends on the original workspace; saved copies remain
available independently while their run stays in the journal. Approval, integration and
publishing of managed runs remain distinct flows; independent project Git is available on desktop/tablet.

Project workflow goal: discovery and independently registered project workspaces
are available through **Projekte** on desktop and tablet in
[T2a/T2b](PROJECT_WORKFLOW_GOALS.md). The native directory list includes unregistered
Git folders, ordinary folders (without implicit Git initialization), and unavailable
entries. Explicit open keeps the chosen existing checkout and displays its actual
branch without creating a hidden profile or modifying instructions. The tablet
needs separate read/open grants. Branch controls show local and cached remote
refs, preview switching/creation, and can open or create a separate worktree.
Mobile branch mutations additionally need explicit `projectGit:write`.
The opened checkout launches Codex/Claude/Grok/Shell without a required profile;
an explicitly selected saved profile contributes launch settings only. Live
sessions prevent changing their checkout's branch. Agent-Arbeitskopie preserves
the previous agent-owned CLI flow.

Interactive lifecycle (updated 2026-09-15): the selected session displays its
launched CLI separately from the terminal. Protected native Windows coding
invocations end their terminal with the CLI; custom/assistant/WSL launches can
still show **CLI beendet · Terminal offen**. Launcher choice describes what to
open and cannot relabel the current session. Opening after CLI return starts a
new invocation while keeping previous output available; a matching live invocation reattaches
it. Browser connectivity and input ownership remain separate indicators. Later
manually typed shell commands are not represented as tracked ADE CLI launches.
Implementation and acceptance: [project workflow goal T1](PROJECT_WORKFLOW_GOALS.md).

Earlier agent project entry (2026-09-09): Agent-Arbeitskopie opens an ADE project working copy,
then offers independent Codex/Claude/Grok/shell choices. Overview project cards
use the same entry. Agent workspaces have a direct saved-profile Open action;
the terminal retains usable height and the empty composer starts folded.
Contracts: `PROJECT_ENTRY.md`; validation/deployment: `PROJECT_ENTRY_RESULTS.md`.

Mobile keyboard layout (2026-09-09): visual-only keyboard resizing automatically
folds terminal chrome to a compact title/Bedienung header and terminal-key row.
An active composer and errors remain accessible; keyboard close restores the
previous layout. Behavior: `PROJECT_ENTRY.md`; evidence: `TERMINAL_KEYBOARD_RESULTS.md`.

Keyboard activation follow-up: tap the CLI or press **Tastatur** to request the
software keyboard, including after dismissal while input stays focused. An
existing PC input lease still requires **Eingabe übernehmen**. No automatic
takeover is added. Evidence: `TERMINAL_KEYBOARD_ACTIVATION_RESULTS.md`.

Assistant access (2026-09-09): explicit home-terminal open/resume on desktop and
Mobile; Mobile xterm display/direct keyboard input and separate private dashboard
tabs; automatically refreshed Overview with current/history filters. Contracts and
limits: `ASSISTANT_ACCESS.md`. Release evidence: `ASSISTANT_ACCESS_RESULTS.md`.

Terminal response improvement: 16 ms keyboard coalescing, immediate refresh after
accepted direct input, 100 ms visible display polling and a PC response-time
indicator. WSL home validation keeps fresh no-link/identity checks through a
reused read-only helper. Measurements: `TERMINAL_LATENCY_RESULTS.md`.

Status: v0.15 (assistant terminals, separate dashboards and live Overview implemented;
native Windows/WSL automation and physical-device acceptance tracked separately, 2026-09-09)
Owner: Adi. This document is the source of truth for coding agents.

Dynamic model selection (2026-09-09): New Agent and Agent Settings load dropdowns
from installed Codex, Grok, Claude and Ollama CLIs in the selected environment.
Refresh, useful loading/error states and preserved unconfirmed saved choices
replace the default text-only model fields. Claude selection is persisted and
passed to session launch; Codex effort choices follow model capabilities.
Contract and executable evidence: `RUNTIME_MODEL_SELECTION.md`.

Ollama coding harness selection (2026-09-16, Goal 31): **Ollama verwenden als →
Coding-Agent → Coding-Harness** offers **Codex CLI · Ollama** and **Qwen Code ·
Ollama**. The model remains a separate selection. Existing coding profiles keep
Codex; direct chat stays `ollama run`. Creation, editing, templates, copies and
portable bundles retain the selection. PC/tablet saved-profile launches use it;
a missing selected CLI produces an actionable error, never a fallback.
Contracts, permission semantics and platform evidence: `OLLAMA_HARNESS_GOALS.md`.

Tablet project entry (2026-09-09): Overview offers **Neues Projekt** and
**Weiterarbeiten**. The PC owns the native project parent; the tablet supplies a
name and opens a fresh local Git project on main without a profile or automatic
CLI launch. Desktop Projects offers the same creation flow. Users then choose
the branch and CLI. Mobile CLI launch uses the existing terminal grant. Creation progresses through
confirmed, recoverable steps. Existing work remains intact on launch failure.
The tablet workspace fills the visual viewport with a project rail on wide
screens, a terminal composer and existing files/changes views. Drafts and pending
commands survive reload on the paired device; connection recovery never submits
work automatically. See `TABLET_PROJECT_START.md` for bounds and operator setup,
and `TABLET_PROJECT_START_RESULTS.md` for executable evidence.

Desktop Git workflow: Graph and the repository inspector expose **Git-Abgleich**;
New Run exposes the same preflight panel. The user chooses a local/origin basis,
compares each worktree, explicitly fetches remote state and confirms one exact
fast-forward at a time. Uncommitted files, own commits, active sessions/leases
and unfinished Git operations block target updates. A local refresh never means
the server was checked. New worktrees still use main HEAD and managed runs use
orchestrator HEAD. Full boundary and mobile follow-up: `REPOSITORY_SYNC_PLAN.md`.

## What it is

One desktop app where all of the user's CLI agents live — for coding, writing
and content work. The terminal is the execution plane: every interactive
session is a real terminal running a real CLI agent. Graph is the optional
control plane for dispatching and observing bounded task runs over those same
agents. It is not a separate fake-agent system or a replacement chat UI.

Overview is the read-only home over that same journal: who is live, which
catalog projects exist, and which runs last moved. It does not invent
telemetry or replace Terminals or Graph.

The desktop remains the only execution host. The installable mobile companion
submits and observes managed work and, with separate desktop device grants,
opens workspace files, Git changes and interactive host terminals. All agents,
Git operations and terminal processes run on that host.

References:
- Layout sketch: `mock/PENUP_20260707_214207.png`
- Approved clickable mockup: `mockup/index.html` (visual reference for
  layout, spacing, copper accent)
- Superset (`reference/superset`, Elastic 2.0) — architecture donor
- Hermes (`reference/hermes-agent`, MIT) — memory system donor
- Conductor screenshots (`mock/Screenshot1.png`, `Screenshot2.png`) — tab feel,
  explicitly WITHOUT macOS traffic-light styling

## Core model

- **Category** — top-level organizational group (a YouTube channel, a repo, a
  book). Has: name and profile photo. It may suggest a default repository for
  onboarding, but it does not own an agent's workspace.
- **Repository** — a first-class catalog entry for one local
  Git repository. The same repository may scope many agents, sessions and runs.
- **Agent** — lives under a category. Has: name, profile photo, runtime
  (which CLI it runs), permission mode, optional default repository, a plain
  home workspace, its own skills, and its own Hermes-style global memory
  (`MEMORY.md`, `USER.md`, providers).
  An agent is an identity, not a repository workspace; its workspace bindings
  supply execution scope.
- **Workspace binding** — one agent plus one repository plus
  one ADE-managed worktree/branch. Bindings are independent per repository and
  may be reused by later non-conflicting executions.
- **Agent template** — immutable spawn defaults and a memory
  seed. Spawning creates a new agent identity, memory directory and optional
  default repository; a template owns no process or mutable workspace.
- **Session** — a terminal window of one agent. Selecting an agent shows its
  sessions as tabs across the top. Multiple sessions of the same agent run
  in parallel. Each session snapshots an immutable repository/workspace scope;
  selecting a different repo opens a new session instead of changing a live
  PTY's working directory. Sessions are NOT split by model — one agent, N
  terminals.
- **Run** — a persisted execution of one user goal. It references existing
  agents as participants and selects an explicit repository scope when Git
  work is required; it does not create permanent agent identities.
- **Task** — one run-scoped unit of work assigned to a participant, with real
  queued/running/completed/failed/cancelled state and an event history.
- **Publication** — a durable audit record for an explicitly confirmed export
  of one attested managed-run HEAD to a new `ade/**` branch and GitHub Draft
  Pull Request. It is not a merge approval or an agent capability.
- **Participant role** — orchestrator/lead/worker is scoped to a run. The same
  named agent may play a different role in a different run.
- **ADE host** — the logged-in desktop process that owns all
  runtime credentials, PTYs, repositories and orchestration state. It may
  expose a disabled-by-default, loopback-only control API through an explicitly
  configured private ingress.
- **Remote device** — a durable revocable control identity with an OS-encrypted
  secret, desktop name and revocation record. Settings can list, rename and
  revoke imported and QR-paired identities. Pairing never
  grants raw terminal, configuration or unrestricted filesystem access.

Graph assigns participants and roles per run. Older Graph-created categories
and agent `teamRole` fields are imported once as a legacy run and retained so
the migration never deletes user data.

## Layout (per approved mockup)

- Left rail, two levels: category tiles (square-ish avatar + name), agent rows
  underneath (round avatar + name + role + presence dot when a session runs).
- Top: session tabs of the selected agent. `+` opens a session, `×` closes.
- Center: the terminal.
- Right: collapsible panel with **Overview**, **Changes** and **Files**. Overview
  inspects the repository selected in the scope header: local health, recent
  commits, on-demand commit patches and optional open GitHub Pull Requests.
  Changes (real git diff) and Files (agent files plus lazy workspace tree) remain
  bound to the active immutable session workspace. The header names both scopes
  and offers safe choose/default/detach/new-session actions.
- All three regions resizable via drag handles (rail width, panel width).
  The default order is rail | terminal | inspector. Settings may place the
  inspector on the left instead; the choice is optional and persisted. Overview
  and Graph stay full-bleed.
- Top-level Overview / Terminals / Graph tabs switch views without creating a
  second copy of agent, workspace, session, or task state. Overview is a
  full-bleed inventory; Terminals keeps the rail, session tabs and inspector;
  Graph keeps the orchestration canvas. A per-agent OpenClaw Dashboard window
  is a different surface and is not this home view.

## Overview home (implemented)

- Overview is a third top-level mode (`Ctrl+3`; `Ctrl+1` Terminals, `Ctrl+2`
  Graph). It is read-only: no spawn, no run start, no inspector Git poll.
- The projection is `overview:get` over the persisted catalog, workspace
  bindings, run journal and the live PTY list. It never includes host paths,
  prompts, mailbox bodies or diagnostics.
- Three hero numbers: **Live** (running PTYs), **Offen** (runs with status
  `running` or phase `approval`), **Tokens** (sum of reported input+output;
  `—` when no managed task reported tokens). Cost is a caption with an
  explicit unknown-task count; missing telemetry is never filled with zero.
- Agent rows follow category membership then leftovers. An agent's
  `lastActivityAt` is the max of its last run `updatedAt`, any binding
  `lastUsedAt`, and interactive session bookends; a run name is extra context,
  never the only clock. Project cards are catalog repositories only —
  portable homes do not appear.
- Work is the 20 newest **closed** interactive sessions and runs. Live
  sessions stay in the Live figure, not in Work. Session rows have no token
  rollup. Task PTYs are not booked here; they already live in the run journal.
- Clicks leave Overview: an agent or project opens Terminals; a run opens
  Graph on that run; a session opens Terminals on that agent (and that tab
  if the PTY is still live). Refresh is event-driven (`orchestration:changed`,
  `pty:exit`, `pty:removed`), not a timer.

## Graph control plane

- Task dispatch is explicit and cancellable. One-shot task sessions use a
  runtime's non-interactive transport and exit when the CLI finishes.
- A global scheduler caps active task CLIs; queued work and the cap are visible.
- UI state must come from real queue/process/run events. Timers may animate an
  event but must never invent working or completion state.
- Runs, tasks, participants, events, and artifacts survive renderer reloads and
  app restarts. Interrupted tasks must resolve to a terminal failure state.
- Selecting a failed run must reveal its persisted actionable error directly
  and accessibly; a generic red status without the task/journal reason is not a
  sufficient recovery state.
- Fan-out must state the process count before launch. Worker-specific planning,
  communication, verification and integration are required before Graph is
  described as orchestration rather than dispatch.
- Desktop IPC and remote commands must enter through one transport-neutral
  application boundary. A remote endpoint must never proxy arbitrary Electron
  IPC channels.
- Retried remote mutations must be idempotent, and remotely observed state must
  come from resumable authoritative events rather than client timers or local
  optimistic completion.
- Repo-backed managed runs select one repository at run level. Every participant
  receives an exclusive agent/repository binding in that repository; one run
  does not transactionally integrate across multiple repositories.
- A successful final verifier atomically attests the exact repository HEAD,
  verification task and time with run completion. Older or plain-workspace
  runs do not gain publication eligibility by inference.
- External publication is a separate local-desktop action after completion. A
  read-only preview and a second explicit confirmation may create only a new
  ADE-owned branch plus a Draft Pull Request. ADE never directly pushes or
  merges the repository default branch.
- Publishing must re-prove clean/same verified HEAD, repository identity,
  unchanged remote base, a collision-free generated ref, provider access and
  exact Draft-PR base/head/head-SHA. Request, success, interruption and failure
  remain durable audit state.

## Repository scopes and reusable agents (implemented Goal 5)

- Repository choice and agent identity are independent. A specialized agent
  may have one default repository; a portable agent has none and receives an
  explicit scope per new session, task or run.
- Scope resolution is explicit request → optional agent default → plain home
  workspace. The result is snapshotted and cannot be redirected by later
  default changes.
- Files/Changes always resolves through the selected session/task/run binding,
  never through a mutable global agent path.
- Choosing another repository while a terminal is live creates a new session.
  Clearing or changing a default never kills a process or deletes/moves files,
  worktrees or branches.
- An agent/repository pair has its own binding/worktree. Active managed runs
  lease bindings exclusively under the current Goal 4 safety rules.
- Portable-agent memory is explicitly global. Repository-specific context comes
  from the selected worktree and a reserved binding-local memory boundary; ADE
  does not silently promote repository content into global agent memory.
- Existing category `repoPath` values and workspaces migrate once into
  repository/default/binding records without deleting legacy data.
- The right-panel scope header shows repository, resolution source, branch,
  shortened worktree path, clean/dirty state and active lease. Repository and
  filesystem IPC resolves the selected session snapshot in main.
- The default Overview tab inspects the selected catalog repository without
  retargeting the active session. It shows at most 12 local commits and 20 open
  GitHub PRs; a full-SHA commit patch is loaded only on demand and is capped.
  GitHub failure is an independent state and cannot hide local repository data.
  The inspector performs no fetch, checkout, branch/PR mutation or push.
- Inspector IPC accepts catalog IDs and exact commit object IDs, never renderer-
  supplied paths or commands. Main revalidates repository identity and routes
  Git/`gh` through the repository's persisted native or WSL backend.
- Agent settings can save an immutable template seed. New-agent onboarding can
  spawn that template into an independent identity and optionally bind it to a
  selected repository.

Detailed model, UI behavior, migration and exit criteria are binding in
`docs/REPOSITORY_SCOPES_PLAN.md` and `docs/ROADMAP.md`.

## Remote workspace tools (Goals 16–19)

Goals 20–21 extend this surface with **Ohne Projekt · Eigener Workspace**.
It opens the agent's configured native or WSL home, even if catalog projects
exist. Files, small edits and interactive terminals work there; Git and managed
tasks require a selected project. Reads never create a missing folder; explicitly
opening a terminal can prepare it. Root changes invalidate old edits/sessions.

The desktop `+` / Ctrl+Shift+T and tablet Terminal offer the same new-session
choice: **Leeres Terminal**, **Gespeichertes Agent-Profil**, **Codex**, **Hermes**,
or **Ollama** with an available model. This choice never rewrites the saved agent.
Fresh CLIs use default permissions/settings; saved profiles retain wrappers,
models and permissions. A session restart retains its own choice. Unavailable
CLIs/models are explained; discovery does not promise authentication or model
health. There is no model installation/download action. Existing separate remote
grants still apply. Acceptance: `SESSION_WORKSPACE_GOALS.md` and
`SESSION_WORKSPACE_RESULTS.md`.

An agent selection opens its workspace with an independent catalog-project
selector and an explicit task action. Files and Git are available without
starting a terminal. The first supported execution boundary is a verified
native worktree; reads never create one implicitly.

- **Files/Git:** `workspace:read` permits a bounded lazy tree, filename search,
  UTF-8 previews, branch/recent commits and separate staged/unstaged patches.
  Secrets, Git metadata, links and hardlinks are excluded; redacted/oversized
  previews cannot be edited.
- **Terminal:** `terminal:control` is an explicit per-device desktop grant to
  execute commands with the host user's rights. A workspace is a starting
  directory, not a sandbox. Start a shell/configured agent or select an existing
  interactive session; managed-task and credential-login sessions are excluded.
  One device controls input, desktop can reclaim immediately, and a 30-second
  heartbeat lease expires after disconnection. Closing the view does not kill
  the process. Output is bounded redacted text with explicit control keys;
  full ANSI color/mouse fidelity is outside this delivery. Unconfirmed input
  is never automatically replayed.
- **Small edits:** `workspace:write` plus read permission allows existing UTF-8
  text files up to 24 KiB. Show line numbers, search, undo and explicit save.
  Check binding/content revisions and show a conflict comparison; never silently
  replace changed content. Preserve BOM/newlines and refuse busy/leased workspaces.
  Keep up to 20 drafts in page memory across workspace changes; clear them on
  identity change. Reloading the page discards drafts.
- **Profiles:** `profiles:write` permits name, role and normalized bounded PNG
  photo changes with a profile revision check. Runtime commands and permission
  configuration remain desktop-only. The same stored profile updates desktop
  and tablet; name/role changes also update the durable role instructions.
  Managed identities cannot be edited until their run releases them. Photo
  upload is limited to 32 KiB/256×256 after normalization.
- **Behavior profiles:** Desktop and mobile share an
  instructions/Markdown-copy editor with ordered sources and revision conflicts.
  Explicitly saved behavior is supplied to new native Windows Codex/Claude
  profile sessions, independently of memory. Plain CLI starts remain deliberate
  choices without new ADE injection. A collapsible session panel identifies the
  captured profile digest and compares it with the saved revision. An explicit
  action retrieves the frozen session instructions; normal polling does not.
  Unsupported transports fail with a useful error. Resumed-thread behavior is
  not claimed. Native Windows acceptance and personal activation are recorded
  in `AGENT_PROFILE_RESULTS.md` and `HANDOFF.md`.

Every grant is opt-in at the desktop, independently of Tailscale membership.
Dedicated typed application APIs require signed devices and current grants;
mutations require idempotency keys and audit. Activation instructions:
`REMOTE_TERMINAL_GUIDE.md`. Acceptance: `REMOTE_WORKBENCH_RESULTS.md`.

## Mobile companion (personal alpha implementation)

- The first client is a responsive installable PWA for iOS and Android. A
  native mobile package is justified only by validated platform gaps.
- The personal alpha uses Tailscale Serve over a private tailnet. ADE listens
  on loopback only; direct LAN/public binds, router port forwarding and
  Tailscale Funnel are unsupported.
- The desktop must be powered on, logged in, online and running the ADE host.
  The mobile client must show offline/stale state clearly and may not queue a
  command for implicit execution after connectivity returns.
- A paired phone may inspect host readiness and a sanitized catalog, choose
  repository and agent independently, submit a bounded single-agent task,
  create/start/cancel a managed run, and observe task/run status and approval
  requirements. Detailed results and approval decisions remain on the desktop.
- Goals 12–15 add separately granted restart, agent/project/workspace creation
  and preview-confirmed Git synchronization. Goals 16–19 add the bounded
  workspace tools below. Raw PTY/IPC proxies, general configuration access,
  absolute host paths and unrestricted filesystem APIs remain excluded.
- Integration approval is a later privileged capability. It requires exact
  review evidence, recent passkey/device reauthentication, a single-use
  transition and a durable audit record.
- Every device has a distinct identity that can be listed and revoked from the
  desktop. Tailscale is an outer access boundary, not a replacement for ADE's
  endpoint authorization.
- Implemented desktop slice: Settings → Verbundene Geräte persists names and
  revocations, closes the revoked device's HTTP/SSE connections immediately and
  records device changes and remote requests in a bounded durable audit. Already
  accepted tasks continue and can be cancelled separately. Desktop Settings
  creates five-minute single-use QR/manual challenges. Browser identity keys
  are non-exportable WebCrypto keys in IndexedDB; reads/commands require signed
  proof plus a Secure HttpOnly Strict 30-minute cookie, with exact Origin and
  CSRF on mutations. The listener remains disabled by default and loopback-only.
- Settings enables/rechecks/disables the native host's private Tailscale Serve
  route and distinguishes configuration from HTTPS reachability verified with
  normal certificate validation. Initial certificate provisioning can take time.
  Unrelated routes are preserved. Unsafe ingress stops the host.
  Closing the window with mobile access enabled keeps ADE in the tray; explicit
  quit ends the host. Login autostart and remote wake remain future work.
- Implementation and platform evidence are in `goal8/MOBILE_CONNECT_RESULTS.md`;
  physical iOS/Android and mobile-network acceptance must be measured separately.
- Goals 8.6–8.9 align the mobile shell with the desktop: shared dark/light tokens,
  `ade_` title bar, Overview/Work/Graph navigation, agent/project inventory,
  searchable runs, team nodes and a tablet side inspector or phone detail dialog.
  New task/run dialogs preserve unsent drafts across view/theme changes. One
  connection remains mounted across views. This original slice stored only
  appearance/view preferences; the later tablet project-start slice additionally
  persists bounded device drafts and pending work keys. Goals 8.6–8.9 themselves
  introduced no new remote endpoint or privilege.
  The prior host keeps serving its loaded UI until the user's next normal restart.
  Acceptance: `goal8/MOBILE_DESKTOP_PARITY_RESULTS.md`.
- The service worker caches only the versioned application shell. Credentials,
  API responses, patches and run details are not intentionally available
  offline.

The complete scope, trust boundaries and sequenced delivery plan are binding in
`docs/REMOTE_CONTROL_PLAN.md` and `docs/ROADMAP.md`.

Verified Draft-PR publishing remains local to the trusted desktop renderer/main
boundary and is deliberately absent from the planned remote API. Its provider,
Git and recovery contract is binding in `docs/VERIFIED_PUBLISHING_PLAN.md`.

## Feedback-driven requirements (2026-07-07, binding)

1. **Resizable** rail and right panel (drag to resize, persisted).
2. **No emojis anywhere** in the UI. Identity = profile photos.
3. **Uploadable profile photo** per category and per agent (PNG/JPG, alpha
   respected). Fallback: initials avatar. Stored in app data.
4. **Remove superfluous chrome**: no Open/Run buttons, no always-visible or
   session-global model picker, no worktree path in a status bar, no setup
   buttons. Sessions are just terminal windows you pull open. An agent's
   advanced settings may persist the exact native runtime model/reasoning
   profile needed for reproducible orchestration; changing it is an identity
   configuration action, not transient terminal chrome.
5. **Real CLI layer**: the terminal is a true PTY wrapper that launches the
   agent CLIs. No fake chat layer.
6. **Supported runtimes** (launch profiles): Claude Code, Codex, OpenCode,
   Grok Build, Ollama (open-source models), plain shell. Extensible list.
7. **Permission modes** per agent (translated to the right flag per CLI):
   - Claude Code: default / `--permission-mode acceptEdits` /
     `--dangerously-skip-permissions`
   - Codex: default / `--sandbox workspace-write` / `--dangerously-bypass-approvals-and-sandbox`
   - Grok Build: default / `--permission-mode acceptEdits` / `--always-approve`
   - OpenCode: their equivalents; plain shell: none.
8. **Light mode must theme the terminal too** — the xterm theme (background,
   foreground, ANSI palette, cursor) switches with the app theme, not only
   the surrounding chrome.
9. Copper accent stays. **Later (not now, no rush): custom background per
   theme — gradients or user PNG with alpha.** Architect for it (background
   layer behind the terminal/UI as a first-class token), do not build UI yet.

## Memory (Hermes-style, per agent)

Each agent gets at creation: `memory/MEMORY.md` (index), `memory/USER.md`
(user profile), providers as designed in the Hermes analysis report. Wired so
the CLI agent actually reads/writes it (CLAUDE.md / AGENTS.md include or
equivalent injection per runtime).

## Onboarding

First run: create a category (name + photo) → optionally register/select a
repository → add an agent (name + photo + runtime + permission mode + optional
default repository) → rails and tabs build themselves. Portable agents and
template spawning remain reachable later alongside "+ New category" / "+ Add
agent". A guided one-command installation is still an objective; the current
source-install and tablet setup steps are in [USER_GUIDE.md](USER_GUIDE.md).

## Non-goals (v1)

- No cloud sync, accounts, hosted relay or public ADE endpoint in the personal
  remote alpha.
- No native iOS/Android package in the first mobile milestone.
- No unrestricted remote IPC/PTY or general host-administration surface.
  Dedicated device-granted terminal, file and catalog APIs are implemented
  as specified above; they do not expose Electron IPC or arbitrary host paths.
- No remote desktop replacement.
- No model picker inside a session.
- No built-in chat UI separate from the terminal.
- Custom background images/gradients: architecture only, no UI.

## Quality bar

- Windows first (dev machine is Win11; ConPTY), keep macOS/Linux compatible.
- Terminal scrollback survives tab switches; sessions survive app reload
  where the PTY layer allows it.
- Mobile terminal history opens with the visible Verlauf button, upward wheel,
  downward touch swipe or Shift+PageUp. The bounded redacted text snapshot stays
  still during output; Escape or Zur Live-Ausgabe returns focus to the button.
  It is retained terminal text, not a complete archive of repainted TUI screens.
- Closing a tab or deleting its owner leaves no inaccessible PTY. Exited
  sessions have bounded retention.
- Keyboard: visible focus, tab switching shortcuts.
- Theme: light + dark, both first-class incl. terminal.
- Repository defaults and explicit execution scopes never redirect a live PTY.
  Files/Changes must identify and use the selected execution's actual binding.
- Repository migration, default changes, detach and template spawning are
  non-destructive; no operation silently shares mutable memory/worktrees or
  deletes user files, branches or history.
- Session launch, attach and non-zero exits must be visible and recoverable;
  never strand a main-owned PTY because renderer reconciliation failed.
- CLI/auth diagnostics are read-only and must not execute custom command text
  or expose credential contents.
- Background task completion/failure may notify through the OS; cancellation
  and clean interactive exits should remain quiet.
- Production renderers are sandboxed with a restrictive CSP. Every privileged
  IPC invoke validates both its ADE main-frame sender and runtime payload.
- Remote control is disabled by default, loopback-bound and HTTPS-only behind
  the configured private ingress. Every endpoint validates identity,
  authorization, Origin/Host, content type, size and exact payload shape.
- Remote mutations are rate-limited, idempotent and audit-recorded. Pairing is
  short-lived and single-use; device revocation takes effect for commands and
  event streams without waiting for restart.
- Remote approval requires recent step-up authentication and visible evidence;
  no network, notification or client failure may imply approval or success.
- A publication preview never authorizes mutation. Publication requires a fresh
  explicit desktop confirmation of the exact attested HEAD and generated ref;
  stale base/head state and branch collisions fail closed. Repository CI and a
  human merge remain authoritative.
- Windows beta distribution is an x64 installer; signing is required for a
  trusted release but local verification artifacts may be unsigned.

## Remote workspace administration — operator goals 12–15

Remote ADE administration is opt-in per paired device, granted from Settings
on the host. A permitted device can request an explicit ADE restart; the host
refuses while work or host operations are active and the client confirms the
new authenticated instance after reconnect. Pairing survives. The operation
restarts ADE only and does not install updates or restart Windows.

Goals 13–15 add bounded creation of agents from host-configured settings,
ADE-owned projects and isolated agent workspaces, previewed Git synchronization,
and project/agent filtering with independent drafts. The tablet project-start
delivery later adds device-scoped draft persistence across reloads; see
`TABLET_PROJECT_START.md`. Original acceptance and
current delivery state: `REMOTE_WORKSPACE_GOALS.md`; executable evidence:
`REMOTE_WORKSPACE_RESULTS.md`. These are not arbitrary filesystem/config/shell
access, automatic Git reset/push or the separate Goal 9 approval contract.
