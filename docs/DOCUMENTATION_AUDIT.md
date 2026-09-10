# ADE-Dokumentationsaudit

## Abgleich vom 10. September 2026

Inventar vor diesem Abgleich: **60 Markdown-Dateien unter docs**. Die aktuellen
Einstiege und Capability-Aussagen wurden mit dem Projekt-/Git-/Ergebnisablauf aus
T0–T7 abgeglichen. Zusätzlich entstehen drei historische Checkpoint-Kopien und
ein [aktualisiertes Produktreview](research/ADE_PRODUCT_REVIEW_2026-09-10.md).
Damit umfasst der geprüfte Bestand jetzt **64 Markdown-Dateien unter docs**.

| Dokument | Entscheidung und konkrete Korrektur |
|---|---|
| HANDOFF | [Zwischenstand archiviert](archived/HANDOFF_2026-09-10_CHECKPOINT.md); aktuelle Übergabe neu geschrieben. Alte T3-Stash-/Neustart-Pendenzen entfernt, tatsächlicher Operator und ursprünglicher Bild-Run getrennt dokumentiert. |
| STATUS | [Zwischenstand archiviert](archived/STATUS_2026-09-10_CHECKPOINT.md); Capability-Matrix behalten, unabhängige Branches/Git/Ergebnisse aktualisiert. Frühere 2.148 Checks ausdrücklich von neuer Gesamtprüfung getrennt. |
| ROADMAP | [Zwischenstand archiviert](archived/ROADMAP_2026-09-10_CHECKPOINT.md); aktuelle Aufgaben und Vorschläge konsolidiert. Historische Goal-Verträge und Exit-Kriterien aktiv belassen. |
| USER_GUIDE und Bilder | Profilfreie Einrichtung, aktuelle Rechte und Menübezeichnungen, Git-Veröffentlichung und Dateiabruf aus Graph/Projekt erklären. 14 Einstiegsbilder erneut aufgenommen; zusätzliche aktuelle Run-Bilder 15/16/23/24. |
| Recherche vom 9. September | Als datierte Quelle aktiv behalten; sichtbarer Verweis auf den Abgleich vom 10. September. Nicht mehr als vollständig offene heutige Aufgabenliste lesen. |
| PLAN-/GOALS-/RESULTS-Dokumente | Gültige API-, Plattform-, Sicherheits- und Messverträge behalten. Ein alter Dateiname alleine ist kein Archivierungsgrund. |

ARCHITECTURE und SPEC sind mit dem T7-Vertrag synchron. Neue Guidebilder stammen
aus isolierten Produktionsbuilds; `capture*.json` nennt Quelle und Grenzen.
Die Ergebnisdateien sind echte lokale Fixture-Ausgaben, keine Modellbewertung.
Ein vollständiger physischer Samsung-Test und die blockierte WSL-Zusatzabnahme
werden ausdrücklich nicht durch Screenshots oder native Windows-Tests ersetzt.

Die abschliessende repositoryweite Prüfung ist in [STATUS](STATUS.md) dokumentiert.
Der Linkcheck prüft aktuell 213 relative Dokumentziele inklusive Archivverweisen.
Die folgenden Abschnitte bewahren das ursprüngliche Audit vom 9. September;
seine Checkzahlen und Aussagen „keine Produktdateien verändert“ gelten für diesen
historischen Dokumentationsslice.

## Ursprünglicher Abgleich vom 9. September

Stand: 2026-09-09 · Ausgangsstand: `8433e7d`.

**Ergebnis:** vier überholte Markdown-Dateien nach `docs/archived` verschoben,
drei vollständige Sammelstände zusätzlich archiviert, aktuelle Einstiege
korrigiert und einen bebilderten [User-Guide](USER_GUIDE.md) mit
[Dokumentationsindex](README.md) ergänzt. Keine Architekturverträge oder
Messprotokolle wurden wegen ihres Alters gelöscht.

## Prüfrahmen

Inventar: die **51 zuvor versionierten Markdown-Dateien unter docs**, dazu die
Root-README. Geprüft wurden Rolle, Datierung, Nachfolger und gegenseitige
Verweise; die betroffenen Einstiegs-/Statusaussagen wurden mit aktuellem Code,
Browser-/Electron-Aufnahmen und Ergebnisprotokollen abgeglichen. Ältere externe
Produktberichte wurden als datierte Recherche eingeordnet, nicht vollständig
gegen die heutige Version jedes Drittprodukts neu validiert.

Der neue Capture-Driver verwendet den Produktionsbuild mit isoliertem Profil,
Beispiel-Repository und lokalen CLI-Fixtures. 14 Screenshots zeigen den aktuellen
Desktop-/Tablet-Ablauf; Softwaretastatur-Geometrie ist simuliert. Quelle und
Bildliste: [capture.json](media/user-guide/capture.json).

## Archivierungsentscheidungen

| Bisheriger Ort | Entscheidung | Begründung / Ersatz |
|---|---|---|
| `ADE_NEUSTART_ANLEITUNG.md` | [Archiv](archived/ADE_NEUSTART_ANLEITUNG.md) | Persönliche Anweisung für einen inzwischen überholten Heim-PC-Stand. Updateablauf jetzt im User-Guide. |
| `HANDOFF-graph-worker-distribution.md` | [Archiv](archived/HANDOFF-graph-worker-distribution.md) | Bereits als abgelöster Entwurf markiert; aktuelle Managed-Run-Verträge stehen in ARCHITECTURE. |
| `HANDOFF-worker-distribution-mvp.md` | [Archiv](archived/HANDOFF-worker-distribution-mvp.md) | Früher MVP mit fest verzögerten Eingaben; kein heutiger Implementierungsauftrag. |
| `DESIGN_REVIEW_2026-07-19.md` | [Archiv](archived/DESIGN_REVIEW_2026-07-19.md) | Datierter UI-Befund mit teilweise erledigten Punkten. Offene Sprach-/Typografie-/Kontrast-/Touch-Themen weitergeführt als R10/R11. |
| `HANDOFF.md` | Aktuelle Datei stark gekürzt; [vollständiger vorheriger Stand](archived/HANDOFF_2026-09-09.md) erhalten | 1.357 Zeilen mit mehreren widersprüchlichen „Nächster Schritt“-Abschnitten. Neue Übergabe beschreibt aktuellen Auftrag, Betrieb und Grenzen. |
| `STATUS.md` | Aktive Matrix aktualisiert; [Snapshot](archived/STATUS_2026-09-09.md) erhalten | Lieferhistorie verdrängte den Capability-Stand und enthielt alte Neustart-Pendenzen. Bekannte Grenzen bleiben aktiv. |
| `ROADMAP.md` | Erledigte Liefernotizen ausgelagert; [Snapshot](archived/ROADMAP_2026-09-09.md) erhalten | Aktuelle Vorschläge vom historischen Lieferverlauf getrennt. Detaillierte Goal-Tracks/Exit-Kriterien bleiben in der aktiven Datei. |

Archivdateien erhalten einen Hinweis und angepasste relative Links. Der damalige
Inhalt bleibt erhalten; alte Codepfade und damalige Testzahlen werden nicht
nachträglich zu heutigen Nachweisen umgeschrieben.

## Konkret korrigierte Aussagen

| Ort | Überholt / missverständlich | Aktuelle Einordnung |
|---|---|---|
| Root-README | Mobile Einstieg hauptsächlich Agent/Work; Entwürfe pauschal nur im Speicher; Overview nur lesend; sehr alte Check-Badge | Projekteinstieg und direkte Assistentenaktionen, persistente Task-/Terminalentwürfe und Guide verlinkt; Badge an belegte Grössenordnung angepasst. |
| STATUS | Remote-Terminal nur begrenzter Text, keine Farbdarstellung; Claude/Grok fehlen in Sitzungsauswahl | xterm-Farben/Cursor, direkte Eingabe, Tastaturaktion und vorhandene CLI-Auswahl benannt; Maus-/Transfergrenzen erhalten. |
| STATUS / HANDOFF | Goals 20–21 noch nicht am Host aktiviert; pauschal keine physische Rückmeldung | Historische Pendenzen archiviert; September-Auslieferung und positives qualitatives Feedback von systematischer Geräteabnahme unterschieden. |
| STATUS | Aktuelle Pilot-Roster-/Modellangaben als allgemeine Capability | Durch persistente Profile und dynamische Desktop-Auswahl ersetzt. Persönliche Messroster bleiben in ihren Nachweisen. |
| Mobile Connect Guide | Terminals und sämtliche Diffs seien nur am Desktop; Projekte in ADE-eigenem Ordner | Dedizierte Remote-Freigaben und konfigurierter Projekt-Stammordner; ausführliche Run-Berichte/Approval/Publishing weiterhin Desktop. |
| Remote Terminal Guide | „Agent starten“ und verpflichtender alter Verwaltungsumweg | Aktuelle Projekt-/Assistentenwege, „[Agentname] öffnen“, Tastaturaktion, Claude/Grok ergänzt. |
| SPEC | Allgemeiner Ausschluss von Remote-Terminal/-Verwaltung widerspricht späteren Vertragsabschnitten; „One-command install“ klingt geliefert | Ausschluss auf unbeschränkte IPC/Host-Verwaltung präzisiert; dedizierte APIs bleiben unverändert. Geführte Installation als Ziel benannt. |
| ROADMAP Goal 11 | SQLite-Migration als Pflicht trotz späterer Retention und Review-Empfehlung | Entscheidung an gemessenen Bedarf gebunden. Bereits vorhandener dedizierter Terminalzugang vom weiteren Ausbau unterschieden. |
| Juli-Professionalisierungsreview | Ursprungsbefunde neben späteren Erledigungsnotizen können als aktuelle Gesamtliste gelesen werden | Datierten Charakter oben erklärt; offene technische Nachprüfungen im neuen Research verlinkt. |

## Bewusst aktiv belassene Dokumente

Die folgende Übersicht deckt die übrigen Dateien des ursprünglichen Inventars ab.
„Behalten“ meint ihren dokumentarischen Zweck, keine erneute Bestätigung sämtlicher
alter Drittanbieter-Aussagen.

| Dateien / Gruppe | Zweck und Entscheidung |
|---|---|
| `ARCHITECTURE.md`, `SPEC.md` | Aktuelle verbindliche Verträge. SPEC-Widerspruch behoben; keine API erweitert. |
| `REPOSITORY_SCOPES_PLAN.md`, `REPOSITORY_SYNC_PLAN.md`, `REPOSITORY_INSPECTOR_PLAN.md` | Weiter gültige Repository-/Git-Verträge; PLAN bedeutet hier nicht veraltet. |
| `VERIFIED_PUBLISHING_PLAN.md`, `MULTIPLATFORM_PLAN.md`, `REMOTE_CONTROL_PLAN.md` | Gelieferte Teilumfänge und offene Plattform-/Sicherheitskriterien. Behalten. |
| `WORKSPACE_BUNDLES.md`, `RUNTIME_MODEL_SELECTION.md` | Nutzbare Funktionsreferenzen mit Grenzen. Behalten. |
| `TABLET_PROJECT_START.md`, `PROJECT_ENTRY.md`, `ASSISTANT_ACCESS.md` | Aktuelle Funktionsverträge; User-Guide ergänzt die Nutzersicht. |
| `REMOTE_WORKSPACE_GOALS.md`, `REMOTE_WORKBENCH_GOALS.md`, `SESSION_WORKSPACE_GOALS.md` | Umfang/Abnahmekriterien gelieferter Slices. Behalten, über Index einordnen. |
| `TABLET_PROJECT_START_RESULTS.md`, `PROJECT_ENTRY_RESULTS.md`, `ASSISTANT_ACCESS_RESULTS.md` | Plattform-/Commit-bezogene Messnachweise. Behalten. |
| `REMOTE_WORKSPACE_RESULTS.md`, `REMOTE_WORKBENCH_RESULTS.md`, `SESSION_WORKSPACE_RESULTS.md` | Funktions-, Berechtigungs- und Recovery-Nachweise. Behalten. |
| `TERMINAL_LATENCY_RESULTS.md`, `TERMINAL_KEYBOARD_RESULTS.md`, `TERMINAL_KEYBOARD_ACTIVATION_RESULTS.md` | Aktuelle Fehlergeschichte mit Negativ-/Positivkontrollen und Messgrenzen. Behalten. |
| `REMOTE_TERMINAL_GUIDE.md`, `goal8/MOBILE_CONNECT_GUIDE.md` | Bestehende vertiefende Anleitungen aktualisiert, auf neuen Einstieg verlinkt. |
| `PROFESSIONALIZATION_REVIEW_2026-07-26.md` | Offene Nachprüfungen, z. B. Mehrprozessschutz, Dashboard-Abmeldung, Kill-Eskalation. Noch nicht komplett abgelöst. |
| `goal6/VALIDATION_PLAN.md`, `goal6/RESULTS.md`, `goal6/F3F4_RETEST.md` | Reproduzierbare historische Produktmessungen; gehören weiterhin zu den Engineering-Nachweisen. |
| `goal7/HOST_API_FOUNDATION_PLAN.md` | Nachvollziehbarkeit des Host-API-Vertrags. Behalten. |
| `goal8/MOBILE_CONNECT_PLAN.md`, `goal8/MOBILE_CONNECT_RESULTS.md` | Ursprünglicher Mobile-Slice und konkrete Transport-/Browsernachweise. Nicht als vollständiger aktueller Mobile-Umfang lesen. |
| `goal8/MOBILE_DESKTOP_PARITY_PLAN.md`, `goal8/MOBILE_DESKTOP_PARITY_RESULTS.md` | Abnahmekriterien und Evidenz für den damaligen Paritätsslice. Behalten. |
| `reports/hermes-memory.md`, `reports/superset.md` | Datierte externe Recherche. Kein Nachweis heutiger Anbieterfunktionen; bei erneuter Nutzung neu prüfen. |
| `research/agent-orchestration/README.md`, `ADE_CONTEXT.md`, `EVALUATION_PLAN.md`, `GRAPH_ORCHESTRATOR_DESIGN.md`, `PROMPTING_PLAYBOOK.md`, `SOURCES.md` | Zusammengehöriges Recherchepaket mit eigenem Einstieg und Quellen. Als Paket behalten; aktuelle ADE-Implementierung steht in STATUS/ARCHITECTURE. |

## Künftige Pflege

1. **USER_GUIDE:** Nutzerwege und Bilder gemeinsam aktualisieren, wenn sichtbare
   Beschriftungen oder Abläufe wechseln. Capture-Driver und Bilder gehören zusammen.
2. **STATUS:** Was heute implementiert und gemessen ist; keine fortlaufende
   Ansammlung ganzer Sitzungsberichte vor der Matrix.
3. **ROADMAP:** Noch offene Arbeit und Exit-Kriterien; neue Vorschläge als solche markieren.
4. **HANDOFF:** Eine aktuelle Übergabe. Historische Übergaben separat archivieren.
5. **RESULTS:** Datum, Code-/Buildstand, Plattform und Messgrenzen erhalten.
6. **archived:** Erst verschieben, wenn Ersatz und verbleibende offene Punkte
   benannt sind. Eingehende Links und Bildpfade danach prüfen.

## Prüfung dieser Lieferung

Die Aufnahme wurde mit dem echten Produktions-UI ausgeführt; alle 14 Bilder sind
PNG-Dateien mit protokollierten Abmessungen und wurden visuell geprüft. Pairing-Code,
QR und Pairing-Link sind maskiert. **187 lokale Verweise** in **60 Markdown-Dateien**
(einschliesslich Root-README und Archiv) wurden auf Ziel bzw. Überschrift geprüft:
keine fehlenden Ziele. PNG-Gesamtgrösse: rund 646 KiB.

Der abschliessende native Windows-Lauf **`pnpm verify` ist grün: 2.148 Checks**,
alle drei TypeScript-Projekte, Produktionsbuild und sämtliche eingebundenen
Electron-/Browser-/Visual-Abläufe. Der finale Capture-Driver wurde zusätzlich nach
seinen letzten Wartezustandskorrekturen typgeprüft und erfolgreich ausgeführt.
Keine Produktdateien unter `src`, Paketabhängigkeiten oder Live-Konfiguration
wurden verändert; ein Betreiber-Neustart war für diesen Slice nicht nötig.

Lokale Rohprotokolle (absichtlich nicht versioniert):
`test-results/user-guide-verify.log`, `user-guide-capture.log`,
`user-guide-script-typecheck.log` und `user-guide-links.log` im selben Verzeichnis.
