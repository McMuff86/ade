# Tablet-Pilot: ADE-Gespräch und Codex-Projektauftrag

17. September 2026, Fortsetzung ab `aacbc6c`. Adi hat den nächsten Einstieg,
Weiterarbeit mit Goals und zuerst den Codex-Ablauf beauftragt. Die Pause aus dem
[Kontexthandoff](CONTEXT_HANDOFF_2026-09-17.md) ist damit aufgehoben.
Claude/Grok und Sprachausgabe folgen nach diesem ersten Tablet-Test.

## Ziel und Lieferfolge

Der gekoppelte Tablet-Browser kann ohne Projektterminal mit ADE sprechen oder
diktieren, eine ausdrückliche Projektübergabe speichern und einen bestätigten
Codex-Projektauftrag verfolgen. Ergebnisse und Rückfragen gehören sichtbar zum
richtigen Auftrag. Ein wiederholter Aufruf oder eine verlorene Quittung darf
keine zweite Arbeit starten. Der physische Tablet-Test bleibt Adis Abnahme;
automatisierter Chromium und echte native Codex-Proben werden separat benannt.

1. **Ausgangsabnahme:** Clipboardfehler getrennt an xterm-Auswahl,
   Main-Schreibwert und Betriebssystem-Rücklesen untersuchen. Fokussierten
   positiven Ablauf und danach `pnpm verify` vollständig ausführen.
2. **Übergaben aus dem Gespräch:** validiertes ADE-Domänenwerkzeug mit
   dauerhafter Idempotenz und Projekt-/Gesprächsbindung. Neuer Werkzeugvertrag
   verlangt einen neuen Gesprächskontext; bestehende lesende Kontexte werden
   nicht stillschweigend erweitert.
3. **Projektauftrag und Rückkanal:** expliziten Auftrag und Elternbeziehung vor
   dem Start dauerhaft reservieren, über `RunCoordinator.submitSingleTask`
   starten und anhand desselben Belegs wiederfinden. Modus und Rechte direkt am
   Launch prüfen. Ergebnis, Rückfragen und Graph aus tatsächlichem ADE-Zustand
   ableiten. Brainstorming und Vormerkungen starten keine Umsetzung.
4. **Tablet-Testlieferung:** fokussierte Vertrags-/Rechtetests, echte
   Electron-/Browser-Flows und native Codex-Probe; abschliessend vollständiges
   `pnpm verify`. Geprüften Build, Zugang mit erhaltenem lokalem Profil und
   kurze Bedienanleitung bereitstellen. Bestehende aktive Arbeit vor einem
   Instanzwechsel prüfen.

## Verbindliche Grenzen

Der zentrale Prozess bleibt ausserhalb der Projektordner mit eingeschränkter
nativer Werkzeugliste. Kein generischer Shell-/PTY-/Dateisystemzugriff und keine
Erweiterung der Remote-IPC-Allowlist. Signierte Tablet-Befehle gehen durch
`AdeApplicationService`; private Inhalte bleiben hinter den vorhandenen
Detail-/Redaktionsgrenzen. Speichern vor Seiteneffekt, stabile Command-Keys,
explizite unbestätigte Zustände und positive Kontrollen nach Negativfällen.

## Arbeitsstand

- Plan und aktives Goal angelegt; Umfang durch Adi auf den ersten Codex-Ablauf
  priorisiert.
- Ausgangsabnahme bestanden: unveränderter Anwendungsstand `aacbc6c`, ergänzter
  Clipboard-Nachweis **77/0** (native Schreibargumente, unmittelbares Electron-
  Lesen und unabhängiges Windows-Lesen exakt `ADE_HISTORY_12`). Der frühere
  Fehler ist hier nicht reproduziert; seine damalige Ursache bleibt ungeklärt.
- Vollständiges `pnpm verify` am 17. September 18:43 CEST mit Exit 0:
  drei TypeScript-Projekte, 87 Suiten/3.580 fokussierte Prüfungen, Build und alle
  Electron-/Browser-/Visualdriver. Log im Hauptcheckout:
  `test-results/tablet-codex-verify-baseline.log`, Exit-Metadaten daneben.
  Diese Abnahme gilt für den Ausgangsstand, nicht für die folgenden Funktionen.
- Implementierung aus separater Arbeitskopie `../ade_tablet_codex_work` in den
  Hauptcheckout übernommen. Aktionsverträge **46/0**: Vorschlag/Bestätigung,
  dauerhafte Eltern-/Kindzuordnung vor Launch, Wiederholung, Queue-Rechteprüfung,
  Speicherfehler, Crash-Wiederherstellung und fehlende/prunierte Kinder.
- Signierter Host-Zugang **22/0**, Sicherheitsprüfung **286/0**, drei
  TypeScript-Projekte grün. Gesamter Gesprächsdriver **55/0** mit lokalem
  Protokollpeer, einschliesslich 11 neuer Aktionsprüfungen: PC-Übergabe,
  Tablet-Auftrag, verlorene Quittung/Reload, Rückfrage/Datei/Ergebnis,
  Projektzuordnung, 800/390 Pixel, Rechteentzug und abschliessende positive Kontrolle.
- Native Codex-Probe **11/0** mit installierter CLI 0.154.0: reale
  Produktionswerkzeuge, bestätigte Übergabe, exakter Resume, bestätigter Auftrag,
  native Rückfrage/Antwort, tatsächliche Testdatei und Ergebnis im Koordinator.
  Koordinator-Modell/Reasoning beobachtet `gpt-5.6-sol`/`high`; Task entsprechend
  angefordert. Der native Driver nutzt einen isolierten Launcher; Produktions-
  Queue und Workspace-Zuteilung sind im Electron-Peer-Test separat geprüft.
- Native Startprüfung fand zwei globale MCP-Einträge, die `mcp_servers={}`
  nicht entfernt. Prozesslokale Deaktivierung samt wirksamer Prüfung ergänzt:
  Policy **35/0**, nativ **3/0**, keine globale Konfigurationsänderung.
- Finale Gesamtabnahme im Hauptcheckout **Exit 0**, 17. September
  **19:07–19:32 CEST**: drei TypeScript-Projekte, **89 Suiten / 3.652 Prüfungen**,
  Produktionsbuild, alle Electron-/Browser-/Visualdriver. Gespräch **55/0**,
  voller Terminaldriver **208/0**, Workspace-CLI mit OS-Clipboard **77/0**,
  Setup **38/0**, Bildvergleiche **22/0**. Source-ID `b05242ffd1f239a77f72`.
  Log: `test-results/tablet-codex-verify-final.log`; Exit-Zeitbeleg:
  `test-results/tablet-codex-verify-final-exit.json`. Persönliche Aktivierung folgt.
  [Anleitung für Adis Tablet-Test](TABLET_CODEX_TEST.md).

Weitere Verträge: [Implementierung](MAIN_AGENT_IMPLEMENTATION.md),
[nächste technische Anbindung](MAIN_AGENT_NEXT.md),
[Gesamtplan](MAIN_AGENT_GOALS.md), [Architektur](ARCHITECTURE.md).

## Persönlicher Testbuild vorbereitet, Aktivierung wartet

Codecommit **`5fd687f`** ist auf `origin/main`. Der unveränderte geprüfte Build
liegt unter `dist/tablet-codex-b05242ffd1f239a77f72`; isolierter echter Electron-
Start am 17. September 19:34 CEST bestanden. Alle drei kompilierten Oberflächen
bestätigen dieselbe Source-ID. Plan, Artefakthashes und Startbeleg liegen unter
`test-results/tablet-codex-release-plan.json` und
`test-results/tablet-codex-isolated-release.json`.

Das isolierte Git-Testprojekt ist unter
`%USERPROFILE%/ADE-Testprojekte/Tablet-Codex-20260917` vorbereitet. Beim geprüften
persönlichen Start wird es über normale ADE-IPC als **ADE-Tablet-Test** registriert,
auf **Koordinieren** gestellt und ein frisches Codex-Gespräch ohne Modellaufruf
angelegt. Die sechs bestehenden Profile, fünf bestehenden Projekte und die
Samsung-Kopplung werden erhalten; Profilzulassung separat ohne Änderung des
persönlichen Zustands geprüft. Der private Zielzugang bleibt
`https://number-cruncher.tailfc0b86.ts.net/`.

Die Aktivierung hat **noch nicht stattgefunden**: Der Vorabcheck erkannte in der
alten ADE-Instanz (PID 65624) eine interaktive Codex-Sitzung mit Prozessbaum.
Keine aktiven Run-/Task-Datensätze, aber ein beendeter Run beweist keine freie
interaktive Sitzung. Deshalb wurde der Neustart vor jeder Beendigung angehalten
und Adi ausdrücklich gefragt, ob diese Sitzung beendet werden darf. Diese
Entscheidung steht aus; keine Zustimmung aus Wartezeit ableiten.

Bei bestätigter Freigabe führt
`test-results/restart-tablet-codex-release.ps1 -RestartInteractiveSessions`
den vorbereiteten Wechsel durch: Prozessidentität und Artefakte prüfen,
Profildaten sichern, vorhandene Tray-Beenden-Aktion verwenden, neuen Release
starten, Originalkatalog/Kopplung und tatsächlich über privates HTTPS geliefertes
Bundle prüfen und erst dann die Startmenü-Verknüpfung aktualisieren. Danach
`activation.json`/Neustartbeleg prüfen und diesen Handoff auf den tatsächlichen
Betriebsstand aktualisieren. Bei erhaltener Sitzung bleibt der neue Release
vorbereitet; keinen zweiten Host mit demselben persönlichen Profil starten.

Die temporäre Implementierungs-Arbeitskopie wurde nach Inhaltsvergleich entfernt;
ihre Prüfarbeitsdateien liegen unter `test-results/tablet-codex-work-evidence`.
