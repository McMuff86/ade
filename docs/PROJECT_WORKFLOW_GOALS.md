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
| T2 | Direkte Unterordner des konfigurierten Projekt-Stamms begrenzt und ohne Link-Verfolgung entdecken; registrierte und noch nicht erfasste Projekte zusammen anzeigen. Eigene Projekt-Workspace-Identität ohne versteckt angelegtes Profil; bestehende Daten bleiben kompatibel | offen |
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
