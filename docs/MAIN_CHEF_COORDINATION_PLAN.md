# Main Chef: Anweisungen und projektübergreifende Aufgaben

Stand: 13. September 2026. **Entwurf für Goal 26, keine neue Supportzusage.**
Diese Änderung dokumentiert eine Codeinspektion; die unten genannten Tests wurden
für diesen Plan nicht ausgeführt. Bestehende Architektur und Produktstatus bleiben
massgeblich. Goal 23–25 behandeln Sprache, Nutzung und Terminal-Latenz; der zweite
PC gehört zum separaten [Multi-Host-Plan](MULTI_HOST_ACCESS_PLAN.md).

## Empfohlener Ablauf

Der Benutzer wählt beim Main Chef **RhinoSheetMetal**, **RhinoClaw** und weitere
Projekte aus „Meine ADE Projekte“ und beschreibt ein gemeinsames Ziel. ADE zeigt
je Projekt den zuständigen Agenten, den Ziel-PC und den vorgesehenen Arbeitsbereich.
Main Chef erstellt daraus einen prüfbaren Aufgabenplan mit Ergebnisbedingungen,
Abhängigkeiten und Aufwandgrenzen. ADE startet die einzelnen Aufgaben und liefert
strukturierte Ergebnisse an Main Chef zurück. Ein Projektabschluss bleibt mit den
tatsächlich ausgeführten Prüfungen verbunden.

Für den ersten Ausbau empfiehlt sich ein Koordinationsauftrag über mehreren
gewöhnlichen, jeweils auf **ein Repository** begrenzten Runs. Das bewahrt die
bestehenden Git- und Integrationsregeln. Main Chef steuert Aufgaben über typisierte
ADE-Kommandos; das automatische Tippen in bereits offene Agent-Terminals ist kein
geeigneter Delegationsweg: Dort können Benutzer arbeiten, Eingaben können auf
Rückfragen treffen und die Sitzung besitzt keinen verlässlichen Aufgabenabschluss.

„Projekt 1, 4, 6“ darf sich nur auf die gerade gezeigte Auswahl beziehen. Nach der
Auflösung speichert ADE stabile Projekt-IDs und zeigt die Namen vor dem Start.
Sortieren oder Umbenennen darf niemals die Zielprojekte eines Auftrags verändern.
Gleichnamige Projekte erhalten einen unterscheidbaren Host-/Projektzusatz.

## Bestehende Grundlage und konkrete Lücken

| Bereich | Im aktuellen Code vorhanden | Für diesen Ablauf zusätzlich nötig |
| --- | --- | --- |
| Rollen | Identitäten mit `orchestrator`, `lead`, `worker`; Rollenblock in `memoryDir/AGENTS.md` | Gut auffindbare Zuweisung weiterer Markdown-Dokumente und Vorschau des wirksamen Kontexts |
| Anweisungen | Erhalt benutzereigener Inhalte ausserhalb des ADE-Rollenblocks; begrenzte rollenbezogene Taskkopie samt SHA-256/Zeichenzahl | Versionierter Dokumentkatalog, eindeutige Quellen, Pflicht-/Referenzstatus und transparente Grössenfehler |
| Kontext | `TASK_CONTEXT.json`, Memory-Snapshot, Prompt-/Adapter-Provenienz und strukturierte Abhängigkeitsergebnisse | Projektübergreifender Kontextvertrag und unveränderliche Dokumentrevision je Auftrag |
| Delegation | Managed Planner-Zuweisungen, DAG-Prüfung, Scheduler, Mailbox und validierte Ergebnisse | Main-Chef-Werkzeug mit eng begrenzter Berechtigung für ausgewählte Projekte und einen übergeordneten Auftrag |
| Repositories | Leases und gemeinsames Git-Repository je managed Run | Elternauftrag über getrennten Kind-Runs; keine Lockerung der Common-Git-Dir-Prüfung |
| Einzelaufgabe | `RunCoordinator.submitSingleTask`, atomare Run-/Teilnehmer-/Task-Erstellung und Main-eigener Launcher | Bewusste Wahl zwischen Einzelaufgabe und vollständigem managed Integrationslauf; Einzelaufgabe ist kein Ersatz für dessen Verifikations-/Publikationsgrenzen |
| Ergebnis/Steuerung | Journal, Ergebnisberichte, Abbruch, Team-Pause und getrennte Publikationsgrenze | Aggregierter Fortschritt, Teilfehler, sichere Wiederaufnahme und gemeinsame Abbruchweiterleitung |

Quellen im Repository: [Rollenvertrag](../src/main/memory/agentInstructions.ts),
[Taskkontext](../src/main/orchestration/contextManifest.ts),
[Coordinator](../src/main/orchestration/RunCoordinator.ts),
[FilesView](../src/renderer/rightpanel/FilesView.tsx),
[Architektur](ARCHITECTURE.md), [Beta-Tests](../scripts/test-orchestration-beta.ts).
Die Beta-Tests enthalten bereits Assertions für die Rollen-Taskkopie und ihre
Digest-Provenienz. Die ältere Forschungsdatei `research/agent-orchestration/ADE_CONTEXT.md`
beschreibt historische Lücken; mehrere davon sind inzwischen im Code geschlossen.

Die heutige Dateiansicht löst gepinnte Dateinamen workspace-first, memory-next auf.
Deshalb darf die neue Rollenverwaltung `AGENTS.md` nicht einfach über diesen
mehrdeutigen Dateinamen bearbeiten: Sie muss den **Identitätsvertrag** ausdrücklich
von den **Repository-Anweisungen** unterscheiden.

## Anweisungen zuweisen

Im Agent-Dialog erhält Main Chef einen Bereich „Anweisungen“:

- **Rolle:** bestehender ADE-Rollenvertrag, mit separat bearbeitbarem Benutzerteil.
- **Dokumente:** beispielsweise `COORDINATION.md`, `QUALITY.md` und
  `PROJECT_CONTEXT.md`; Hinzufügen, Reihenfolge, aktiv/inaktiv und Pflicht/Referenz.
- **Geltungsbereich:** global für diese Identität, für ausgewählte Projekte oder
  nur für einen Auftrag. Projektlokales Wissen geht nur an passende Teilnehmer.
- **Wirksamer Kontext:** Dateiname, Herkunft, Revision, Digest, Umfang und Zweck;
  Konflikte, fehlende Pflichtdateien oder übergrosse Inhalte vor dem Start erklären.

Ein Dokumentimport erstellt eine ADE-eigene Kopie unter einem instruction-
Verzeichnis der Identität ausserhalb aller geleasten Repositories. Ein explizites
„Quelle aktualisieren“ importiert eine neue unveränderliche Revision. Änderungen
an der ursprünglichen Datei ändern keinen bereits gestarteten Auftrag. Main liest
nur validierte reguläre Dateien unter derselben Link-/Containment-Disziplin wie
andere Workspace-Grenzen; Remote-Nutzer übermitteln keine beliebigen Hostpfade.

Vorgeschlagene Metadaten: `documentId`, `revision`, `name`, `sha256`, `bytes`,
`chars`, `required`, `scope`, `createdAt`; Zuweisungen referenzieren diese IDs.
Beim Auftragsstart werden die konkreten Revisionen eingefroren. Jeder Kindtask
erhält nur seine passenden Kopien im Taskverzeichnis und einen versionierten
Kontextindex. Das ist keine Installation von Dateien in den Projekt-Worktree.

Pflichtanweisungen dürfen nicht still abgeschnitten werden. Die vorhandene
32.000-Zeichen-Begrenzung des Rollen-Snapshots ist bei der Einführung bewusst zu
migrieren: verständlicher Startfehler oder vom Benutzer gekürzte Revision.
Referenzen können begrenzt und als solche gekennzeichnet werden. Die Persistenz
des Pflicht-Kontextindex muss vor Launch erfolgreich sein; der bisher teilweise
best-effort geschriebene Kontextpacketpfad reicht dafür allein nicht aus.

Modell-/Plattformvorgaben, Benutzerauftrag und technische Berechtigungen bleiben
verbindlich. Repository-Anweisungen und Taskvertrag haben wie bisher Vorrang vor
dem Identitätsprofil; Memory und Referenztexte sind zusätzlicher Kontext. Widersprüche
zu verbindlichen Vorgaben werden vor der betroffenen Arbeit offengelegt. Markdown
kann niemals Rechte erteilen, ein Projekt freischalten oder eine Freigabe ersetzen.

## Projektzuständigkeit und Auftragsvertrag

„Meine ADE Projekte“ bildet den auswählbaren Katalog. Je Projekt kann der Benutzer
einen Standard-Verantwortlichen und optional weitere Teammitglieder hinterlegen.
Ein Agent-Profil kann für mehrere Projekte zuständig sein; der Ausführungsscope
bleibt pro Task unveränderlich und wird in Main aufgelöst. Ein bereits offenes
Codex-Terminal erzeugt keine automatische Zuständigkeit oder Koordinationsfreigabe.

Ein neuer `CoordinationJob` verweist auf Chef-Identität, ausgewählte Projekt-IDs,
eingefrorene Dokumentrevisionen, genehmigten Ausführungsscope, Kind-Runs,
projektübergreifende Abhängigkeiten, Limits und Status. Das Ziel und Dokumentkörper
bleiben in Main; die UI erhält Titel, freigegebene Ergebnisdetails, Status und
Digest-/Längenmetadaten nach dem bestehenden View-Vertrag.

Main Chef liefert einen strukturierten Plan mit `projectId`, `assigneeId`, Titel,
Aufgabe, Akzeptanzkriterien, Abhängigkeiten und benötigten Fähigkeiten. Main prüft
Auswahl, Zuständigkeit, Adapterfähigkeit, Zyklen, Budgets und Leases. Main erzeugt
selbst Run-/Teilnehmer-/Task-IDs, Arbeitsbereiche, PTY-Sitzungen und idempotente
Launch-Kommandos. Vom Modell vorgeschlagene Pfade, Shellbefehle oder beliebige
Run-IDs sind keine zulässigen Delegationsparameter.

Der Benutzer kann bereits beim Erteilen des Auftrags Planung und Ausführung im
angegebenen Scope autorisieren; dafür braucht es keine zusätzliche Freigabe je
gewöhnlicher Unteraufgabe. Neue Projekte, zusätzliche externe Aktionen oder eine
Ausweitung des genehmigten Umfangs erfordern eine konkrete Scopeänderung.
Die vorhandene dauerhafte Integrationsfreigabe bleibt pro Kind-Run erhalten.
Publizieren bleibt eine separate, am exakten verifizierten HEAD gebundene Aktion
des bestehenden PublicationService. Main Chef darf diese Grenzen nicht durch
einen Shell-Aufruf oder den Text seiner Anweisungsdateien umgehen.

Managed Agents arbeiten ausschliesslich in ihren Leases. Wenn ADE Git besitzt,
dürfen sie nicht add, commit, reset, checkout, rebase, merge oder push ausführen.
ADE erstellt und integriert die geprüften Änderungen. Die Produktberechtigung
des Chefs ist unabhängig von einem CLI-Bypassmodus: Ein solcher Prozess ist nach
der bestehenden Architektur vertrauenswürdig und kein OS-sicher isolierter Agent.
Der neue Funktionsumfang darf daraus keine umfassende Prozessisolation behaupten.

## Technischer Kontrollweg

Ein schmaler Agent-Werkzeugadapter reicht nur typisierte Vorschläge an
`AdeApplicationService` weiter. Eine jobgebundene, kurzlebige Capability begrenzt
Projektmenge, Aktionen und Budgets. Sie stammt aus Main, nie aus Markdown oder
einem Modellresultat. Kinder erhalten keine Chef-Capability. Der erste Ausbau
verbietet rekursive Chefs und begrenzt Anzahl Aufgaben, Parallelität, Laufzeit
und Reparaturversuche. Token-/Kostenlimits nur bei nachgewiesener Adaptertelemetrie.

Mobile-Kommandos laufen weiter mit Device-Principal, Scope, Signatur, erforderlichem
Idempotency-Key und Audit über die Host-API. Neue Kanäle brauchen explizite
IPC-Policy; keine Erweiterung auf beliebige PTY-, FS-, Config-, Host- oder Shell-
Operationen. Wire-DTOs liegen in `src/shared/remote.ts`, Ereignisdaten bleiben auf
der Whitelist, Fehler werden redigiert. Main→Renderer-Ereignisse nutzen ausschliesslich
`rendererWindows.ts`.

Ein Elternauftrag hält keinen gemeinsamen Git-Lease über unterschiedliche Repos.
Kind-Runs besitzen ihre eigenen Leases und Verifikationsnachweise. Projektübergreifende
Abhängigkeiten transportieren zunächst begrenzte, typisierte Ergebnisinformationen
oder explizit freigegebene Artefakte. Ein Commit in Projekt A wird nicht automatisch
in Projekt B übernommen. Reale Abhängigkeiten wie eine veröffentlichte Bibliothek
benötigen einen gesonderten, erlaubten Liefer-/Publikationsschritt.

## Ergebnisse, Pause und Abbruch

Der Chefbericht zeigt je Projekt Ergebnis, geänderte Dateien, Prüfungen, Risiken,
Blocker und Integrations-/Publikationsstand. Zusammenfassungen ersetzen keine
Prüfevidenz. Ein erledigtes Kind macht keinen unvollständigen Elternauftrag grün;
„teilweise abgeschlossen“ bleibt von „abgeschlossen“ unterscheidbar. Fehlende
Nutzungsdaten bleiben unbekannt, gemeinsam genutzte Abokontingente werden nicht
aus Task-Tokenzahlen erfunden.

„Pause“ stoppt neue Starts; laufende Tasks enden regulär. „Stoppen“ sperrt zuerst
weitere Delegation und leitet idempotente Abbrüche an aktive Kinder weiter. Leases
werden erst nach deren tatsächlichem Ende freigegeben. Späte Ergebnisse lösen
keinen neuen Task und keinen Commit nach Leaseverlust aus. Ein Neustart darf
keine doppelte Delegation erzeugen und keinen unterbrochenen Auftrag als erfolgreich
rekonstruieren. Reparaturen erhalten ein festes Versuchslimit und einen dokumentierten
Grund; abgeschlossene Kinder werden nicht ohne Anlass erneut ausgeführt.

Neue Journaltypen und Koordinationsdatensätze brauchen Migration, Archivierung und
Retention zusammen mit ihren Referenzen. Offene/geleaste/veröffentlichte Runs
werden weiterhin nicht weggekürzt; Archive werden vor dem Speichern geschrieben.
Dokumentkörper und Mailboxtexte gelangen nicht über `OrchestrationView` in die UI;
erforderliche Ergebnisdetails gehören in `RunReport`/`ResultDetails`.

## Goal 26: kleine, überprüfbare Ausbaustufen

| Teilziel | Ergebnis | Abnahme |
| --- | --- | --- |
| 26.1 Anweisungen | Expliziter Identitätsvertrag und versionierte Markdown-Zuweisung; Vorschau des wirksamen Kontexts | Reale native Codex-Aufgabe erhält exakte Revision/Digest ausserhalb des sauberen Leases; Änderung nach Start wirkt erst beim nächsten Auftrag; fehlend, zu gross und Linkpfad negativ geprüft; keine Quellenverwechslung bei zwei `AGENTS.md` |
| 26.2 Zuständigkeit und Planung | Namenbasierte Mehrfachauswahl, Projektverantwortliche, gespeicherter Plan | Drei Testprojekte, Umbenennen/Sortieren, doppelte Namen, fehlende Zuständigkeit, Scopeüberschreitung und Zyklen; Planung startet keine Implementierung |
| 26.3 Ein Host, mehrere Projekte | Elternauftrag startet getrennte managed Kind-Runs mit begrenzter Parallelität | Zwei echte Repositories, disjunkte Leases, überprüfte Ergebnisse und Integration je Repo; doppelte Kommandos, Kindfehler, Scopewechsel und gleichzeitige interaktive Sitzung |
| 26.4 Steuerung und Bericht | Pause, Stop, Neustart und begrenzte Reparatur; nachvollziehbarer Gesamtbericht | Stop während Launch/Ergebnisrennen, kein Commit nach Leaseverlust, kein doppelter Start nach Recovery; Teilabschluss bleibt wahr; Archiv/Retention und redigierte Wire-Ereignisse |
| 26.5 Zweiter Host | Gezielte Delegation an separat gekoppelten ADE-PC | Erst nach Multi-Host-Identität/Grants; zwei reale PCs, Host offline/widerrufen, keine Schlüssel-/Scopevermischung, keine automatische Umleitung auf anderen PC |

Jede UI-Stufe braucht Desktop- und Mobile-Playwright-Flows, Tastaturbedienung,
sichtbaren Fokus, Dialog-Fokusrückgabe sowie Lade-/Leer-/Fehlerzustände. Vor einer
repositoryweiten Fertigmeldung ist `pnpm verify` erforderlich. Reale Adapter- und
Plattformnachweise werden getrennt dokumentiert: native Windows, native Linux/WSLg,
Windows-UI mit WSL-Backend und macOS. Goal-6-Messungen bleiben Codex-only mit den
vorgeschriebenen Modell-/Reasoning-/Bypass- und dauerhaften Rollenvertrags-Pins.

**Sinnvoller erster Lieferumfang:** 26.1 und 26.2 schaffen eine bedienbare
Anweisungsverwaltung und einen überprüfbaren Plan. 26.3 folgt mit zwei Projekten
auf einem PC. Hostübergreifende Autonomie folgt erst nach nachgewiesener
Hostauswahl, getrennten Berechtigungen und zuverlässigem Abbruch.
## Ausgangsbefund vom 14. September 2026

Historischer Befund vor der unten beschriebenen Umsetzung:

Die erneute lokale Sub-Agent-Analyse zeigt eine konkrete Voraussetzung für
Goal 26.1: Interaktive Sitzungen und Managed Tasks bekommen heute nicht denselben
Profilkontext. `snapshotAgentInstructions()` enthält benutzereigenen Text aus
der Identitätsdatei, `injectMemoryBlock()` interaktiv nur den erzeugten
Rollenblock. Projektstarts überspringen diese Injection auch mit ausgewähltem
Profil. Die interaktive Injection schreibt zudem in Repository-Anweisungen.

Vor einer ausführlichen Profil-UI muss daher ein gemeinsamer, vom optionalen
Memory unabhängiger Snapshot entstehen: Rollenblock, eigene mehrzeilige
Anweisungen und explizit zugewiesene Markdown-Revisionen mit Quellenindex,
Digest und festen Größenlimits. Pflichtkontext darf nicht still abgeschnitten
werden. Dokumentrevisionen liegen in der ADE-Identitätsablage außerhalb
geleaster Repositories; Import prüft reguläre Dateien und Linkdisziplin.

Interaktive Launcher benötigen je CLI einen nachgewiesenen Transport des
externen Snapshots zusätzlich zu Repository-Anweisungen. Ein Zugriffspfad allein
beweist kein Lesen. Expliziter Agentmodus und ausgewähltes Projektprofil
erhalten Kontext; normale CLI, Shell und Login nicht. Unbekannte Custom-Commands
müssen fehlende Unterstützung sichtbar machen. Legacy-Injection darf nicht
parallel weiterlaufen; bestehende alte Repository-Blöcke sind ein gesonderter
Migrationsfall und werden nicht pauschal gelöscht.

Die Sitzung speichert Profil-ID, Revision, Digest, Erfassungszeit und
Dokumentrevisionen. Die UI meldet „übergeben“, nicht unbelegt „gelesen“.
Änderungen am Profil zeigen bei laufenden Sitzungen eine neuere Revision und
gelten erst beim nächsten Start. Profiltexte gehen nur über die explizite
Profilabfrage, nicht über allgemeine Agent-/Run-Zusammenfassungen. Mobile nutzt
den bestehenden `profiles:write`-Ledger mit erweiterter Konflikterkennung.

Abnahme: gemeinsamer Snapshot mit Memory aus, Profil-/Normal-CLI-Trennung,
unveränderte Projektdateien, Ressourcen-/Revisionskonflikte, echte native
Codex-/Claude-Probeläufe; WSL getrennt nachweisen. Dieser Abschnitt beschreibt
noch offene Arbeit und behauptet keine bereits wirksame Profilübergabe.

### Verifizierte Transportkandidaten

Die installierte Codex-CLI unterstützt `-c key=value`; die offizielle
[Konfigurationsreferenz](https://learn.chatgpt.com/docs/config-file/config-reference)
führt `developer_instructions` als zusätzliche Sitzungsanweisungen. Das ist
der bevorzugte Kandidat für einen begrenzten Profiltext. `model_instructions_file`
ersetzt dagegen eingebaute Anweisungen und passt nicht zu einer bloßen
Spezialisierung. Vor Implementierung müssen Windows-Argumentlänge, bestehende
benutzereigene Developer-Anweisungen und der tatsächliche native Starttransport
nachgewiesen werden; umfangreiche Dokumente brauchen eine explizite Grenze.

Claude dokumentiert `--append-system-prompt-file` für interaktive und
nichtinteraktive Starts. Damit kann ein eingefrorener Snapshot außerhalb des
Repositorys zusätzlich übergeben werden. Bei fortgesetzten Gesprächen kann der
bisherige Prompt gespeichert bleiben; eine Profiländerung darf deshalb keinen
unbelegten Live-Wechsel behaupten.
[CLI-Referenz](https://code.claude.com/docs/en/cli-reference).
Die Dokumentationsprüfung ersetzt noch keinen echten ADE-Startnachweis.

### Implementierungsstand: Profilbearbeitung und Transportbausteine

Der gemeinsame Editor für Desktop und Mobile kann Arbeitsanweisungen sowie
geordnete Markdown-Kopien speichern. Grenzen: 8.000 Zeichen je Text/Dokument,
acht Dokumente, zusammen 24.000 Zeichen; der vollständige Identitätskontext
ist auf 32.000 Zeichen begrenzt und wird bei Überschreitung abgelehnt.
Die reine Vorschau schreibt keine Dateien. Revision und Quellen-Digests
erkennen konkurrierende Änderungen. Mobile nutzt dedizierte Profilrouten mit
bestehender Gerätefreigabe und signiertem Idempotenz-Ledger; Profiltext wird
nicht in allgemeine Zusammenfassungen oder Ledger-Ergebnisse aufgenommen.

Ein nativer Windows-Transportbaustein legt unveränderliche Snapshot-Dateien
außerhalb des Workspace ab. Codex verlangt vor dem Anhängen ausdrücklich
verifizierte bestehende Developer-Anweisungen; unbekannter Zustand blockiert.
Claude verwendet die zusätzliche Prompt-Datei. Zwölf Tests belegen sicheren
Argumenttransport einschließlich PowerShell 5.1, PowerShell 7 und npm-Shim.
Die Anbindung an den ADE-Sitzungsstart ist inzwischen implementiert: 39
Electron-Prüfungen mit echten PTYs belegen Profil-/Projektstarts, Starttext,
Quellen, Versionsvergleich und unveränderte Repository-Dateien. Aktiviertes
MEMORY/USER samt Pflegeanweisungen bleibt erhalten; deaktivierte Quellen werden
nicht gelesen. Profil- und vollständiger Start-Digest sind getrennt.
Zwölf mobile Browserprüfungen decken die Profilbearbeitung einschließlich
Konflikten und Erhalt eigener Entwürfe ab. Je eine echte Codex-/Claude-Probe
bestätigt die Verarbeitung des nur im Profil enthaltenen Antwortmarkers.
Die vollständige Gesamtabnahme ist grün; Produktcommit `661b41a` ist gepusht
und persönlich aktiviert. Genaue Belege und Plattformgrenzen:
`AGENT_PROFILE_RESULTS.md`, Betriebsstand in `HANDOFF.md`.
