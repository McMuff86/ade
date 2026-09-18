# Tablet-Wiederaufnahme und Workspace-Orientierung — 18. September 2026

Adi hat nach dem Shell-Build die Weiterarbeit ausdrücklich beauftragt. Der erste
Build wurde um 00:17 CEST aktiviert; die anschliessende Arbeit verändert dessen
separaten Release nicht.

## Befund und Änderung

Die native Electron-/Chromium-Negativprobe belegte drei Lücken: Im kompakten
Tastaturmodus fehlten sichtbare Verbindungs-/Übernahmeaktionen; eine fehlgeschlagene
Bildschirmabfrage liess weitere Tastatureingaben zu. Die Probe verwendete nur
einen isolierten Projektordner und einen ungesendeten Testtext. Ergebnis **6/3**,
drei beabsichtigte Fehler, abschliessender positiver Kontrollfall bestanden.
Beleg: `test-results/tablet-recovery-negative.log`.

Die Wiederaufnahmeleiste bleibt jetzt bei geöffneter Tastatur erreichbar. Nach
Verbindungsabbruch wird die Anzeige als veraltet gekennzeichnet. „Erneut verbinden“,
„Anzeige erneut laden“ und bei Desktop-Besitz „Eingabe übernehmen“ verwenden die
vorhandenen Zugangs-/Besitzregeln. Eine Verbindung übernimmt keine Sitzung
automatisch. Andere Geräte werden nicht verdrängt. Gesunde Sitzungen erhalten
keine zusätzliche Zeile.

Direkte Eingabe, Sondertasten und gesendeter Text pausieren bei fehlender aktueller
Anzeige; nach Wiederverbindung ist zuerst eine erfolgreiche Anzeigeabfrage nötig.
Ungesendete Tastaturpakete werden verworfen, lokale Textentwürfe erhalten.
Verzögerte Promptübergaben prüfen den aktuellen Zustand nach dem Warten erneut.
Leere Grössen-/Lease-Nachrichten und bewusstes Beenden bleiben davon unabhängig.
Es gibt keine automatische Wiederholung unbestätigter Eingaben.

„Workspace-Info“ im Tablet-Projektkopf bleibt mit Tastatur erreichbar, nimmt
Dialogfokus und gibt ihn beim Schliessen zurück. Es zeigt Projekt, Branch und
Workspace-Art. Am PC öffnet ein Tastaturschalter den exakten Workspace-Stammordner,
auch für einen separaten Worktree. Dieser Stamm ist nicht zwingend das aktuelle
Shell-Verzeichnis. Absolute PC-Pfade bleiben auf dem Tablet maskiert.

## Abnahme

Der erweiterte native Eingabe-/Wiederaufnahme-/Latenzdriver besteht zunächst
**29/0**: IME, Shell-Abschluss, 390-Pixel-Breite mit 420-Pixel-Tastaturviewport,
Info-Dialog/Fokus, tatsächlicher Netzverlust, Desktop-Übernahme, dieselbe Shell,
HTTP-503-Anzeigefehler, null Eingabepakete während Pause, kein Replay, genau einmal
ausgeführtes `git status`, erhaltener Entwurf. Der erste positive Versuch enthielt
einen Test-Race: automatische Wiederverbindung entfernte den Retry-Button vor
dem simulierten Klick. Der Test klickt jetzt bei noch unterbrochener Verbindung;
danach wird das Netzwerk wieder freigegeben. Keine Produktanforderung abgeschwächt.
Auch der finale Driver mit Sperre bis zur ersten erfolgreichen Anzeige nach
Reconnect besteht **29/0** (`test-results/tablet-recovery-final.log`).
Die Git-/Desktop-Pfadprüfung besteht **31/0**; der Workspace-/CLI-Driver
**79/0**, einschliesslich exaktem Worktree-Pfad und Rückkehr zum Originalordner.
Logs: `test-results/tablet-recovery-project-git.log` und
`test-results/tablet-recovery-workspace.log`.

Der erste Gesamtlauf bestand 89 Suiten / 3.677 Prüfungen und den Build, fand aber
eine Regression bei laufendem Diktat: Die neue Anzeigesperre ersetzte den
Sprachcomposer durch einen blockierten Platzhalter. Dadurch blieb der gesicherte
Zwischenstand während Offline unsichtbar (**60/1**). Die Anzeigesperre blockiert
nun nur die Übergabe; Composer und grosser Editor bleiben mit bearbeitbarem
Entwurf erhalten. Der bestehende Offline-Handler kann seine Vorschau und den
Hinweis sichern. Drei zusätzliche native Prüfungen decken Anzeigefehler,
gesperrtes Senden in beiden Editoren und Wiederaufnahme ohne PTY-Schreibzugriff ab.
Der komplette Diktatdriver besteht nach der Korrektur **66/0**, einschliesslich
verlorener Übergabequittung, gesichertem Live-Zwischenstand, Abbruch und erneutem
erfolgreichen Diktat. Beleg: `test-results/tablet-recovery-dictation.log`.
Erster Gesamtlauf: `test-results/tablet-recovery-verify.log`; finale Abnahme folgt.

Der zweite Gesamtlauf besteht alle bis zum Workspace-Driver ausgeführten
Fach- und Bedienprüfungen (Diktat **66/0**, Terminal **208/0**, alle 79
Workspace-Prüfungen), bricht aber beim Löschen des temporären Worktree-Verzeichnisses
mit Windows-`EBUSY` ab. Im Quellcode der installierten Node-22-Version ist
bestätigt: Synchrones `rmSync` wiederholt diesen anfänglichen Fehler bei einem
leeren Verzeichnis nicht. Der Driver verwendet jetzt asynchrones `rm` mit
begrenzten Wiederholungen und prüft zusätzlich den direkten temporären Zielpfad.
Eine native Probe hält das Arbeitsverzeichnis durch einen eigenen Prozess offen:
Synchrones Löschen scheitert erwartungsgemäss, asynchrones Löschen besteht nach
kontrollierter Prozessfreigabe. Beleg: `test-results/tablet-cleanup-probe.log`.
Dieser Testfehler wird nicht als erfolgreiche Gesamtabnahme gezählt.
Zweiter Lauf: `test-results/tablet-recovery-verify-final.log`; abschliessender
vollständiger Wiederholungslauf: `test-results/tablet-recovery-verify-complete.log`.

Eine physische Samsung-Abnahme ist weiterhin offen. Chromium emuliert den
Tastaturviewport und verwendet echte IME-Ereignisse, aber keine Samsung-Tastatur.

Für die Geräteabnahme nach Neuladen der Tablet-Seite:

1. In der Projektshell `git status` vor Enter sichtbar tippen; danach ausführen.
2. Umlaute, Autokorrektur, Einfügen, Cursorbewegung und einen langen ungesendeten
   Text prüfen; Hoch-/Querformat sowie Tastatur öffnen/schliessen wechseln.
3. Einen lokalen Entwurf speichern, kurz die Verbindung unterbrechen und
   wiederkehren: klare Anzeige, bewusste Eingabeübernahme, derselbe Prozess.
4. Workspace-Info öffnen und über Schliessen/Escape verlassen; Projekt und Branch
   prüfen. Die PC-Pfadanzeige nennt den Workspace-Stamm, nicht die Shell-Position.
5. „Shell beenden“ abbrechen und dann bestätigen; eine neue Shell öffnen.
6. Anschliessend den [Codex-Auftrag mit Rückfrage](TABLET_CODEX_TEST.md) vollständig
   bis Datei, Ergebnis und Reload-Nachweis durchspielen.

## Betrieb

Vollständiges `pnpm verify` bestanden am 18. September 2026, 01:25–01:54 CEST:
89 Suiten / 3.677 fokussierte Prüfungen, TypeScript, Produktionsbuild und alle
Electron-/Chromium-/Visual-Driver. Beleg: `tablet-recovery-verify-complete.log`
und zugehöriger Exit-Code 0. Auch die vorher fehlgeschlagene Bereinigung besteht.

Persönlich aktiviert um 01:54 CEST: `tablet-recovery-45179f3a10f68b7971f8`,
PID 45844 ersetzt 57592. Isolierter Start und reale Aktivierung bestanden;
6 Profile, 6 Projekte, 1 Kopplung und 5 persönliche Commits bestätigt.
Private HTTPS-Seite liefert exakt das neue Tablet-Bundle (HTTP 200).
Sicherung: `C:\Users\Adi.Muff\ADE-Backups\TabletRecovery-20260918-015425`.
Beleg: `test-results/tablet-recovery-restart.json`. Startmenü-Verknüpfung aktualisiert.
Anschliessend separat beauftragt: [Eleven v3](ELEVEN_V3_RESULTS.md).
In dessen Abnahme wurde zusätzlich eine zuvor sporadische Überschneidung von
Heartbeat und explizitem Senden reproduziert und korrigiert; Nachweise und der
zugehörige Folge-Build stehen ebenfalls im Eleven-v3-Bericht.
Es erfolgt kein Commit oder Push im Rahmen dieses Auftrags.
