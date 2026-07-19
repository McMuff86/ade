# ADE Design-Review — 2026-07-19

Grundlage: Screenshots des Produktions-Builds (Dark/Light, Terminals- und
Graph-Modus, Sidebar-Baselines aus `scripts/fixtures/visual-baselines/win32`,
"Neuer Run"-Dialog), plus `src/renderer/theme/tokens.css`,
`theme/themes.ts` und die Panel-Stylesheets. Dieses Dokument bewertet den
Ist-Zustand und priorisiert Vorschläge; es ändert selbst nichts.

## Was heute trägt

- **Eine warme Stimme:** Der Kupfer-Akzent (`--accent`) auf warmem
  Nahe-Schwarz bzw. Papiergrund ist eine echte, konsistent durchgezogene
  Identität — kein Template-Look. Das Light-Theme ist bewusst keine
  Invertierung, sondern dieselbe Hue-Familie auf Papier. Behalten.
- **Mono-first als Haltung:** Ein Terminal-Produkt, das durchgehend in einer
  Code-Schrift spricht, wirkt glaubwürdig. Die Wortmarke `ade_` ist klein,
  aber eigen.
- **Ruhe als Prinzip:** Die neue Progressive-Disclosure-Linie (Scope-Aktionen
  hinter `⋯`, Checks on demand, nur entscheidungsrelevante Farben) gibt der
  Sidebar ein klares Rauschbudget. Die Graph-Empty-State ist vorbildlich:
  eine Aussage, eine primäre Aktion.
- **Zustände existieren:** Loading/Empty/Error/Offline sind überall
  unterschieden und fail-closed formuliert — das ist selten und wertvoll.

## Befunde und Vorschläge

### Quick Wins (klein, sichtbar) — umgesetzt am 2026-07-20

1. **Light-Theme: Terminal behält einen harten schwarzen Rahmen.** ✔ Behoben.
   Tatsächliche Ursache: `@xterm/xterm/css/xterm.css` malt den
   `.xterm-viewport` mit `#000` und gewann durch Bundle-Reihenfolge gegen
   ADEs gleichspezifischen `transparent`-Override; der schwarze Viewport
   schien durch das `.xterm`-Padding als Ring. Fix: Drei-Klassen-Selektor
   (`.terminal-host .xterm .xterm-viewport`) gewinnt deterministisch;
   gleicher Fix für den Graph-Dock (`.gdockpanel-term`). Ein struktureller
   Playwright-Check hält alle Terminal-Flächen im Light-Theme auf `--bg`/
   transparent.
2. **Scope-Header-Select läuft unter den Dropdown-Pfeil.** ✔ Behoben:
   `padding-right: 20px` + `overflow: hidden` + `text-overflow: ellipsis`.
3. **Theme-Toggle bleibt ein Platzhalter.** ✔ Umgezogen: Die bewusste
   Theme-Wahl ("Darstellung": Dunkel/Hell) lebt jetzt in der Settings-Seite;
   im Header bleibt ein Icon-Schnellumschalter (☀/☾) mit sprechendem
   aria-label.

### Strukturell (Typografie, Farbe, Sprache)

4. **Sprachmix DE/EN vereinheitlichen.** Graph-Modus und Run-Dialog sprechen
   Deutsch ("Neuer Run", "Ersten Run erstellen"), Rail/Sidebar/Dialoge
   Englisch ("Add agent", "Open new session", "Select a repository").
   Empfehlung: ein zentrales Strings-Modul (auch ohne echtes i18n) und eine
   bewusste Entscheidung für eine Produktsprache; der Mix wirkt derzeit
   unfertig und macht Copy-Reviews unmöglich.
5. **Zweite Schriftstimme für Fließtext.** Alles ist `--mono`, auch
   mehrzeilige Erklärtexte (Dialog-Beschreibungen, Notices, Empty-States).
   Mono bleibt die Signatur für Daten, IDs, Pfade, Terminals und Zahlen;
   Fließtext ab ~2 Zeilen wechselt auf `--sans`. Das hebt die Datenflächen
   erst richtig hervor und verbessert Lesbarkeit in Dialogen deutlich.
6. **Typo-Skala als Tokens.** Im CSS leben ad hoc 8.5/9/9.5/10/10.5/11/
   11.5/12/12.5/13/16 px. Empfehlung: 5–6 Stufen als Custom Properties
   (`--fs--1` … `--fs-4`) plus definierte Gewichte; bestehende Werte darauf
   mappen. Das diszipliniert künftige Features von allein.
7. **Akzent entlasten, Warnfarbe einführen.** Kupfer ist heute gleichzeitig
   Interaktions- (aktiver Tab, primärer Button, Links) und Warnstimme
   (Divergenz, review-required, Lease). Empfehlung: `--warn` als eigenes
   Token (im Dunkeln ein kälteres Amber, auf Papier ein tieferes Ocker),
   Kupfer ausschließlich für Interaktion/Identität. Dann liest sich "↑1 ↓0"
   eindeutig als Zustand, nicht als Link.
8. **Kontrast-Audit für `--faint`.** Dark: `#4A505A` auf `#15171C` ≈ 2:1;
   Light: `#9A9285` auf `#EAE5DA` ≈ 2.4:1. Viele Metadaten (PR-/Commit-Meta,
   Section-Untertitel) hängen an faint und unterschreiten AA deutlich;
   `--muted` liegt im Light-Theme bei ~4:1 knapp darunter. Empfehlung:
   faint nur noch für echte Dekoration (Trennzeichen, Eyebrows), Metadaten
   auf muted heben, muted im Light-Theme einen Tick abdunkeln. Passt zum im
   Handoff bereits geplanten Accessibility-Budget.

### Produktebene (Flows)

9. **"Neuer Run"-Dialog entzerren.** Der Dialog ist lang und mischt häufige
   Entscheidungen (Name, Ziel, Orchestrator, Repository, Teilnehmer) mit
   seltenen (Budgets). Gleiche Philosophie wie in der Sidebar: Budgets in
   eine kompakte Offenlegung. Dazu die bereits geplanten Punkte: explizite
   **Harness-Wahl** pro Run/Teilnehmer (heute nur ein statisches "Codex"
   rechts) und eine **Repo-Pfad-Zeile** unter der Repository-Auswahl.
10. **Leeres Zentrum als Start-Surface.** Ohne Session ist die Mitte eine
    große leere Fläche mit einem 12-px-Hinweis. Die im Inspector-Plan
    dokumentierte Richtung (zuletzt genutzte Repositories, wiederaufnehmbare
    Runs, eine primäre Aktion) ist der größte einzelne UX-Hebel für den
    Ersteindruck.
11. **Changes-Tab mit entscheidungsrelevantem Zähler.** Die Tabs Overview/
    Changes/Files sind gleichwertig beschriftet; ein kleiner Badge am
    Changes-Tab nur bei >0 geänderten Dateien wäre konsistent mit dem
    Prinzip "nur Entscheidungen leuchten".
12. **Trefferflächen für die mobile Zukunft.** Graph-Zoom (+/−/□), `⋯`,
    Tab-Schließkreuze liegen unter 44 px. Solange Desktop-only ist das ok;
    mit dem geplanten Mobile-Host lohnt ein Interaktionsflächen-Pass.

### Signatur (der eine bewusste Risiko-Vorschlag)

13. **„Beweiskette" als visuelles Motiv.** ADEs Alleinstellung ist nicht der
    Chat, sondern die verifizierbare Kette Repository → Run → Verifikation →
    Publication → PR → CI. Vorschlag: eine dünne Kupferlinie als
    wiederkehrendes Kettenmotiv — im Graph verbindet sie die Phasen eines
    Runs, im Inspector trägt das `ADE run`-Badge ein Kettenglied-Glyph, im
    Publikations-Dialog zeichnet sie die Attest-Schritte nach. Ein Motiv,
    überall sparsam eingesetzt, macht das Produktversprechen sichtbar und
    ist die Art Wiedererkennbarkeit, die kein generisches Agent-Dashboard
    hat.

## Priorisierung

1. Quick Wins 1–3 (ein kleiner Slice, sofort sichtbare Qualität).
2. Sprache (4) und Schriftstimmen/Skala (5, 6) als Fundament vor weiteren
   UI-Features.
3. Warn-Token + Kontrast (7, 8) zusammen mit den geplanten
   Accessibility-Budgets.
4. Run-Dialog (9) gemeinsam mit Harness-Wahl/Settings/Repo-Pfad, Start-
   Surface (10) als eigener Slice, danach 11–13.
