# Sprachsteuerung im Terminal — nahtlos statt modal

Stand: 16. September 2026. Analyse des Tablet-Frontends (`src/mobile`) und der
geteilten Sprachkomponenten (`src/renderer/terminal/PromptComposer.tsx`,
`ComputerVoiceTest.tsx`, `ReplySpeechButton.tsx`) mit Blick auf die Frage:
*Wie fühlt sich Diktieren und Sprechen an, wenn ein Terminal offen ist?*
Grundlage sind der Code auf `main` (ed4d74b plus Arbeitsbaum) und die
Screenshots der heutigen Testläufe in `test-results/dictation/` und
`test-results/remote/`. Abschnitte 1–6: Analyse und Vorschlag; Abschnitt 8:
Stand der Umsetzung von Phase 1.

## 1. Was heute passiert: ein Sprach-Durchgang auf dem Tablet

Ausgangslage: Projekt-Terminal mit Codex ist offen, Eingabe liegt beim Tablet.
Der Benutzer will eine Aufgabe sprechen, das Ergebnis sehen und es sich
vorlesen lassen. So läuft das gegenwärtig ab:

| Schritt | Aktion | Was im Vordergrund steht |
| --- | --- | --- |
| 1 | **Prompt / Diktat** oben rechts in der Kopfzeile antippen | Modal *Prompt und Diktat* legt sich über das Terminal; das Terminal ist abgedunkelt und nicht mehr lesbar |
| 2 | Im Modal nach unten scrollen | Bei 1024 × 768 (Landscape) liegen **Diktieren** und **Aufnahme stoppen** unterhalb des sichtbaren Bereichs (`tablet-live.png`); der Computer-Kasten und drei Absätze Hilfetext stehen davor |
| 3 | **Diktieren** antippen, sprechen | Live-Text erscheint in der Textarea; Stopp-Knopf weiterhin unter dem Falz |
| 4 | **Aufnahme stoppen** | Status „Audio wird transkribiert…“ |
| 5 | Text lesen, **An CLI absenden** | Absatz-Hinweis „An die CLI übergeben. Die Verarbeitung … noch nicht bestätigt.“ |
| 6 | Modal schliessen (✕) | Erst jetzt ist das Terminal wieder sichtbar |
| 7 | Terminal beobachten | — |
| 8 | **Antwort anhören** (schwebt unten links *über* der Terminalausgabe) | Zweites Modal *Antwort anhören*: Umfang-Select, zwei Hilfeabsätze, Sprechtext, Anhören/Stoppen |
| 9 | **Schliessen** | zurück zum Terminal |
| 10 | nächster Durchgang: zurück zu Schritt 1 | — |

**Sieben Tipps, zwei bis drei Modale, null Sekunden, in denen Sprache und
Terminal gleichzeitig sichtbar sind.** Genau das erzeugt das Gefühl von
„nicht seamless“: Sprechen ist ein Ort, das Terminal ein anderer, und man
pendelt.

Der Desktop hat dieses Problem nicht: dort ist derselbe `PromptComposer` als
**seitliches Dock** neben dem Terminal montiert (`DesktopPromptDialog`,
`.desktop-prompt-panel`). Das Tablet-Modal ist also die Ausnahme, nicht die
Regel, und der Vertrag (`PromptComposerPort`) ist bereits so gebaut, dass die
Hülle austauschbar ist.

## 2. Diagnose: fünf Hierarchie-Fehler, kein Layout-Fehler

1. **Der Sprachweg liegt hinter einem Modal.** Ein Modal sagt „unterbrich, was
   du tust“. Diktieren ist aber genau das, was der Benutzer gerade tut; das
   Terminal ist der Kontext, nicht die Ablenkung. Während der Aufnahme sieht
   man weder, was die CLI gerade zeigt, noch ob der Prompt-Editor überhaupt
   offen ist.
2. **Drei Sprachfunktionen, drei Oberflächen.** Diktat (Modal 1), Computer-Test
   (Kasten im Modal 1), Antwort anhören (Modal 2 mit eigenem Look, eigenem
   Radius 14 px, eigenen Fallback-Farben `#20252d`/`#8cc8ff`, die nicht aus
   `tokens.css` stammen). Für den Benutzer ist das *eine* Tätigkeit:
   mit dem Terminal sprechen.
3. **Erklärtext vor Handlung.** Im Modal stehen vor dem ersten Knopf, den man
   wirklich braucht, der Computer-Kasten mit drei Zeilen, ein Absatz zu
   Anmeldung/Projektvertrauen, das Label, die Textarea und darunter noch drei
   Zeilen zu Speicherung, Dauer und ElevenLabs. Alles wahr, alles bei jedem
   Öffnen erneut. Die Handlung (**Diktieren**) ist der letzte sichtbare Block.
4. **Gleichgewichtete Knöpfe.** Diktieren, Aufnahme stoppen, Abbrechen, In CLI
   einfügen, An CLI absenden, Entwurf kopieren, Entwurf löschen, Computer
   testen, Begrüssung abspielen: neun umrandete Knöpfe derselben Gewichtung.
   Kein Knopf sagt „ich bin der, den du beim Sprechen brauchst“.
5. **Statuszeile ohne Hierarchie.** „Terminal verbunden · Codex läuft ·
   Terminal offen · Eingabe: Du (Tablet)“ sind vier Aussagen für einen
   Zustand („du sprichst mit Codex“). Daneben der Mono-Pill
   „CLI · API-Zugang vorhanden“, dann zwei Text-Knöpfe. Die Zeile ist 11 px,
   der Sprachknopf darin ist der unauffälligste Eintrag.

Zwei Nebensachen, die auf dem Tablet auffallen: **Antwort anhören** ist
`position: absolute` unten links *im* Terminal und verdeckt Ausgabezeilen;
und der Fokus-Bar hat sieben Elemente (Sitzung öffnen mit, CLI öffnen,
Workspace einblenden, Schriftgrösse, Branch-Info, Eingabe freigeben, Sitzung
beenden), die alle beim Sprechen irrelevant sind.

## 3. Gestaltungsentscheid

Das Terminal ist der Held (so steht es im [UI Calm Pass](UI_CALM_PASS.md)).
Sprache muss *am* Terminal stattfinden, nicht *vor* ihm. Deshalb:

- **Farbe:** unverändert. Kupfer bleibt die einzige Stimme; im Sprachmodus ist
  **genau ein** Element kupfern: der Sprechknopf. Die Aufnahme bekommt keinen
  Rot-Punkt und kein zweites Signal; ein pulsierender Kupferring am Knopf
  genügt (bei `prefers-reduced-motion` ein statischer, breiterer Ring).
- **Schrift:** Sans für alles Chrome, Mono ausschliesslich für Terminal und
  den diktierten Entwurf. Der Entwurf ist maschinennaher Text, der ins
  Terminal geht; Mono macht das sichtbar. Hilfetexte nicht unter 12 px.
- **Layout:** eine **Sprachleiste** am unteren Rand des Terminals, im Fluss,
  nicht schwebend. Sie ist immer da, solange ein CLI-Terminal offen ist und
  die Eingabe beim Tablet liegt. Sie wächst nur, wenn sie Inhalt hat.
- **Prinzip:** Ein Durchgang = Sprechen → Sehen → Senden → Hören, ohne die
  Fläche zu wechseln. Jeder Zustand steht in *einem* Wort in der Leiste,
  nicht in einem Absatz. Erklärungen gehören in ein einmaliges
  Onboarding oder ins `⋯`-Menü, nicht in den Arbeitsfluss.

Geprüft gegen den generischen Standard: Eine „Chat-Eingabezeile mit Mikro
rechts“ wäre die Default-Antwort. Sie passt hier nicht, weil der Text nicht
an ein Modell, sondern an ein *Terminal* geht und der Benutzer ihn vor dem
Senden lesen muss. Darum ist der Entwurf ein eigener, lesbarer Mono-Block
über den Knöpfen und die Sprechtaste steht **links**, wo auf dem Tablet
im Querformat der Daumen liegt; Senden steht rechts als bewusste
Gegenbewegung.

## 4. Vorschlag: die Sprachleiste

### 4.1 Querformat (Galaxy Tab S10 Ultra, ca. 1480 × 924 CSS-px)

```text
┌────────────────────────────────────────────────────────────────────────────────┐
│ ADE · main · Codex                       ● Eingabe: Tablet     ⋯   ✕            │  40 px, eine Zeile
├────────────────────────────────────────────────────────────────────────────────┤
│                                                                                │
│   Terminal (xterm), nimmt den ganzen Raum zwischen Kopf und Leiste             │
│                                                                                │
│                                                                                │
│                                                                                │
├────────────────────────────────────────────────────────────────────────────────┤
│ ┃ Bitte prüfe den Code im Ordner src/mobile und                                │  Entwurf: Mono, 1–4 Zeilen,
│ ┃ fasse die Fehler zusammen.▏                                                  │  wächst mit dem Text
│                                                                                │
│  (◉) Hört zu · 0:12      Einfügen   Senden ▸        ▷ Anhören     ⌨   ⋯        │  Leiste 56 px
└────────────────────────────────────────────────────────────────────────────────┘
```

- **(◉)** ist der Sprechknopf, 56 × 56 px, Kupfer. Ein Tipp startet, derselbe
  Tipp stoppt. Sein Zustand steht daneben als ein Wort plus Zähler:
  `Sprechen` → `Hört zu · 0:12` → `Wird erkannt…` → `Sprechen`.
- Der **Entwurf** steht direkt über der Leiste, mit Kupfer-Balken links
  (▏ = live, noch veränderbar; ohne Balken = fertig). Er ist eine normale
  Textarea; Tippen öffnet die Tastatur, der bestehende
  `m-keyboard-compact`-Modus greift wie heute.
- **Einfügen** und **Senden** sind die einzigen anderen aktiven Knöpfe. Senden
  ist „quiet“ (ohne Rahmen bis Hover), aber mit Pfeil; nach dem Senden wird
  der Entwurf geleert, die Leiste zeigt für zwei Sekunden `Übergeben ✓` und
  fällt dann auf eine Zeile zusammen. Kein Absatz-Hinweis mehr.
- **▷ Anhören** sitzt rechts in der Leiste statt schwebend im Terminal. Es
  öffnet kein zentriertes Modal, sondern klappt die Leiste nach oben zu einem
  Sheet (siehe 4.4).
- **⌨** öffnet die Terminaltastatur (heute „Tastatur“); die Sondertasten
  Enter/Tab/Esc/Ctrl+C/Pfeile rutschen in eine zweite Zeile, die nur bei
  offener Tastatur erscheint, wie heute schon in `m-keyboard-compact`.
- **⋯** enthält alles, was heute im Modal steht, aber nicht zum Sprechen
  gehört: Entwurf kopieren, Entwurf löschen, Computer testen, im grossen
  Editor öffnen (= das heutige Modal, als Fallback für lange Texte),
  Hinweise zu Aufnahmedauer und ElevenLabs.

Zusammengeklappt, ohne Entwurf, ist die Leiste eine Zeile:

```text
├────────────────────────────────────────────────────────────────────────────────┤
│  (○) Sprechen                                       ▷ Anhören     ⌨   ⋯        │  56 px
└────────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Hochformat (924 × 1480)

Gleiche Leiste, gleiche Reihenfolge. Der Entwurf darf bis 30 % der Höhe
wachsen und scrollt danach intern. Mit offener Tastatur (`--tablet-height`
schrumpft) bleibt die Leiste über der Tastatur und das Terminal behält
mindestens 120 px, wie es `m-keyboard-compact` heute schon erzwingt.

### 4.3 Zustände des Sprechknopfs

| Zustand | Knopf | Wort daneben | Was sonst passiert |
| --- | --- | --- | --- |
| Bereit | Kupferring, leer | Sprechen | — |
| Mikrofon | Ring pulsiert langsam | Mikrofon… | nur bis Freigabe |
| Hört zu | gefüllt, Ring pulsiert | Hört zu · m:ss | Entwurf zeigt Live-Text mit Balken, `readonly` |
| Erkennt | gefüllt, Ring statisch | Wird erkannt… | Balken bleibt |
| Bereit mit Text | Kupferring | Sprechen | Senden/Einfügen aktiv |
| Sendet | ausgegraut | Übergeben… | Senden gesperrt |
| Übergeben | Häkchen 2 s | Übergeben | Entwurf leer, Leiste fällt zusammen |
| Nicht möglich | grau, durchgestrichen | Grund in 3–6 Wörtern (`Eingabe beim PC`, `Kein CLI-Prompt`, `Offline`) | Tipp auf das Wort zeigt die heutige lange Erklärung |

Das ersetzt die heutigen `role="status"`-Absätze im Modal („Mikrofon wird
angefragt…“, „Audio wird transkribiert…“, „Live-Transkription · Zwischenstand
– Wörter können sich noch ändern“) durch ein Wort am Ort der Handlung.
Die ARIA-Live-Region bleibt; sie wird nur kürzer.

### 4.4 Antwort anhören als Sheet statt Modal

```text
├────────────────────────────────────────────────────────────────────────────────┤
│  Sichtbarer Ausschnitt · Kurz ▾                                      Schliessen│
│  Die Tests sind durchgelaufen. Zwei Dateien wurden geändert. Der nächste       │  Sprechtext, Sans, max. 6 Zeilen
│  Schritt wäre ein Commit.                                                      │
│  (▶) Liest vor · 0:04                                        Erneut   Stoppen  │
└────────────────────────────────────────────────────────────────────────────────┘
```

- Das Sheet nimmt den Platz der Leiste ein und schiebt das Terminal nach
  oben, statt es zu überdecken. Man sieht weiter, was die CLI tut.
- Die Umfangwahl „Kurz / Alles“ wird ein Segment-Control in der Kopfzeile des
  Sheets statt eines `<select>` mit Label.
- Die zwei Hilfeabsätze („Ein kurzer Auszug … Keine KI-Zusammenfassung.
  Codeblöcke werden ausgelassen. Der Sprechtext wird an ElevenLabs
  gesendet.“) wandern hinter ein `ⓘ` in der Sheet-Kopfzeile. Beim ersten
  Öffnen pro Gerät steht der Satz einmal sichtbar unter dem Sprechtext.
- `reply-speech.css` übernimmt die Tokens aus `tokens.css`; die eigenen
  Fallbacks (`#20252d`, `#8cc8ff`, `#566`) entfallen.

### 4.5 Computer als Einstieg, nicht als Kasten

Der Computer-Test ist heute ein eigener Kasten *über* dem Entwurf, den jeder
sieht, der nur diktieren will. Vorschlag:

- **Langes Drücken** auf den Sprechknopf (oder `⋯ → Computer rufen`) startet
  den Computer-Modus. Die Leiste zeigt `Sage „Computer“` mit dem gleichen
  pulsierenden Ring; nach der Begrüssung geht sie ohne weiteren Tipp in
  `Hört zu` über. Damit wird die Begrüssung („Wähle nach dieser Begrüssung
  ‚Diktieren‘ …“) zur Handlung statt zur Anweisung: der Benutzer muss nichts
  mehr wählen.
- Der Begrüssungstext erscheint als Sheet wie in 4.4, mit **Erneut** statt
  „Begrüssung abspielen“.
- Die 20-Sekunden-Grenze und die Bedingung „Fenster offen lassen“ bleiben;
  sie stehen als kurze Zeile im Sheet, nicht dauerhaft in der Leiste.

Das ändert nichts am Vertrag von [Goal 33.0](VOICE_COMPANION_PROPOSAL.md):
kein Hintergrund-Mikrofon, keine Sprachaktionen, der Prompt bleibt
unverändert. Es ändert nur, wo der Einstieg liegt.

### 4.6 Kopfzeile und Fokus-Bar im Sprachfluss

- Statuszeile auf **eine** Aussage reduzieren: `● Eingabe: Tablet` (grün) oder
  `○ Eingabe: PC` (grau) oder `Offline`. „Terminal verbunden“, „Terminal
  offen“ und „Codex läuft“ verschwinden als Text; der CLI-Name steht schon
  im Titel. Der Mono-Pill „CLI · API-Zugang vorhanden“ bleibt nur, wenn er
  etwas Handlungsrelevantes sagt (`Anmeldung unbestätigt`), sonst nicht.
- **Sitzung & Workspace** bleibt der Schalter für den Fokus-Bar. Standard
  bei offener CLI-Sitzung: **eingeklappt**. Heute ist er per
  `terminal-controls-expanded` standardmässig offen und zeigt sieben
  Elemente, die beim Sprechen nicht gebraucht werden.
- **Prompt / Diktat** als Knopf entfällt; die Leiste *ist* der Zugang.

### 4.7 Wortwahl

| Heute | Vorschlag | Warum |
| --- | --- | --- |
| Prompt / Diktat | (entfällt) bzw. „Sprechen“ | Der Benutzer spricht; „Prompt“ ist Systemsprache |
| Diktieren / Aufnahme stoppen · 12 s | Sprechen / Hört zu · 0:12 | ein Knopf, zwei Zustände |
| An CLI absenden | Senden | Ziel steht im Titel; „CLI“ ist Systemsprache |
| In CLI einfügen | Einfügen | dito |
| Antwort anhören | Anhören | in der Leiste ist der Kontext klar |
| Computer testen | Computer rufen | „testen“ klingt nach Diagnose |
| Begrüssung abspielen | Erneut | gleiches Wort wie beim Vorlesen |
| „An die CLI übergeben. Die Verarbeitung durch das Modell ist damit noch nicht bestätigt.“ | Übergeben ✓ (2 s) | Der Benutzer sieht das Terminal; er braucht keinen Absatz |
| „Vor der Übergabe Anmeldung und Projektvertrauen direkt im Terminal abschliessen. Die CLI muss ihren Eingabeprompt anzeigen.“ | nur wenn `capability.available === false`: „Kein CLI-Prompt“ mit Tipp-Erklärung | Erklärung erst, wenn sie zutrifft |

Die Sicherheitsaussagen (Audio geht an ElevenLabs, Aufnahme höchstens fünf
Minuten, Entwurf bleibt auf diesem Gerät) bleiben erreichbar: einmal beim
ersten Sprechen pro Gerät als Hinweiszeile unter der Leiste, danach unter
`⋯ → Hinweise`.

## 5. Umsetzungsskizze

Keine neuen IPC-Kanäle, keine Änderung an `PromptComposerPort`,
`ReplySpeechPort`, Diktat-Tickets, Idempotenz oder Freigaben.

| Bereich | Änderung | Dateien |
| --- | --- | --- |
| Composer-Logik | `PromptComposer` in einen Hook `usePromptComposer(port, draftKey)` und eine Darstellung trennen. Der Hook enthält Aufnahme, Recovery, Senden, Entwurf; die heutige Darstellung bleibt für Desktop-Dock und Grosseditor. | `renderer/terminal/PromptComposer.tsx` |
| Sprachleiste | Neue Darstellung `VoiceStrip` (geteilt, damit der Desktop sie später ebenfalls unter dem Terminal nutzen kann). Zustände aus 4.3, Entwurf-Textarea, Einfügen/Senden, Anhören, ⌨, ⋯. | neu `renderer/terminal/VoiceStrip.tsx`, `voice-strip.css` |
| Tablet-Terminal | `MobilePromptDialog` nicht mehr per Knopf öffnen; Leiste unter `TerminalScreen` montieren, `m-terminal-composer` („Text verfassen“) und die schwebende `m-terminal-read-reply` entfernen. Grosseditor über ⋯. Fokus-Bar standardmässig eingeklappt bei laufender CLI-Sitzung. | `mobile/RemoteTerminalPane.tsx`, `mobile/TerminalScreen.tsx`, `mobile/tablet.css` |
| Statuszeile | Eine Aussage statt vier; Pill nur bei Handlungsbedarf. | `mobile/RemoteTerminalPane.tsx` (`statusBar`) |
| Antwort anhören | Dialog zu Sheet in der Leiste; Segment-Control; Tokens statt Fallbacks. | `renderer/terminal/ReplySpeechButton.tsx`, `reply-speech.css` |
| Computer | Einstieg per langem Drücken / ⋯; Übergang Begrüssung → Hört zu. | `renderer/terminal/ComputerVoiceTest.tsx` |
| Tests | Rollen/Namen anpassen: `Prompt / Diktat`, `Diktieren`, `Aufnahme stoppen`, `An CLI absenden`, `Antwort anhören`, `Computer testen` werden in `test-dictation-electron.ts`, `helpers/computerVoiceFlow.ts`, `test-reply-speech.ts` referenziert. Neue Prüfungen: Leiste bei 1024 × 768 und 924 × 1480 ohne Scrollen vollständig sichtbar; Terminal bleibt während `Hört zu` sichtbar (≥ 40 % Höhe); Sheet überdeckt das Terminal nicht. | `scripts/…` |

Reihenfolge, die den grössten Effekt zuerst bringt:

1. **Leiste statt Modal** (Composer-Hook, VoiceStrip, Montage im Tablet-
   Terminal, Statuszeile, Fokus-Bar eingeklappt). Das ist der Schritt, der
   das Pendeln beendet.
2. **Anhören als Sheet** in der Leiste, schwebenden Knopf entfernen.
3. **Computer als Einstieg** mit Übergang in `Hört zu`.
4. Desktop-Dock optional auf dieselbe Leiste umstellen, damit PC und Tablet
   denselben Ort für Sprache haben.

Was bewusst *nicht* Teil dieses Vorschlags ist: automatisches Vorlesen nach
Antwortende, Stopp-Wort, Hintergrund-Mikrofon. Dafür gelten weiterhin die
Bedingungen aus [Goal 33.2/33.3](VOICE_COMPANION_PROPOSAL.md).

## 6. Abnahme, wie sie ein Benutzer erlebt

Playwright auf dem Tablet-Bundle wie in `test-dictation-electron.ts`, aber
mit den Fragen eines Benutzers:

- Nach dem Öffnen einer Codex-Sitzung ist der Sprechknopf ohne Scrollen
  sichtbar und mit einem Tipp erreichbar (1024 × 768 und 924 × 1480).
- Während `Hört zu` sind Terminal, Live-Text und der Stopp im selben
  Bildausschnitt; kein Element liegt unter dem Falz.
- Nach **Senden** ist die Terminalausgabe sofort sichtbar, ohne Schliessen.
- **Anhören** verdeckt keine Terminalzeile.
- Ein vollständiger Durchgang Sprechen → Senden → Anhören braucht höchstens
  vier Tipps und keine Modale.
- Tastatur offen: Leiste bleibt über der Tastatur, Terminal ≥ 120 px.
- Escape/Fokus: Schliessen des Sheets gibt den Fokus an den Sprechknopf
  zurück; `⋯`-Menü ist per Tastatur erreichbar.
- Reduced motion: kein pulsierender Ring, Zustand trotzdem erkennbar.

## 7. Entscheidungen (Adi, 16. September 2026)

1. Sprechknopf **links**, Senden rechts.
2. **Einfügen** bleibt in der Leiste, quiet.
3. Grosseditor bleibt als `⋯ → Im Editor öffnen`.
4. Desktop erst nach der Tablet-Abnahme.

## 8. Umsetzung Phase 1 (16. September 2026)

Gebaut wie in Abschnitt 5, Punkt 1, mit diesen Abweichungen und Ergänzungen:

- **Geteilte Logik.** `usePromptComposer` in `PromptComposer.tsx` trägt
  Aufnahme, Recovery, Übergabe und Entwurf; `PromptComposer` (Desktop-Dock,
  Grosseditor) und die neue `VoiceStrip` (`renderer/terminal/VoiceStrip.tsx`,
  `voice-strip.css`) sind nur noch Darstellungen darüber. Hinweistexte des
  Hooks bleiben wörtlich erhalten; die Leiste zeigt sie als Kurzform
  (`Erkannt · prüfen, dann senden`, `Übergeben ✓` für 2,5 s, …).
- **Tablet-Montage.** `mobile/TerminalVoiceStrip.tsx` bindet Port und
  Freigaben (`useMobilePromptPort`, `useMobileSpeechGrants` aus
  `PromptDialog.tsx`) und montiert die Leiste unter `TerminalScreen`.
  Ohne Eingabebesitz zeigt derselbe Rahmen den Grund (`Eingabe beim PC`) und
  den Knopf **Eingabe übernehmen**; der Knopf steht nur noch dort. Der
  Grosseditor ersetzt die Leiste, solange er offen ist, damit genau eine
  Instanz den gemeinsamen Entwurf schreibt.
- **Anhören** sitzt per Portal in der Leiste (`replySlot` in
  `TerminalScreen`), heisst dort „Anhören“ und verdeckt keine Ausgabe mehr.
  Sein Dialog bleibt vorerst das bestehende Modal (Sheet folgt in Phase 2).
- **Computer rufen** liegt in ⋯ und öffnet den bestehenden Test-Kasten über
  dem Entwurf (langes Drücken folgt in Phase 3).
- **Behalten statt entfernt:** „Text direkt ans Terminal senden“ (das frühere
  „Text verfassen“) bleibt als leise Klappzeile unter der Leiste, weil es
  für Shell-Sitzungen ohne CLI-Prompt der einzige Textweg ist und die
  Terminal-Suiten darauf aufbauen. Die Sondertasten (Enter, Tab, Esc,
  Ctrl+C, Pfeile) erscheinen nur bei offener Tastatur oder nach Tipp auf ⌨.
- **Statuszeile:** eine Besitzaussage mit Punkt (`● Eingabe: Du (Tablet)`,
  `Eingabe: Desktop`, `Offline`, `Sitzung beendet`); „Terminal verbunden“
  und der Knopf „Prompt / Diktat“ entfallen. Das CLI-Label
  („Codex läuft · Terminal offen“) bleibt, weil viele Prüfungen darauf
  warten; seine Kürzung ist Textpflege für Phase 2.
- **Fokus-Bar** ist eingeklappt, solange eine CLI in der gewählten Sitzung
  läuft (`terminal-controls-expanded` = false). Sie erscheint von selbst,
  wenn die CLI beendet ist, im vergrösserten Terminal („Workspace
  einblenden“ muss erreichbar bleiben) und nach „Bedienung“ bei offener
  Tastatur. Die Test-Helfer bekamen dafür `expandSessionControls`, das
  `terminalLauncher` und die Flows vor „Sitzung beenden“, „Eingabe
  freigeben“, der CLI-Wahl und der Sitzungswahl aufrufen.
- **Offline** ersetzt die Leiste nicht: Sie bleibt montiert, sichert den
  letzten Zwischenstand einer laufenden Aufnahme als Entwurf und zeigt
  `Offline` als Grund am Sprechknopf.
- **Hinweis** zu ElevenLabs, Aufnahmedauer und Speicherort erscheint einmal
  pro Gerät unter dem Computer-Kasten bzw. über dem Entwurf und danach über
  `⋯ → Hinweise anzeigen`.

Testmigration: `computerVoiceFlow` nimmt die Knopfnamen als Parameter; der
Tablet-Teil von `test-dictation-electron.ts` prüft jetzt Leiste, Terminal-
Sichtbarkeit (≥ 220 px) und Grosseditor statt des Modals. Ein Stolperstein
beim Ausführen: Die Electron-Driver setzen `Path`; aus Git Bash sieht Node
`PATH`, das Fixture-Codex verliert gegen das installierte, und die Sitzung
endet sofort. Driver deshalb aus PowerShell starten.

### Nachweise und Aktivierung (16. September 2026, 17:23–17:52 CEST)

| Lauf | Ergebnis | Log |
| --- | --- | --- |
| `test-dictation-electron.ts --computer-only` (Desktop-Dock + Tablet-Leiste) | 19 / 0 | `test-results/voice-strip-computer-3.log` |
| `test-dictation-electron.ts` (vollständig) | 60 / 1; der rote Check „Verbindungsverlust während der Aufnahme“ führte zur Offline-Korrektur oben | `voice-strip-dictation.log` |
| `test-remote-terminal-electron.ts` Varianten `--tablet-layout-only`, `--workspace-cli-only`, `--project-git-only`, `--run-inspection-only`, `--terminal-home-only`, `--terminal-latency-only` | 20/0, 75/0, 22/0, 27/0, 42/0, 6/0 | `voice-strip-terminal-suites*.log` |
| `test-mobile-browser.ts`, `test-mobile-electron.ts`, `test-remote-workspace-browser.ts`, `test-remote-workbench-browser.ts`, `test-ollama-electron.ts` | 60/0, 36/0, 24/0, 43/0, 28/0 | `voice-strip-terminal-suites.log` |
| Hauptsuite `test-remote-terminal-electron.ts` | 207 / 1 („closing one home terminal retains the other sessions“; in der Einzelwiederholung `--terminal-home-only` 42/0 grün) | dito |
| `--assistant-only` | 58 / 1; der rote Check (Terminalhöhe im Fokus-Modus) führte zur Regel „Workspace einblenden im Header“ | `voice-strip-terminal-suites-2.log` |

Nach den letzten Korrekturen (Offline-Verhalten, Fokus-Regel, kürzerer
Hinweis) wurden Typprüfung, Build und der isolierte Startcheck des Releases
wiederholt, nicht aber die vollständigen Electron-Läufe; das steht aus.

Persönliche Aktivierung: Release `dist/voice-strip-1b73aff6` (Source-ID
`1b73aff62a7bed7e36b2`, Arbeitsbaum auf `ed4d74b`, nicht committet).
Isolierter Startcheck bestanden (`test-results/voice-strip-release-smoke.json`).
Backup `C:\Users\Adi.Muff\ADE-Backups\VoiceStrip-20260916-174937`,
Startmenü-Verknüpfung umgestellt. Die vorherige Instanz (PID 33884, Release
`reply-speech-e9e032d`) liess sich über das Tray-Menü nicht automatisiert
beenden (Symbol per UI-Automation nicht gefunden) und wurde nach Freigabe des
Operators samt ihrer Codex-Sitzung per Prozessende gestoppt. Neue Instanz PID
20656: Startquittung bestanden, 6 Profile, 5 Projekte, 1 Gerät, Tablet-Seite
HTTP 200 mit byteidentischem Bundle (`test-results/voice-strip-restart.json`,
`dist/voice-strip-1b73aff6/activation.json`).

### Phase 2 und 3 (16. September 2026, ab 18:10 CEST)

Adi wollte beide Phasen vor dem Gesamtlauf; Ziel: eine Sprachbedienung, die
sich auf dem Tablet nativ anfühlt.

**Phase 2, Anhören als Sheet.** `ReplySpeechButton` trennt Zustand
(`useReplySpeech`) von Hülle: Der Desktop behält den modalen Dialog, das
Tablet bekommt `ReplySpeechSheet`, ein nicht-modales `role="dialog"`, das
per Portal in den Sheet-Platz der Leiste (`voice-sheet-slot`) rendert und
dort Entwurf und Sprechzeile ersetzt (`data-sheet-open`). Kopfzeile: Titel,
Quelle, Segment-Control **Kurz | Alles** (`radiogroup` „Vorleseumfang“),
ⓘ für die Hinweise, Schliessen. Darunter der editierbare Text, der
Sprechtext, dann **Anhören / Erneut**, **Stoppen** und der Status in einer
Zeile. Escape schliesst nur das Sheet: Chromium löst den Abbruch des
umgebenden nativen Dialogs beim Keyup aus, das nach dem Schliessen ausserhalb
landet; das Sheet schluckt das folgende Escape-Keyup gezielt. Vorlesen
braucht keinen Eingabebesitz; der blockierte Rahmen („Eingabe beim PC“)
bietet den Sheet-Platz ebenfalls. `reply-speech.css` benutzt die Tokens aus
`tokens.css` statt eigener Farben. Das Auslesen des Terminals wartet einen
Takt, wenn xterm einen frisch geschriebenen Frame noch parst.

**Phase 3, Computer als Einstieg.** Der Ablauf aus `ComputerVoiceTest`
liegt jetzt in `useComputerCall` (gleiche Texte, gleiche Grenzen: 20 s
Zuhören, feste Begrüssung, kein Prompt-Schreiben). Der Desktop-Kasten nutzt
den Hook unverändert. In der Leiste startet **langes Drücken** auf den
Sprechknopf oder `⋯ → Computer rufen` den Aufruf; der Knopf zeigt
`Sage „Computer“` (pulsierender Ring), `Computer gehört…`, `Begrüssung…`,
`Computer antwortet…`. Die Begrüssung erscheint als Panel über dem Entwurf
mit **Erneut** und **Ausblenden**. Nach der abgespielten Begrüssung geht
die Leiste ohne weiteren Tipp in `Hört zu` über (`onGreeted` →
`record()`); die Aufgabe wird diktiert, geprüft und gesendet wie sonst.
Der Übergang bleibt bei der harmlosen Begrüssung; Aufgaben werden nie
automatisch gesendet.

**Native Details.** Wake Lock hält den Bildschirm wach, solange die Leiste
zuhört oder spricht; kurze Vibration beim Start/Stopp der Aufnahme und beim
langen Drücken; `touch-action: manipulation` und unterdrücktes Kontextmenü
auf dem Sprechknopf; das Sheet gleitet mit 160 ms ein, bei
`prefers-reduced-motion` ohne Bewegung.

**Nachweise.** `test-dictation-electron.ts --computer-only` fährt auf dem
Tablet den neuen `computerStripFlow` (Menü, Abbruch mit Fokusrückgabe,
langes Drücken, Begrüssung, automatischer Übergang ins Diktat, Erneut):
21/0. `test-reply-speech-electron.ts` prüft das Sheet unter dem sichtbaren
Terminal, das Segment-Control, Escape ohne Schliessen des Projekts und die
grosse Audioantwort: 34/0 (`voice-strip-reply-electron-10.log`).
Nicht umgesetzt: die Kürzung des CLI-Status-Labels („Codex läuft · Terminal
offen“), weil über zehn Suiten auf diese Texte warten; das bleibt Textpflege.

### Nachtrag 18:07 CEST: Antwort anhören auf dem Tablet

Adis erster Tablet-Test: Sprechen ohne Modal „sehr gut gelungen“, aber
**Antwort anhören** endete mit `response_too_large`. Ursache: Der Host-API-
Server begrenzt JSON-Antworten auf 512 KiB, das Base64-MP3 einer Antwort
(vom Provider bis 2 MiB erlaubt) passt nicht hinein. Korrektur in
`HostApiServer.ts`: Die Routen `terminalSpeech` und `speechQuery` dürfen
4 MiB, alle anderen behalten die Grenze. `test-reply-speech-electron.ts`
fährt jetzt die Leiste und lässt das Fixture-Audio per ID3-Padding über die
alte Grenze wachsen (33/0, Desktop und Tablet). Commit 6002cd8 auf `main`
(nach 99a0e47 mit der Leiste und dem vorgespulten `codex/reply-speech`).
Aktiviert als `dist/voice-strip-d5db34c4`, PID 17632; die vorherige Instanz
endete diesmal regulär vor dem Helfer-Fallback. Backup
`ADE-Backups\VoiceStrip-20260916-180656`.
