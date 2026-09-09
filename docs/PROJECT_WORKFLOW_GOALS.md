# Projektarbeit ohne verpflichtendes Agent-Profil

Stand: 2026-09-09. Aktiver, vom Nutzer beauftragter Goal. Jeder abgeschlossene
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
| T3 | Projekt → Workspace/Branch → CLI auf Desktop und Tablet. Bestehenden Checkout ausdrücklich verwenden; zusätzliche Arbeitskopie für parallele Arbeit anbieten. Lokale/Remote-Branches, neuen Branch und profilfreien Start mit echten Git-/PTY-Fixtures prüfen | offen |
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
