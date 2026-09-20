# ADE UI/UX – Analyse, Designentscheid und Umsetzung (Branch `ui/next-level`)

Stand: 19. September 2026. Antwort auf [UI_UX_REVIEW_BRIEF.md](UI_UX_REVIEW_BRIEF.md).
Dieses Dokument enthält den Designentscheid, das Aktionsinventar, die
Wireframes, die Komponentenregeln und den Stand der Umsetzung. Nachweise
stehen im Abschnitt „Abnahme“; alles ohne Nachweis gilt als offen.

## Integration mit Aufgaben und Notizen

Branch-Commit `464b6a5` wurde mit dem Aufgaben-/Notizen-Stand `9378b8e`
zusammengeführt. `AppNav` und die deutschen Namen gelten auf beiden Geräten;
die echte `DesktopOrganizer`-/`MobileOrganizer`-Ansicht ersetzt die Platzhalter.
Offline-Entwürfe, Konfliktkopien, Diktat, Exporte, Erinnerungen und Agentenübergabe
bleiben erhalten. Das gespeicherte Einklappen der Navigation wurde in `AppNav`
übernommen; die doppelte Navigation und `RoomPlaceholder` wurden entfernt.
Die Organizer-Treiber wurden auf die neuen Namen umgestellt, **nicht ausgeführt**.

Für die Zusammenführung hat der Nutzer ausdrücklich keine weiteren Tests
gewünscht. Die unten aufgeführten Ergebnisse gehören zum separaten UI-Branch,
nicht zum zusammengeführten Stand. `pnpm verify` bleibt offen. Der gemeinsame
Desktop-/Mobile-Build und die Aktivierung werden in [HANDOFF.md](HANDOFF.md)
protokolliert. Link-Zielarten und die Messung am echten Gerät bleiben Folgearbeit.

## 1. Analyse in einem Absatz

Das Briefing hat recht: ADE leidet nicht an fehlenden Funktionen, sondern an
fehlender Rangordnung. Auf dem Bild B3 (Tablet, Graph) stehen zehn gleich
gewichtete Schaltflächen über dem Graph, darunter zwei Filter, darunter eine
weitere Aktionszeile; „Neuer Run“ kommt zweimal vor. Auf dem PC mischt die
Titelleiste sieben Bereiche mit vier Verwaltungsknöpfen und zwei
Sitzungsknöpfen in einer Reihe. Der Projektkopf auf dem Tablet (B1/B2) braucht
drei Zeilen für Titel, Status und Aktionen, und „Links“/„Verlauf“ liegen auf
der ersten Terminalzeile. Dazu kommen zwei Sprachen (`Overview`, `Work`,
`Settings` neben „Projekte“, „Einrichtung“) und ein Wort für zwei Dinge:
„Neue Aufgabe“ startet einen Agenten, während die neuen persönlichen
„Aufgaben“ gerade keinen starten dürfen.

Die Lösung ist deshalb zuerst eine Ordnung, dann ein Stil: **drei Räume, eine
Werkzeugzeile, ein Wortschatz.** Die Palette (warmes Fast-Schwarz, Kupfer,
Papier) und die Schriftrollen aus dem [Calm Pass](UI_CALM_PASS.md) bleiben; sie
sind die Identität. Neu ist, was wo steht und wie es heisst.

## 2. Designentscheid

### Token-Plan

| Ebene | Entscheid |
| --- | --- |
| Farbe | Unverändert: `--bg #0E0F12`, `--panel #15171C`, `--accent #E09A4A` (Kupfer), Papier-Light. Neu sind nur **Bedeutungsnamen**: `--ok` (verbunden, gespeichert und bestätigt), `--warn` (Wiederverbindung, ausstehend, anderer Build), `--bad` (nicht erreichbar, fehlgeschlagen, endgültig) und `--accent-soft` für eingeschaltete Schalter. |
| Schrift | Unverändert zwei Rollen: Sans für Bedienung, Mono für Maschinentext. Skala 11/12/13/15/20 px. Keine Versalien, keine Laufweite; Beschriftungen in Satzschreibung. |
| Layout | **Eine lesbare Kopfzeile** auf PC und Tablet in derselben Reihenfolge: `ade_` · Räume · laufende Arbeit · Verwaltung. Räume sind Tabs mit kupferner Unterstreichung, gruppiert durch Abstand, Haarlinie und eine leise Inline-Beschriftung („Organisation  Aufgaben Notizen“). Inhalt linksbündig. |
| Prinzipien | (1) Pro Fläche genau eine Kupfer-Aktion. (2) Gruppen durch Nähe und Beschriftung, nicht durch Karten. (3) Nichts schwebt ohne festen Platz. (4) Zustände heissen, was sie für die Person bedeuten: „Eingabe: Du“, „PC nicht erreichbar“, „Auf diesem Gerät gespeichert“. (5) Das Terminal ist der Held; Chrome tritt auf eine Zeile zurück, sobald gearbeitet wird. |

**Selbstprüfung gegen die üblichen Standardlösungen.** Ein gruppiertes
Segment-Control mit Karten je Gruppe wäre die Vorlage gewesen; verworfen,
weil es die Kopfzeile höher und lauter macht. Stattdessen lesen sich die
Gruppen wie ein Satz in einer Zeile. Ein „Neu ▾“-Sammelmenü wurde geprüft und
verworfen: Es versteckt den Unterschied zwischen persönlicher Aufgabe und
Agentenauftrag, den das Briefing gerade sichtbar haben will. Die
Verwaltungsaktionen bleiben am PC direkt erreichbar (ein Klick), aber als
eigene, leise Gruppe; auf dem Tablet sitzen sie rechts im Kopf, nie mehr in
der Werkzeugzeile.

### Begriffsmodell (UX-04, UX-08)

| Begriff | Bedeutung | Sichtbar als |
| --- | --- | --- |
| Übersicht | Wo bin ich, was braucht mich | Raum 1 |
| Aufgabe | Persönlicher Eintrag, startet nie einen Agenten | Raum „Organisation → Aufgaben“ |
| Notiz | Freier Inhalt (Text, Diktat, Foto, Skizze) | Raum „Organisation → Notizen“ |
| Agent beauftragen | Ausdrückliche Übergabe an einen Agenten | Aktion in Übersicht, Aufträge, Graph; Dialog „Agent beauftragen“ |
| Run | Ausführung eines oder mehrerer Aufträge | Raum „Entwicklung → Aufträge“ und „Graph“; Aktion „Neuer Run“ |
| Sitzung | Laufendes Terminal auf dem PC | „Arbeit wechseln“, Projekt-Terminal |
| Verwaltung | Einrichtung, Einstellungen, Diagnose, Verwalten (Geräte/Workspaces) | Gruppe rechts im Kopf |

Das Modell steht maschinenlesbar in `src/shared/appNavigation.ts` (`GLOSSARY`,
`APP_NAV_GROUPS`) und ist die einzige Quelle für Reihenfolge und Namen.

## 3. Aktionsinventar je Arbeitskontext

| Kontext | Hauptaktion (Kupfer) | Sekundär | Kontextbezogen | Selten / endgültig |
| --- | --- | --- | --- | --- |
| Übersicht (Tablet) | Neuer Run | Agent beauftragen, Neues Projekt | Weiterarbeiten-Karten | Aktualisieren |
| Projekte (Tablet) | Neues Projekt | – | Workspace öffnen je Karte | Aktualisieren |
| Terminals (Tablet) | Terminal öffnen | – | Sitzung wählen im Rail | Aktualisieren |
| Aufträge | Neuer Run | Agent beauftragen | Run öffnen, im Graph öffnen | Aktualisieren |
| Graph, oben | Neuer Run | Bericht, Rückfragen, Draft-PR (Gruppe „Ergebnisse“) | Run wählen, Status, Ziel (Gruppe „Run“) | Git-Abgleich, Run löschen (Gruppe „Selten und endgültig“) |
| Graph, unten | – | Orchestrierung starten | Direkt an Teams, Alle pausieren/aktivieren (Gruppe „Run-Steuerung“) | Run abbrechen, Tasks stoppen |
| Graph, links unten | – | – | Ansicht: −, Zoomstufe, +, Einpassen; Task-Slots aufklappbar | – |
| Projekt-Terminal (Tablet) | Sprechen / Senden (Voice-Strip) | Sitzung & Workspace, Projektbereich | Verlauf, Links (im Voice-Strip, nicht über der Ausgabe) | Terminal beenden (leise, rot) |
| Kopfzeile PC/Tablet | – | Arbeit wechseln, ADE-Betreuung (Gruppe „Laufende Arbeit“) | Verbindung (Tablet, öffnet Erklärung) | Einrichtung, Einstellungen, Diagnose, Verwalten |

Bewusst behandelte Duplikate: „Neuer Run“ nur noch in der oberen Run-Leiste
des Graphs (unten entfernt). „Einstellungen“ auf dem Tablet nur noch im Kopf
(aus der Werkzeugzeile entfernt). „Terminal öffnen“ und „Neues Projekt“ nur
noch dort, wo ihr Ergebnis erscheint.

## 4. Wireframes

PC, breit (≥ 1180 px):

```
ade_  Übersicht │ Organisation  Aufgaben  Notizen │ Entwicklung  Projekte  Terminals  Aufträge  Graph
                                                  Arbeit wechseln  ADE-Betreuung │ Verwaltung  Einrichtung  Einstellungen  Diagnose  ☀
──────────────────────────────────────────────────────────────────────────────────────────────────────────
```

PC, schmal (< 900 px): Räume in einer eigenen Zeile, Beschriftungen fallen
zuerst weg, dann die Icons; keine Aktion verlässt die Kopfzeile.

Tablet quer:

```
ade_  Übersicht │ Aufgaben Notizen │ Projekte Terminals Aufträge Graph      ● Verbunden  Verwalten  ⚙  ☀
Übersicht  Dein Workspace auf einen Blick        Arbeit wechseln  ADE-Betreuung   Neues Projekt  Agent beauftragen  [Neuer Run]  ↻
```

Telefon: Zeile 1 `ade_ … ● Verbunden ⚙ ☀`, Zeile 2 die Räume (scrollbar,
Beschriftungen aus), Werkzeugzeile umbricht: Titel, dann Aktionen.

Graph (PC), leer / laufend / fertig:

```
[Run ▾][läuft][Phase][Repo][Ziel……]  │ Ergebnisse  Bericht  Rückfragen(2)  Draft-PR │ Git-Abgleich  Run löschen │ [Neuer Run]
                                                                                   (leer: nur [Run ▾] und [Neuer Run] + Leerzustand mittig)
┌ Task-Slots 1/4 ▸ ┐
[−][100 %][+][⛶]                       Run-Steuerung │ Orchestrierung starten  Direkt an Teams  Alle pausieren  Alle aktivieren │ Run abbrechen
```

Projekt-Terminal (Tablet), kompakt:

```
Projekt · Gartenplaner   ● Eingabe: Du   Claude Code läuft   Arbeit wechseln  ADE-Betreuung  Sitzung & Workspace  Workspace-Info  Projektbereich ▾  ✕
┌──────────────────────────────── Terminal (volle Höhe) ────────────────────────────────┐
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
[🎙 Sprechen]  Sprechen oder hier tippen …      Verlauf  Links  Anhören  🖼  ⌨
```

## 5. Komponentenregeln

- **Schaltflächen, fünf Gewichte** (PC `.btn*`, Tablet `button.m-*`): normal
  (Rahmen), primär (Kupfer, genau eine je Fläche), leise (Text bis Hover),
  eingeschaltet (Kupferton `--accent-soft`), destruktiv (rot, Rahmen erst im
  bestätigten Zustand). Touch-Ziele 44 px (`--touch`), PC 28 px (`--control-h`).
- **Gruppen** haben `role="group"` und `aria-label`; die sichtbare Beschriftung
  ist `aria-hidden`, damit Screenreader den Namen einmal hören.
- **Navigation** (`src/renderer/nav/AppNav.tsx`): `role="tablist"` mit Namen
  „Bereiche“; Pfeiltasten wandern über alle Räume, Home/End springen; Fokus
  sichtbar innen liegend. Der zugängliche Name eines Tabs ist sein sichtbarer
  Name.
- **Icons** nur zusammen mit Text oder mit `aria-label` und `title`; keine
  Unicode-Glyphen (`□`, `⇲`, `⌗`, `✕`) mehr als Bedienelemente im Graph.
- **Zustandsfarben** ausschliesslich über `--ok/--warn/--bad`; Farbe ist nie
  die einzige Information (Text steht daneben).
- **Dialoge** unverändert: Fokus beim Öffnen, Rückgabe an den Auslöser,
  Fallback wenn der Auslöser verschwindet.

## 6. Zustandsentwürfe

| Zustand | Anzeige | Nächster Schritt in der Meldung |
| --- | --- | --- |
| Verbunden | Kopf: „Verbunden“ (grün). Dialog „Verbindung zum PC“: letzte Bestätigung, Kopplung bleibt bestehen. | – |
| Kurz unterbrochen | Kopf: „Verbinde…“ (Kupfer). Dialog: Daten können veraltet sein, Entwürfe bleiben auf dem Gerät. | Erneut verbinden |
| PC nicht erreichbar | Kopf: „Offline“ (rot). Dialog: Reihenfolge Tailscale → PC/ADE → erneut verbinden; ausdrücklich: **keine neue Kopplung**, Browserspeicher nicht löschen. | Erneut verbinden |
| Anderer Build | Kopf grün, ein Hinweisbanner mit Anleitung (ADE am PC vollständig beenden, neu starten, Seite neu laden). Dialog gleich. | Build-Stand ansehen |
| Gerätefreigabe fehlt | Unverändert an der betroffenen Stelle (`Einstellungen → Verbundene Geräte …`), jetzt mit dem richtigen Menünamen. | Freigabe am PC |
| Persönliche Organisation | Aufgaben/Notizen zeigen die integrierte Organizer-Ansicht mit Leer-, Lade-, Fehler- und Speicherzuständen. | Aufgabe oder Notiz anlegen |
| Eingabehoheit | Unverändert „Eingabe: Du (Tablet)“ / „Eingabe: Desktop“ mit Punkt, jetzt als leiser Text im Kopf. | Eingabe übernehmen |

## 7. Umsetzung auf diesem Branch

| Bereich | Änderung | Dateien |
| --- | --- | --- |
| IA und Wortschatz | Drei Räume, Glossar, deutsche Namen (Übersicht, Aufgaben, Notizen, Aufträge, Einstellungen, Diagnose, Agent beauftragen); Hilfetexte „unter Settings →“ heissen „unter Einstellungen →“. | `shared/appViews.ts`, `shared/appNavigation.ts`, 21 Dateien mit Hilfetexten |
| Navigation | Gemeinsame Komponente für PC und Tablet mit Gruppen, Inline-Beschriftung, Tastaturbedienung. Ersetzt `mode-switch` und `m-view-switch`. | `renderer/nav/AppNav.tsx`, `nav.css` |
| PC-Kopfzeile | Räume · Laufende Arbeit · Verwaltung als benannte Gruppen; Verwaltungsknöpfe leise; Untertitel entfernt. Button-System mit `.btn-primary`/`.btn-danger`. | `renderer/App.tsx`, `app.css`, `theme/tokens.css` |
| Tablet-Kopf und Werkzeugzeile | Kopf wie am PC; Verbindung als Schalter mit Erklärungsdialog; Verwalten und Einstellungen im Kopf; Werkzeugzeile pro Raum mit genau einer Kupfer-Aktion; Satzschreibung statt Versalien. | `mobile/main.tsx`, `mobile/ConnectionStatus.tsx`, `mobile.css`, `terminals.css` |
| Graph | Run-Leiste in Gruppen „Run“, „Ergebnisse“, „Selten und endgültig“ + Hauptaktion; unterer Dock ohne Griff und ohne doppeltes „Neuer Run“, mit Beschriftung „Run-Steuerung“; Task-Slots fest verankert und aufklappbar; Ansicht mit benannten Knöpfen und Zoomstufe; Dock-Panel mit benannten Knöpfen. Gespeicherte Freipositionen (`ade.graph.actionsPos`, `ade.graph.slotsPos`) werden nicht mehr gelesen. | `renderer/graph/GraphView.tsx`, `graph.css` |
| Projekt-Terminal Tablet | „Verlauf“ und „Links“ wandern in den Voice-Strip (verdecken keine Ausgabe); Kopfaktionen leise; Diagnosetext nur bei geöffnetem „Sitzung & Workspace“. | `mobile/TerminalScreen.tsx`, `RemoteTerminalPane.tsx`, `tablet.css` |
| Tests | 30 Treiber/Helfer auf die neuen Namen umgestellt (Tab-Namen ohne „view“, „Einstellungen“, „Diagnose“, „Agent beauftragen“, „Zur hellen Darstellung wechseln“, Reihenfolge der Räume). | `scripts/**` |

### Zusammenführung auf main

Abgeschlossen: deutsche Labels übernommen, beide Organizer-Routen eingehängt,
Platzhalter entfernt, Erinnerungsbanner erhalten und Testselektoren angepasst.
Die gemeinsame Navigation erhält weiterhin ihre gespeicherte Einklappfunktion.
Die Inhalte werden bei Seitenwechsel und Wiederverbindung weiterhin über den
bestehenden Organizer-Cache abgeglichen; API und Geräteschlüssel bleiben bestehen.

## 8. Abnahme

Alle Treiber aus PowerShell gegen den Build dieses Branches (Worktree
`../ade-ui-next-level`, 19. September 2026, 22:40–23:30 CEST). Ein nicht
aufgeführter Treiber wurde für diesen Branch nicht ausgeführt; `pnpm verify`
als Ganzes steht noch aus. Bei der Zusammenführung wurde es auf ausdrücklichen
Nutzerwunsch nicht ausgeführt.

| Prüfung | Ergebnis |
| --- | --- |
| `pnpm typecheck` (node, web, scripts) | bestanden |
| `pnpm build` (Desktop und Mobile) | bestanden |
| `test-work-electron` (Räume-Reihenfolge, Tastatur, kompaktes Fenster) | 20/0 |
| `test-setup-electron` | 38/0 |
| `test-mobile-browser` (Chromium, Telefon; Tastaturnavigation über die Gruppen, Verwalten im Kopf, Einstellungen-Dialog) | 61/0 |
| `test-remote-terminal-electron --tablet-layout-only` | 20/0 |
| `test-remote-terminal-electron --session-navigation-only` | 51/0 |
| `test-remote-terminal-electron --workspace-cli-only` (Projektkopf ein-/ausklappen, Verlauf/Links im Voice-Strip) | 92/0 |
| `test-remote-terminal-electron --project-only` | 28/0 (ein früherer Lauf scheiterte am Grok-Fixture-Start und einmal an der 480-px-Höhe; beides danach behoben bzw. stabil grün) |
| `test-git-sync-electron` | 20/0 |
| `test-profile-session-electron` | 39/0 |
| `test-visual-regression` | 22/0, Inspector-Baselines (win32) neu aufgenommen, weil die Kopfzeile jetzt 48 statt 54 px hoch ist |
| `test-remote-workspace-browser` | 24/0 |
| `test-mobile-electron` | 37/0 |
| `test-remote-restart-electron` | 12/0 |
| `test-project-publish-browser` | 12/0 |
| `test-electron-workflow` | 197/0 |
| `test-cli-work-package` | nicht bewertbar: braucht `dist/win-unpacked/ADE.exe`, das in diesem Worktree nicht gebaut wurde |

Sichtprüfung mit eigenen Screenshots (PC 1440 und 760 px, hell und dunkel, alle
Räume; Tablet 1400/800/390 px aus den Treibern): Kopfzeile in einer Zeile ab
1180 px, zwei Zeilen darunter, keine Aktion ausserhalb des Fensters; Graph mit
Run-Leiste, Run-Steuerung und Ansicht an festen Plätzen; Projekt-Terminal mit
einzeiligem Kopf und unverdeckter erster Ausgabezeile.

Produktänderung aus der Abnahme: Das Terminal-Eingabefeld hält sich nach dem
Fokussieren selbst im sichtbaren Bereich (ein Frame nach dem Layout), weil
bei 480 px Höhe ein späterer Layoutschritt das Feld 15 px unter den Rand
schob.

## 9. Offen für den nächsten Durchgang

- Der Aufgaben-/Notizen-Inhalt ist eingehängt. Die bestehenden Speicherzustände
  aus dem Briefing („Auf diesem Gerät gespeichert“, „Mit PC abgeglichen“,
  „Übertragung ausstehend“, „Zwei Versionen vorhanden“) mit `--ok/--warn/--bad`
  darstellen.
- Link-Dialog: Zielart „Projektoberfläche“ / „API“ anzeigen, sobald ein
  Projekt sie hinterlegt (UX-09); heute nur Adresse und lokaler Hinweis.
- Kontrast- und Zoommessung der kleinen Stufen (11–12 px) auf realen Geräten
  (UX-11); dieser Branch verändert Grössen nicht nach unten.
- Menü „Verwaltung“ als echtes Aufklappmenü auf dem PC erst, wenn die
  Kopfzeile bei 760 px trotz Gruppen zu voll wird; heute passt sie.

## 10. Dichte-Pass am PC (20. September 2026)

Dritter Durchgang nach Calm Pass und Räumen, wieder mit eigenen Screenshots
(Fixture-Profil, 1440/860 px, hell und dunkel, Tablet 1280/390 px). Befund:
Die Räume Projekte, Aufträge und Aufgaben/Notizen sowie der eingebettete
Block „CLI-Arbeit“ benutzten am PC noch Tablet-Masse (44-px-Controls, 16–23-px
Überschriften, gerahmte Karten), und der neue Knopf „Gespräche“ brach die
Kopfzeile bei 1440 px auf zwei Zeilen. Palette, Schriftrollen und Räume bleiben.

| Bereich | Änderung | Dateien |
| --- | --- | --- |
| Kopfzeile | Einzeilig bis 1000 px: Gruppenbeschriftungen ab 1440 px, Raum-Icons ab 1260 px ausgeblendet (nur PC; Tablet behält 1180/760). Darunter zwei saubere Zeilen: Logo + Räume, dann laufende Arbeit + Verwaltung. Gemessen bei 1440 px: 1367 px statt 1723 px. | `app.css`, `nav/nav.css` |
| Dichte | Alle PC-Räume mit `--control-h` (28 px), Raumtitel 20 px, Abschnittstitel 12 px leise, Zeilen mit Haarlinien statt Karten, genau eine Kupfer-Aktion je Fläche. | `work.css`, `cli-work.css`, `projects.css`, `organizer.css` |
| Projekte | Kopfzeile mit Titel und den zwei Wegen zum Hinzufügen (Ordner = normal, „Neues Projekt“ = Kupfer, öffnet ein Inline-Formular statt `<details>`); Werkzeugzeile Suche · Segment „Alle / Meine ADE Projekte“ · Aktualisieren leise; Hilfetexte als leise Zeilen; Karten bleiben, weil jede eine Wahl ist. | `ProjectsView.tsx`, `ProjectDirectory.tsx`, `projects.css` |
| Aufträge | Filter als eine Zeile; Agenten als leise Liste wie im Rail; „CLI-Arbeit“ und „Managed Runs“ als gleichrangige Abschnitte; Runs als Zeilen mit Kupfer-Inset bei Auswahl. | `work.css` |
| Aufgaben / Notizen | PC-Regeln nur unter `.shell > .organizer` (Tablet unverändert): Kopf 20 px, Synchronisieren leise, Ansichts-Chips leise mit Kupferton, Einträge als Zeilen. | `organizer.css` |
| Übersicht | „Übersicht aktualisieren“ (statt „Overview“) und Zeilenaktionen als Text bis Hover; CLI-Arbeit-Block in derselben Skala wie die anderen Abschnitte. | `overview.css`, `messages.de.ts` |
| Inspector | Tabs in der Oberflächensprache: **Repository · Änderungen · Dateien**. Der erste Tab heisst bewusst nicht „Übersicht“, weil der Raum so heisst und `getByRole('tab', { name: 'Übersicht' })` in 21 Treibern sonst zwei Treffer hätte. | `RightPanel.tsx`, `messages.*.ts` |
| Einstellungen | Tabs als Unterstreichung wie im Inspector; Darstellung/Inspektor als Segment-Control; Sprach-Select und Stimme-Controls in PC-Höhe; Projektstart-Formular ohne gestreckten Knopf. | `settings.css`, `speech-preference.css` |
| Einrichtung | Schritte als unterstrichene Reihe (echte Sequenz); „Zu den Projekten“ nicht mehr Kupfer, damit die Aktion des Schritts die einzige ist; CLI-Liste flach. | `setup.css`, `SetupModal.tsx` |
| Diagnose | Flach mit Haarlinien statt Karten; Zusammenfassung ein übersetzter Satz („1 von 4 konfigurierten Laufzeiten bereit“). | `diagnostics.css`, `DiagnosticsModal.tsx` |
| Tablet | Terminal-Rail: gewählte Zeile als Kupferton mit Inset statt gefüllter Kupferblock. Raum Terminals: „Terminal öffnen“ in der Werkzeugzeile ist normal gerahmt; die Kupfer-Aktion ist „Leeres Terminal öffnen“ im Startbereich, dort wo das Terminal erscheint. Das Aktionsinventar in Abschnitt 3 gilt entsprechend. | `mobile/terminals.css`, `mobile/main.tsx` |
| Einstellungen (Text) | Hilfetext „Mobiler Zugriff“ von acht auf drei Sätze gekürzt (de/en, gleicher Schlüssel). | `messages.de.ts`, `messages.en.ts` |

Abnahme aus PowerShell gegen den Build vom 20. September, 15:00–15:20 CEST:
`pnpm typecheck` bestanden, `pnpm build` bestanden, `test-setup-electron` 38/0,
`test-organizer-electron` 15/0, `test-work-electron` 20/0,
`test-visual-regression` 22/0 mit neu aufgenommenen Inspector-Baselines
(Tab-Beschriftung geändert). Drei Treiber suchten noch die englischen Labels
von vor dem Sprach-Commit `9a38dd6` („Status“, „Repository for new session“,
„Show CI checks …“); sie wurden auf die deutschen Labels umgestellt. Nachtrag
(Tablet-Terminals, Hilfetext, Projekte-Kopfzeile mit Gruppe „Einzelnes Projekt
freigeben“): `test-remote-terminal-electron --tablet-layout-only` 20/0,
`test-mobile-browser` 61/0 (fünf Selektoren auf deutsche Labels umgestellt),
`test-setup-electron` 38/0. Nicht bestanden: `test-electron-workflow` scheitert
im ersten Check an `Categories and agents`; der Treiber hängt seit dem
Sprach-Commit an englischen Labels, 50 davon sind hier bereits übersetzt, der
Rest bleibt Folgearbeit. `pnpm verify` als Ganzes nicht ausgeführt.

Nachtrag gleicher Tag: Tablet-Terminals mit einer Kupfer-Aktion und der
gekürzte Hilfetext sind umgesetzt (Zeilen oben); Prüfung siehe
[STATUS.md](STATUS.md).
