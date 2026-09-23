# Tasks, Notes und gruppierte Bedienung

## Auftrag und Abnahmeplan

Am 19. September 2026 als aktives Codex-Ziel beauftragt und implementiert.
Der Nutzer hat abschliessend den sofortigen Abschluss ohne weitere Tests und
einen sauberen Worktree angeordnet. Die Gesamtprüfung wird für diese Lieferung
ausgelassen; dies ist keine Behauptung einer repositoryweiten Abnahme.

- Navigation: Übersicht; Organisation (Tasks, Notes); Entwicklung (Projekte,
  Terminals, Work, Graph); Verwaltung. Einklappbar, mit tastaturbedienbaren
  Gruppen. Graph trennt Ansicht, Arbeit, Ergebnisse und kontextbezogene Aktionen.
- Tasks: Titel/Text, Diktat, optionales Projekt, Checkliste, Bilder, Fälligkeit,
  Erinnerung; Heute/Geplant/Später/Erledigt; explizite Agentenübergabe über den
  vorhandenen Einzelauftragsweg und verlinktes Ergebnis.
- Notes: Text/Diktat, Bilder, editierbare Stift-/Touch-Zeichnungen, Radierer,
  Undo/Redo, Autosave; PNG/PDF/Markdown-Export; Aufgabe aus Notiz/Ausschnitt.
- Desktop und Tablet verwenden dieselben Verträge und dieselbe Oberfläche.
  Offline-Entwürfe und ausstehende Änderungen liegen gerätegebunden in IndexedDB.
  Wiederverbindung überträgt sie geordnet. Gleichzeitige Änderungen erzeugen
  eine sichtbare Konfliktkopie; keine stille Überschreibung.
- Auf dem PC liegen Daten ausserhalb von Projekt-Repositories im ADE-Profil.
  Strikte Eingabegrenzen, atomare Speicherung, keine Links, revisionsgebundene
  Änderungen. Ein fortlaufender Zähler je Client bindet wiederholte Änderungen
  an ihren Inhalt, ohne mit jeder Autosave-Aktion einen unbegrenzt wachsenden
  Aktionsspeicher zu erzeugen.
- Mobile Zugriffe verwenden eigene Organizer-Freigaben, Gerätesignaturen und
  Idempotenzschlüssel. Bestehende Host-/Dateisystem-/Terminal-Grenzen bleiben
  erhalten. Diktat nutzt die vorhandene Aufnahme-/Transkriptionspipeline.
- Erinnerungen laufen in ADE; Fälligkeit startet keinen Agenten. Anzeige und
  Desktop-Benachrichtigungen müssen ihre tatsächliche Verfügbarkeit ausweisen.

## Aktivierter Abschlussbuild

Am 19. September **23:19:44 CEST** auf Quelle **`84c3fb056ecdde7aa0f1`**
aktualisiert, neue persönliche PID **73360**. `pnpm build` erzeugte Desktop und
Mobile erfolgreich; private HTTPS-Auslieferung entspricht dem neuen Bundle.
Alle drei Kopplungen und der Projekt-/Profilbestand bleiben erhalten.
Die nachfolgend beschriebenen Ergänzungen nach dem Zwischenstand sind damit
aktiviert. Keine neuen Tests auf abschliessende Nutzeranweisung.
Details und Sicherung stehen in [HANDOFF.md](HANDOFF.md).

## Aktivierter Zwischenstand am 19.09.2026

Auf ausdrücklichen Nutzerwunsch wurde der gemeinsame Desktop-/Mobile-Build vor
dem vollständigen Testlauf aktiviert. `pnpm build` und `pnpm typecheck` bestanden.
Quelle `c9b05c98545b86f2f286`, Desktop gebaut 22:23:49 CEST, Mobile 22:23:58 CEST.
Die persönliche Instanz wurde um 22:24:58 CEST vollständig neu gestartet
(PID 71736). HTTPS liefert das neue Mobile-Bundle; der SHA-256-Abgleich mit
`out/mobile` bestand. Alle drei Gerätekopplungen und der Projekt-/Profilbestand
blieben unverändert. Lokaler Nachweis: `test-results/organizer-preview-activation.json`.

Tasks/Notes sind jetzt in beiden Oberflächen erreichbar. Bestehende Mobilgeräte
brauchen die neuen Freigaben „Persönliche Aufgaben und Notizen lesen“ und
„Persönliche Aufgaben und Notizen bearbeiten“; bestehende Geräte wurden nicht
automatisch erweitert. Die Gruppierung der bisherigen Navigation/Graph-Aktionen,
Desktop-Erinnerungsbenachrichtigungen und die vollständige UI-Abnahme stehen
noch aus. Erinnerungen werden derzeit beim Öffnen der Aufgaben angezeigt.
Dieser Zwischenstand ist keine abgeschlossene Feature-Abnahme.

Der Nutzer hat den grossen Testlauf ausdrücklich zurückgestellt; `pnpm verify`
wurde für diesen Zwischenstand nicht ausgeführt. Die vorangegangenen fokussierten
Store-/API-/Cache-Prüfungen ersetzen die noch fehlende integrierte UI-Abnahme nicht.

## Implementiert und gezielt geprüft

Nach dem ersten Zwischenstand ergänzt und im Abschlussbuild aktiviert:

- Gemeinsame Navigation mit Start/Organisation/Entwicklung und gespeichertem
  Einklappen; Desktop-Verwaltung und mobile Aktionen gruppiert. Graph gruppiert
  Run-Auswahl, Ergebnisse, Verwaltung, Steuerung und Ansicht. Doppelter
  „Neuer Run“-Button entfernt, Position der Steuerung auch per Button rücksetzbar.
- Entwürfe bleiben bei lokalem Speicherfehler beim Seitenwechsel im Speicher
  der geöffneten App. Sichtbare Fehlermeldung, Wiederholungsaktion und
  Warnung beim Neuladen; ausdrücklich kein falsches „gespeichert“.
- Diktatvorschau wird erst nach erfolgreicher Übernahme freigegeben. Ein zu
  langer Text bleibt kopierbar in der Vorschau.
- Fällige Erinnerungen erscheinen desktopweit; ein Main-Timer prüft alle zehn
  Sekunden auf neue Fälligkeit und nutzt im Hintergrund die bestehende native
  Benachrichtigung. Betriebssystemzustellung bleibt von den Systemeinstellungen
  abhängig. Nicht bestätigte Erinnerungen können nach ADE-Neustart erneut erscheinen.
- Fotos werden als begrenzte lokale Blob-URLs angezeigt; die Mobile-CSP bleibt
  unverändert. PNG/PDF-Export mit Fotos im echten Browser geprüft.

Fokussierte Nachweise: Store/Erinnerungen **51/0**, Cache/Editor/Wiederaufnahme
**31/0**, signierte Organizer-API **35/0**, Browser-Ablauf **27/0**, native Windows-Electron-Ansicht **15/0**.
Browser prüft tatsächliches IndexedDB, signierte Host-Aufrufe, Offline-Konflikte,
Foto, Stift mit Druckwerten, Touch, Radieren zwischen Stützpunkten, Undo/Redo,
Downloads, lokales Trennen samt Löschen des Gerätecaches sowie 390/800/1400 CSS-Pixel. Electron
prüft IPC, StrictMode, Neustart der Ansicht, globale Erinnerung und Graph-Gruppen.
Browser-Handoff wurde mit verlorener Antwort, erneutem Öffnen und genau einem
gestarteten Auftrag geprüft. Electron prüft zusätzlich reale Mikrofonpakete mit
simuliertem Sprachanbieter, Diktatübernahme, Textlimit und IndexedDB-Speicherfehler
mit positivem Wiederholungsfall. Keine kostenpflichtige Sprachanfrage im Test.
Screenshots und Exporte liegen lokal unter `test-results/organizer`.
Die isolierten Builds liegen unter `test-results/organizer-build`; `out` und die
laufende persönliche Instanz werden durch diese Prüfungen nicht ersetzt.

Zusätzlich besteht die gezielte Gesprächs-Diktatregression **6/0**: bereits
getippter Text bleibt beim Übernehmen erhalten. Die Gegenprobe mit dem fehlerhaften
Zwischenbuild scheiterte genau am fehlenden getippten Text; der korrigierte Build
bestand. Die allgemeinen Recording-Verträge bestehen **28/0**.

Abschluss auf ausdrückliche Nutzeranweisung: keine weiteren Tests, gemeinsamer
Desktop-/Mobile-Build, Aktivierung, Commit und Push. Der letzte noch laufende
Typecheck wurde abgebrochen. Vorstehende Ergebnisse stammen aus den vorherigen
gezielten Prüfungen; `pnpm verify` wurde für diese Lieferung nicht ausgeführt.
Die Gesamtprüfung kann im nächsten Arbeitsabschnitt nachgeholt werden.

## Skizze: Stift, Finger und Hand (Phase 1, 23. September 2026)

Erste Phase des Vorschlags [Skizzieren in Notizen](SKETCH_UX_PROPOSAL.md).
Keine Layout-, Vertrags- oder API-Änderung; nur Eingabe und Strichdarstellung.

- Ein schwebender oder aufgesetzter Stift schaltet Berührungen für 1,5 s auf
  Navigation; eine aufgelegte Hand zeichnet nicht mehr und blockiert den Stift
  nicht mehr. Der Stift übernimmt einen laufenden Fingerstrich.
- Berührungen breiter als 24 CSS-Pixel gelten als Handballen und werden ignoriert.
- Hat ein Gerät einmal einen Stift gemeldet, scrollt der Finger auf der Fläche
  die Seite statt zu zeichnen. Die Checkbox „Nur Stift“ ist durch das Auswahlfeld
  „Eingabe“ ersetzt: Automatisch, Stift zeichnet/Finger verschiebt, Finger
  zeichnet auch. Modus, Stiftmarke, Farbe und Strichstärke werden pro Gerät
  gespeichert (`ade.sketch.preferences`), nicht in der Notiz.
- Seitentaste und Radiererende des Stifts radieren, ohne das Werkzeug zu wechseln;
  das Kontextmenü auf der Fläche ist unterdrückt.
- Zwischenpunkte über `getCoalescedEvents()`; Darstellung mit quadratischen Kurven
  durch die Mittelpunkte, in Vorschau und PNG/PDF gleich. Gespeicherte Punkte
  bleiben unverändert.

Nachweise: Eingaberegeln **19/0** (`test-sketch-input.ts`, in `pnpm test`),
Browser-Ablauf **32/0** (`test-organizer-browser.ts`: Seitentaste radiert,
Finger nach Stift-Hover hinterlässt keinen Strich und die Fläche gibt Berührungen
ans Scrollen, Handballenkontakt zeichnet auch bei „Finger zeichnet auch“ nicht,
Fingertipp zeichnet weiterhin). Typecheck und `pnpm build` bestanden. Physische
Stiftmessung auf dem Tablet steht aus; die Regeln beruhen auf den vom Browser
gemeldeten Zeigerarten, Kontaktgrössen und Tastenbits.

## Skizze: das Blatt (Phase 2, 23. September 2026)

Zweite Phase des Vorschlags [Skizzieren in Notizen](SKETCH_UX_PROPOSAL.md).
Vertrag, Speicherung, Host-API und Export unverändert; Ansicht und Werkzeuge
sind Geräte- und Ansichtszustand.

- In der Notiz steht die Skizze als Vorschau mit dem Button „Zeichnen“; die
  Aufklappzeile „Skizze und Fotomarkierungen“ entfällt. Leer: gestrichelter
  Rahmen mit „Hier antippen oder ‚Zeichnen‘ wählen.“
- Zeichnen im Blatt (`SketchSheet.tsx`): feste Überlagerung über der App,
  Kopfzeile mit „← Notiz“, Titel, Zoomstufe, −/+ und „Einpassen“;
  Werkzeugleiste links (Standard, per Menü nach rechts): Stift, Radierer, sechs
  Tinten, drei Stärken, Rückgängig/Wiederholen, Menü mit Eingabemodus,
  „Werkzeuge rechts“, PNG-Export und „Alles löschen“ mit Rückfrage. Unter 700 px
  Breite liegt die Leiste unten und umbricht.
- Gesten: ein Finger verschiebt, zwei Finger zoomen um den Mittelpunkt,
  Doppeltipp mit zwei Fingern passt ein; Ctrl + Mausrad zoomt um den Zeiger,
  Rad verschiebt, mittlere Taste oder Leertaste + Ziehen verschiebt. Tastatur:
  bisheriges Zeichnen plus `+`/`-`/`0`, `E`/`P`, `1`–`6`, Escape.
- Darstellung mit Gerätepixeln und Ansichtstransformation (scharf bei jeder
  Zoomstufe); Punktdichte folgt der Zoomstufe. Ansichtsmathematik in
  `renderer/viewTransform.ts`, vom Graph mitbenutzt (Verhalten dort unverändert).
- Fokus: Blatt ist `role="dialog"`, Fokus auf der Zeichenfläche, Tab bleibt im
  Blatt, Escape schliesst (zuerst das Menü), Fokus zurück auf „Zeichnen“ oder
  ersatzweise auf das Titelfeld. Öffnen/Schliessen blenden 150 ms, unter
  `prefers-reduced-motion` ohne Übergang. Leiste dimmt während eines Strichs.

Nachweise: Eingaberegeln und Ansichtsmathematik **31/0** (`test-sketch-input.ts`),
Browser-Ablauf **42/0** (Blatt öffnet mit Fokus, Ein-Finger-Pan ohne Strich,
Zwei-Finger-Zoom 250 %, Einpassen, Ctrl + Rad, Taste `0`, Gerätepixel bei DPR 2,
Menü/Escape, Handballen, Fingertipp, Hochformat-Leiste unten mit erreichbarem
Menü, Escape schliesst und gibt den Fokus zurück, Vorschau nennt die Linienzahl),
Electron **17/0** (Blatt öffnet und schliesst mit Fokusrückgabe). Screenshots
`test-results/organizer/sheet-desktop.png`, `sheet-tablet.png`,
`sheet-portrait.png`, `desktop-sheet.png`. Typecheck und Build bestanden; die
Prüfungen liefen gegen den isolierten Build unter `test-results/organizer-build`.
Physische Stift- und Gestenmessung auf dem Tablet steht aus.

## Skizze: Feinschliff (Phase 3, 23. September 2026)

Dritte Phase des Vorschlags [Skizzieren in Notizen](SKETCH_UX_PROPOSAL.md);
Vertrag, Speicherung und Export weiterhin unverändert.

- Ein Stift, der die Vorschau in der Notiz berührt, öffnet das Blatt sofort;
  derselbe Strich läuft auf dem Blatt weiter (Zeigerübernahme per
  `setPointerCapture` beim Einhängen). Ist der Stift schon abgehoben, öffnet
  sich das Blatt nur. Finger und Maus öffnen weiterhin per Tipp/Klick.
- Punktraster als reine Ansichtshilfe (Raster 50 Blattpunkte), umschaltbar im
  Blattmenü, pro Gerät gespeichert; nie im Dokument, nie im PNG/PDF.
- Bereits in Phase 2 enthalten: Zwei-Finger-Doppeltipp „Einpassen“, „Werkzeuge
  rechts“, Erstöffnungshinweis, gedimmte Leiste während eines Strichs.

Nachweise: Eingaberegeln **31/0**, Browser-Ablauf **45/0** (Stiftkontakt auf
der Vorschau öffnet das Blatt und der Strich hat mehrere Punkte in
Bewegungsrichtung; Raster färbt den Blattpunkt (50, 50) nur bei eingeschaltetem
Schalter und steht als Gerätepräferenz, nicht im Dokument), Electron **17/0**;
Typecheck und Build bestanden, Prüfungen gegen den isolierten Build unter
`test-results/organizer-build`. Aktiviert am 23. September 2026, 13:04 CEST
(PID 57088, Source `489df28138b0b4827a2b`, siehe [HANDOFF.md](HANDOFF.md)).

## Skizze: Werkzeuge und Blattformat (Phase 4, 23. September 2026)

Auf Nutzerwunsch nach Phase 3: Teil-Radierer, feinere Stärke, Blattformat und
Exportauflösung. Vertrag (`shared/organizer.ts`) weiterhin unverändert; das
Blattformat nutzt die vorhandenen Grenzen 1–4096 Punkte.

- **Radierer** mit zwei Modi in einer Optionsleiste oben auf dem Blatt: „Teil
  einer Linie“ (Standard) schneidet an der Radierkante ein Stück aus jeder
  getroffenen Linie; beide Enden bleiben als eigene, editierbare Linien
  erhalten. „Ganze Linie“ entfernt die oberste getroffene Linie wie bisher.
  Radierergrösse 8–120 Punkte per Slider; ein gestrichelter Kreis zeigt die
  Reichweite. Die Seitentaste des Stifts folgt dem gewählten Modus.
- **Stift**: Strichstärke 1–40 per Slider mit Anzeige, die drei Schnellwerte in
  der Leiste bleiben; Schalter „Stiftdruck“ (Druck moduliert die Stärke oder
  nicht). Werte sind Gerätepräferenzen.
- **Blatt** im Menü: Formate Querformat 1600 × 1000, Hochformat 1000 × 1600,
  Quadrat 1200 × 1200, Breit 2400 × 1200, Gross 3200 × 2000 oder eigene Breite/
  Höhe (200–4096). Ein Blatt kleiner als die Zeichnung wird mit der nötigen
  Grösse abgelehnt; grössere Blätter werden übernommen, eingepasst und sind per
  Rückgängig umkehrbar (die Historie hält ganze Skizzen-Schnappschüsse).
- **PNG-Auflösung** 1×, 2×, 3× (bis 8192 px Kantenlänge) als Gerätepräferenz;
  gilt für „Skizze als PNG“ im Blatt und in der Notiz. PDF unverändert.

Nachweise: Eingaberegeln, Radierlogik und Blattregeln **44/0**
(`test-sketch-input.ts`), Browser-Ablauf **54/0** (Teil-Radierer trennt eine
Zwei-Punkt-Linie in zwei Stücke mit Lücke, „Ganze Linie“ entfernt sie, Slider
setzt Stärke 30 und speichert sie pro Gerät, Stiftdruck aus ergibt Druck 1,
Hochformat wird wegen der Zeichnung abgelehnt und nennt die nötige Grösse,
Gross 3200 × 2000 wird übernommen und eingepasst, Rückgängig stellt 1600 × 1000
wieder her, Fokus bleibt nach „Übernehmen“ im Menü, PNG 2× liefert 3200 px bei
unverändertem Blatt), Electron **17/0**. Typecheck und Build bestanden;
Prüfungen gegen den isolierten Build unter `test-results/organizer-build`.
Aktiviert am 23. September 13:29:10 CEST (PID 14160, Source `e2c2870395761d3a32f7`, siehe
[HANDOFF.md](HANDOFF.md)).

## Skizze: Radierer-Leistung, Stiftarten und Deckkraft (Phase 5, 23. September 2026)

Nach Adis Tablet-Test: Der Teil-Radierer hakte (2–3 s Stillstand), und der Stift
sollte Deckkraft und mehrere Stiftarten bekommen.

- **Radierer.** Bisher schrieb jede Stiftbewegung sofort ins Dokument
  (IndexedDB und Sync je Abtastpunkt). Jetzt arbeitet der Radierer während des
  Ziehens auf einer Arbeitskopie, zeichnet über den vorhandenen Frame-Takt und
  speichert beim Loslassen genau einen Schnappschuss; ein Ziehen ohne Treffer
  speichert nichts, ein Rückgängig nimmt den ganzen Zug zurück. Vor jeder
  Segmentgeometrie sortiert ein Begrenzungsrahmen entfernte Linien aus.
- **Stiftarten** (Vertrag `shared/organizer.ts`, optionale Felder `brush` und
  `opacity`, alte Striche bleiben gültig): Stift (bisherige Drucklinie),
  Bleistift (dünner, leicht körnig, Standard 100 % einstellbar), Kugelschreiber
  (konstante Breite, ignoriert Druck, immer deckend), Kohle (breit, weiche Kante
  aus drei Durchgängen), Kalligrafie (Feder in 45°, Breite folgt der
  Strichrichtung), Leuchtstift (flaches Band, Multiplizieren, startet mit 35 %).
  Deckkraft 5–100 % per Slider in der Stift-Optionsleiste; beide Werte sind
  Gerätepräferenzen und wandern mit jedem neuen Strich. Halbtransparente Striche
  werden deckend in einen begrenzten Offscreen-Canvas gezeichnet und einmal
  komponiert, daher keine dunkleren Nahtstellen; Vorschau, PNG und PDF nutzen
  dieselbe Zeichenfunktion.
- Radier-Reichweite folgt der sichtbaren Breite (Leuchtstift, Kohle breiter);
  Teilstücke erben Stiftart und Deckkraft.

- Nachschärfung nach Sichtprüfung (`test-results/organizer/sheet-brushes.png`,
  erzeugt mit `scripts/preview-sketch-brushes.ts` gegen einen Mobile-Build):
  Bleistift zeichnet ohne eigene Deckkraft mit 80 % und schmalerem Kern plus
  körnigem Rand, Kalligraphie mit grösserem Breitenbereich (10–100 % der
  Nibbreite), und die Palette erhält als siebte Tinte Markergelb; die Wahl
  „Leuchtstift“ wechselt von Tinte auf Gelb und zurück, solange die Farbe nicht
  bewusst geändert wurde. Tastatur `1`–`7` wählt die Tinte.

Nachweise: Vertrag **56/0** (`test-organizer.ts`: unbekannte Stiftart,
Deckkraft ausserhalb 0,05–1 und fremde Strichfelder abgelehnt, alte Striche
gültig), Eingabe-/Radierlogik **49/0** (`test-sketch-input.ts`: Rahmen-Gate,
brush-abhängige Reichweite, Teilstücke erben Felder, 60 Radier-Abtastungen über
500 Linien / 20 000 Punkte in ~33 ms), Browser-Ablauf **64/0**
(Leuchtstift setzt 35 %, Strich speichert `brush`/`opacity`, Deckkraft ist
Gerätepräferenz, deckender Stift behält die alte Strichform, Radierzug speichert
erst beim Loslassen und ist ein Rückgängig-Schritt), Electron **17/0**.
Typecheck und isolierter Build bestanden. Noch nicht aktiviert.
