# Zwischenstand: Terminal, Abo-Nutzung und Git-Bedienung

13. September 2026. Der Benutzer hat einen zeitnahen Commit/Push dieses laufenden
Arbeitsstands angefordert. Dies ist noch keine abschliessend abgenommene Release.

## Enthalten

- Mobiler Textverlauf per Knopf, Mausrad, Touch und Shift+PageUp, mit stabiler
  Leseposition; [Verlaufdetails](TERMINAL_SCROLL_RESULTS.md).
- Terminalanzeige verwendet bereits aufbereitete, redigierte Bilder erneut,
  solange weder Ausgabe noch Grösse geändert wurden. Bei geänderter Ausgabe
  wartet Mobile 40 statt 100 ms bis zur nächsten Abfrage; weiter nur eine
  laufende Abfrage. Eine neue Ende-zu-Ende-Latenzmessung steht noch aus.
- **Abo-Nutzung** am Desktop-/Mobile-Terminal: native Codex-Kontoabfrage liefert
  beobachtete Prozentwerte, Zeitfenster, Reset und Messzeit. Keine Umrechnung in
  erfundene Resttokens. API-Schlüssel-Sitzungen, eigene Startbefehle und WSL
  bekommen keine vermeintlichen Werte des nativen Abo-Kontos.
- Claude und Grok zeigen den Einstieg über `/usage`; ihre Werte werden noch
  nicht automatisch in ADE übernommen. Dies ist eine explizite Funktionsgrenze.
- Git zeigt nächsten Schritt, Arbeitsziel, Dateiauswahl und letzten ADE-Fetch.
  Merge-Richtung ist sichtbar; Branch-Erstellung zeigt Basis und prüft Namen
  sowie bestehende lokale Branches vor der Vorschau. Übernahme zeigt fünf
  Schritte und kann die empfohlene Dateiauswahl wiederherstellen.

## Abo-Vertrag

`terminal:usage` ist Desktop-`launch`, mit strikter Session-ID-Validierung.
Mobile verwendet `terminal/query` mit `usage: true` und verpflichtender
Terminal-ID; bestehende signierte Geräte-/Terminal-/Workspace-Prüfungen gelten
vor und nach dem asynchronen Abruf. Keine Erweiterung der generischen Remote-
Command-Allowlist. Der Hostadapter ruft weiterhin nur `AdeApplicationService`.

Der Codex-Prozess führt ausschliesslich `initialize`, `initialized` und
`account/rateLimits/read` aus, mit 12 Sekunden Timeout, begrenzter Ausgabe und
Beendigung seines eigenen Prozessbaums. Kein Thread/Prompt, Login, Reset-Kauf
oder Credential-Export. Nur strikt projizierte Zahlen und feste Meldungen gehen
an die Oberfläche. Native Kontoabfragen sind für 60 Sekunden zusammengefasst.
`SubscriptionUsage` und `SubscriptionWindow` sind Wire-Verträge in `remote.ts`.

Offizielle Grundlagen, am 13. September geöffnet:

- [Codex App Server](https://learn.chatgpt.com/docs/app-server): Konto-Limits und Reset-Zeitfenster.
- [Claude Code Statusline](https://code.claude.com/docs/en/statusline): optionale `rate_limits` für Abonnenten nach einer Anbieterantwort.
- [Grok Build Changelog](https://x.ai/build/changelog): `/usage` zeigt Anbieterlimits und Reset.
- [Grok Nutzung](https://docs.x.ai/grok/faq): gemeinsames Wochenkontingent.

## Bisherige Prüfung und offene Arbeit

- TypeScript aller drei Projekte und Produktionsbuild bestanden.
- Terminalprojektion: 33 Checks, Abo-Adapter: 14 Checks bestanden.
- Echte native Codex-0.154.0-Kontoabfrage erfolgreich: 89 % Rest im gemeldeten
  7-Tage-Fenster zum Messzeitpunkt; keine Modellinferenz. Keine Kontodaten gespeichert.
- Vor Erweiterung um Abo/Git: gezielter Terminal-Browserlauf 36 Checks bestanden.
- Erster Gesamtlauf `terminal-scroll-verify.log` scheiterte an zwei UI-Checks:
  Messung der inneren statt vollständigen Terminalfläche; Zuweisungsprüfung,
  die fälschlich nur eine gesamte Zuordnung pro Agent erwartete. Beides korrigiert;
  der abschliessende positive Gesamtlauf steht noch aus.
- Aktueller gezielter Browserlauf: `test-results/terminal-usage-home.log`.
- Dieser erweiterte Browserlauf besteht noch nicht: 23 Checks bestanden, danach
  Timeout beim erwarteten Codex-Quota-Fixturewert. Ursache und abschliessende
  Wiederholung sind offen; der Zwischencommit behauptet keine fertige Abnahme.
- IPC-Sicherheitsprüfung nach neuem Kanal: 230 Checks bestanden.
- Neue Git-/Übernahme-Browserchecks und vollständiges `pnpm verify` folgen.
- Anfrage nach kompakterem Kopfbereich: Screenshot zeigt RhinoSheetMetal;
  Rückfrage nach ADE/Rhino-Ziel noch offen. Kein Rhino-Projekt wurde geändert.
- Physisches Samsung/DeX, WSL und automatische Claude-/Grok-Prozentübernahme
  sind mit diesem Zwischenstand nicht abgenommen.

Persönliche ADE-Instanz bleibt auf der Releasekopie vom 13. September, 12:48 Uhr.
Dieser Commit aktualisiert den Quellstand, nicht den laufenden Prozess.
