**ADE: Projekte, CLI-Sitzungen und Git-Workflow — Analyse vom 14. September 2026**

Nachtrag vom 15. September: Die persönliche Konfiguration ist inzwischen auf
vier Originalprojekte und optionale Coding-Profile umgestellt. Die sechs hier
untersuchten alten Agent-Arbeitskopien wurden nach geprüfter Sicherung entfernt.
Die unten beschriebenen Altstände dienen als historische Analyse;
[aktivierter Stand und WSL-Prüfung](PROJECT_WORKFLOW_REORGANIZATION.md).

Das Ziel ist ein Arbeitsplatz für Adis parallele Projekte: ADE mit Codex,
RhinoSheetMetal mit Claude Code und RhinoClaw mit Grok. Während eine CLI arbeitet,
wird eine andere Aufgabe geprüft oder fortgesetzt. Projekt, Arbeitskopie,
Branch, Sitzung und der nächste Git-Schritt müssen dabei jederzeit erkennbar sein.

Meine Empfehlung: **Projekt → Aufgabe/Arbeitskopie → CLI → Prüfen → Übernehmen
oder PR** als täglicher Ablauf. Gespeicherte Agents sind optionale Arbeitsprofile.
Für gleichzeitige Änderungen im selben Repository bekommt jede Aufgabe einen
eigenen Branch und Worktree. Work und Overview sollten auch interaktive Sitzungen
übersichtlich zusammenführen; der Graph bleibt für koordinierte Runs sinnvoll.
Das ist eine Diskussionsgrundlage, keine bereits beschlossene Produktänderung.

**Untersuchter und gestarteter Stand**

- HEAD: `797aba0cd77ddebf498646ae4e0225f5af1cdce0`, Branch `main`.
- Der Build enthält die bereits vorhandenen, noch uncommitteten
  Workspace-Terminal-Erweiterungen. Er entspricht deshalb nicht allein HEAD.
- `pnpm build` und Windows-x64-Verzeichnispackaging bestanden.
- Gestartete Anwendung: `dist/workflow-review-20260914/win-unpacked/ADE.exe`.
  Persönliches Profil: `%APPDATA%/ade`; Start um 23:20 Uhr, PID 62964.
  Die Anwendung reagierte nach dem Start. Das ganze `win-unpacked`-Verzeichnis
  gehört zum ausführbaren Build; dies ist kein neu installierter NSIS-Installer.
- Persönliche Konfiguration vor Start gesichert unter
  `test-results/workflow-review-backup-20260914-232041`.
- Die Oberfläche wurde zusätzlich mit derselben gepackten EXE automatisiert
  untersucht: separates Prüfprofil mit kopiertem Projekt-/Agentkatalog und Bildern,
  ohne übernommene Credentials oder Runs. Eine echte Windows-PTY-Shell gab im
  ADE-Originalordner den Prüfmarker aus. Es wurde kein Modellauftrag gestartet.
- Lokale Git-Stände der sechs registrierten Projekte und ihrer Agent-Worktrees
  wurden gelesen. Remote-Vergleiche verwenden vorhandene Tracking-Refs; sie sind
  keine Aussage über den aktuellen GitHub-Stand, da kein Fetch ausgeführt wurde.

Die letzten Änderungen erklären den heutigen Funktionsumfang:

| Commit/Arbeitsstand | Bedeutung für diesen Workflow |
|---|---|
| `bab7df7` | Freie Terminals, Workspace-Zuweisung, Navigation und geprüfte Übernahme älterer Änderungen |
| `5e27bdd` | Terminalverlauf, Abo-Anzeige und Hilfen für den nächsten Git-Schritt |
| `01659dd`, `b40c758`, `8fa89f2` | Commit-Details, Projektauswahl und Tablet-/Sprachbedienung |
| `661b41a` | Gespeicherte Profilanweisungen für native Profilsitzungen |
| `8c6dd63` | Desktop-Work mit Filtern und Agent-Profileinstellungen |
| `797aba0` | Dokumentiert die Aktivierung des vorherigen Work-Builds |
| Vorhandener lokaler Arbeitsstand | Workspace-Wahl im Starter, direkte Codex-/Claude-Aktionen, zusätzliche Sitzungen, Projekttabs, Suche/Kopieren/Schriftgrösse |

**Was die fünf Bereiche tatsächlich leisten**

| Bereich | Heutige Funktion | Bewertung für Adis Alltag |
|---|---|---|
| Overview | Live-Zähler, Agents, ausgewählte Projekte, Runs und Historie beendeter interaktiver Sitzungen | Gute Startübersicht, aber keine vollständige Liste aller gerade laufenden Projekt-Sitzungen |
| Projekte | Vorhandenen Ordner öffnen, Branch/Worktree wählen, CLI mit optionalem Profil starten, Terminal/Git/Ergebnisse | Der passendste Einstieg für den beschriebenen Cursor-Ablauf |
| Terminals | Agentbezogene Terminals und freie Sitzungen; der globale Starter kann jetzt auch Projekt-Workspaces wählen | Funktioniert, hat aber ein anderes Navigationsmodell als Projekte |
| Work | Run-Liste mit Projekt-, Agent-, Statusfilter; neue verwaltete Einzelaufgabe oder neuer Run | Für interaktive CLI-Arbeit unvollständig: eine solche Sitzung wird nicht automatisch zum Work-Eintrag |
| Graph | Run-Cluster mit Rollen, Teams, Aufgaben, Aktivität und Ergebnissen; Task-Slots | Nützlich für echte Zusammenarbeit innerhalb eines Runs; kein Projekt-/Branch- oder allgemeiner Sitzungsgraph |

Im persönlichen Katalog gab es zum Prüfzeitpunkt sechs Agents, sechs registrierte
Projekte, fünf ausgewählte „Meine ADE Projekte“ und keine Runs. Daher sind die
leeren Work-/Graph-Flächen in dieser Konfiguration korrekt. Daraus folgt aber
nicht, dass es keine produktive interaktive Arbeit geben kann.

Die Overview-Projektkarten zählen bisher Agent-Bindings. „Noch kein
Agent-Workspace“ bei RhinoSheetMetal bedeutet daher nicht, dass dessen
Originalprojekt fehlt oder erst einem Agenten zugewiesen werden muss.
Die Projektübersicht startet mit „Alle“ und listet auch viele normale Unterordner
unter `repos`; „Meine ADE Projekte“ wäre für den täglichen Wechsel der bessere
Standard. Suche und Filter existieren bereits.

**Ein besonders missverständlicher Einstieg**

Der Knopf „Terminal öffnen / fortsetzen“ an einem Overview-Agenten startet
ausdrücklich dessen Home-Workspace (`repositoryId: null`), obwohl daneben der
Name seines Standardprojekts stehen kann. Für Hermes passt das, für „Main Chef
→ ADE“ ist die Erwartung leicht eine andere. Der Klick auf die Projektkarte
führt dagegen zum Projekteinstieg. Diese Ziele sollten im Knopftext und vor dem
Start eindeutig benannt werden.

Die gespeicherte Workspace-Zuweisung ist ebenfalls nicht global: Der dokumentierte
Zuweisungsablauf gilt für die mobile Agent-/Terminalansicht und verwendet dort
einen konkreten Projektworkspace. Der klassische Desktop-Agentstart und verwaltete
Tasks lösen weiterhin Agent-/Repository-Bindings auf. Im Desktop-Projekteinstieg
wird wiederum der ausdrücklich geöffnete Checkout verwendet. Eine gemeinsame
Beschriftung „Agent ist diesem Workspace zugewiesen“ verdeckt diese Unterschiede.

Belege: [Overview-Aktionen](../src/renderer/overview/OverviewView.tsx),
[Overview-Daten](../src/main/overview/projectOverview.ts),
[Work](../src/renderer/work/WorkView.tsx),
[Graph-Modell](../src/renderer/graph/graphModel.ts),
[Zuweisungsvertrag](WORKSPACE_ASSIGNMENT.md),
[Projektstart](../src/main/pty/PtyManager.ts).

**Was ein ADE-Workspace gegenüber `C:\Users\Adi.Muff\repos` ist**

Ein Projekt ist der registrierte Repository-Eintrag. Ein Workspace ist der konkrete
Ordner, in dem die CLI arbeitet. Ein Agent-Profil enthält etwa Runtime, Modell und
Arbeitsanweisungen. Eine Sitzung ist der laufende Prozess mit eigenem Gespräch.
Ein Run ist der von ADE verwaltete Aufgabenablauf. Diese Dinge sind getrennt.

| Arbeitsort | Dateien und Verwendung |
|---|---|
| `repos/<Projekt>` | Bestehender Hauptcheckout. Öffnet ADE genau diesen Ordner, sehen Cursor und ADE dieselben Dateien sofort. |
| `repos/.ade-worktrees/projects/<ID>` | Zusätzlicher, im Projekteinstieg erstellter Task-Checkout mit eigenem Branch. |
| `repos/.ade-worktrees/<Projekt>/<Agent>` | Neuerer Ablageort dauerhafter Agent-/Repository-Arbeitskopien; ein konfigurierter anderer Basisordner kann diesen ersetzen. |
| `%APPDATA%/ade/ade/worktrees/...` | Vorhandene ältere Agent-Worktrees. Der neue Standard verschiebt sie nicht automatisch. |
| `%APPDATA%/ade/ade/agents/<ID>/workspace` | Persönlicher Home-Workspace ohne ausgewähltes Repository; bei WSL-Profilen kann das ein Linux-Pfad sein. |

Git-Worktrees gehören zum selben Repository: Sie teilen Commits und Branch-Refs,
haben aber eigene Arbeitsdateien, HEAD und Index. Ein Commit im Task-Worktree
aktualisiert deshalb die Dateien des auf `main` stehenden Hauptcheckouts nicht.
Ein Branch allein erzeugt noch keinen zweiten Arbeitsordner. Ein Branchwechsel
im Originalordner ändert auch die Dateien, die eine dort geöffnete Cursor-Instanz
sieht. [Git-Worktree-Dokumentation](https://git-scm.com/docs/git-worktree).

Die überprüften, lesbaren Agent-Worktrees teilen tatsächlich das `.git` ihres
jeweiligen Hauptprojekts. Sie sind keine unabhängigen Klone. Deshalb ist zwischen
diesen lokalen Worktrees kein Push/Pull nötig, um einen Commit sichtbar zu machen.
Das Aktualisieren der ausgecheckten Dateien erfolgt aber weiterhin bewusst über
den gewünschten Git-Stand. Für getrennte Klone oder einen anderen Rechner wäre
ein Remote-Transfer nötig.

Neue Agent-Bindings beginnen am HEAD des Hauptrepositories bei ihrer Erstellung.
Das muss nicht `main` sein und ist nicht automatisch der neueste Remote-Stand.
Die zusätzliche Projekt-Arbeitskopie verwendet den in der Branch-Vorschau
ausgewählten Basis-Commit. Uncommittete Dateien und ignorierte Abhängigkeiten
werden dabei nicht als Arbeitsstand übernommen.

Belege: [RepositoryScopeService](../src/main/repositories/RepositoryScopeService.ts),
[ProjectWorkspaceService](../src/main/repositories/ProjectWorkspaceService.ts),
[ProjectBranchService](../src/main/repositories/ProjectBranchService.ts).

**Konkreter Zustand auf diesem PC**

Die Zahlen vergleichen mit dem lokalen Hauptcheckout, gemessen vor dem Schreiben
dieser Analyse. „Zurück/eigen“ bezeichnet unterschiedliche erreichbare Commits,
keinen fachlichen Vergleich der Änderungen.

| Projekt / Agent-Workspace | Hinter Hauptstand | Eigene Commits | Lokale Änderungen | Folgerung |
|---|---:|---:|---:|---|
| RhinoClaw / RhinoClaw_Agent | 0 | 0 | 0 | Gleicher Commit-Stand |
| ADE / alter Main-Chef-Workspace | unbekannt | unbekannt | unbekannt | Binding bereits `invalid`; Git-Inspektion schlägt fehl |
| 2D_rpg_jumpnrun / Main Chef | 6 | 0 | 0 | Commit-Stand per Fast-forward aktualisierbar, sofern unbelegt |
| RhinoLayoutTools / LayoutTool_FrontendDesigner | 81 | 1 | 2 | Auseinandergelaufen; eigene Arbeit zuerst gezielt prüfen |
| RhinoLayoutTools / GrokMain | 15 | 0 | 0 | Commit-Stand per Fast-forward aktualisierbar, sofern unbelegt |
| Codex Native / Main Chef | 0 | 0 | 2 | Änderungen sind bisher nur in dieser Arbeitskopie |
| RhinoSheetMetal | — | — | — | Originalprojekt vorhanden und sauber; kein Agent-Binding erforderlich |

ADE selbst hatte zu Beginn 26 geänderte/unversionierte Einträge auf `main`,
2D_rpg_jumpnrun 143. Eine Aktualisierung auf den letzten Commit übernimmt solche
Dateien nicht. Der gespeicherte mobile Main-Chef-Override für ADE zeigt bereits
auf `repos/ai_agent_code_workspace`; er repariert das ungültige alte Binding
für andere Startwege nicht. Hier liegt konkrete Altlast statt nur eine
theoretische UX-Frage vor.

**Empfohlener täglicher Ablauf**

1. **Projekt öffnen.** Unter Projekte zunächst „Meine ADE Projekte“ verwenden.
   Den vorhandenen Hauptordner öffnen; Import registriert ihn und verschiebt ihn nicht.
2. **Arbeitsort wählen.** Bestehende Arbeit im bisherigen Checkout fortsetzen.
   Für eine neue abgegrenzte Aufgabe unter Branches die Basis `main` wählen,
   beispielsweise `feature/layout-polish` anlegen und „Zusätzliche Arbeitskopie
   anlegen“ aktivieren. Der Originalordner kann auf `main` bleiben.
3. **CLI wählen.** Codex und Claude Code haben direkte Knöpfe; Grok steht unter
   „Arbeiten mit“. Ein Profil ist optional. Die normale CLI-Auswahl verwendet
   die CLI-Defaults; Modell/Reasoning aus einem ADE-Profil gelten beim expliziten
   Profilstart. Der aktuelle einfache Codex-/Claude-/Grok-Starter hat keine eigene
   freie Modellauswahl. Modelle im CLI oder über das gespeicherte Profil wählen.
4. **Aufgabe geben und wechseln.** Die Sitzung läuft beim Ansichtswechsel weiter.
   Eine passende laufende Projektsitzung wird wiederverwendet; ein weiterer Start
   ist ausdrücklich möglich. Projekttabs wechseln mit Ctrl+PageUp/PageDown;
   Ctrl+Shift+T öffnet eine zusätzliche Sitzung.
5. **Prüfen und committen.** In einer interaktiven Sitzung kann die CLI nach Auftrag
   Tests und Git-Schritte ausführen, soweit die Repo-Anweisungen das erlauben.
   Alternativ die Sitzung beenden und den ADE-Git-Bereich verwenden. Dieser blockiert
   Mutationen derzeit bereits bei einem offenen Terminal im selben Checkout,
   selbst wenn nur noch dessen Shell läuft.
6. **Abschliessen.** Entweder den Task-Branch lokal in den Hauptbranch übernehmen,
   oder pushen und einen PR erstellen. Danach den Originalordner bei Bedarf auf
   den tatsächlich integrierten Stand bringen.

Verschiedene Projekte können gleichzeitig laufen. Zwei Aufgaben im selben Projekt
erhalten separate Worktrees. Zwei CLIs im selben Workspace sind technisch möglich,
teilen jedoch die Dateien; für unabhängige schreibende Aufgaben ist das keine
Trennung. Bei einem Wechsel von Claude zu Codex auf derselben Aufgabe erst den
bisherigen Schreiber beenden. Code und ein kurzer Übergabetext können übernommen
werden; die Gesprächskontexte der Anbieter werden nicht automatisch geteilt.

Ein neuer Worktree kann eine eigene Installation von Abhängigkeiten und lokale
Konfiguration benötigen. Bei parallelen App-Starts müssen auch Ports und Dienste
zusammenpassen. Der Originalordner bleibt dabei der gut auffindbare Ort für die
integrierte, lokal geprüfte Version.

**Abgleich in beide Richtungen**

| Ziel | Heutiger Weg und Wirkung |
|---|---|
| Neuer Hauptstand → alter Agent-Worktree ohne eigene Änderungen | Graph → Git-Abgleich → Projekt → Git-Basis „Lokal · main“ → beim Agenten „Update prüfen“ → Fast-forward bestätigen. |
| GitHub → lokales main | Fetch aktualisiert zunächst Remote-Refs. Danach `origin/main` als Basis und den Hauptcheckout per Fast-forward aktualisieren, wenn die Historie passt. |
| Aktuelles main → Task-Worktree mit eigenen Commits | Im Task-Worktree bewusst `main` mergen, Konflikte lösen und testen. Ein Fast-forward reicht bei echter Divergenz nicht. |
| Fertiger Task-Branch → lokales main | Hauptworkspace auf dem gewünschten Zielbranch öffnen, Quellbranch im Git-Bereich wählen, Merge prüfen und abschliessen; oder denselben geprüften Ablauf über eine interaktive CLI ausführen. |
| Alte eigene/uncommittete Agent-Arbeit → aktuelles Hauptprojekt | Git-Abgleich → Änderungen übernehmen… → Quelle und Dateien auswählen → separate Integrationskopie → Konflikte/Prüfungen → Geprüften Stand übernehmen. |
| Task-Branch → PR | Im Projekt-Git-Bereich Remote prüfen, Branch ausdrücklich pushen, GitHub-PR vorbereiten und erstellen. Zielbranch z. B. `main`; Anmeldung von `gh` muss vorhanden sein. |
| Gemergter GitHub-PR → `repos/<Projekt>` | Im lokalen Hauptcheckout Fetch und Fast-forward auf `origin/main`. Ein PR oder Push allein ändert dort keine Arbeitsdateien. |

Fetch und Merge sind getrennte Operationen. Ein Merge wirkt auf den aktuell
ausgecheckten Zielbranch; „Hauptrepository“ bezeichnet den Ordner, nicht zwingend
den Branch `main`. Deshalb vor der Übernahme immer das angezeigte Ziel prüfen.
[Git Fetch](https://git-scm.com/docs/git-fetch),
[Git Merge](https://git-scm.com/docs/git-merge).

Die vorhandene geprüfte Übernahme ist besonders für den weit zurückliegenden
LayoutTool-Designer relevant. Sie sichert ausgewählte Dateiinhalte gegen die
gemeinsame Basis und baut eine Integrationskopie auf dem heutigen Zielstand.
Nach gültigen Projektprüfungen erstellt ADE den Review-Commit und aktualisiert
den sauberen Hauptcheckout per Fast-forward. Der alte Workspace bleibt erhalten.
Dieser Weg ersetzt keine vollständige Übernahme aller alten Quellcommits mit
unveränderter Historie. Für einen regulären neuen Feature-Branch passen der
gewöhnliche Branch-Merge oder PR besser. [Bestehender Übernahmeablauf](WORKSPACE_INTEGRATION.md).

Der allgemeine Git-Abgleich listet Hauptcheckout und Agent-Bindings. Zusätzliche
profilfreie Task-Worktrees werden dort nicht als gleichwertige Update-Ziele
geführt; sie sind über Projekte → Branches → Vorhandene Arbeitskopien erreichbar.
Auch Git-Aktionen im Projektpanel sind für Agent-Bindings bewusst gesperrt.
Das sind weitere Gründe, für neue manuelle Tasks profilfreie Projekt-Worktrees
mit optionalem Startprofil zu bevorzugen.

**Interaktive Arbeit und verwaltete Runs**

„Work → Neue Aufgabe“ startet einen verwalteten ADE-Auftrag mit Agent-Profil,
Journal, Ergebnisvertrag und Workspace-Lease. Das ist ein eigener Ablauf gegenüber
einem Gespräch im Projektterminal. Bei solchen Tasks besitzt ADE die Git-Metadaten:
Der Task-Agent soll weder committen noch Branches wechseln oder pushen.
ADE prüft und integriert die Ergebnisse über seinen verwalteten Ablauf.

Ein aktiver Managed-Lease kann im selben Repository zusätzliche Projektstarts
und Git-Mutationen sperren. Daher bedeutet „parallele Tasks“ heute nicht, dass
jede Kombination aus Managed Run und interaktiver CLI im selben Repo frei läuft.
Die vier Graph-Task-Slots gehören zum Managed-Scheduler; sie sind keine allgemeine
Beschreibung der Zahl nutzbarer interaktiver Projektterminals.

Ein Renderer-Reload kann vorhandene PTYs wieder anbinden. Ein vollständiger
ADE-/PC-Neustart bewahrt keinen laufenden Prozess. „Fortsetzen“ muss zwischen
Wiederanbinden einer laufenden Sitzung, CLI-Neustart und einer vom Anbieter
unterstützten Gesprächswiederaufnahme unterscheiden. Aus dem aktuellen Build
folgt keine automatische anbieterübergreifende Gesprächswiederherstellung.

**Prioritäten für eine einfachere Bedienung**

1. **Einheitlicher Projektkontext:** Desktop überall Projekt, konkreten Pfad,
   Branch, Workspace-Art und gestartetes Profil zeigen. „Originalprojekt öffnen“,
   „Neue Aufgabe in eigener Arbeitskopie“ und „Assistent im Home öffnen“ eindeutig
   auseinanderhalten. Zuweisungen über Desktop/Mobile konsistent auflösen.
2. **Gemeinsame Arbeitsliste:** In Overview/Work auch laufende interaktive
   Projektsitzungen mit selbst vergebenem Aufgabentitel führen. Ein Klick bringt
   exakt dieselbe Sitzung zurück. „Prozess läuft“ und „wartet auf mich“ nur dann
   unterscheiden, wenn dafür ein echter Nachweis existiert.
3. **Schneller Wechsel:** Eine dauerhafte Projekt-/Aufgabenleiste mit zuletzt
   verwendeten Sitzungen und Tastaturwechsel über Projekte hinweg. Die heutigen
   Terminaltabs lösen vor allem den Wechsel innerhalb eines Workspaces.
4. **Git-Abschluss am Task:** Sichtbare Aktionen „Mit main aktualisieren“,
   „In main übernehmen“ und „Push / PR“, jeweils mit Quelle, Ziel und Prüfergebnis.
   Die vorhandenen Git-/Integrationsdienste können die Grundlage bleiben.
5. **Arbeitsfläche fürs Terminal:** Im untersuchten 1440×940-Fenster beanspruchen
   Projektkopf, Branchbereich und doppelte Starter viel Höhe. Nach dem Start
   Starter einklappen; Sitzung, Branch und Status kompakt stehenlassen. Das hilft
   dem tatsächlichen Lesen langer Agent-Antworten.

Der Graph sollte weiterhin Rollen und Abhängigkeiten koordinierter Arbeit zeigen.
Eine normale Einzelaufgabe muss dafür kein Orchestrator-/Lead-/Worker-Team erhalten.
Die bestehenden Sicherheitsprüfungen sind wertvoll; die tägliche Bedienung sollte
ihre Voraussetzungen im gewählten Projektkontext verständlich machen.

**Prüfnachweise und Grenzen**

- Produktionsbuild und Windows-x64-Packaging: erfolgreich.
- Gepackte EXE: Navigation durch alle fünf Bereiche, Projekt- und Gitansicht,
  native PTY mit Echo im Originalprojekt: erfolgreich.
- Drei TypeScript-Projekte: erfolgreich.
- Desktop Work: 20 Checks; Git-Abgleich Electron: 20 Checks;
  Workspace-/CLI-Electron: 54 Checks; Projekt-Git-Electron: 22 Checks bestanden.
- `pnpm test`: alle 56 fokussierten Suiten mit 2.567 Checks bestanden, Exit 0.
  Die vier zusätzlichen Electron-Abläufe bestanden mit insgesamt 116 Checks.
- Kein erneuter vollständiger `pnpm verify` in dieser Analyse. Die frühere
  Gesamtabnahme des übernommenen lokalen Arbeitsstands ist in
  [WORKSPACE_TERMINALS_RESULTS.md](WORKSPACE_TERMINALS_RESULTS.md) dokumentiert.
- CLI-Fixtures beweisen Startort, Sitzungs- und Git-Verträge. Dieser Durchlauf
  belegt keine neue echte Provider-Inferenz, keinen echten GitHub-PR und keine
  zusätzliche Linux-/WSL-/macOS-Unterstützung.

Lokale Evidenz: `test-results/workflow-review/ui-review.json` mit acht Screenshots,
`test-results/workflow-review/git-audit.json`,
`test-results/workflow-review-activation.json` sowie die
`test-results/workflow-review-*.log`-Dateien.

Als erste Produktentscheidung bietet sich an: **Bestehendes Projekt direkt
fortsetzen; neue parallele Aufgabe standardmässig in eigenem Branch/Worktree;
Agent-Profil optional.** Danach lässt sich die gemeinsame Arbeitsliste gezielt
umsetzen und an ADE, RhinoSheetMetal und RhinoClaw abnehmen.
