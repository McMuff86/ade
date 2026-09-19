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
