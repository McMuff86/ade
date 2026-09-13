# Fastener-Palette und Agent-Obergruppen: Analyse vom 13. September 2026

Status: Analyse und Produktvorschlag. Keine Integration, Kategorienmigration oder
Änderung am persönlichen ADE-Profil wurde ausgeführt.

## Konkreter RhinoLayoutTools-Fall

Verglichen wurden der lokale Hauptstand `d287642bf829` und der Agent-Branch
`ade/rhino-grok-layout-b64603` bei `7567dcde40af`. Der Agent-Branch enthält einen
eigenen Commit und liegt 79 Commits hinter dem Hauptstand. Ein Remote-Fetch war
kein Bestandteil dieser Analyse; Aussagen zum neuesten Serverstand werden damit
nicht getroffen.

Der eigene Commit ergänzt eine nicht-modale Eto-Palette für `FastenerPlace`:
Norm in Klartext, Grösse, Länge, Antrieb, Flip und eine Silhouetten-Vorschau.
Er betrifft sechs Dateien, darunter die neuen Module `place_dialog.py` und
`silhouette.py`. Im Hauptstand existiert diese Platzierungspalette noch nicht.
Das dort vorhandene Eto-Fenster `FastenerList` dient der Übersicht, Suche und
Prüfung bereits vorhandener Verbindungsmittel und ersetzt sie nicht.

Die zwei uncommitteten Dateien im Agent-Workspace sind die Änderung an
`AGENTS.md` mit ADE-Rollen-/Memory-Anweisungen und eine neue `CLAUDE.md` mit
Agent-Anweisungen. Der eigentliche Paletten-Code ist bereits committed.

### Wiederverwendbarkeit und offene Anpassungen

| Bestandteil | Befund |
| --- | --- |
| Silhouetten und Katalogauswahl | Sinnvoll wiederverwendbar. Der vorhandene Selftest besteht mit 99 Grössen sowohl gegen die alten als auch die aktuellen Katalog-/Hilfsmodule. |
| Eto-Palette | Sinnvolle Grundlage; muss das heutige gemeinsame Designsystem `scripts/rlt_ui.py` verwenden. Die alte Version definiert eigene UI-Helfer, Farben und Schriften. |
| `fastener_place.py` | Gezielt in den aktuellen Ablauf integrieren. Der Hauptstand ergänzt insbesondere `Bohrung`/AutoDiameter und lädt den neueren Cutter-Code. Diese Funktionen müssen erhalten bleiben. |
| Normwechsel im offenen Picker | Fehler isoliert reproduziert: `entry` wird vor `picker.Get()` gelesen, während der Dialog anschliessend `state` verändern kann. Beim Platzieren werden dadurch die alte Norm und die neue Grösse kombiniert. Nach dem Picker-Ergebnis müssen Norm und Grösse gemeinsam neu gelesen und validiert werden. |
| Dokumentation | Die drei Dokumentationspatches passen nicht direkt auf den heutigen Stand und müssen inhaltlich eingearbeitet werden. |
| Rhino-Laufzeit | In dieser Analyse nicht geprüft. Der alte Commit vermerkt ebenfalls einen offenen Live-Test. Fensterwechsel, Vorschau, Abbruch, Bohrungswahl und tatsächliche Platzierung brauchen eine Rhino-Abnahme. |

`git apply --check` lehnt den vollständigen Patch für `CHEATSHEET.md`, `README.md`,
`docs/HANDOFF.md` und `scripts/fastener_place.py` ab. Beide neuen Python-Dateien
sind als reine Dateiergänzung anwendbar. Dies ist ein Test der direkten
Patch-Anwendbarkeit, keine simulierte Drei-Wege-Zusammenführung und kein Nachweis
einer fertigen Integration.

Empfehlung: Einen separaten Integrations-Workspace vom aktuellen Hauptstand
anlegen, die beiden neuen Module als Grundlage übernehmen und den aktuellen
Platzierungsablauf gezielt erweitern. Danach Repository-Prüfungen und Rhino-Tests
ausführen und die vollständige Änderung zur Übernahme vorlegen. Der alte
Agent-Workspace bleibt als Quelle erhalten.

## Vorschlag für ADE: Änderungen zur Übernahme prüfen

Der bestehende Repository-Abgleich aktualisiert ausschliesslich per
Fast-forward. Er blockiert eigene Commits sowie uncommittete Dateien und bietet
noch keine geprüfte Übernahme divergierter Arbeit an.

Ein zusätzlicher Einstieg **Änderungen zur Übernahme prüfen** sollte:

1. Quell-Workspace und aktuellen Ziel-Branch anzeigen; eigene Commits und lokale
   Dateien getrennt erfassen und einen überprüfbaren Stand sichern.
2. Änderungen gegenüber der gemeinsamen Basis bewerten: bereits vorhanden,
   direkt übernehmbar oder Anpassung erforderlich. Agent-spezifische Rollen- und
   Memory-Einträge separat kennzeichnen.
3. Einen Integrations-Workspace auf dem Zielstand vorbereiten. Hier findet die
   Übernahme statt; Quelle und Hauptworkspace werden dadurch nicht überschrieben.
4. Tests, Konflikte und verbleibende Funktionsunterschiede anzeigen. Technische
   Patch-Anwendbarkeit allein bedeutet noch keine fachliche Freigabe.
5. Erst nach Prüfung und ausdrücklicher Bestätigung integrieren. Geänderte
   Ausgangsstände oder inzwischen belegte Workspaces machen die Vorschau ungültig.

Desktop und Mobile sollten denselben Prüfbericht verwenden. Ein möglicher
Agent-Auftrag zur Anpassung arbeitet ausschliesslich im Integrations-Workspace.
Dieser Ablauf ist ein Vorschlag und noch nicht implementiert.

## Vorschlag für die Navigation

ADE besitzt derzeit Kategorien und darunter Agent-Profile. Eine Kategorie hat
keine übergeordnete Kategorie. Der Name `Remote Agents` im vorhandenen Code ist
eine Ausweichkategorie beim mobilen Erstellen eines Agenten in einem leeren
Katalog, keine vorhandene zusätzliche Hierarchieebene.

Empfohlen ist eine optionale, einklappbare **Obergruppe** über den bestehenden
Kategorien, mit höchstens dieser einen zusätzlichen Ebene:

| Obergruppe | Bestehende Kategorie | Bestehendes Profil |
| --- | --- | --- |
| Agent-Systeme, frei als Remote Agents benennbar | Hermes Agent | Hermes General |
| Agent-Systeme, frei als Remote Agents benennbar | OpenClaw | Sentinel |
| Agent-Systeme, frei als Remote Agents benennbar | GrokBuild | GrokMain |

Die vorhandenen Kategorien bleiben erhalten. Obergruppen dienen der Navigation;
sie ändern keine Agent-Identitäten, Projektzuordnungen, Berechtigungen oder
Graph-Rollen. Eine Kategorie gehört höchstens einer Obergruppe an, Profile
bleiben Mitglied ihrer bestehenden Kategorie. Die Darstellung sollte auf Desktop
und Mobile gleich sein, mit Suche und gespeicherter Auf-/Zuklapp-Auswahl.

`GrokMain` verwendet aktuell den nativen Runtime-Typ `grok`, ohne benutzerdefinierten
Startbefehl oder Dashboard. Hermes und Sentinel verwenden Shell-Profile mit
eigenem Befehl und Dashboard. Der Gruppenname `Remote Agents` sollte daher keine
technische Aussage über den Ausführungsort implizieren. `Agent-Systeme` ist der
genauere gemeinsame Name; tatsächlicher Ausführungsort gehört ins jeweilige Profil.

## Prüfevidenz

`test-results/fastener-review-20260913/review.json` enthält die Commit-IDs,
Patch-Prüfergebnisse, beide bestandenen Silhouetten-Selftests und die isolierte
Normwechsel-Reproduktion. Die Kombination aus alter Norm und neuem Zustand wurde
mit dem unveränderten, per AST isolierten `run_dialog` und einem kontrollierten
Picker nachgestellt; das ersetzt keinen Rhino-Live-Test.

Alle Testkopien und der extrahierte Patch liegen im selben ignorierten
Testverzeichnis. Der Git-Dateistatus beider originalen RhinoLayoutTools-Workspaces
war nach der Analyse unverändert. ADE wurde für diese Analyse nicht neu gestartet.
