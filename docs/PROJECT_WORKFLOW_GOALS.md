# Projektarbeit ohne verpflichtendes Agent-Profil

Stand: 2026-09-10. Aktiver, vom Nutzer beauftragter Goal. Jeder abgeschlossene
Task erhält einen eigenen Commit; erst nach Abschluss aller Tasks wird gepusht.
Die Tabelle dokumentiert Umsetzung, keine vorweggenommene Produktfreigabe.

## Gewünschter Ablauf

Projekte im eingestellten Stammordner sehen → Projekt öffnen → Branch auswählen
oder anlegen → Codex, Claude, Grok oder Shell starten → Änderungen prüfen →
committen, pushen, PR erstellen oder einen Branch zusammenführen.

Ein Agent-Profil ist optional. „Ohne Agent-Profil“ verwendet die CLI-Einstellungen
und die Anweisungen des gewählten Repositorys; ADE injiziert dabei keine fremde
Agent-Identität. Bestehende Agent-Homes und verwaltete Runs bleiben erreichbar.

## Tasks und Abnahme

| Task | Lieferumfang und Abnahme | Stand |
|---|---|---|
| T0 | Ablauf, Grenzen, Reihenfolge und Prüfkriterien dokumentieren; lokale Dokumentverweise prüfen | abgeschlossen |
| T1 | Gestartete CLI und Terminalprozess getrennt beobachten. Nach CLI-Ende beispielsweise „Claude beendet · Terminal offen“; Startauswahl bezeichnet keine andere laufende Sitzung. Reconnect, Exit und erneutes Öffnen mit echten PTY-Fixtures prüfen | abgeschlossen für native Windows; zusätzliche WSL-Abnahme offen |
| T2a | Datenmodell und begrenzte Ordnererkennung; eigene Projekt-Workspace-Identität ohne versteckt angelegtes Profil; bestehende Daten bleiben kompatibel | abgeschlossen für native Windows |
| T2b | Erkannte und registrierte Projekte auf Desktop/Tablet zusammen anzeigen; typisierte Zugriffe und Freigaben; eigenständigen Workspace ausdrücklich öffnen | abgeschlossen für native Windows |
| T3a | Branch-/Worktree-Grenze mit vorhandenen lokalen/Remote-Branches, neuer Arbeitskopie, konkreter Vorschau und Drift-/Sitzungs-/Lease-Schutz; echte Git-Fixtures | abgeschlossen als interne native Windows-Grenze; Bedienoberfläche folgt T3b |
| T3b | Projekt → Workspace/Branch → CLI auf Desktop und Tablet: T3a über typisierte API/Bedienoberfläche verbinden, profilfreie Codex/Claude/Grok/Shell-Sitzungen und ausdrücklich gewählte Profile; vorhandene und neue Projekte mit echten PTY-Fixtures prüfen | abgeschlossen für native Windows |
| T4 | Git-Arbeitsfläche: Status, Diff, selektive Datei-Auswahl und Commit; Fetch und Fast-forward-Pull; Branch-Merge mit sichtbaren Konflikten, Fortsetzen und Abbrechen. Vorschau, HEAD-/Index-/Datei-Drift, aktive Sitzungen und verwaltete Leases prüfen | offen |
| T5 | Explizites Pushen und GitHub-PR-Erstellen aus dem gewählten Branch; Ziel und Änderungen vor Ausführung anzeigen. Gerätefreigabe, Idempotenz, Fehler und unklaren Ausgang prüfen; kein Force-Push | offen |
| T6 | Menü, Tastatur/Fokus und responsives Layout durchgehend prüfen; Guide mit aktuellen Screenshots, Architektur/Status/Handoff synchronisieren. Vollständiges `pnpm verify`; letzter Commit, danach gemeinsamer Push | offen |

## Verbindliche Umsetzungsgrenzen

- CLI-Zustand beruht auf dem von ADE gestarteten Aufruf, nicht auf vermuteten
  Zeichenfolgen im Terminal. Browser-Verbindung, Eingabebesitz und offener
  Terminalprozess sind eigene Zustände. Manuell in der Shell gestartete Prozesse
  werden nicht als zuverlässig erkannte ADE-CLI ausgegeben.
- Ein Projekt-Workspace ist nicht an eine Agent-Identität gebunden. Verwaltete
  Tasks behalten ihre bestehenden Agent-/Worktree-/Lease-Verträge. Eine laufende
  CLI wird durch Branch-Auswahl niemals stillschweigend in einen anderen Kontext
  versetzt.
- Erkennung beginnt am lokal konfigurierten und validierten Stammordner. Remote
  Clients erhalten und senden opake IDs statt absoluter PC-Pfade. Links,
  Junctions, verschobene Identitäten und unerwartete Git-Metadaten werden geprüft.
- Git-Aktionen sind feste typisierte Operationen, kein über Remote gesendeter
  Shell-Befehl. Vor Mutation werden Workspace, Git-Zustand und Berechtigungen
  erneut geprüft. Kein automatisches Stash, Reset oder Force-Push.
- Änderungen an externen Repositories werden im Produkt ausdrücklich ausgelöst.
  Bei Verbindungsabbruch nach einer Mutation ist Wiederholung an eine dauerhafte
  Idempotenz-Quittung gebunden; ein unklarer Ausgang wird nicht als Erfolg gezeigt.
- Neue Remote-Verträge laufen über `AdeApplicationService`, eigene DTOs und
  scoped Gerätefreigaben. Die generische `REMOTE_COMMAND_CHANNELS`-Allowlist wird
  nicht für Terminal-, Datei- oder Git-Befehle geöffnet.
- Native Windows ist die unmittelbar überprüfbare Zielplattform. Bestehende
  Windows→WSL-Agent-Homes bleiben erhalten. Weitere Plattformfreigaben benötigen
  eigene ausführbare Evidenz.

## Evidenz und Betrieb

Fokussierte Prüfungen und relevante Grenzen werden mit jedem Task eingetragen.
Tests verwenden temporäre Profile, lokale Git-Repositories und kontrollierte
CLIs. Die laufende persönliche ADE-Instanz und produktive Workspaces werden
nicht als Test-Fixtures verwendet. Der Abschluss erfordert den vollständigen
Prüflauf sowie einen sauberen, gepushten Repository-Stand.

Vorherige Produktbasis: `f606a1d`; `pnpm verify` mit 2.148 Checks. Das ist die
Ausgangsevidenz und keine Verifikation dieses Goals.

### T1 — CLI und Shell getrennt

- `SessionMeta.program`, `pty:program` und die autorisierte Mobile-Projektion
  tragen den Zustand des ursprünglich gestarteten Aufrufs. Die Shell bleibt
  unabhängig davon bedienbar. Angezeigte Profilnamen stammen aus der Sitzung.
- Native Windows: drei TypeScript-Projekte und Build grün; 17 Parser-/Wrapper-
  Checks, 36 Remote-Terminal-Checks, 216 Security-Checks, 104 echte Terminal-/
  Tablet-Checks und 185 Desktop-Checks. Nach der zusätzlichen Behandlung
  unterbrochener Shell-Kontrollflüsse wurde der 58-Check-Assistant-/Lifecycle-
  Ablauf erneut grün ausgeführt. Diese Zahlen sind einzelne Läufe, keine neue
  repositoryweite `pnpm verify`-Gesamtsumme.
- Der reale Windows→WSL-Zusatzlauf scheiterte schon vor dem ersten CLI-Start am
  Root-Probe-Timeout. Auch `wsl.exe -d Ubuntu --exec /bin/true` antwortete nicht
  innerhalb von 15 Sekunden. Das ist keine erfolgreiche Negativkontrolle und
  keine WSL-Freigabe. T6 soll die Zusatzabnahme bei erreichbarem Backend erneut
  versuchen. Es wurde kein WSL-Neustart durchgeführt.
- Der danach im WSL-Cleanup hängende Testprozess wurde gezielt beendet. Sein
  natives temporäres Profil `ade-terminal-electron-2xyWJu` bleibt als Diagnose-
  artefakt liegen: automatische Freigabeprüfung lehnte die Löschung mit
  „blocked by policy“ ab. Die Fixture versucht nach einem Fehler in der reinen
  WSL-Lesephase künftig keinen unnötigen Cleanup-Aufruf. Persönliche ADE-Instanz
  und Workspaces blieben unberührt.
- Lokale Logs: `test-results/project-goal-*.log`; 193 Dokumentverweise geprüft.
  Der Guide erklärt die neuen Zustände; aktualisierte Gesamtaufnahmen folgen T6.

### T2a — Unabhängige Workspace-Identität und Ordnererkennung

- Main-Service erkennt konfigurierte direkte Projektordner und bestehende
  Katalogeinträge; normale Ordner werden gezeigt, aber nicht automatisch mit Git
  initialisiert. Links bleiben unzugänglich; grosse Listen melden ihre Begrenzung.
- Explizites Öffnen registriert den genauen Checkout und bei Bedarf das Repo in
  einem Speicherschritt. Vorhandene Worktrees behalten ihren Ordner und ihr
  gemeinsames Repository. Es entsteht weder ein Agent noch eine Agent-Bindung,
  und vorhandene Repository-Anweisungen bleiben unverändert.
- Neue `projectWorkspaces`-Collection mit rückwärtskompatibler Leer-Migration,
  strikter Validierung und Schutz bei Workspace-Bundle-Import. UI/API folgen T2b;
  keine profilfreie CLI-Startfunktion aus diesem Service-Test ableiten.
- Native Windows: 32 neue Prüfungen mit echten Git-Repositories, darunter
  Unicode/Pfadnamen mit Apostroph, paralleles Öffnen, Neustart, Worktrees,
  unbekannte Auswahl, Junctions, Root-/Git-Pointer-Wechsel, Git-Umgebungsvariablen,
  detached HEAD, unborn master und Listenlimit. Drei TypeScript-Projekte grün.
- Der vorhandene Bestand läuft grün: 33 Suiten / 1.713 Checks, darunter 34
  Config- und 200 Workspace-Bundle-Checks. Die neue 32-Check-Suite wurde zusätzlich
  ausgeführt und mit gemessenem Floor registriert; sie ist in diesen 1.713 noch
  nicht enthalten. Die abschliessende Gesamtverifikation bleibt T6.
- Evidenz: `test-results/project-discovery-*.log`. Nächster Schritt: T2b UI/API.

### T2b — Projektordner auf Desktop und Tablet

- Neuer Desktop-Reiter „Projekte“ und gemeinsame durchsuchbare Ordnerliste auf
  dem Tablet. Vorhandene native Checkouts werden ohne Agent-Profil geöffnet;
  Branch, Checkout-Art und unabhängige Identität sind sichtbar. Ordner ohne Git,
  fehlender Stamm, fehlende Rechte und Such-Leerstände werden erklärt.
- Desktop-IPC und separate signierte Host-Routen über `AdeApplicationService`.
  Leserecht `workspace:read`, neue ausdrückliche Schreibfreigabe `projects:write`,
  Audit, Idempotenz und erneute Rechteprüfung vor Speichern/Antwort. Kein breiterer
  generischer Remote-IPC-Zugriff; alte Geräte erhalten die Freigabe nicht automatisch.
- Mobile speichert den Öffnungsbeleg vor der Mutation. Verlorene Antwort und
  Seitenneuladen führen zu ausdrücklichem Wiederholen derselben Aktion; der
  geöffnete Workspace wird durch Lesen wiederhergestellt. Browser-Speicherfehler
  verhindern das Senden. Verwerfen erhält vorhandene Host-Workspaces und Dateien.
- Native Windows: drei TypeScript-Projekte und Build grün; 26 neue echte API-/Git-
  Prüfungen, 20 Entwurfs- und 218 Security-Checks. Gesamter fokussierter Bestand:
  **35 Suiten / 1.777 Checks grün**. Gemessene neue Floors sind registriert.
- Electron/Chromium: **17 Checks grün** für Desktop und Tablet, mit verlorener
  HTTP-Antwort, Reload, fehlender Freigabe, Speicherfehler, Tastaturfokus und
  390-Pixel-/Tablet-Layout. Der vorangehende vollständige Terminal-Driver hatte
  117 bestandene und zwei fehlgeschlagene neue Fokusprüfungen; die Fokusübergabe
  wurde anschliessend von verzögerten Bildschirm-Frames entkoppelt und der
  betroffene 17-Check-Ablauf erneut grün geprüft. Der vollständige Wiederholungslauf
  gehört weiterhin zur Gesamtverifikation T6, nicht zu einer behaupteten Freigabe.
- Der vorhandene Agent-Arbeitskopie-Einstieg bleibt ausdrücklich erreichbar.
  Branch-Steuerung und profilfreie CLI im unabhängigen Checkout folgen T3.
  Logs und Aufnahmen: `test-results/project-directory-*.log` und
  `test-results/remote/project-directory-*.png`. Persönliche ADE-Instanz nicht
  neu gestartet; noch kein Push.

### Angeforderter Zwischenstand vor dem Tablet-Test

Der Nutzer hat während T3a ausdrücklich einen Zwischencommit und einen Neustart
für den Tablet-Test angefordert. Die begonnenen Branch-Datentypen und die interne
Übernahme eines bereits geprüften Worktrees werden mitgesichert. Sie sind noch
kein freigegebener Branch-Wechsel oder CLI-Start: T3a/T3b bleiben in Arbeit/offen.
Die neue Oberfläche zum Testen entspricht T2b. Der gemeinsame Push bleibt am Ende.

Zwischenprüfung: drei TypeScript-Projekte grün, 40 Workspace-/Branch-Vertragschecks
und 26 Projekt-API-Checks grün. Logs: `test-results/project-checkpoint-*.log`.

Build `03175c4` wurde auf ausdrücklichen Wunsch um 23:35:47 Europe/Zurich als
separate feste Build-Kopie gestartet (PID 26028). Private Tablet-Adresse HTTP 200,
korrektes neues JS-Asset, Tailscale-Routen unverändert. Die bestehende Kopplung
bleibt erhalten; neue Projekt-Schreibfreigabe am PC noch explizit aktivieren.
Details und unveränderte offene Tasks: [HANDOFF.md](HANDOFF.md).

### T3a — Branches und Arbeitskopien

- Interner Main-Service liest lokale und zuletzt gefetchte Remote-Branches sowie
  vorhandene Worktrees. Aktueller Branch, Dirty-Zustand und Sperrgrund bleiben
  getrennt sichtbar. Grenzen: 200 Branches, 100 Worktrees, begrenzte Git-Ausgabe.
- Konkrete Vorschau ist fünf Minuten gültig, an den aufrufenden Principal gebunden
  und einmalig anwendbar. Branch-, HEAD-, Datei-, Worktree- oder Identitätsänderungen
  verhindern die Mutation. Aktive Terminals, Agent-Bindungen, verwaltete Leases
  und unvollständige Git-Operationen werden erneut geprüft.
- Explizite zusätzliche Arbeitskopien erhalten einen eigenen Branch aus der
  gewählten Commit-Basis. Laufende Sitzungen und ungesicherte Quelldateien bleiben
  erhalten. Ein nach Rechteentzug schon angelegter Worktree bleibt sichtbar und
  kann ausdrücklich übernommen werden; ADE löscht oder resettet ihn nicht.
- Native Windows: drei TypeScript-Projekte und **40 echte Git-Fixture-Checks grün**,
  einschliesslich Remote-Tracking, ignorierter lokaler Dateien, Hooks, Git-Umgebung,
  Drift, Rechteentzug, Recovery und abschliessender Positivkontrolle. Floor 40
  registriert; Logs: `test-results/project-branches*.log`.
- Noch keine neue API-/UI-Freigabe: T3b verbindet diese Grenze mit Projekten und
  profilfreien Terminals. Die persönliche Testinstanz bleibt auf `03175c4`.


### TG — eingeschobener Graph-/Ergebniszugriff

Auf ausdrücklichen Wunsch vor T3b: Graph zeigt empfangene Aktivität und bestätigten
Prozesszustand; Run-Details bieten vollständige gespeicherte Antwort sowie sichere
Bildvorschau und Downloads aus dem ursprünglichen Task-Workspace. Fokus, Escape,
responsive Ansicht und Wiederöffnung sind in echtem Electron/Chromium geprüft.
31 fokussierte Grenzchecks und 12 native PTY-/Browserchecks grün; ergänzende
Regressionen und Typprüfung siehe STATUS. Guide und Verträge synchronisiert.
Eigener Commit und genehmigter ADE-Neustart; kein Push. T3b-Stash bleibt erhalten.

### T3b — Projekt, Branch und profilfreie CLI

- Desktop und Tablet verwenden den genauen unabhängigen Checkout. Codex, Claude,
  Grok und Shell benötigen kein Profil. Ein ausdrücklich gewähltes natives Profil
  liefert Start-Einstellungen; es erzeugt keine Agent-Bindung und überschreibt
  keine Repository-Anweisungen. Projekt-/Branch-/Profilzustand bleibt auch in
  Sitzungshistorie und Weiterarbeiten getrennt und auswählbar.
- Branch-Übersicht, konkrete Vorschau und Worktree-Auswahl verwenden T3a. Eigene
  Live-Terminals sperren den Wechsel im selben Checkout. Eine zusätzliche
  Arbeitskopie ermöglicht parallele Arbeit; verwaltete Leases bleiben gesperrt.
  Mobile braucht ausdrücklich `projectGit:write` zusätzlich zu Lesen/Öffnen.
- Neues Projekt legt auf beiden Oberflächen den benannten dauerhaften Ordner
  mit main an und wartet auf die CLI-Auswahl. Verlorene Erstellungs-, Öffnungs-,
  Branch- und Terminalantworten bleiben über Reload mit ihrem eigenen Beleg
  wiederholbar. Offline bleibt das Terminal mit gesperrter Eingabe sichtbar.
- Native Windows: **41 Projekt-/API-/History-Grenzchecks**, **25 Entwurfschecks**,
  **54 Provisionierungs-** und **62 Repository-Checks** grün; drei TypeScript-
  Projekte und Build grün. Die vorherige Regression des gesamten fokussierten
  Bestands hatte 37 Suiten/1.859 Checks; neue gemessene Floors sind registriert,
  die abschliessende Gesamtverifikation gehört weiterhin T6.
- Echtes Electron/Chromium: **22 Projekt-/Branch-/PTY-Checks** sowie **28 neue
  Projekt-/Recovery-/Legacy-Checks** grün. Negative Kontrollen: verlorene Antworten,
  verbotener Branch-Wechsel bei Live-Terminal, unzulässige Startkontexte und
  Git-Umgebung. Abschliessende Positivkontrollen passieren. Lokale Test-CLIs
  belegen Startkontext und Prozesszustand, keine Provider-Inferenz oder physische
  Samsung-Tastatur. Die zusätzliche WSL-Abnahme bleibt getrennt offen.
- Logs: `test-results/project-launch-*.log`, `project-start-electron.log`.
  Guide ergänzt um aktuelle Branch-Vorschau und Terminalaufnahme. Persönliche
  ADE-Instanz bleibt auf `e07e00b`; T4/T5/T6 und gemeinsamer Push bleiben offen.
