# Skizzieren in Notizen — das Blatt statt der Kachel

Stand: 23. September 2026. Analyse der Zeichenfläche in den Notizen
(`src/renderer/organizer/SketchEditor.tsx`, `sketchRendering.ts`,
`OrganizerEditor.tsx`, `organizer.css`) auf `main` (f7144d5) mit Blick auf drei
Beobachtungen aus der Benutzung mit Stift auf dem Windows-Tablet:

1. Die aufgelegte Hand zeichnet mit, sobald sie den Bildschirm berührt.
2. Die Fläche ist klein, sitzt unter dem Falz und lässt sich nicht vergrössern.
3. Verschieben und Zoomen mit den üblichen Gesten fehlt ganz.

Abschnitte 1–2 beschreiben den heutigen Zustand mit Ursachen im Code,
Abschnitte 3–9 den Vorschlag, Abschnitt 10 die Umsetzung in Phasen mit Tests,
Abschnitt 11 die offenen Entscheidungen. Der gemeinsame Vertrag
(`src/shared/organizer.ts`), Speicherung, Host-API und Export bleiben
unverändert; alles Folgende ist Darstellung und Eingabe im Renderer.

## 1. Was heute passiert: eine Skizze mit dem Stift

Ausgangslage: Notiz ist geöffnet, Tablet liegt quer (1024 × 768), Stift in der
Hand. Der Benutzer will eine Idee skizzieren.

| Schritt | Handlung | Was geschieht | Warum es sich komisch anfühlt |
| --- | --- | --- | --- |
| 1 | Nach unten scrollen bis zur Fläche | Titel, Projekt, Notiztext (140 px+), Fotoreihe und die Aufklappzeile „Skizze und Fotomarkierungen“ stehen davor | Zeichnen ist der letzte Punkt einer Formularseite |
| 2 | Hand auflegen, Stift ansetzen | Der Handballen erzeugt einen Punkt oder Strich; solange der Handballen aufliegt, wird der Stift ignoriert | Die Hand „gewinnt“ gegen den Stift |
| 3 | „Nur Stift“ ankreuzen | Touch wird verworfen; die Einstellung gilt nur für diese Komponente und ist beim nächsten Öffnen wieder aus | Eine Einstellung, die jedes Mal neu gesetzt werden muss |
| 4 | Detail zeichnen | 1600 × 1000 logische Punkte werden auf rund 990 CSS-Pixel Breite gequetscht; auf einem 2×-Display sind Linien weich | Kein Hineinzoomen, keine feinen Striche |
| 5 | Mit dem Finger weiterscrollen | Die Fläche hat `touch-action: none`: der Finger zeichnet statt zu scrollen; die Seite bewegt sich nur ausserhalb der Fläche | Der Finger ist mal Scrollen, mal Stift |
| 6 | Farbe wechseln | Natives Farbfeld öffnet den Systemdialog | Ein Systemdialog mitten im Zeichnen |
| 7 | Strichstärke ändern | Schieberegler, rund 120 px breit, 1–30 | Mit dem Stift schwer zu treffen, ohne Vorschau |

Kurz: **Zeichnen ist heute ein Formularfeld.** Es teilt sich Scrollen,
Grösse und Werkzeuge mit dem Rest der Notiz, und die Eingabe unterscheidet
nicht, ob eine Hand, ein Finger oder ein Stift die Fläche berührt.

## 2. Ursachen im Code

- **Hand und Stift sind gleichberechtigt.** `start()` in `SketchEditor.tsx`
  nimmt jeden Zeiger mit `button === 0`, sofern nicht `penOnly` gesetzt ist. Die
  Sperre `pointer.current !== null` sorgt zusätzlich dafür, dass der *erste*
  Kontakt (meist der Handballen) den Strich bekommt und der Stift abgelehnt wird.
  Ein Handballen ohne Bewegung erzeugt einen Ein-Punkt-Strich, den `drawStroke`
  als Kreis füllt — genau der „Punkt aus dem Nichts“.
- **Kein Zeigerkontext.** Der Stift meldet auf Windows Ink bereits beim
  Schweben (`pointermove` mit `pointerType === 'pen'`, `buttons === 0`), lange
  bevor er aufsetzt. Diese Information wird heute nicht genutzt; Kontaktgrösse
  (`event.width`/`event.height` eines Touch-Zeigers) ebenfalls nicht.
- **Feste Fläche.** `<canvas width=1600 height=1000>` mit CSS `width: 100%`
  und `aspect-ratio: 8/5` in einem Editor mit `max-width: 1150px`, innerhalb
  eines `<details>`. Keine Ansichtstransformation, keine Berücksichtigung von
  `devicePixelRatio`. Punkte werden über `getBoundingClientRect` linear
  umgerechnet; das Datenmodell ist bereits geräteunabhängig, die Darstellung
  nicht.
- **Ohne Gesten.** Mehrere Touch-Zeiger werden verworfen. Im Graph existiert
  bereits Pan/Zoom (`GraphView.tsx`, „pan and zoom“), aber als lokale
  Funktionen, nicht als wiederverwendbarer Baustein.
- **Werkzeuge als Formularzeile.** `input[type=color]`, `input[type=range]`,
  Checkbox und fünf Textbuttons in einer umbrechenden Zeile; auf dem Desktop
  28 px, auf dem Tablet 44 px hoch.
- **Strichqualität.** Segmente werden als gerade Linien von Punkt zu Punkt
  gezeichnet, ohne Glättung und ohne `getCoalescedEvents()`; schnelle
  Stiftbewegungen wirken eckig. Der Stift-Radiererknopf und die Seitentaste
  (`button === 5`, `buttons & 32` bzw. `buttons & 2`) werden nicht ausgewertet.
- **Zustand pro Sitzung.** Farbe, Stärke, „Nur Stift“ liegen in `useState`
  und gehen beim Wechsel der Notiz verloren.

Was bereits gut ist und erhalten bleibt: strukturierte, editierbare Striche mit
Druckwerten; Radierer, der ganze Linien trifft, auch zwischen Stützpunkten;
Undo/Redo mit 30 Schritten und Ctrl+Z; Tastaturzeichnen (Pfeile, Shift, Leertaste);
Grenzen mit klaren Meldungen; Foto als Hintergrund; PNG/PDF-Export.

## 3. Leitidee: das Blatt

Die Skizze soll sich anfühlen wie ein Blatt Papier, das man auf den Tisch
zieht: **Wenn gezeichnet wird, tritt die Notiz zurück und das Blatt tritt
vor.** Es füllt den Bildschirm, liegt auf dem dunklen Grund der App, hat eine
einzige schmale Werkzeugleiste an der Seite der freien Hand und reagiert auf
Hand, Finger und Stift so, wie man es von Papier und Notiz-Apps kennt: Der Stift
zeichnet, der Finger schiebt, zwei Finger zoomen, die aufgelegte Hand tut nichts.

Prinzipien für alles Weitere:

- **Eine Fläche, zwei Zustände.** In der Notiz ist die Skizze eine Vorschau.
  Zeichnen passiert im Blatt. Es gibt keine dritte, halb-grosse Variante.
- **Eingabeart entscheidet, nicht eine Checkbox.** Die Unterscheidung
  Stift/Finger/Hand ist automatisch; eine Einstellung gibt es nur als
  Ausweichweg für Geräte ohne Stift.
- **Werkzeuge sind Formen, nicht Formulare.** Farben sind Tintenpunkte,
  Stärken sind Punkte in drei Grössen; kein Farbdialog, kein Schieberegler.
- **Ruhe um das Blatt.** Der Grund ist `--bg`, das Blatt weiss (wie der Export),
  Werkzeugleiste in `--panel` mit `--line`. Kupfer (`--accent`) markiert genau
  ein Ding: das aktive Werkzeug.
- **Daten unverändert.** Zoom, Verschiebung, Werkzeugwahl und Eingabemodus sind
  Ansichts- und Gerätezustand, niemals Dokumentdaten.

## 4. Eingabe: Hand, Finger, Stift

Das Kernproblem ist Schritt 2 aus Abschnitt 1. Vorschlag in drei Stufen, alle
ohne neue Einstellung:

**Stufe 1 — Stift in der Nähe schaltet Touch auf Navigation.** Jedes
Stiftereignis auf dem Blatt (auch Schweben mit `buttons === 0`) setzt einen
Zeitstempel `lastPen`. Solange ein Stift aufliegt oder `lastPen` jünger als
1,5 s ist, darf **kein Touch-Zeiger zeichnen**. Weil Windows Ink beim Schweben
fortlaufend Ereignisse liefert, ist die Hand bereits abgesichert, bevor der
Stift das Glas berührt — genau die Situation „Stift in der Hand, Hand kommt
auf den Bildschirm“.

**Stufe 2 — Kontaktgrösse.** Ein Touch-Zeiger mit `width` oder `height`
grösser als 24 CSS-Pixel ist ein Handballen und wird vollständig ignoriert:
er zeichnet nicht, er verschiebt nicht. Chrome liefert die Kontaktfläche auf
Windows-Touchscreens.

**Stufe 3 — Gerätegedächtnis.** Sobald ein Gerät je einen Stift gesehen hat
(`localStorage`-Marke pro Gerät), ist der Finger auf dem Blatt dauerhaft
Navigation. Geräte ohne Stift (Desktop mit Maus, Touch-Notebook ohne Stift)
zeichnen mit Finger oder Maus wie bisher.

Die bisherige Checkbox „Nur Stift“ wird zu einem Eingabemodus in der
Werkzeugleiste, gespeichert pro Gerät, nicht pro Notiz:

| Modus | Stift | Finger | Standard |
| --- | --- | --- | --- |
| Automatisch | zeichnet | zeichnet, bis das Gerät einen Stift gesehen hat; danach verschiebt er | ja |
| Stift zeichnet, Finger verschiebt | zeichnet | verschiebt, zoomt | — |
| Finger zeichnet auch | zeichnet | zeichnet (ein Finger), zwei Finger zoomen | — |

Ergänzend, weil billig und spürbar:

- **Stift-Radierer und Seitentaste.** `button === 5` oder `buttons & 32`
  (Radiererende) sowie `buttons & 2` (Seitentaste) radieren, solange gedrückt,
  ohne das gewählte Werkzeug zu wechseln.
- **Mehrere Zeiger verwalten.** Statt `pointer.current` eine `Map<pointerId,
  Rolle>` mit den Rollen `draw`, `pan`, `ignore`. Ein zweiter Finger neben
  einem Pan-Finger macht aus dem Pan einen Pinch.

## 5. Das Blatt: Layout, Gesten, Tastatur

Das Blatt ist eine feste Überlagerung innerhalb der App (`position: fixed;
inset: 0`, dieselbe Ebene wie `.organizer .overlay`, `z-index: 400`), nicht
die Fullscreen-API des Browsers: sie funktioniert im Electron-Fenster und im
Tablet-PWA gleich, respektiert `--tablet-height` bei offener Tastatur und lässt
sich mit Escape verlassen.

```
Tablet quer, 1024 × 768                               Desktop, 1400 × 900
┌──────────────────────────────────────────────┐    ┌────────────────────────────────────────────────┐
│ ← Notiz   Desktop-Skizze         100 %  ⤢   │    │ ← Notiz   Desktop-Skizze              100 %  ⤢ │
│┌──┐                                          │    │┌──┐                                            │
││✎ │   ┌──────────────────────────────────┐   │    ││✎ │       ┌────────────────────────────┐       │
││◫ │   │                                  │   │    ││◫ │       │                            │       │
││──│   │                                  │   │    ││──│       │                            │       │
││● │   │                                  │   │    ││● │       │                            │       │
││● │   │            Blatt (weiss)         │   │    ││● │       │       Blatt (weiss)        │       │
││● │   │       eingepasst, zentriert       │   │    ││● │       │                            │       │
││● │   │                                  │   │    ││● │       │                            │       │
││● │   │                                  │   │    ││● │       │                            │       │
││● │   │                                  │   │    ││● │       └────────────────────────────┘       │
││──│   └──────────────────────────────────┘   │    ││──│                                            │
││· ● ●│                                       │    ││· ● ●│                                          │
││──│                                          │    ││──│                                            │
││↶ │                                          │    ││↶ │                                            │
││↷ │                                          │    ││↷ │                                            │
││──│                                          │    ││──│                                            │
││☰ │                                          │    ││☰ │  Eingabemodus / Leiste rechts              │
│└──┘                                          │    │└──┘                                            │
└──────────────────────────────────────────────┘    └────────────────────────────────────────────────┘
Grund: --bg. Blatt: weiss mit 1 px --line und weichem Schatten. Leiste: --panel, 48 px breit.
```

Kopfzeile (eine Zeile, `--panel`, 44 px auf dem Tablet, 36 px auf dem Desktop):
links „← Notiz“ (schliesst, Fokus zurück auf „Zeichnen“), daneben der Notiztitel
in `--muted`; rechts die Zoomstufe als `<output>` und „Einpassen“. Kein
Hilfetext in der Kopfzeile. Beim ersten Öffnen pro Gerät steht am unteren Rand
eine Zeile „Stift zeichnet, Finger verschiebt. Zwei Finger zoomen.“; sie
verschwindet mit dem ersten Strich und kommt nicht wieder.

Ansicht: Zustand `{ scale, x, y }` in Bildschirmkoordinaten wie im Graph. Beim
Öffnen wird das Blatt eingepasst (Fit = Skalierung 1). Grenzen: 0,5× bis 6× Fit;
Verschiebung so begrenzt, dass mindestens ein Viertel des Blatts sichtbar bleibt.
Die Ansichtsmathematik aus `GraphView.tsx` (Zoom um einen Punkt, `zoomBy`,
`fitView`) wird in einen kleinen Hook `useViewTransform` gezogen, den Graph und
Blatt gemeinsam nutzen; der Graph ändert dabei sein Verhalten nicht.

| Geste / Eingabe | Wirkung |
| --- | --- |
| Stift aufsetzen und ziehen | Strich (Druck → Stärke) |
| Stift-Radiererende, Seitentaste | Radieren während gedrückt |
| Ein Finger ziehen | Verschieben (im Modus „Finger zeichnet auch“: Strich) |
| Zwei Finger | Zoom um den Mittelpunkt, gleichzeitig verschieben |
| Zwei Finger doppelt tippen | Einpassen |
| Handballen | nichts |
| Mausrad + Ctrl | Zoom um den Mauszeiger |
| Mausrad | Vertikal verschieben, mit Shift horizontal |
| Mittlere Maustaste oder Leertaste + ziehen | Verschieben |
| Maus links ziehen | Strich (Desktop ohne Stift) |

Tastatur, aufbauend auf dem Bestehenden: Pfeile bewegen den Zeichenpunkt,
Shift + Pfeil zeichnet, Leertaste setzt einen Punkt, Ctrl+Z / Ctrl+Shift+Z
verlaufen wie heute. Neu: `+` / `-` zoomen um die Mitte, `0` passt ein, `E`
wechselt zum Radierer, `P` zum Stift, `1`–`6` wählen die Tinte, Escape
schliesst. Das Blatt ist `role="dialog"` mit `aria-modal`, übernimmt den Fokus
auf die Zeichenfläche und gibt ihn an den Öffner zurück; verschwindet der
Öffner (Notiz gewechselt, Liste offline neu geladen), fällt der Fokus auf das
Titelfeld der Notiz. Die Fokuslogik kommt aus `onboarding/Modal.tsx`, als Hook
ausgelagert, weil das Blatt keinen Dialograhmen hat.

Hochformat oder Breite unter 700 px: die Leiste wird zu einer waagrechten Zeile
am unteren Rand mit denselben Elementen, horizontal scrollbar; die Kopfzeile
bleibt. Bewegung: Öffnen und Schliessen blenden in 150 ms; unter
`prefers-reduced-motion` ohne Übergang.

## 6. Werkzeugleiste

Eine Spalte, 48 px breit, Ziele 44 × 44 px auf allen Geräten (auch am Desktop
ist das Blatt eine Stiftfläche). Reihenfolge von oben, getrennt durch 1 px
`--line`:

1. **Stift**, **Radierer** — Icon-Buttons mit `aria-pressed`; aktiv bekommt
   `--accent-soft`-Füllung und Kupferrand.
2. **Sechs Tinten** als gefüllte Kreise (22 px), die gewählte mit 2 px
   Kupferring. Feste Palette, alle `#rrggbb` und damit vertragskonform:

   | Name | Wert | Herkunft |
   | --- | --- | --- |
   | Tinte | `#1F1D1A` | warmes Schwarz der hellen Textfarbe |
   | Blau | `#2155D6` | bisheriger Standard, bleibt lesbar in alten Notizen |
   | Kupfer | `#A96B22` | Akzent der hellen Oberfläche |
   | Rot | `#C14B42` | `--del` hell |
   | Grün | `#2F8A5D` | `--add` hell |
   | Grau | `#7C838E` | `--muted`, für Hilfslinien |

   Standard beim ersten Öffnen: Tinte. Die Auswahl wird pro Gerät gemerkt.
3. **Drei Stärken** als Punkte: fein 2, mittel 5, breit 11 (in Blattpunkten,
   Druck moduliert wie heute). Standard: mittel.
4. **Rückgängig**, **Wiederholen** — wie heute, mit Icon und `title`.
5. **Menü** (☰): Eingabemodus (Abschnitt 4), „Leiste rechts“ für Linkshänder,
   „Foto als Hintergrund“ (nur wenn Fotos vorhanden), „Alles löschen“ mit
   Rückfrage, „Als PNG speichern“.

Während ein Strich gezogen wird, geht die Leiste auf 40 % Deckkraft und kehrt
beim Absetzen zurück — die eine Bewegung, die etwas anzeigt (das Blatt gehört
jetzt dem Stift). Kein Hover-Schatten, kein Verlauf, keine Karten.

Wortwahl (Sätze in Normalschreibung, Verben zuerst): „Zeichnen“, „← Notiz“,
„Einpassen“, „Stift“, „Radierer“, „Rückgängig“, „Wiederholen“, „Alles löschen“,
„Eingabe: Automatisch / Stift zeichnet, Finger verschiebt / Finger zeichnet
auch“. Die Meldungen „Die Skizze ist voll…“ und „Punktgrenze erreicht…“ bleiben,
erscheinen als `role="alert"` am unteren Rand des Blatts.

## 7. Die Skizze in der Notiz

Die Aufklappzeile „Skizze und Fotomarkierungen“ entfällt. An ihrer Stelle steht
ein Abschnitt **Skizze** mit einer Vorschau: das gerenderte Blatt
(`renderOrganizerSketch`, bereits vorhanden) im Seitenverhältnis 8:5, maximal
320 px hoch, mit 1 px `--line`. Darunter eine Zeile mit dem Button **Zeichnen**
und, wenn Fotos vorhanden sind, dem Auswahlfeld „Foto als Hintergrund“.

```
Skizze
┌──────────────────────────────────────────────┐
│                                              │
│              (Vorschau des Blatts)            │
│                                              │
└──────────────────────────────────────────────┘
[ Zeichnen ]   Foto als Hintergrund [ Leere Fläche ▾ ]
```

Leer: dieselbe Fläche mit gepunktetem Rand in `--faint` und dem Satz „Mit dem
Stift antippen oder auf Zeichnen tippen.“ Ein Stiftkontakt auf der Vorschau
öffnet das Blatt sofort. Der begonnene Strich wird übergeben: der Ansatzpunkt
wird in Blattkoordinaten gemerkt, und die neue Zeichenfläche ruft in ihrem
Einhänge-Effekt `setPointerCapture(pointerId)` für den noch aktiven Zeiger auf.
Diese Übergabe ist mit CDP-Stiftereignissen zu verifizieren; gelingt sie nicht
zuverlässig, öffnet der Stiftkontakt nur das Blatt und der erste Strich beginnt
dort (Abschnitt 11).

Das Zeichnen in der eingebetteten Vorschau entfällt damit. Tastaturzeichnen
bleibt im Blatt vollständig erhalten; der bestehende Browser-Test wechselt dafür
zuerst mit „Zeichnen“ ins Blatt.

## 8. Strichqualität und Darstellung

- **Gerätepixel.** Die Zeichenfläche des Blatts hat die Grösse des sichtbaren
  Bereichs mal `devicePixelRatio`; gezeichnet wird mit
  `setTransform(scale·dpr, 0, 0, scale·dpr, x·dpr, y·dpr)`. Linien sind bei
  jeder Zoomstufe scharf. Das Dokument bleibt 1600 × 1000 Blattpunkte.
- **Glättung nur beim Zeichnen.** Segmente werden als quadratische Kurven durch
  die Mittelpunkte aufeinanderfolgender Stützpunkte gezeichnet; die gespeicherten
  Punkte ändern sich nicht. PNG- und PDF-Export nutzen dieselbe Funktion und
  bleiben deckungsgleich mit dem Bildschirm.
- **Alle Zwischenpunkte.** `getCoalescedEvents()` liefert die Punkte zwischen
  zwei Frames; schnelle Bögen werden rund statt eckig.
- **Punktdichte mit der Ansicht.** Die Mindestdistanz zwischen Stützpunkten ist
  heute 1 Blattpunkt; sie wird zu `1 / scale` (feiner beim Hineinzoomen,
  gröber beim Herauszoomen), damit die Grenze von 20 000 Punkten nicht durch
  langsame Striche bei kleiner Ansicht verbraucht wird.
- **Vorschau-Rasterung.** Die Vorschau in der Notiz wird einmal pro
  Dokumentänderung gerendert (wie heute mit Versionszähler), nicht pro Frame.

## 9. Was unverändert bleibt

- `OrganizerSketch`, `SketchStroke`, `SketchPoint`, Grenzen in
  `ORGANIZER_LIMITS`, Validierung in `validOrganizerDocument`: Farben bleiben
  `#rrggbb`, Punkte bleiben in `[0, width] × [0, height]`, Blattgrösse 1600 × 1000.
  Ein grösseres oder frei wählbares Blatt wäre eine Vertragsänderung
  (`dimension()`, Punktvalidierung, PDF-Layout) und ist nicht Teil dieses
  Vorschlags.
- Speicherung, Autosave, Konfliktkopien, IndexedDB, Host-API
  (`/api/v1/organizer/*`), Redaktion, IPC-Klassifizierung.
- Export als PNG/PDF/Markdown, Foto als Hintergrund, Aufgabe aus Notiz.
- Radierer-Semantik (ganze Linie, Undo stellt Druckpunkte wieder her).

## 10. Umsetzung in drei Phasen

**Phase 1 — Hand, Finger, Stift** (spürbarste Wirkung, keine Layoutänderung)

- `SketchEditor.tsx`: Zeigerverwaltung als Map mit Rollen; `lastPen`-Fenster;
  Kontaktgrösse; Gerätemarke „Stift gesehen“; Eingabemodus statt Checkbox,
  gespeichert pro Gerät; Stift-Radiererende und Seitentaste;
  `getCoalescedEvents()`.
- `sketchRendering.ts`: Kurvenglättung in `drawStroke` (Export folgt automatisch).
- `src/shared/i18n/messages.de.ts` / `messages.en.ts`: neue Texte, „Nur Stift“
  entfällt.
- Tests in `scripts/test-organizer-browser.ts`: Stift schwebt (CDP
  `Input.dispatchMouseEvent`, `pointerType: 'pen'`, `buttons: 0`), dann Touch
  (`Input.dispatchTouchEvent`) → keine neue Linie; Touch mit grosser
  Kontaktfläche → keine Linie; Seitentaste radiert; bestehende Prüfung „touch
  drawing and undo retain editable pen and touch strokes“ setzt zuvor den Modus
  „Finger zeichnet auch“.
- Doku: dieser Abschnitt in `TASKS_NOTES.md` verlinken, `STATUS.md` Eintrag.

**Phase 2 — Das Blatt** (Vollbild, Gesten, Leiste, Vorschau)

- Neu `SketchSheet.tsx` (Überlagerung, Kopfzeile, Leiste, Zeichenfläche mit
  DPR-Transformation) und `useViewTransform.ts` (aus `GraphView.tsx`
  herausgelöst, Graph umgestellt ohne Verhaltensänderung).
- Fokus-Hook aus `onboarding/Modal.tsx` herauslösen (`useDialogFocus`), von
  `Modal` und `SketchSheet` genutzt.
- `SketchEditor.tsx` wird Zustandsbesitzer (Striche, Undo/Redo, Werkzeuge) und
  rendert Vorschau plus Blatt; Undo-Verlauf überlebt Öffnen und Schliessen.
- `OrganizerEditor.tsx`: `<details>` ersetzt durch Abschnitt „Skizze“.
- `organizer.css`: Blatt, Leiste, Vorschau, Hochformat-Variante; Desktop-Dichte
  gilt für Kopfzeile, nicht für die 44-px-Werkzeuge.
- Tests: „Zeichnen“ öffnet das Blatt, Escape schliesst und der Fokus liegt auf
  „Zeichnen“; Pinch mit zwei Touchpunkten ändert die Zoomanzeige und erzeugt
  keine Linie; Ein-Finger-Ziehen verschiebt ohne Linie; Ctrl+Mausrad zoomt;
  Kontext mit `deviceScaleFactor: 2` → Canvas-Puffer ist doppelt so gross wie
  die CSS-Grösse; Tastaturzeichnen speichert weiterhin zwei Striche;
  Screenshots `test-results/organizer/sheet-tablet.png`, `sheet-desktop.png`,
  `sheet-portrait.png`. Electron-Lauf `test-organizer-electron` ergänzt um
  Öffnen/Schliessen des Blatts.
- Doku: `ARCHITECTURE.md` (Abschnitt Organizer: Blatt ist Ansichtszustand,
  keine Dokumentdaten), `TASKS_NOTES.md`, `STATUS.md`, `HANDOFF.md`.

**Phase 3 — Feinschliff**

- Stiftkontakt auf der Vorschau öffnet das Blatt mit Strichübergabe.
- Zwei-Finger-Doppeltipp „Einpassen“, „Leiste rechts“, Erstöffnungshinweis.
- Optional ein Punktraster als reine Ansichtshilfe (nicht gespeichert, nicht
  exportiert), umschaltbar im Menü.
- Leiste blendet während des Strichs auf 40 %.

Jede Phase ist eigenständig lieferbar und endet mit `pnpm verify`.

**Stand:** Phase 1 am 23. September 2026 umgesetzt (`sketchInput.ts`,
`SketchEditor.tsx`, `sketchRendering.ts`, Texte, `test-sketch-input.ts`,
Browser-Test); Nachweise in [TASKS_NOTES.md](TASKS_NOTES.md). In Phase 1 bedeutet
„Finger verschiebt“ auf der eingebetteten Fläche: der Finger scrollt die Seite;
Pan/Zoom kommt mit dem Blatt. **Phase 2** am selben Tag umgesetzt
(`SketchSheet.tsx`, `viewTransform.ts`, `useDialogFocus`, Vorschau im Editor,
Browser-/Electron-Tests); Abweichungen vom Text oben: „Foto als Hintergrund“
bleibt in der Notiz statt im Blattmenü, die Kopfzeile ist überall 40 px, das
Menü öffnet als Feld über dem Blatt statt als Popover an der Leiste. **Phase 3**
ebenfalls am 23. September umgesetzt: Stiftkontakt auf der Vorschau öffnet das
Blatt mit Strichübergabe (`setPointerCapture` beim Einhängen, im CDP-Test
bestätigt), Punktraster als Ansichtshilfe im Blattmenü. Damit ist der Vorschlag
vollständig umgesetzt und seit 13:04 CEST aktiv (PID 57088).

## 11a. Nachtrag Phase 4: Werkzeuge und Blattformat (23. September 2026)

Nach dem Tablet-Test wünschte der Nutzer einen Radierer, der auch Teile einer
Linie entfernt, feinere Stärkeregler, einstellbare Blattgrösse und -auflösung.
Umgesetzt als Optionsleiste oben auf dem Blatt (Stift: Stärke-Slider 1–40 und
Stiftdruck; Radierer: „Teil einer Linie“/„Ganze Linie“ und Grössen-Slider mit
Reichweitenkreis) und als Abschnitt „Blatt“ im Menü (fünf Formate oder eigene
Grösse 200–4096 Punkte, nie kleiner als die Zeichnung, Rückgängig inklusive)
sowie „PNG-Auflösung“ 1×–3×. Der Teil-Radierer schneidet an der Radierkante und
erzeugt neue Linien mit eigenen Ids; der Vertrag bleibt unverändert. Details in
[TASKS_NOTES.md](TASKS_NOTES.md).

## 11. Offene Entscheidungen

1. **Leiste links oder rechts als Standard?** Entschieden am 23. September 2026:
   links (die zeichnende rechte Hand verdeckt sie nicht), umschaltbar im Menü.
2. **Stiftkontakt auf der Vorschau öffnet sofort?** Umgesetzt (Phase 3): ja, mit
   Strichübergabe; die Übergabe ist im CDP-Test stabil.
3. **Standardtinte Schwarz statt Blau?** Vorschlag: Tinte (`#1F1D1A`); bestehende
   blaue Skizzen bleiben blau, Blau bleibt in der Palette.
4. **Automatischer Modus vs. fester Standard „Stift zeichnet, Finger
   verschiebt“?** Vorschlag: Automatisch, damit Desktop ohne Stift und
   Touch-Notebooks ohne Stift ohne Einstellung funktionieren.
