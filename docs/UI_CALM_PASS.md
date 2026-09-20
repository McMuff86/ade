# UI Calm Pass — weniger „crowded“, aufgeräumter

Stand: 14. September 2026. Analyse des gesamten Desktop-Frontends (`src/renderer`)
und des Tablet-Frontends (`src/mobile`), Umsetzung von Phase 1, Vorschlag für
Phase 2 und 3.

## Diagnose: woher das Gedränge kommt

Live-Screenshots des Builds vom 14. September (nicht die älteren Doku-Bilder)
zeigen fünf Ursachen. Keine davon ist ein Layout-Fehler; alle sind
Hierarchie-Fehler, also lösbar ohne neue Ansichten.

1. **Monospace für alles.** Labels, Hilfetexte, Buttons und Daten stehen in
   derselben Schrift. Fließtext in Monospace wirkt pro Zeile rund 30 % breiter
   und ohne Wortbild; die Fläche füllt sich, obwohl wenig Information da ist.
2. **Versal-Eyebrows in jedem Panel.** `ACTIVE SESSION SCOPE`, `WORKSPACE`,
   `SELECTED REPOSITORY`, `BRANCH`, `OPEN PULL REQUESTS`, `AGENTS`, `PROJECTS`,
   `PROFILE PHOTO`, `NAME` … Versalien mit Laufweite sind optisch lauter als
   der Inhalt, den sie beschriften.
3. **Eine Button-Gewichtung für alles.** Titelleiste (Einrichtung, Settings,
   Diagnostics, Theme), Tab-Leiste (Terminal öffnen, Inspector), Rail-Kopf
   (Freie Terminals, Anordnen) und Overview (sieben Mal „Terminal öffnen /
   fortsetzen“ als Block) benutzen dieselbe umrandete Schaltfläche. Nichts
   tritt zurück, also konkurriert alles.
4. **Karten in Karten.** Der Inspector rahmt Health-Grid, PRs und Commits
   jeweils in eine eigene Box mit Tönung, obwohl das Panel selbst schon der
   Rahmen ist. Jede zusätzliche Kante ist Rauschen ohne Information.
5. **Stapel statt Zeile im Rail-Kopf.** „Freie Terminals“, Suchfeld mit
   sichtbarem Label und „Anordnen“ liegen untereinander, das Suchfeld ist im
   Dark-Theme weiß (ungestylter Native-Input). Im Anordnen-Modus bekommt jede
   Zeile zwei 30 × 32 px große Rahmen-Buttons.

## Gestaltungsentscheid (Token-Plan)

- **Farbe:** unverändert. Warmes Fast-Schwarz, Kupfer als einzige Stimme,
  Paper-Light als Gegenstück. Die Identität steckt in der Palette, nicht in
  der Dichte.
- **Schrift:** zwei Rollen statt einer. UI-Chrome (Labels, Buttons, Prosa) in
  `--sans` (Segoe UI Variable / system-ui); `--mono` nur für Maschinentext:
  Terminal, Pfade, SHAs, Branch-Namen, Diffs, Dateilisten, Logotype. Der
  Kontrast beider Schriften *ist* die Hierarchie.
- **Typo-Skala:** 11 / 12 / 13 / 15 / 20 px als Tokens (`--fs-xs` … `--fs-xl`),
  Stat-Zahl 24 px. Labels in Satzschreibung, ohne Laufweite.
- **Layout:** Drei-Regionen-Shell bleibt. Gruppierung durch Abstand und
  Haarlinien statt durch Rahmen. Pro Fläche genau eine Primäraktion in Kupfer;
  alles andere „quiet“ (ohne Rahmen bis Hover).
- **Prinzip:** Das Terminal ist der Held, das Chrome tritt zurück. Farbe nur
  für entscheidungsrelevante Zustände (dirty, diverged, review required).

## Phase 1 — umgesetzt in diesem Commit

Nur Dateien, die der parallel arbeitende Agent nicht angefasst hat. Keine
Verhaltensänderung; alle Test-Selektoren (Rollen, Labels, `data-testid`,
Klassen wie `.cat-name`, `.strip-actions`, `.add-agent`) bleiben gültig.

| Bereich | Änderung | Datei |
|---|---|---|
| Basis | `body` in `--sans`; `code/pre/kbd/.mono` in `--mono`; Typo-, Radius- und Control-Höhen-Tokens; `color-scheme` je Theme; Native-Formularelemente per `:where()` (Spezifität 0) im Theme | `theme/tokens.css` |
| Titelleiste | Einrichtung/Settings/Diagnostics/Theme als Text-Buttons, nur der Mode-Switch bleibt ein Control; `.btn-quiet`-Variante; Untertitel unter 1100 px ausgeblendet | `app.css` |
| Rail | Kopf als ein `.rail-tools`-Block: „Freie Terminals“ als Zeile mit `>_`-Glyph, Suchfeld mit Placeholder (Label per `aria-label`), „Anordnen“ inline; Gruppen-Überschrift als leises Label; Kategorie-Chevron nur bei Hover/collapsed; Anordnen-Pfeile 24 px ohne Rahmen; Wrap erst unter 200 px | `rail/Rail.tsx`, `rail/rail.css` |
| Tab-Leiste | „Terminal öffnen“/„Inspector“ ohne Rahmen; aktiver Inspector als kupferne Tönung; undefinierte Tokens (`--edge`, `--error`) ersetzt | `terminal/terminal.css` |
| Inspector | Scope-Kopf ohne Tönung, Repo-Name 15 px, Pfad leise in Mono; Abschnitte flach mit Haarlinien statt Karten; Health-Grid als zweispaltige Liste; alle Eyebrows in Satzschreibung; Datei-/Änderungslisten in Mono, Labels in Sans | `rightpanel/rightpanel.css` |
| Overview | Inhalt auf ~1120 px zentriert; Stat-Labels Satzschreibung, Zahl 24 px; Agent-Aktion in der Zeile rechts statt als Block darunter; Abschnitts-Titel 12 px | `overview/overview.css` |
| Modale | Formular-Labels von `NAME`/`PROFILE PHOTO`/… in Satzschreibung; alle Text-Inputs (auch `list`-Inputs) im Theme; Session-Start-Dialog mit demselben Feld-Rhythmus | `onboarding/*.tsx`, `onboarding.css`, `sessions/sessionLaunch.css` |

Visuelle Baselines des Inspectors (`scripts/fixtures/visual-baselines/win32`)
wurden mit `pnpm test:visual:update` neu aufgenommen.

Bewusst **nicht** in Phase 1, weil diese Dateien im Arbeitsbaum des anderen
Agenten geändert sind: `projects/projects.css`, `projects/ProjectsView.tsx`,
`settings/settings.css`, `settings/SettingsModal.tsx`, alles unter
`src/mobile/` außer der geteilten `tokens.css`.

## Fortsetzung

Phase 2 und 3 sind am 19. September in [UI_UX_NEXT_LEVEL.md](UI_UX_NEXT_LEVEL.md)
aufgegangen: gruppierte Navigation, Graph-Gruppen, Tablet-Werkzeugzeile und ein
Begriffsmodell. Die dort noch offenen Punkte Projekte-Seite, Settings-Tabs und
PC-Dichte der geteilten Komponenten hat der Dichte-Pass vom 20. September
(Abschnitt 10 desselben Dokuments) umgesetzt. Die folgenden Abschnitte bleiben
als Herkunft stehen.

## Phase 2 — Vorschlag (nach Merge des anderen Agenten)

1. **Projekte-Seite** (`projects.css`, `ProjectsView.tsx`, `ProjectDirectory.tsx`):
   Inhalt auf max. 880 px; „Bestehenden Ordner hinzufügen“ und „Neues Projekt“
   in eine Werkzeugzeile neben der Suche; die drei Hilfeabsätze auf einen
   Satz unter dem Suchfeld reduzieren (Rest in Tooltip/`<details>`); Filter
   „Alle / Meine ADE Projekte“ als Segment-Control wie der Mode-Switch.
2. **Settings** (`settings.css`, `SettingsModal.tsx`): Modal in zwei Spalten
   (Navigation links: Darstellung, Mobiler Zugriff, Projekte, Harness,
   Sprache; Inhalt rechts) statt einer langen Scrollseite; Erklärtexte auf
   je einen Satz kürzen, Details in `<details>`; Status-Sätze („Mobiler
   Zugriff ist ausgeschaltet …“) als eine Zeile mit Punkt-Indikator.
3. **Graph-Toolbar** (`graph.css`): Toolbar ohne Rahmenkarte, direkt auf dem
   Canvas-Grund; Zoom-Controls und „Task-Slots“ als eine leise Gruppe.
4. **Tablet** (`mobile.css`, `tablet.css`): dieselben Regeln übernehmen —
   `.m-eyebrow` in Satzschreibung, Karten nur wo Auswahl stattfindet, Buttons
   in zwei Gewichten (primär Kupfer / quiet).

## Phase 3 — Vorschlag (kleine, sichtbare Reste)

- Session-Notices unten im Terminal als eine Zeile mit Icon statt Karte.
- Leerzustände („No sessions — press +“) mit einer klaren Handlung als
  einzigem Button, Text darunter.
- Titelleiste: „Diagnostics“ in Settings integrieren, wenn der Diagnose-
  Status nicht rot ist (ein Button weniger im Dauerzustand).
- Zweisprachigkeit der Labels (Englisch/Deutsch gemischt: „Open new session“
  neben „Terminal öffnen“) vereinheitlichen — das ist Textpflege, wirkt aber
  stark auf den Eindruck von Ordnung.

## Übergabe an den parallel arbeitenden Agenten

Der Commit dieser Phase liegt auf `main` im selben Arbeitsbaum. Er berührt
keine deiner geänderten Dateien; ein Merge ist nicht nötig.

1. `git log -1 --stat` prüfen, dass der Commit „style: calm pass …“ vorliegt.
2. `pnpm build` ausführen (Renderer und Mobile werden mit der neuen Basis-
   Schrift gebaut).
3. Die persönliche ADE-Instanz wie bisher beenden (Tray → Beenden bzw. PID
   aus `docs/HANDOFF.md`) und aus dem frischen `out/` neu starten.
4. Sichtprüfung: Titelleiste mit Text-Buttons, Rail-Kopf einzeilig, Inspector
   ohne Karten, Overview-Aktionen rechts in der Zeile.
5. Beim eigenen Commit: `settings.css`/`projects.css` unverändert lassen, bis
   Phase 2 startet, damit dort keine Konflikte entstehen.
