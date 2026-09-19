# ADE – UI/UX-Analyse und Briefing für die Designüberarbeitung

Stand: 19. September 2026. Auftrag: Analyse und Übergabe an eine UI/UX-Fachperson. Dieses Dokument setzt keine der Empfehlungen um.

## 1. Einschätzung und wichtigster Designauftrag

ADE bietet bereits viele hilfreiche Arbeitsabläufe. Die grösste gestalterische Aufgabe ist, **Organisation, laufende Arbeit, Ergebnisse und Verwaltung klarer voneinander zu unterscheiden**. Gegenwärtig erscheinen Funktionen dieser verschiedenen Ebenen häufig nebeneinander. Dadurch konkurrieren Schaltflächen und Statusinformationen mit dem eigentlichen Arbeitsinhalt.

Die Überarbeitung sollte mit Informationsarchitektur, Begriffen und Aktionshierarchie beginnen. Allein kleinere Buttons oder zusätzliche Menüs würden die Orientierung nicht ausreichend verbessern. Besonders auf dem Tablet soll der Nutzer sofort erkennen:

1. In welchem Projekt und welcher Sitzung arbeite ich?
2. Wer hat gerade die Eingabe, und ist der PC erreichbar?
3. Was ist meine nächste sinnvolle Handlung?
4. Ist mein Inhalt gespeichert, übertragen oder bereits zur Ausführung übergeben?

Tasks und Notes erweitern ADE um persönliche Organisation. Sie brauchen einen klaren Platz neben den vorhandenen Agentenaufträgen. Eine persönliche Aufgabe, ein Terminal und ein Agenten-Run dürfen dabei nicht wie austauschbare Bezeichnungen für dieselbe Sache wirken.

## 2. Aussagekraft und Abgrenzung

Die Analyse beruht auf Quellcode, vorhandener Projektdokumentation, vorhandenen Test-Screenshots sowie den vom Nutzer bereitgestellten Bildern und Rückmeldungen. Sie ist eine fachliche Durchsicht, **keine durchgeführte Usability-Studie und kein vollständiges Accessibility-Audit**. Es wurden für dieses Dokument keine neuen Produkttests und keine externen Studien durchgeführt.

Referenz des bestehenden Produkts bei Beginn der Durchsicht: Commit `9fba338a1325cf44093af9c32db1bc3ba5146f58`. Der gemeinsame Arbeitsbaum wird parallel weiterentwickelt. Navigation, Button-Gruppen und Tasks/Notes können bei Übergabe bereits anders aussehen; die Fachperson soll diese Punkte gegen den dann abgenommenen Build prüfen. Die Findings beschreiben den Ausgangszustand, keine behauptete Fehlerfreiheit oder Fertigstellung der parallelen Umsetzung.

**Tasks und Notes sind zum Zeitpunkt dieser Analyse in Umsetzung.** Ihre Anforderungen stehen in [TASKS_NOTES.md](TASKS_NOTES.md). Die Empfehlungen dazu beschreiben Designentscheidungen und Prüfbedarf; sie sind kein Nachweis bereits ausgelieferter Funktionen.

Evidenzarten im Dokument:

- **Beobachtet:** im gelesenen Code oder einem bezeichneten Bild vorhanden.
- **Nutzerrückmeldung:** in dieser Zusammenarbeit ausdrücklich berichtet; kein Nachweis für alle Nutzer.
- **Hypothese:** vermutete Auswirkung, die im Prototyp oder mit Nutzern zu prüfen ist.
- **Empfehlung:** vorgeschlagene Richtung; die konkrete Gestaltung bleibt offen.

Die genannten `test-results/`-Dateien liegen lokal und sind nicht als dauerhaft versionierte Designunterlagen anzusehen. Ältere Bilder belegen nur ihren Aufnahmezustand. Für eine externe Übergabe passende, anonymisierte Bilder zusammen mit diesem Dokument exportieren; Projektadressen, Personen, Terminalinhalte und Zugangsdaten vorher prüfen. Die Fachperson kann die Analyse auch ohne Zugriff auf den Code lesen.

## 3. Nutzungssituationen und Designziele

| Situation | Absicht | Was die Oberfläche deutlich machen muss |
| --- | --- | --- |
| PC, intensive Entwicklungsarbeit | Terminal bedienen, Dateien prüfen, Agentenauftrag starten | Projekt, Sitzung, aktive Eingabe und nächste Aktion; genug Platz für den Arbeitsinhalt |
| Tablet zu Hause | Bestehende Arbeit fortsetzen, diktieren, Ergebnisse ansehen | Gleiche Begriffe und Zustände wie am PC, gut erreichbare Touch-Ziele |
| Tablet unterwegs, Verbindung schwankt | Arbeit fortsetzen oder Idee festhalten | Erreichbarkeit des PCs, lokal gespeicherter Inhalt, ausstehende Übertragung; bestehende Kopplung von einer neuen Kopplung unterscheiden |
| Kurze Erfassung zwischendurch | Aufgabe notieren oder etwas skizzieren | Schnell schreiben, sprechen oder zeichnen können, ohne vorher Projekt, Agent und Run konfigurieren zu müssen |
| Rückkehr nach längerer Pause | Überblick gewinnen | Was ist offen, was braucht eine Antwort, was ist erledigt und wo liegen die Ergebnisse? |

Der Nutzer hat drei konkrete Reibungen genannt: zu wenig sichtbares Terminal, Unsicherheit über erneutes Pairing unterwegs und einen scheinbar unveränderten Build nach dem Neubauen. Zusätzlich führte ein korrekt geöffneter API-Link zu der Erwartung, die Projektoberfläche zu sehen. Diese Beispiele sind besonders geeignet, um Entwürfe an realen Abläufen zu prüfen.

## 4. Priorisierte Findings

Prioritäten: **P1** vor weiterer Ausweitung der Oberfläche klären; **P2** im anschliessenden Design-Durchgang bearbeiten; **P3** ergänzende Verfeinerung. Dies sind Designprioritäten, keine Sicherheits- oder Fehlerklassifikation.

### UX-01 · P1 · Navigation vermischt Ziele und Systemverwaltung

**Beobachtet:** Der Desktop-Kopf enthält `Overview`, `Projekte`, `Terminals`, `Work`, `Graph` und daneben unter anderem `Arbeit wechseln`, `ADE-Betreuung`, `Einrichtung`, `Settings`, `Diagnostics` und den Theme-Schalter. Mobile ergänzt eine weitere Toolbar mit `Verwalten`, `Details`, `Einstellungen`, `Arbeit wechseln`, `ADE-Betreuung`, `Aktualisieren`, `Terminal öffnen`, `Neues Projekt`, `Neue Aufgabe` und `Neuer Run`; Sichtbarkeit hängt von Ansicht und Zustand ab. Einstellungen sind mobil sowohl im Kopf als auch in der Toolbar erreichbar.

**Hypothese:** Nutzer müssen vor einer Handlung zwischen mehreren ähnlich gewichteten Einstiegspunkten wählen. Tasks und Notes würden eine bereits dichte Leiste zusätzlich verlängern.

**Empfehlung:** Eine wiederkehrende Navigationsstruktur entwerfen: Übersicht; Organisation mit Tasks/Notes; Entwicklung mit Projekte/Terminals/Work/Graph; Verwaltung mit Einstellungen/Einrichtung/Diagnose. Diese Gruppierung ist eine zu prüfende Ausgangsidee, keine festgelegte Sidebar. Auf PC und Tablet darf die Darstellung variieren, Bedeutung und Reihenfolge sollten gleich bleiben. „Arbeit wechseln“ als schnellen Sitzungswechsel eindeutig von der Seitennavigation unterscheiden.

**Prüfung:** Eine Person findet „Aufgabe für später erfassen“, „laufendes Terminal fortsetzen“ und „Gerätefreigabe prüfen“, ohne dafür erst die verschiedenen Seiten ausprobieren zu müssen. Eingeklappte Navigation bleibt per Tastatur und Touch verständlich erreichbar.

**Belege:** [App.tsx](../src/renderer/App.tsx), [mobile/main.tsx](../src/mobile/main.tsx), Bild B3.

### UX-02 · P1 · Graph-Aktionen sind über mehrere Orte verteilt

**Beobachtet:** Der Desktop-Graph verteilt Run-Auswahl, Bericht, Rückfragen, Veröffentlichung, Löschen und Erstellung auf eine obere Leiste; ein verschiebbarer unterer Dock enthält weitere Run-/Team-Aktionen. `Neuer Run` kommt in beiden Bereichen vor. Zoom, Task-Slots und Aktivitätsfenster bilden zusätzliche frei positionierte Elemente. Der mobile Graph hat eine globale Toolbar sowie eine eigene Run-Aktivitätsleiste mit Aktualisierung und Dateien. Bei vorhandenem Run entsteht dadurch mehr als eine Aktionsebene oberhalb der eigentlichen Darstellung.

**Hypothese:** Die Bedeutung einer Aktion ist teilweise stärker an ihren Ort als an ihr Objekt gebunden. Frei verschobene Elemente erschweren eine stabile Orientierung; ein enger Bildschirm kann schneller von Bedienung als vom Graph belegt sein.

**Empfehlung:** Vier klar erkennbare Gruppen entwerfen: **Ansicht**, **Run**, **Ergebnisse** und **Auswahl**. Zoom/Einpassen gehören zur Ansicht; Run-Auswahl und Start zum Run; Bericht/Dateien/Veröffentlichung zu Ergebnissen; Agenten-/Team-Aktionen zum ausgewählten Objekt. Seltene und destruktive Aktionen dürfen in ein beschriftetes weiteres Menü. Noch offene Rückfragen bleiben auffindbar. Positionen sollen zurücksetzbar sein, ohne Doppelklick als einzigen Weg vorauszusetzen.

**Prüfung:** „Welcher Run wird abgebrochen?“ ist unmittelbar beantwortbar. Neuer Run hat je sichtbarem Arbeitskontext einen eindeutigen Haupteinstieg. Die leere Darstellung, ein laufender Run mit vielen Teilnehmern und ein fertiger Run ergeben eine verständliche Hierarchie. Vorhandene Tastaturbedienung der Knoten und Auswahl bleiben erhalten.

**Belege:** [GraphView.tsx](../src/renderer/graph/GraphView.tsx), [Graph.tsx](../src/mobile/Graph.tsx), [graph.css](../src/renderer/graph/graph.css), Bilder B3/B4. B4 zeigt einen älteren Leerzustand; die Verteilung bei aktiven Runs wurde im Code geprüft.

### UX-03 · P1 · Der Arbeitsinhalt braucht mehr Fläche, ohne den Kontext zu verlieren

**Nutzerrückmeldung:** Der obere Projektbereich beanspruchte auf dem Tablet zu viel Terminalfläche. Der Nutzer wünschte Einklappen und eine gemeinsame Zeile für Tabs, Aktualisieren und Branches.

**Bereits verbessert:** Der Projektbereich ist inzwischen einklappbar; die Präferenz bleibt erhalten. Auf breiten Tablets teilen sich die betreffenden Bedienelemente eine Zeile. Die bestehende Implementierung behandelt ausstehende Branch-Aktionen sowie Tastatur-/Fokusverhalten ausdrücklich. Diese Funktion ist keine noch fehlende Empfehlung.

**Beobachteter Rest:** Im schmalen Testbild nehmen selbst nach dem Einklappen Projekttitel, Workspace-Info, Status, CLI-Status und Sitzungsaktionen mehrere Zeilen ein. Unter dem Terminal folgen Verlauf, Diktathinweis, Eingabefeld und weitere Aktionen. `Links` und `Verlauf` liegen innerhalb der Terminalfläche; im Bild überdecken sie Teile der ersten Ausgabezeile. Der historische Nutzerscreenshot zeigt ebenfalls diese Überlagerung.

**Empfehlung:** Einen bewusst gestalteten kompakten Arbeitsmodus mit minimalem Kontextkopf definieren. Projekttitel, Verbindung und Eingabehoheit sollen erhalten bleiben; selten benötigte Details werden bei Bedarf geöffnet. Für Terminalwerkzeuge eine Position prüfen, die Ausgabe nicht verdeckt. Den Composer im leeren Ruhezustand kompakt halten und beim Schreiben/Diktieren gezielt erweitern. Einwilligungs- und Aufnahmeinformationen bleiben zum passenden Zeitpunkt sichtbar.

**Prüfung:** Terminal, Cursor und Eingabe bleiben bei Bildschirmtastatur, Drehung, längeren Titeln und schmalem Fenster erreichbar. Einklappen erzeugt keine neue Terminalinstanz, verliert keinen Text und versteckt keine ungeklärte Aktion. Die verfügbare Arbeitsfläche vor/nach dem Entwurf bei gleicher Schriftgrösse messen.

**Belege:** [TABLET_PROJECT_LAYOUT.md](TABLET_PROJECT_LAYOUT.md), [ProjectDirectoryPage.tsx](../src/mobile/ProjectDirectoryPage.tsx), [RemoteTerminalPane.tsx](../src/mobile/RemoteTerminalPane.tsx), [tablet.css](../src/mobile/tablet.css), Bilder B1/B2 und Nutzerbild von 12:43 Uhr.

### UX-04 · P1 · Persönliche Aufgaben und Agentenaufträge brauchen verschiedene Begriffe

**Beobachtet:** `Work` enthält `Neue Aufgabe`, `Neuer Run`, `Managed Runs` und Task-Zähler. Im Graph bezeichnet „Tasks“ ausführbare Arbeit von Agenten. Der Nutzer wünscht zusätzlich persönliche Aufgaben für später oder einen Termin.

**Empfehlung:** Ein verbindliches kleines Begriffsmodell vor dem Ausbau festlegen. Vorschlag: **Task/Aufgabe** = persönlicher Eintrag; **Agentenauftrag** = ausdrücklich übergebene Arbeit; **Run** = zugehöriger Ausführungsablauf; **Sitzung** = laufendes Terminal; **Note/Notiz** = freier Inhalt. Die endgültigen sichtbaren Begriffe mit dem Nutzer testen. „Neue Aufgabe“ in Work muss eine Agentenausführung erkennbar ankündigen, wenn es diese auslöst.

**Prüfung:** Nutzer können vor dem Speichern sagen, ob etwas nur notiert oder tatsächlich gestartet wird. „Erledigt“ bei einer persönlichen Aufgabe und „Run abgeschlossen“ dürfen sich nicht stillschweigend gegenseitig ersetzen. Eine Erinnerung startet keinen Agenten.

**Belege:** [WorkView.tsx](../src/renderer/work/WorkView.tsx), [mobile/ui.tsx](../src/mobile/ui.tsx), [TASKS_NOTES.md](TASKS_NOTES.md).

### UX-05 · P1 · Verbindung, Kopplung und Aktualität verständlicher auseinanderhalten

**Nutzerrückmeldung:** Sorge vor erneutem Pairing beim Wechsel von zu Hause nach unterwegs; später ein alter Tablet-Build trotz `pnpm build` und `pnpm start`.

**Beobachtet:** Es gibt bereits Statusmeldungen für verbunden/offline, Wiederverbindung, Kopplung und einen Vergleich von PC-/Browser-Build. Die Dokumentation erklärt, dass das Fensterschliessen den mobilen Host weiterlaufen lässt und `pnpm start` die bestehende Instanz öffnen kann. Der tatsächliche alte Build war eine weiterlaufende PC-Instanz. Ein Vergleich „Browser und PC verwenden denselben Quellstand“ sagt für sich allein nicht, ob dieser Quellstand der neueste lokal gebaute ist.

**Empfehlung:** Eine einfache Zustandsdarstellung mit gezielter Hilfe entwickeln: verbunden; kurz unterbrochen/wird wieder verbunden; PC länger nicht erreichbar; Gerätefreigabe fehlt; neue Kopplung nötig; anderer Build. „Erneut koppeln“ darf keine allgemeine Reparaturhandlung für Netzunterbrechungen sein. Update-Informationen müssen die laufende Version beschreiben; „aktuell“ nur bei belastbarem Vergleich. Im PC-Menü die Folgen von Fenster schliessen, ADE beenden und ADE neu starten unterscheidbar machen.

**Prüfung:** Für WLAN-/Mobilfunkwechsel, PC-Neustart und fehlende Gerätefreigabe entstehen unterschiedliche, handlungsfähige Zustände. Ein Nutzer kann erkennen, ob Abwarten, Tailscale prüfen, PC starten oder Rechte prüfen sinnvoll ist. Keine Aufforderung zum Löschen des Browserspeichers als erste Massnahme.

**Belege:** [MobileAccessSection.tsx](../src/renderer/settings/MobileAccessSection.tsx), [SetupStatus.tsx](../src/mobile/SetupStatus.tsx), [HostRestartSection.tsx](../src/mobile/HostRestartSection.tsx), [USER_GUIDE.md](USER_GUIDE.md), [TABLET_PROJECT_LAYOUT.md](TABLET_PROJECT_LAYOUT.md).

### UX-06 · P1 · Aktion, Bestätigung und Ergebnis brauchen eine gemeinsame Sprache

**Beobachtet:** Mobile hat bereits Erklärungen für ausstehende Antworten, Wiederaufnahme und Rechte. Verschiedene Oberflächen verteilen Bestätigung, Fehlermeldung, Inline-Status und Toolbar-Banner unterschiedlich. In B3 erscheinen mehrere Hinweise gleichzeitig; der dort sichtbare Versionsfehler stammt aus einem Testszenario und belegt keinen aktuellen Ausfall der persönlichen Instanz.

**Empfehlung:** Ein Zustandsmuster pro Aktion entwerfen: bereit → wird ausgeführt → bestätigt oder Ergebnis unklar → erneut prüfen. „Gesendet“ ist nicht gleich „ausgeführt“, „gespeichert“ nicht gleich „mit PC abgeglichen“. Kritische ungeklärte Aktionen bleiben an ihrem Objekt sichtbar; erledigte Routinehinweise dürfen zurücktreten. Der nächste Schritt gehört in die Meldung. Deaktivierte Buttons benötigen einen auch ohne Hover auffindbaren Grund.

**Prüfung:** Antwortverlust nach Start, Speichern und Agentenübergabe führt nicht zu einem irreführenden Fehler mit erneutem unabhängigen Start. Nutzer erkennen ausstehende Vorgänge und können zum betroffenen Objekt zurückkehren. Nicht mehrere Banner mit gleichem Grund übereinander stapeln.

**Belege:** [ProjectDirectoryPage.tsx](../src/mobile/ProjectDirectoryPage.tsx), [HostRestartSection.tsx](../src/mobile/HostRestartSection.tsx), [mobile/main.tsx](../src/mobile/main.tsx), Bild B3.

### UX-07 · P2 · Button-System und Icons konsistent definieren

**Beobachtet:** Desktop und Mobile verwenden verschiedene Button-Klassen, Gewichtungen und Werkzeuge. Der Graph besitzt zusätzliche eigene Stile. Viele Aktionen erscheinen als gleichartige umrahmte Buttons. Mobile rendert das Einstellungs-Icon als Kreis mit radialen Strichen; neben dem Sonnensymbol für das Theme sind die Formen ähnlich. Einige Graph-Werkzeuge verwenden Zeichen wie `□`, `⇲`, `⌗` oder `✕` mit `title` statt sichtbarer Erklärung.

**Empfehlung:** Ein kleines gemeinsames System festlegen: Hauptaktion, normale Aktion, unauffällige Zusatzaktion, Umschalter und destruktive Aktion. Gruppierung über Nähe und Beschriftung ausdrücken, nicht jeder Gruppe eine weitere Karte geben. Icons einheitlich zeichnen; seltene oder folgenreiche Aktionen mit Text benennen. Icon-Erklärungen müssen mit Tastatur und Touch funktionieren, nicht ausschliesslich mit Hover.

**Prüfung:** Fokus, Hover, aktiv/ausgewählt, disabled und busy sind visuell unterscheidbar. Die Verbindung aus Farbe, Text und Form trägt die Bedeutung auch bei eingeschränktem Farbsehen. Auf Touch-Geräten projektweit mindestens die bereits verwendete Zielgrösse von 44 CSS-Pixeln anstreben; Dichte am PC separat prüfen.

**Belege:** [tokens.css](../src/renderer/theme/tokens.css), [graph.css](../src/renderer/graph/graph.css), [mobile/ui.tsx](../src/mobile/ui.tsx), [UI_CALM_PASS.md](UI_CALM_PASS.md), Bilder B1–B4.

### UX-08 · P2 · Sprache und Informationsdichte vereinheitlichen

**Beobachtet:** `Overview`, `Work`, `Settings`, `Diagnostics`, `Managed Run`, `Agent`, `Agents`, `Workspace` und deutsche Beschriftungen stehen nebeneinander. Einige Listen geben Statuswerte wie `running` direkt aus. Technische Angaben und erklärende Hilfetexte stehen teils dauerhaft in der Arbeitsansicht.

**Empfehlung:** Ein deutschsprachiges Glossar und Regeln für bewusst beibehaltene Fachbegriffe erstellen. Titel beschreiben den Gegenstand, Aktionen beginnen mit einem eindeutigen Verb. Kurze Hilfen erscheinen dort, wo eine Entscheidung fällt; technische Details bleiben als Details verfügbar. Berechtigung, aktive Aufnahme und mögliche Datenverluste dürfen nicht aus Platzgründen versteckt werden.

**Prüfung:** Derselbe Vorgang heisst auf PC und Tablet gleich. „Schliessen“, „Beenden“, „Trennen“, „Entfernen“ und „Löschen“ sagen klar, ob Ansicht, Prozess, Verbindung, Zuordnung oder Inhalt betroffen ist.

**Belege:** [App.tsx](../src/renderer/App.tsx), [WorkView.tsx](../src/renderer/work/WorkView.tsx), [Graph.tsx](../src/mobile/Graph.tsx), [SettingsTabs.tsx](../src/renderer/settings/SettingsTabs.tsx).

### UX-09 · P2 · Links brauchen Kontext zum Ziel

**Nutzerrückmeldung:** Nach „Öffnen“ eines Links erschien JSON statt der erwarteten Projektoberfläche. Der gewählte Pfad war ein API-Endpunkt; das Öffnen funktionierte technisch korrekt.

**Beobachtet:** Der Linkdialog sammelt URLs aus der Terminalausgabe und bietet Öffnen/Kopieren. Für lokale PC-Adressen gibt es bereits einen Hinweis. Eine inhaltliche Unterscheidung von Projektoberfläche und API-Ziel ist nicht vorhanden.

**Empfehlung:** Zieladresse und gegebenenfalls vom Projekt ausdrücklich hinterlegte Bedeutung zeigen, etwa „Projektoberfläche“ oder „API“. Ein konfigurierbarer Projektlink kann einen verlässlichen Haupteinstieg bieten. Automatisch vermutete Bedeutungen nur als solche anzeigen; Pfade nicht still verändern. Der vollständige Link bleibt überprüfbar.

**Prüfung:** Ein API-Link ist erkennbar eine andere Art von Ziel, sofern diese Information bekannt ist. Öffnen und Kopieren verwenden dieselbe angezeigte Adresse. Kein vermeintlich intelligentes Kürzen auf `/`, das absichtlich gewählte Unterseiten zerstört.

**Belege:** [TerminalLinks.tsx](../src/mobile/TerminalLinks.tsx), [terminalLinks.ts](../src/shared/terminalLinks.ts), Nutzerbild mit `/api/sheet-metal/capabilities`.

### UX-10 · P2 · Lange Arbeitsabläufe brauchen sichtbare Rückwege

**Beobachtet:** ADE öffnet Projekt-Workspaces, Inspektoren, Einstellungen, Branch-/Git-/Veröffentlichungsansichten und weitere Dialoge. Der gemeinsame mobile Dialog enthält bereits Fokusübergabe, Escape-Verhalten und Fallback-Fokus. Unterschiedliche Begriffe wie Workspace-Info, Sitzung & Workspace und Projekt-Einstellungen können trotzdem ähnliche Erwartungen auslösen.

**Empfehlung:** Für die wichtigsten Abläufe eine verständliche Tiefenstruktur entwerfen. Dauerhafte Arbeitsbereiche bevorzugt als Seite oder Panel; kurze Entscheidungen als Dialog. Titel enthalten den aktuellen Gegenstand. Wechsel zwischen Projekt, Sitzung und Run erhalten Kontext und Entwurf. Ein klarer Rückweg zeigt, ob nur die Ansicht geschlossen wird oder die Sitzung endet.

**Prüfung:** Projekt → Terminal → Link → zurück und Run → Ergebnis → Datei → zurück verlieren weder Auswahl noch Entwurf. Der Fokus kommt an einen sinnvollen Ort zurück; Browser-Zurück und App-Zurück verhalten sich vorhersehbar. Letzteres ist eine zu prüfende Anforderung, kein in dieser Analyse nachgewiesener Defekt.

**Belege:** [mobile/ui.tsx](../src/mobile/ui.tsx), [ProjectDirectoryPage.tsx](../src/mobile/ProjectDirectoryPage.tsx), [RunInspector.tsx](../src/mobile/RunInspector.tsx).

### UX-11 · P2 · Lesbarkeit und Bedienbarkeit systematisch messen

**Beobachtet:** Die Designbasis verwendet kleine Typografiestufen von 11–15 Pixeln, zurückhaltende Sekundärfarben und einen 28-Pixel-Basiswert für Desktop-Controls. Mobile hat eigene grössere Ziele. Die Bilder zeigen kleine Status-/Hilfetexte und teilweise schwache visuelle Unterscheidung von Zusatztext und deaktivierter Bedienung. Aus Bildern allein lässt sich keine verlässliche Kontrastkonformität ableiten.

**Empfehlung:** Die Fachperson soll konkrete Text-/Hintergrundkombinationen, Fokusdarstellung, Zoom, Umbruch und reale Touch-Ziele messen. Informationsdichte nach Rolle reduzieren, bevor die Schrift verkleinert wird. Systemschriftgrösse, Hell-/Dunkelmodus, längere deutsche Wörter und grosse Projektnamen berücksichtigen. Für frei verschiebbare Graph-Panels und die Zeichenfläche alternative Bedienwege definieren.

**Prüfung:** Keine wesentlichen Funktionen sind nur über Farbe, präzises Ziehen oder Hover verfügbar. Bedienelemente bleiben mit externer Tastatur und vergrösserter Darstellung erreichbar. Zeichnen hat eine nachvollziehbare textliche Alternative für Notizinhalte und Beschreibung von Bildern.

**Belege:** [tokens.css](../src/renderer/theme/tokens.css), [tablet.css](../src/mobile/tablet.css), [GraphView.tsx](../src/renderer/graph/GraphView.tsx), Bilder B1/B2/B3. Ein umfassender Screenreader-Test steht für diese Analyse aus.

## 5. Tasks und Notes: Designbrief für die laufende Erweiterung

### Gemeinsamer Einstieg und Auffindbarkeit

Tasks und Notes bekommen eigenständige Seiten. Eine schnelle Erfassung soll von beiden aus unmittelbar erreichbar sein. Ob zusätzlich ein globales Erfassungsmenü sinnvoll ist, im Prototyp prüfen; nicht ungeprüft eine weitere dauerhafte Button-Reihe ergänzen. Projektzuordnung ist optional. Persönliche Einträge bleiben ausserhalb von Projekt-Repositories, bis ein Export oder eine ausdrückliche Übergabe erfolgt.

Liste und Detailansicht sollten dieselbe Struktur auf PC und Tablet besitzen. Auf schmalen Bildschirmen können sie nacheinander statt nebeneinander erscheinen. Suche, Filter und Sortierung müssen sichtbare Zustände haben; leere Sammlung, leerer Filtertreffer und noch nicht geladene Daten erhalten verschiedene Texte.

### Task: von der Idee zur tatsächlichen Arbeit

**Kernablauf:** Titel schreiben/diktieren → bei Bedarf Details ergänzen → lokal speichern/mit PC abgleichen → später bearbeiten, erledigen oder an einen Agenten übergeben.

Für den Erstkontakt reicht ein Titel. Projekt, Termin, Erinnerung, Checkliste und Anhänge gehören in einen schrittweise geöffneten Detailbereich. Für `Heute`, `Geplant`, `Später`, `Erledigt` müssen klare Zugehörigkeitsregeln gelten; überfällige Aufgaben dürfen nicht aus „Heute“ verschwinden. Vor der Umsetzung des finalen Designs klären:

- Bedeutet ein Datum Fälligkeit, geplanten Arbeitsbeginn oder Erinnerung? Diese Konzepte nicht in einem einzigen uneindeutigen Kalenderfeld zusammenfassen.
- Wie werden ganztägige Aufgaben, Uhrzeiten, Zeitzonen und überfällige Einträge angezeigt?
- Wo erscheinen Erinnerungen, wenn ADE am PC geschlossen, das Tablet offline oder Benachrichtigungen nicht erlaubt sind? Die Oberfläche verspricht nur tatsächlich verfügbare Zustellung.
- Was passiert bei „Erledigt“, während ein zugehöriger Agentenauftrag noch läuft oder fehlgeschlagen ist?

**Agentenübergabe:** Ein ausdrücklicher Schritt zeigt Projekt, Zielagent, Auftragstext und ausgewählte Anhänge. Danach verlinkt die Aufgabe den Auftrag und dessen Ergebnis. Unklar bestätigte Übergaben brauchen einen Wiederaufnahmezustand. Ein erneuter Tap darf für den Nutzer nicht wie eine harmlose Wiederholung aussehen, wenn er zusätzliche Ausführung erzeugen würde.

### Note: freier Inhalt mit guter Stiftbedienung

**Kernablauf:** Notiz öffnen → schreiben, diktieren, Foto einfügen oder skizzieren → automatisch sichern → bei Bedarf exportieren oder Aufgabe daraus machen.

Text, Bilder und Zeichnung sollen gemeinsam verständlich sein. Vor einem grösseren Canvas-Design entscheiden, ob die erste Ausbaustufe eine Seite mit Inhaltsblöcken oder eine freie Fläche ist. Beide Modelle haben andere Anforderungen an Auswahl, Scrollen, Zoomen, Export und Tastaturbedienung.

Eine kleine sichtbare Werkzeuggruppe genügt für den Anfang: Schreiben/Zeichnen, Stift, Radierer, Farbe/Breite, Rückgängig/Wiederholen. Export und weiterführende Aktionen gehören ausserhalb der eigentlichen Zeichenwerkzeuge. Die Begriffe „Stift“ und „Text“ dürfen nicht gleichzeitig Werkzeug und Inhaltsart uneindeutig bezeichnen.

Mit echtem Tablet prüfen: Handballen, Stift plus Finger, versehentliches Scrollen beim Zeichnen, Drehen des Geräts, Unterbrechung während eines Strichs und Wiederherstellung. Stiftdruck oder Handballenerkennung sind erst nach tatsächlicher Geräteprüfung als unterstützt zu bezeichnen. Eine Notiz bleibt nach dem Export editierbar; PNG/PDF sind Ausgaben, nicht das einzige Speicherformat.

„Aufgabe daraus erstellen“ sollte eine neue Aufgabe mit Rückverweis erzeugen und den ursprünglichen Notizinhalt erhalten. Ob eine Textauswahl, ein Bild oder die ganze Notiz übernommen wird, vor Bestätigung zeigen. Eine automatische KI-Auswertung ist keine Voraussetzung für diesen Ablauf.

### Speichern, Offline und Konflikte als sichtbarer Teil der Bedienung

Für beide Seiten dieselben Zustandsbegriffe verwenden. Vorschlag für verständliche Anzeigen: „Auf diesem Gerät gespeichert“, „Mit PC abgeglichen“, „Übertragung ausstehend“, „Speichern nicht möglich“ und „Zwei Versionen vorhanden“. Ein allgemeines „Gespeichert“ wäre unterwegs zu ungenau.

Offline-Notizen und Aufgaben sollen sich weiter bearbeiten lassen, soweit der tatsächliche lokale Speicher es erlaubt. Live-Diktat ist getrennt davon zu betrachten: Lokale Texterfassung bedeutet nicht automatisch Offline-Transkription. Bei nicht verfügbarem Diktat eine klare Erklärung mit weiter nutzbarer Texteingabe zeigen.

Gleichzeitige Änderungen an PC und Tablet brauchen einen einfachen Vergleich mit erhaltenen Fassungen; nicht still überschreiben. Bei Speicherfehlern ist der Inhalt sichtbar und kopier-/exportierbar, soweit technisch möglich. Nach Wiederverbindung darf ein gerade bearbeiteter Text nicht überraschend durch eine Serverfassung ersetzt werden.

## 6. Konkrete Prototyp- und Abnahmeszenarien

Diese Szenarien sind vorgeschlagene Designabnahmen, noch keine ausgeführten Tests. Zunächst mit dem Hauptnutzer, danach möglichst mit Personen testen, die ADE nicht kennen. Fehlversuche, Nachfragen, Umwege und benötigte Hilfe festhalten; keine frei erfundenen Zeitersparnisse oder Erfolgsquoten berichten.

| Szenario | Erwartbare Beobachtung |
| --- | --- |
| Bestehendes Projekt auf Tablet öffnen, oberen Bereich einklappen, diktieren | Mehr nutzbare Terminalfläche; Projekt/Eingabehoheit erkennbar; Composer und Tastatur verdecken keine notwendige Aktion |
| Vom Heim-WLAN auf eine andere Verbindung wechseln | Wiederverbindung verständlich; keine neue Kopplung bei unveränderter gültiger Identität; Entwurf bleibt erhalten |
| PC ist offline, Aufgabe für morgen notieren | Speicherdauer und lokaler Zustand klar; Erinnerung verspricht keine technisch unmögliche Zustellung |
| Dieselbe Note gleichzeitig am PC und Tablet bearbeiten | Beide Fassungen auffindbar, Konflikt erklärbar und auflösbar; keine stille Überschreibung |
| Run öffnen, Rückfrage beantworten, Ergebnisdatei ansehen | Run- und Auswahlkontext bleiben sichtbar; fachlich zusammengehörige Aktionen werden gemeinsam gefunden |
| Terminal-Link mit API-Pfad öffnen | Angezeigte Adresse und Zielerwartung stimmen überein; Rückkehr zum Terminal gelingt |
| Skizze mit Stift erstellen, rückgängig machen, Foto ergänzen, als PNG/PDF ausgeben | Werkzeuge ohne Sucharbeit auffindbar; Export verständlich; Original bleibt bearbeitbar |
| Aus Note eine Task erstellen und an Agent übergeben | Unterschiede zwischen Notiz, persönlicher Aufgabe und gestarteter Ausführung werden korrekt verstanden |
| Alten PC-Prozess bei neu gebauter Anwendung erkennen | Sichtbarer Build-Status behauptet keine unbelegte Aktualität; vollständiger Neustart und Fensterschliessen werden unterschieden |
| Nur Tastatur: Navigation, Graph-Knoten, Menüs und Dialoge | Erkennbarer Fokus, logische Reihenfolge, Escape/Rückweg, keine unerreichbaren Aktionen |

Mindestens PC-Fenster breit/schmal, Tablet quer/hoch und Telefonbreite prüfen. Als vorhandene Anknüpfungspunkte existieren Tests bei 1400×900, 800×1000 und 390×844; das sind CSS-Viewportgrössen, keine Aussage über alle Geräte. Browserleisten, installierte App, Bildschirmtastatur und vergrösserte Darstellung verändern die verfügbare Fläche zusätzlich.

## 7. Gewünschte Ergebnisse der UI/UX-Fachperson

1. **Informationsarchitektur und Begriffsmodell:** Seiten, Gruppen, Gegenstände, Zustände; begründete Einordnung von Tasks/Notes/Work/Run/Sitzung.
2. **Aktionsinventar:** je Arbeitskontext Hauptaktion, sekundäre Aktionen, kontextbezogene Aktionen und seltene/destruktive Aktionen; vorhandene Duplikate bewusst behandeln.
3. **Wireframes für PC und Tablet:** Navigation, Graph leer/aktiv/fertig, Projektterminal normal/kompakt/mit Tastatur, Tasks Liste/Detail, Notes Text/Skizze/Foto.
4. **Zustandsentwürfe:** leer, lädt, offline, Rechte fehlen, Antwort unklar, speichern fehlgeschlagen, Konflikt, Wiederverbindung und Build-Wechsel. Keine reine Sammlung idealer Erfolgsansichten.
5. **Kleine Komponentenspezifikation:** Button-Gewichte, Gruppen, Menüs, Tabs, Dialoge, Hinweis-/Fehlerdarstellung, Fokus, Touch-Ziele und Typografie; möglichst auf den bestehenden Theme-Tokens aufbauen.
6. **Klickbarer Prototyp und kurzes Testprotokoll:** Ergebnisse der Szenarien oben, offene Entscheidungen und begründete Priorisierung. Bei Abweichung von bestehenden Abläufen Auswirkungen auf Nutzer und Entwürfe benennen.
7. **Umsetzbare Übergabe:** Bildschirmzustände, Interaktionsregeln und prüfbare Akzeptanzkriterien. Die technische Umsetzung folgt getrennt; dieses Briefing gibt keine pauschale Freigabe für weitere Produktänderungen.

## 8. Bild- und Quellenverzeichnis

| Kürzel | Quelle | Einordnung |
| --- | --- | --- |
| B1 | [project-context-collapsed.png](../test-results/remote/project-context-collapsed.png) | Vorhandenes Testbild vom 19.09., eingeklappter Tablet-Projektbereich; hier visuell durchgesehen |
| B2 | [project-context-phone.png](../test-results/remote/project-context-phone.png) | Vorhandenes schmales Testbild derselben Layoutänderung; hier visuell durchgesehen |
| B3 | [tablet-graph-light.png](../test-results/mobile/tablet-graph-light.png) | Vorhandenes Testbild vom 19.09., mobile Toolbar und Graph im Hellmodus; Fehlermeldungen gehören zum aufgenommenen Testszenario |
| B4 | [04-graph.png](../test-results/ui-audit/04-graph.png) | Älteres Bild vom 14.09., Desktop-Graph leer; nur historische visuelle Ergänzung, kein Beleg für heutige Vollständigkeit |
| N1 | Nutzerbild vom 19.09., 12:43 Uhr, Projektterminal mit blauen Anmerkungen | Primäre Rückmeldung zu vertikalem Platzbedarf; lokale Clipboard-Datei `codex-clipboard-VBMziz.png`, nicht dauerhaft im Repository |
| N2 | Nutzerrückmeldungen zu Pairing, altem Build und API-Link in der Zusammenarbeit | Einzelne tatsächlich berichtete Verständnisschwierigkeiten; keine Häufigkeitsmessung |

Weiterführende Projektdokumente: [USER_GUIDE.md](USER_GUIDE.md), [TABLET_PROJECT_LAYOUT.md](TABLET_PROJECT_LAYOUT.md), [MOBILE_PAIRING_RECOVERY.md](MOBILE_PAIRING_RECOVERY.md), [UI_CALM_PASS.md](UI_CALM_PASS.md), [TASKS_NOTES.md](TASKS_NOTES.md). Frühere Vorschläge darin vor Übernahme gegen den aktuellen Build prüfen.

## 9. Was bei der Überarbeitung erhalten bleiben soll

ADE besitzt bereits wertvolle Bedien- und Sicherheitskonventionen: bestehende Kopplungen, gespeicherte Entwürfe, ausdrückliche Freigaben, Vorschauen vor Git-/Veröffentlichungsaktionen, Wiederaufnahme ungeklärter Antworten, Tastaturbedienung und Fokus-Rückgabe. Die Überarbeitung soll diese verständlicher darstellen. Weniger sichtbare Buttons dürfen weder unklare Ausführung noch versteckte Datenverluste oder den Verlust eines laufenden Arbeitskontexts erzeugen.

Das wichtigste Abnahmeziel ist deshalb eine nachvollziehbare Arbeitsoberfläche: weniger konkurrierende Entscheidungen, mehr Platz für den Inhalt und klare Aussagen darüber, wo die Arbeit liegt und was eine Aktion bewirkt.
