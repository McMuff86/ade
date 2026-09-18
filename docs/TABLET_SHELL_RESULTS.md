# Tablet-Shell und Commit-Verlauf — 17. September 2026

Der Benutzer beobachtete in der Shell des Projekts `rhino-compute-platform` auf
dem Samsung-Tablet eine sichtbare Eingabeaufforderung, aber unsichtbaren Text vor
Enter. Er bestätigte zusätzlich den Positionsversatz zwischen Text und Cursor.
Die Pfadmaskierung verkürzte die Anzeige, übernahm jedoch den ursprünglichen
Cursor; umgebrochene redigierte Zeilen wurden ausserdem auf eine Zeile gekürzt.

Die Korrektur projiziert bereits maskierte Zeilen samt Caret durch headless xterm.
Eingabe-Leerzeichen, Umbrüche, Unicode-Zellbreiten und gescrollte Prompts bleiben
zusammenhängend. Geheimnisse über harte Zeilenumbrüche werden weiterhin vor der
Projektion entfernt. Native Farben/Modi unveränderter Zeilen bleiben erhalten;
Cache-Versionen beziehen sich auf den vor der asynchronen Projektion erfassten
Stand. Der Browser erhält weiterhin keine absoluten Host-Pfade.

Die Bildkontrolle deckte zusätzlich einen browserseitigen Resize-Fehler auf:
xterm behielt trotz `scrollback: 0` nach dem schmalen Reflow `baseY: 1` bei
`viewportY: 0`. Text/Cursor erschienen damit eine Zeile unter der IME-Vorschau.
`TerminalScreen` leert bei geänderten Dimensionen den lokalen Puffer vor dem
vollständigen Main-Frame. Das bewahrt Modi und aktive Komposition; der separate
Verlauf wird weiterhin vom Host geliefert. Der verschärfte Test scheiterte vor
dieser Korrektur an der Positionsprüfung und besteht danach, auch wenn der
Grössenwechsel während einer noch unbestätigten Komposition erfolgt.

Die gemeinsame Projekt-Git-Ansicht zeigt unter dem Status eine aufklappbare Liste
„Letzte 5 Commits“. Quelle ist der gelesene HEAD des ausgewählten Checkout;
angezeigt werden Nachricht, Kurz-SHA, Autor und Datum. Der reine Lesezugriff bleibt
mit einer aktiven Shell und ohne Git-Schreibrecht verfügbar. Neue Repositories
haben einen ausdrücklichen Leerzustand. Laden/Fehler/Offline-Zustände werden von
der bestehenden Git-Ansicht getragen. Enter/Leertaste öffnen und schliessen die
Liste; bei schmalen Ansichten werden lange Inhalte umgebrochen.

Adi meldete zusätzlich den im kompakten Tablet-Modus versteckten Sitzungsabschluss.
Unter der Terminalanzeige bleibt jetzt „Shell beenden“ bzw. „Terminal beenden“
sichtbar. Bei geöffneter Tastatur steht der Button neben der horizontal scrollbaren
Tastenleiste. Ohne Tastatur teilt er sich die Zeile mit dem eingeklappten Texteditor,
damit die vergrösserte Terminalanzeige ihre nutzbare Höhe behält.
Er verwendet die vorhandene Bestätigung, Besitz-/Verbindungsprüfung
und den bestehenden signierten Abschlussbefehl. Abbrechen gibt den Fokus zurück;
nach Abschluss erhält der sichtbare Launcher oder ein expliziter Fallback Fokus.
Das × der Workspace-Ansicht beendet weiterhin keinen laufenden Prozess.

## Nachweise

- Terminal-Projektion: **54/0** mit Prompts, Eingabe vor Enter, Cursorbewegung,
  Zeilenumbruch, Scrollback, Unicode, Geheimnissen, TUI-Modi und Ausgabebegrenzung.
  Gegen die unveränderte Projektion aus `HEAD` schlagen gezielt alle neun neuen
  Positions-/Umbruchkontrollen fehl (**45/9**); danach besteht die neue Projektion.
  Negativbeleg: `test-results/tablet-shell-negative.log`.
- Projekt-Git: **54/0**, einschliesslich leerem Branch, Root-Commit, fünf neuesten
  Commits, Maskierung von Nachricht/Autor und Leserecht während aktiver Shell.
- Drei TypeScript-Projekte und Produktionsbuild bestanden.
- Erweiterte native Electron/Chromium-IME-/Latenzprobe: **19/0**. Echte PowerShell,
  signierter Host-Zugang, sichtbare unbestätigte Komposition am Cursor, genau
  einmalige Übernahme vor Enter und ausgeführtes `git status`. Einzelzeichen
  p50/p95 **133/187 ms**, Vierergruppen **152/206 ms**. Die lokale rohe CLI-Fixture
  misst **119/150 ms** bzw. **146/161 ms**, ohne Git-Prozess pro Tastendruck.
  Zusätzlich 390-Pixel-Ansicht mit 420-Pixel-Tastaturviewport, erreichbarer
  Abschluss, Dialogfokus, Escape/Abbrechen, tatsächlich beendeter Prozess,
  Fokusrückgabe zum aktivierten Launcher und erneutes Öffnen einer frischen Shell.
  Die Fokusrückgabe wartet auf die abgeschlossene Auswahlaktualisierung;
  die Close-Quittung kann der abgelösten Abfrage vorauslaufen.
  Log: `test-results/tablet-shell-latency-final.log`.
- Native Electron-/Tablet-Git-Bedienprüfung: **28/0**, inklusive Tastaturbedienung
  der Commit-Liste, Aktualisierung nach Commit, Leserecht und 390-Pixel-Layout.
  Log: `test-results/tablet-shell-project-git.log`.
- Der erste Gesamtlauf bestand drei TypeScript-Projekte, **89 Suiten / 3.677
  Prüfungen**, Build und die vorangehenden Bedienprüfungen, endete aber im
  Terminaldriver mit **206/2**: Der zusätzliche Abschluss belegte ohne Tastatur
  eine eigene Zeile und drückte zwei vergrösserte Terminals unter die bestehende
  Mindesthöhe. Die gemeinsame Zeile mit dem eingeklappten Editor korrigiert dies;
  Mindesthöhe und Testgrenze bleiben unverändert. Beleg des ersten Laufs:
  `test-results/tablet-shell-verify-first.log`. Der komplette betroffene
  Terminaldriver besteht danach **208/0**, die Eingabe-/Abschlussprüfung **19/0**.
  Die finale Gesamtabnahme besteht **Exit 0**: 17. September 23:48 bis
  18. September 00:15 CEST, drei TypeScript-Projekte, **89 Suiten / 3.677
  Prüfungen**, Produktionsbuild und alle Electron-/Chromium-/Visualdriver.
  Log: `test-results/tablet-shell-verify.log`.
  Keine physische Samsung-Abnahme der Korrektur behauptet.

## Betrieb

Persönlich aktiviert am **18. September 2026 um 00:17 CEST** nach ausdrücklichem
Neustartauftrag. Der isolierte Starttest bestand zuerst. Alte PID 44420 regulär
beendet, neue PID **57592**, Release `dist/tablet-shell-df7bd102395819bff557`.
Sechs Profile, sechs Projekte und die bestehende Tablet-Kopplung erhalten.
Die persönliche Git-Abfrage liefert fünf Commits; privates HTTPS liefert HTTP
200 und bytegleich das neue Tablet-Bundle. Startmenü-Verknüpfung aktualisiert.
Sicherung: `C:\Users\Adi.Muff\ADE-Backups\TabletShell-20260918-001745`.
Beleg: `test-results/tablet-shell-restart.json`.

Der autorisierte nächste Stabilisierungsblock folgt nach dieser Aktivierung;
die laufende Instanz verwendet einen separaten, unveränderlichen Release.
