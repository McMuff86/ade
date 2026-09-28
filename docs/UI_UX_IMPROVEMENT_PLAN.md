# ADE UI/UX – Verbesserungsplan (Vorlage für den Frontend-Design-Durchgang)

Stand: 27. September 2026, Quellstand `b1174c4`. Auftrag: fundierter Plan, der
anschliessend mit dem Frontend-Design-Skill ausgearbeitet wird. Dieses Dokument
setzt nichts um.

**Evidenzlage.** Zehn parallele Code-Analysen (Shell, Graph, Inspector,
Terminal, Einstellungen, übrige Räume, Tablet, Design-Dokumente, Barrierefreiheit,
Test-Sicherheitsnetz) mit `datei:zeile`-Belegen; 78 Befunde, hier verdichtet.
Alle Befunde sind Code-Lesungen aus einem Durchgang, **nicht gegengeprüft** und
keine Nutzerstudie. Zeilenangaben gelten für `b1174c4`. Bei der Ausarbeitung
jede Zeilenangabe vor dem Umbau nachschlagen.

## 1. Ausgangslage in einem Absatz

Die drei Design-Runden vom 14.–20. September (Calm Pass, Räume/Next Level,
Dichte-Pass) haben Palette, Schriftrollen, Räume-Navigation, Glossar, Button-
Gewichte und 28-px-Controls festgelegt und in Shell, Inspector, Übersicht,
Aufträge, Projekte und Organizer umgesetzt. Was fehlt, ist die **Systematik
darunter**: das Token-Set kennt nur Farbe und fünf Schriftgrössen, jeder Raum
baut Buttons, Leerzustände, Fehlerzeilen und Fokusringe neu, und die drei
grössten Flächen (GraphView 2 710 Zeilen, rightpanel.css 1 161 Zeilen, graph.css
994 Zeilen) sind für einen Design-Durchgang zu gross. Auf dem Tablet stapeln
sich vier Chrome-Zeilen, und die Schrift liegt mit 9–10 px unter der
Token-Skala. Das visuelle Sicherheitsnetz deckt nur den Inspector ab. Ein
Design-Durchgang ohne diese Vorarbeit würde die alten Inkonsistenzen in neuer
Optik reproduzieren.

## 2. Was feststeht und nicht neu verhandelt wird

Diese Entscheide sind dokumentiert, verifiziert und in Playwright-Treibern
verankert. Der Design-Skill arbeitet **innerhalb** dieser Vorgaben:

- **Palette:** warmes Fast-Schwarz (`--bg #0E0F12`), Kupfer als einzige warme
  Stimme (`--accent`), Paper-Light als eigenständiges Gegenstück, nicht als
  Inversion. `tokens.css` ist die einzige Farbquelle; Shell, Inspector,
  Terminal und Räume enthalten keine Hex-Literale mehr (Graph, runFiles,
  reply-speech: siehe §4.1).
- **Schriftrollen:** `--sans` für Chrome, `--mono` nur für Maschinentext. Skala
  11/12/13/15/20 px, Stat-Zahl 24 px. Keine Versalien-Labels, keine Laufweite.
- **Räume-Modell** und Kopfzeile `ade_ · Räume · laufende Arbeit · Verwaltung`
  aus `src/shared/appNavigation.ts`, geteilt mit dem Tablet.
- **Glossar:** Übersicht, Aufgabe (startet nie einen Agenten), Notiz, Agent
  beauftragen, Run/Auftrag, Sitzung, Verwaltung. Inspector-Tabs **Repository ·
  Änderungen · Dateien**, nie „Übersicht“ (21 Treiber).
- **Controls:** PC 28 px (`--control-h`), Touch 44 px (`--touch`). Fünf
  Button-Gewichte; genau eine Kupfer-Aktion je Fläche; Gruppierung durch
  Abstand und Haarlinien statt Rahmen; das Terminal ist der Held.
- **Dialogregeln:** Fokus beim Öffnen hinein, Rückgabe an den Öffner mit
  Fallback; Graph-Knoten sind fokussierbare Buttons (Enter/Space, Escape).
- **Hinweis für den Design-Skill:** Warmes Papier plus Kupfer, Haarlinien und
  Mono-Metadaten zählen zu den Mustern, die generierte Oberflächen oft
  reproduzieren. Hier sind sie bewusst gewählt und bleiben. Die Eigenständigkeit
  soll an **einer** Stelle entstehen (Vorschlag in §5), nicht durch weitere
  Dekoration.

## 3. Zielbild

Ein Design-System aus wenigen benannten Teilen, das Desktop und Tablet teilen:
Token (Farbe, Schrift, Abstand, Radius, Fokus, Bewegung), Primitive (Button,
Feld, Tab-Leiste, Menü, Dialog, Leerzustand, Hinweiszeile, Statuschip), und
Raum-Bausteine (RoomHeader, FilterBar, Row/Card). Jeder Raum benutzt diese
Teile; Abweichungen sind dokumentiert. Der Nutzer erkennt auf beiden Geräten
sofort: welches Projekt, welche Sitzung, wer die Eingabe hat, ob der PC
erreichbar ist, was die nächste Handlung ist (Ziele aus dem Review-Briefing).

## 4. Arbeitspakete in Reihenfolge

Reihenfolge ist Abhängigkeitsreihenfolge: A und B sind Voraussetzung, C–F sind
die eigentlichen Design-Durchgänge, G läuft begleitend.

### A. Sicherheitsnetz zuerst (vor jeder Umgestaltung)

Ohne Baselines lässt sich ein Design-Durchgang nicht abnehmen. Heute
vergleichen wir sieben PNGs des Inspectors bei 1400×900; Shell, Graph, Räume,
Dialoge, Terminal und das ganze Tablet haben keine Baseline, und der visuelle
Treiber läuft nicht im `verify:gate`.

| Schritt | Inhalt | Dateien |
| --- | --- | --- |
| A1 | `comparePng`/`captureState` nach `scripts/helpers/visualBaseline.ts` ziehen | `scripts/test-visual-regression.ts:276-331` |
| A2 | Vollfenster-Baselines: Shell mit Agentenliste, Graph, Projekte, Organizer, Einstellungen (je Tab), Neuer-Run-Dialog, Report-Dialog; hell und dunkel; Erstlauf-Leerzustand | Treiber erweitern; Fixtures liefern bereits PR #42 |
| A3 | Fenstergrössen 1400×900, 1000×700, 880×700 mit Overflow-Prüfung der Kopfzeile | `scripts/test-visual-regression.ts:45-47` |
| A4 | Tablet-Baselines in `test-mobile-browser.ts` (390×844, 820×1180, beide Themes) und Tablet-Terminal mit Tastatur-Resize | `scripts/test-mobile-browser.ts:91-233` |
| A5 | Terminal-Baseline mit deterministischer Fixture-Shell (fester Banner) | Fixture-CLI der anderen Treiber |
| A6 | `visual-regression` in `GATE_DRIVERS` für die Dauer des Durchgangs; Regionen (Kopf, Nav, Liste, Tabs) zusätzlich einzeln erfassen | `scripts/verify.ts:93-94,164` |

Iterationsschleife danach: Token ändern → `pnpm test:visual` → Diff-PNGs
sichten → bewusst `pnpm test:visual:update`. Nur aus PowerShell starten
(Electron-Treiber, Fixture-CLIs). Nie `pnpm build` bei laufender Instanz.

### B. Fundament: Token und Primitive (Voraussetzung für C–F)

**B1 Token-Set vervollständigen** (`src/renderer/theme/tokens.css`, vom Tablet
per Import geteilt): Abstandsskala `--sp-1…--sp-6` (2/4/6/8/12/16), Radien
bereinigen (heute 2/5/6/7/8 px gemischt; Vorschlag 4/6/8), `--focus-ring`
(heute fünf Varianten und 13 `outline:none`), `--shadow-select` für den
Kupfer-Inset, `--motion-fast/--motion-base` mit Easing, `--danger` als Alias
von `--del` (heute in vier Dateien als nicht existierendes Token referenziert),
globale `prefers-reduced-motion`-Regel (heute vier Stellen gegen 33
Animationen). Entscheid: keine Schriftgrösse unter `--fs-xs`; wo 9–10,5 px
stehen (Graph 115 Literale, Inspector 21, Settings, Tablet 107), auf Token
abbilden. Belege: SHELL-1/2, G2, RP-3, SET-2, F4, M-03, A11Y-3/5.

**B2 Eine Control-Schicht** statt sechs Raum-Resets (`overview.css:5-17`,
`projects.css:105-112`, `organizer.css:5-8,124-131`, `work.css:9-18`,
`cli-work.css:6-13`, `voice-studio.css`): `.btn`, `.btn-primary`, `.btn-quiet`,
`.btn-icon`, `.btn-danger` plus Feld-Anatomie (Label oben `--muted`, Hinweis
unten `--faint`, 28/44 px). `organizer-primary`/`work-primary` auf die
gemeinsame Klasse. Belege: F1, SET-6, T6.

**B3 Geteilte Primitive** mit je einer CSS-Datei: `EmptyState` (Titel, ein
Satz, optional eine Kupfer-Aktion; Varianten leer/lädt/Fehler; heute fünf
Klassen und drei Optiken), `InlineNotice` (eine Zeile mit Icon statt
schwebender Karte), `Tabs` (role=tablist mit Pfeiltasten; Projekte baut heute
eine eigene Tab-Leiste aus `aria-pressed`), `Menu` (Fokus auf erstes Element,
Pfeile, Rückgabe an den Öffner; Datei-Kontextmenü hat heute nichts davon),
`Dialog` (ein Primitiv für Renderer wie `src/mobile/ui.tsx`; heute sieben
handgebaute `role=dialog`), `StatusChip`. Belege: F2, F3, RP-2, A11Y-1, T3.

**B4 Live-Regionen entwirren:** 218 `role=status`, 116 `role=alert`, 7
`aria-live`. Drei Komponenten (StatusText, LiveStatus, Alert) und ein Codemod;
Playwright-Treiber, die `role=alert` abfragen, vorher inventarisieren.
Beleg: A11Y-2.

**B5 Komponenten teilen, ohne Verhalten zu ändern**, damit der Design-Skill
isolierte Teile mit eigener CSS-Datei und eigenem Screenshot bekommt:
`GraphView.tsx` → canvas/nodes/chrome/inspector/dialogs; `graph.css`
UX-02-Override-Block einfalten (Doppeldefinitionen `.grunbar`, `.gslots`,
`.gzoom`); `rightpanel.css` → scope/tabs/inspector/changes/files/preview und
fünf Doppelregeln mergen; `SettingsModal.tsx` → Panels je Thema; `TerminalPane`
→ Toolbar/Search/Banners; `OverviewView`, `SketchSheet`, `mobile/main.tsx`
(95-Zeilen-JSX) und `mobile.css` (5–15 Regeln je Zeile) reformatieren.
`src/mobile/test-results/` aus dem Quellbaum entfernen. Belege: G1, G3, RP-7,
SET-7, T7, F6, M-07.

**B5 umgesetzt für die drei grössten Flächen (27. September 2026).** Verhalten
und Darstellung unverändert; Zeilenangaben dieses Plans zu `GraphView.tsx`,
`graph.css` und `rightpanel.css` gelten nur noch für `b1174c4`.

- `GraphView.tsx` (2 710 → 242 Zeilen) ist nur noch Container: Zustand über
  mehrere Flächen und die feste DOM-Reihenfolge (= Tab- und Stapelreihenfolge).
  Teile: `GraphCanvas.tsx` (Welt, Kanten, Journal-Pulse, Ziehen),
  `GraphNodes.tsx` (Cluster, Orchestrator-/Mitgliedskarte, Team-Rahmen),
  `RunBar.tsx`, `RunBanners.tsx` (Fehler, Freigabe mit Diff),
  `GraphChrome.tsx` (Task-Slots, Ansicht, Run-Steuerung, Leerzustand),
  `GraphDockPanel.tsx`, `GraphInspector.tsx`, `Composer.tsx`,
  `PublicationModal.tsx`, `NewRunModal.tsx`; Helfer `graphLayout.ts`,
  `useGraphViewport.ts`, `graphText.ts`, `graphIcons.tsx`.
- `graph.css` ist Einstieg mit geordneten `@import`s (Reihenfolge =
  Kaskade): `graphCanvas`, `runBar`, `runBanners`, `graphNodes`,
  `graphChrome`, `graphInspector`, `graphDockPanel`, `activityFeed`,
  `resultDetails`, `runReport`, `graphControls` (`.gact`, `.ginsp-close`),
  `graphDialogs`. Der UX-02-Override-Block ist eingefaltet; sieben tote
  Regelgruppen sind entfernt (`.grt-pick`, `.gdock-grip`, `.gcomposer-warn`,
  `.ginsp-summary`, `.gcard.ghost`, `.gtbtn.danger`).
- `rightpanel.css` ist Einstieg für `panelShell` (Rahmen, Tabs, Splitter),
  `repositoryScope`, `repositoryInspector`, `changesView`, `filesView`,
  `inlinePreview` (Diff und Dateivorschau), `fileContextMenu`. Die einzige
  echte Doppelregel (`.ri-pr-line strong`) ist zusammengeführt; gleiche
  Regelkörper über Ansichten hinweg (ausgewählte Zeile in Änderungen und
  Dateien, Zählerschrift) bleiben getrennt und werden in B1/B3 zu Token bzw.
  Primitiv.
- Nachweis: Kaskadenvergleich vorher/nachher auf Quelle und ausgeliefertem
  CSS (gleiche Werte je Selektor und Eigenschaft; kein Reihenfolgewechsel
  zwischen gleich spezifischen Selektoren, die dasselbe Element treffen
  können), übrige CSS-Chunks bytegleich; `scripts/test-style-entries.ts`
  hält die Einstiegsregel fest.
- Beim Aufteilen gefunden, bewusst **nicht** geändert (für C/D):
  `.grun-failure-body p` ist wirkungslos, weil `.grun-failure p` gleich
  spezifisch und später ist; der Fehlertext scrollt darum doppelt. Der
  Run-Report in **Aufträge** (`WorkView`) bekommt seine Grundstile nur aus
  `graph.css`, das erst mit dem Graph-Chunk (Graph besucht oder „Neuer Run“
  geöffnet) geladen wird.
- Offen aus B5: `SettingsModal`, `TerminalPane`, `OverviewView`,
  `SketchSheet`, `mobile/main.tsx`, `mobile.css`, `src/mobile/test-results/`.

### C. Desktop-Shell und Terminal (erster Design-Durchgang)

Hier entsteht der Eindruck der App; hier soll der Design-Skill die eine
eigenständige Stelle setzen (§5).

- **C1 Kopfzeile:** fünf Breakpoints in zwei Dateien auf zwei reduzieren
  (kompakt ≤1260, gestapelt ≤1000); entscheiden, ob Raum-Gruppen durch
  Beschriftung (heute erst ab 1440 px sichtbar, also auf gängigen Laptops nie),
  durch Abstand oder durch Icon+Label getragen werden; Nav-Tabs auf
  `--control-h` (heute 34 px); Setup/Diagnose in Einstellungen oder Overflow;
  Theme-Glyphen ☀/☾ und Rail-Chevrons ▸/▾ auf das 24-px-SVG-Raster der Nav.
  Belege: SHELL-3/4/8, DOC-08.
- **C2 Rail:** Affordanzen nicht mehr `opacity:0` bis Hover (Touch/Lupe finden
  „Agent hinzufügen“ nicht); Regel für die ganze App: Hover-Reveal nie für
  Primäraktionen und nie für Zustand. Beleg: SHELL-4.
- **C3 Session-Tab-Leiste:** tote `.tabstrip`-Regel in `app.css` löschen, Leiste
  nach `tabs/tabs.css`, Tab-Form (Mockup-Rundung vs. Nav-Unterstrich) einmal
  entscheiden. Beleg: SHELL-5.
- **C4 Terminal-Chrome-Budget:** höchstens eine 28-px-Zeile über dem xterm
  (Copy/Paste/Schrift in den Overflow), Banner und Tool-Fehler als eine Zeile,
  Sitzungs-Notizen inline statt als schwebende Karte über der letzten
  Terminalzeile; Sprachleiste im Leerlauf einklappbar wie am Tablet. Belege:
  T1, T3, DOC-03.
- **C5 Sprachleiste, Zustände:** vier explizite Zustände (`data-state`:
  idle/sending/offline/needs-check) auf `--ok/--warn/--bad`; Long-Press =
  Computer sichtbar machen (Fortschrittsring 0–550 ms, Hinweis „Tippen: Diktat ·
  Halten: Computer“ bis `hintSeen`, `aria-describedby`, Tastaturäquivalent).
  Belege: T2, T4.
- **C6 Sitzungswechsler:** aktuelle Sitzung im Auslöser, `aria-current` mit
  Kupfer-Inset, Status-Punkt, Pfeiltasten aus dem Suchfeld. Beleg: T5.
- **C7 Leer- und Ladezustände** der Shell auf `EmptyState` (heute nackte `<p>`
  oben links). Beleg: SHELL-7.

### D. Inspector, Graph, Einstellungen

- **D1 Inspector:** Dateibaum als `role=tree` mit Pfeiltasten, Home/End,
  Shift+F10 für das Menü, sichtbarem Fokus; Lade-/Fehlerzustand je Pfad
  (heute stumm, Fehler nur in der Konsole); Scope-Kopf von fünf auf zwei Zeilen
  (Name + Chips; Pfad mittig gekürzt mit Vollpfad im Tooltip; „Repository für
  neue Sitzung“ in die Verwaltungs-Disclosure); erste ≤900-px-Regel (heute
  keine). Belege: RP-1/2/5/6.
- **D2 Graph-Knoten:** eine Status-Sprache je Knoten (heute Ampel-Lichter,
  Branch-Glyph, Rollenlabel, Chip und Animation nebeneinander); Anatomie-Spec
  Name/Rolle/Status/Branch/Aktionen für Agent, Orchestrator, Team;
  Vier-Gruppen-Toolbar (Ansicht · Run · Ergebnisse · Auswahl) fertigstellen;
  Inspector-Aside mit `role=complementary`, Schliessen-Knopf, Fokusübergabe;
  `SessionTail` als `role=log` mit Wartezustand; Diff-Farben auf `--add/--del`.
  Belege: G4/5/6/8, DOC-05.
- **D3 Einstellungen:** eigenes Modal (~720–880 px, 80 vh) mit linker
  Navigation je Thema statt 420-px-Modal mit 58-vh-Scrollbrunnen; ein Leitsatz
  je Abschnitt (max. 62 Zeichen), Rest in `<details>`; Status als Punktzeile;
  eine Fehlerdarstellung statt vier; Feldfehler mit `aria-invalid`, Grund neben
  deaktiviertem Speichern. Offen: Modal oder eigener Raum (§6). Belege: SET-1/3/4/8.

### E. Räume vereinheitlichen

`RoomHeader` (h1, Meta, Aktions-Slot) und `FilterBar` für Übersicht, Aufträge,
Projekte, Organizer; Entscheid Zeilen vs. Karten für Sammlungen (heute beides);
Projekte im offenen Zustand mit genau einer Primäraktion (Sitzung
starten/fortsetzen); ein Breakpoint-Set (≥1000/≤900/`pointer:coarse`) statt
900/760/700/620/599; Organizer-Speicherzustände als vier Chips („Auf diesem
Gerät gespeichert“, „Mit PC abgeglichen“, „Übertragung ausstehend“, „Zwei
Versionen vorhanden“; heute existieren nur zwei Texte). Belege: F3/5/8,
DOC-02.

### F. Tablet

- **F1 Zwei Chrome-Zeilen statt vier:** Kopf = Räume + ein Verbindungs-Pill;
  Werkzeugzeile = eine Primäraktion je Raum + Overflow. Aktualisieren,
  Verbinden und Verbindungsstatus in den Pill/Dialog; Fusszeile ab 700 px
  weg oder 28-px-Statuszeile. Beleg: M-01, UX-01.
- **F2 Ein expliziter Fokusmodus** (`data-focus-mode`) statt drei sich
  überlagernder `:has()`-Mechanismen, mit immer sichtbarer 44-px-Rückkehr zu
  Dateien/Git; Bewegung mit Reduced-Motion-Fallback. Beleg: M-02, Memory
  „Tab-Zeile verschwindet“.
- **F3 Typo/Touch:** keine Schrift unter 11 px (heute 3×9, 21×10 px), Chrome-
  Controls nie unter 44 px (heute 40–42 px), Radio/Checkbox-Zeilen 44 px;
  Kontrast- und Zoommessung auf dem realen Tablet (UX-11, seit Juli offen) in
  STATUS festhalten. Belege: M-03/04, DOC-01, A11Y-6.
- **F4 Ein Verbindungsmodell:** Pill als einzige Quelle (Wort + zuletzt
  gesehen), ein Banner nur wenn eine Aktion blockiert ist, deaktivierte Knöpfe
  mit Grund. Beleg: M-05.
- **F5 Leer/Lade/Hinweis** über die geteilten Primitive aus B3 (heute Graph-
  Icon für jeden Leerzustand, nackte `<p role=status>`). Beleg: M-06.

### G. Sprache und Text (begleitend, billigster grosser Gewinn)

Untranslatierte Literale (`Dashboard ↗`, `Changes`/`Files` als Tab-Werte,
`${n} changed`, `${runs.length} Runs`, `sessions running`, Fehlertexte im
Kategorie-Dialog, `flash('Integration abgelehnt')`), Glossar-Pass über
`messages.de.ts` (bleibt „Workspace“? „Run“ ja), Status-Enums an der
Render-Grenze übersetzen, `{{title}}` statt `{{value1}}` und Pluralschlüssel
für neue Texte. Hash-Suffixe wie `"Zoom out [5665726b]"` sind eine
Disambiguierung mit deutschem Eintrag (geprüft: `messages.de.ts:1899`), also
kein Laufzeitfehler; ein Playwright-Check, dass kein gerenderter Text auf
`/\[[0-9a-f]{8}\]/` passt, sichert das ab. Tastenkürzel: eine Registry
(`useSessionShortcuts.ts` plus Terminal-Suche, Graph), Hilfsdialog Ctrl+/,
`aria-keyshortcuts` in der Nav; Skip-Link; ein h1 je Raum. Belege: SHELL-6,
RP-4, SET-5, F7, M-08, DOC-06, A11Y-4/7/8.

## 5. Briefing für den Frontend-Design-Skill

So ist der Plan gemeint, wenn der Skill ihn ausarbeitet (Reihenfolge C → D →
E → F, jeweils nach A und B):

- **Gegenstand:** ADE, eine Electron-Entwicklungsumgebung, in der ein Mensch
  KI-Agenten in Terminals und Git-Worktrees beauftragt, überwacht und deren
  Ergebnisse prüft, am PC und vom Tablet aus. Publikum: eine Person, Adi,
  täglich, oft parallel zu laufender Arbeit. Hauptaufgabe der Oberfläche:
  Orientierung (Projekt, Sitzung, Eingabe, Erreichbarkeit) und Übergabe
  (Text/Sprache → Terminal) ohne Ablenkung vom Terminalinhalt.
- **Token-Plan:** Farbe fix (§2). Zu entscheiden: Abstandsbasis (4 px), drei
  Radien, ein Fokusring (Kupfer-Outline; im Light-Theme auf `--accent-dim`
  heute zu schwach, `#C9A26B` auf `#F3EFE7`), Bewegungs-Skala, Chip-/Pill-
  Formen, Mindestgrösse 11 px (PC) und 12 px (Tablet, siehe §6).
- **Wo die eine Eigenständigkeit hingehört (Vorschlag):** in die Übergabe-
  Geste selbst, also Mikrofon, Fortschrittsring beim Halten, Zustandswechsel
  idle → sending → confirmed, auf PC und Tablet identisch. Das ist die
  Handlung, die ADE von anderen Werkzeugen unterscheidet. Alles andere bleibt
  leise. Alternative: die Graph-Knoten-Anatomie. Nicht beides.
- **Layout-Regeln:** Drei-Regionen-Shell bleibt; Kopf einzeilig bis 1000 px;
  Inhalt in Räumen links ausgerichtet, max. 1120 px; Sammlungen als Zeilen
  mit Haarlinien, Karten nur wo eine Wahl getroffen wird; Zeilenlänge unter
  80 Zeichen.
- **Text:** Deutsch, Du-Form wie bisher, Verb-zuerst-Buttons, Satzschreibung,
  Fehler nennen Ursache und nächsten Schritt, Leerzustände laden zur Handlung
  ein.
- **Selbstkritik-Schleife:** nach jedem Slice Screenshots aus dem visuellen
  Treiber (hell/dunkel, drei Breiten, Tablet) ansehen, ein Element entfernen,
  dann Baseline aktualisieren.

## 6. Entscheide (von Adi getroffen am 27. September 2026)

1. **Raum-Gruppen in der Kopfzeile:** nur Abstand und eine feine Trennlinie,
   keine sichtbaren Beschriftungen; der Gruppenname bleibt als
   `aria-label`/Tooltip.
2. **Einstellungen:** breiteres Modal (etwa 720–880 px, 80 vh) mit Navigation
   je Thema links; kein eigener Raum (Verwaltung bleibt Chrome).
3. **Sammlungen:** Zeilen mit Haarlinien überall; Karten nur, wo eine Wahl
   getroffen wird (CLI-Startkacheln, Auswahl im Neuer-Run-Dialog).
4. **Graph:** Ampel-Lichter ersetzt durch eine Status-Sprache (Chip mit Punkt,
   Bewegung nur bei „arbeitet“); Details als angedockte Spalte mit
   Schliessen-Knopf und Fokusrückgabe.
5. **Tablet:** Fusszeile in den Verbindungs-Pill und seinen Dialog;
   Fokusmodus automatisch, aber als expliziter Zustand mit immer sichtbarer
   44-px-Rückkehr; Mindestschrift 12 px.
6. **Sprachleiste am PC:** im Leerlauf auf eine 28-px-Zeile eingeklappt, nie
   mit Entwurf oder angezeigtem Zustand, mit Tastenkürzel.
7. **Eigenständigkeit:** die Übergabe-Geste (Mikrofon, Ring beim Halten,
   Zustände), auf PC und Tablet gleich.
8. **Lehnwörter:** „Run“ und „Workspace“ bleiben (Workspace im Glossar
   erklärt); „Inspector“ heisst sichtbar „Details“.

**Korrektur zu 6 (nach Code-Prüfung):** Der PC hat keine Sprachleiste unter
dem Terminal; Diktat öffnet dort das Seitendock „Prompt / Diktat“, das im
Leerlauf keinen Platz belegt. Auch die Tablet-Leiste klappte im Leerlauf nicht
ein. Adi hat daraufhin entschieden: Tablet-Leiste mit einzeiliger Ruheform,
Geste in Tablet-Leiste und PC-Dock, das Dock bleibt.

**Umgesetzt (28. September 2026):**

- 1: `AppNav.tsx` ohne sichtbare Beschriftungen; Gruppenname als
  `aria-describedby` jedes Tabs und als `title` der Gruppe; auch die
  „Verwaltung“-Beschriftung der Titelleiste entfällt.
- 2: `SettingsTopics.tsx` + `settings-topics.css`: Modal bis 880 px und 80 vh,
  Themen Allgemein · Tablet und Geräte · Projekte · Harnesses und Schlüssel ·
  Stimme; eine Scrollfläche (Strg+F findet alles), die Navigation springt zum
  Thema, fokussiert seine Überschrift und markiert es (`aria-current`). Das
  Tablet behält seine Tabs Allgemein/Stimme.
- 3: Zeilen in Übersicht (Projekte), Projektverzeichnis (PC und Tablet),
  Nutzungs-Aufschlüsselung, Einstellungen (Geräte, Harnesses, Bundle-Import),
  Git-Sync, Sitzungswechsler, Tablet-Übersicht, Weiterarbeiten, Sitzungen im
  Starter, Terminal-Navigation, Organizer-Listen, Commit-Listen, Projekt-Rail,
  Workspace-Zuordnung, Notizauswahl. Karten bleiben: CLI-Startkacheln,
  Modus/Theme-Wahl, Bildauswahl, Gesprächsmodi, Gesprächsverlauf und
  Vorschläge (je eigene Entscheidung).
- 4: Graph-Knoten (PC und Tablet) ohne Lichter; `.gchip` mit Punkt ist die
  einzige Status-Sprache, Bewegung nur bei „arbeitet“. Details als Spalte
  (328 px, bündig rechts, unter 900 px weiter überlagernd) mit „Details
  schliessen“, Fokus zurück an den Knoten (`data-node-id`).
- 5: Fusszeile entfernt; Task-Slots, letzte Bestätigung und „Erneut
  verbinden“ (in jedem Zustand) im Verbindungsdialog, Uhrzeit in der Pill ab
  1440 px. Fokusmodus als `data-focus-mode` (`terminal` | `keyboard`), vom
  Terminal an den Arbeitsbereich gemeldet, statt `:has()`-Proben; „Workspace
  einblenden“ bleibt auch bei offener Tastatur in der Titelzeile und schliesst
  sie. Tablet-Schrift ≥ 12 px (`--fs-xs` am Tablet 12 px), Bedienelemente
  44 px, Checkbox-/Radio-Zeilen 44 px.
- 6/7: `micGesture.tsx` + `mic-gesture.css` für Tablet-Leiste und PC-Dock:
  Tippen diktiert, Halten (550 ms, Ring füllt sich) ruft den Computer,
  Umschalt+Eingabe als Tastenkürzel, Beschreibung per `aria-describedby`,
  Übergabe-Zustand `data-state` idle/sending/confirmed/offline/needs-check.
  Tablet-Leiste im Leerlauf mit leerem Entwurf einzeilig (`data-compact`,
  gleiche DOM-Knoten, Fokus bleibt beim Tippen).
- 8: „Details“, „Details schliessen“, „Breite der Details“, „Seite der
  Details“, „Details ein- oder ausblenden“; Glossar in `appNavigation.ts`.

## 7. Bewusst nicht in diesem Plan

Sketch-Phase-6-Wünsche (Affinity-ähnliche Ebenen/Pinsel), Ollama im nativen
`ollama run`-Terminal, UX-05 (Fenster schliessen/beenden/neu starten als Menü),
UX-10 (Zurück-Navigationstiefe am Tablet) und der vollständige Screenreader-
Test bleiben eigene Aufträge; sie sind im Review-Briefing bzw. in den
Memory-Notizen festgehalten und werden hier nur als offen markiert.

## 8. Abnahme je Slice

Jeder Slice endet mit: fokussierte Suite grün, `pnpm test:visual` mit
gesichteten Diffs und bewusstem `--update`, Playwright-Fluss für den
sichtbaren Ablauf (Tastatur, Fokusrückgabe, Leer-/Fehlerzustand, ≤900 px oder
Tablet), Eintrag in `docs/STATUS.md`, und am Ende des Pakets `pnpm verify`
plus `pnpm activate`. Keine Behauptung „unterstützt“ ohne Treiber.
