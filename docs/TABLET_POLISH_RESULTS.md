# Einzelprojekte, Tablet-Breiten und PWA-Start

## Bedienung

- PC → Projekte → **Einzelnes Projekt für ADE Mobile freigeben** öffnet die
  native Ordnerauswahl. Bestehende native Git-Repositories können auch außerhalb
  des Projekt-Stammordners in den Katalog aufgenommen werden. Wiederholte Auswahl
  erzeugt kein Duplikat; Abbrechen verändert nichts. Auf Mobile die Projektordner
  aktualisieren. Die bestehenden Gerätefreigaben gelten weiterhin; bei einer
  eingeschränkten Projektauswahl das neue Projekt am PC freigeben.
- Mobile → Terminals: Die sichtbaren senkrechten Griffe neben Agentenliste und
  Inspector mit Finger oder Maus ziehen. Tastatur: Pfeiltasten, Home und End.
  Beide Breiten werden lokal im Browser gespeichert (14–32 %). Auf schmalen
  Tablets bleibt nur die Agentenliste sichtbar; unter 700 px bleibt sie
  aufklappbar. Terminal-Fokusmodus und Bildschirmtastatur blenden die Griffe aus.
- Installierte PWA: Öffentliche Startdokumente erlauben jetzt externe
  Top-Level-Navigationen. Der Service Worker lädt Navigationsdokumente aus
  seinem eigenen Ursprung und fällt bei HTTP-Fehlern auf die öffentliche
  Shell-Kopie zurück. API-Antworten werden weiterhin niemals gecacht.
  Bereits gekoppelte Browser stellen ihre Anmeldung mit dem gespeicherten,
  nicht exportierbaren Geräteschlüssel wieder her. Hat eine installierte App
  einen getrennten Browser-Speicher, erklärt die Kopplungsseite das erneute
  Koppeln direkt in der App.

## Grenzen und Schutz

Keine neuen IPC- oder Remote-Schreibkanäle. Die PC-Aktion verwendet
`dialog:pickFolder` und `repository:import`; die Projektdiscovery enthält bereits
registrierte Projekte außerhalb des Stammordners. Es werden weder Agenten noch
Workspaces oder Terminals gestartet und keine Gerätegrants erweitert.

Die PWA-Ausnahme ist auf GET `/` bzw. `/index.html` mit Fetch-Metadata
`navigate`/`document` begrenzt. Fremder Host, Funnel, Frames, API-Zugriffe und
Mutationen bleiben gesperrt. Beim Weiterleiten durch den Service Worker können
Navigations-Metadaten verändert werden; deshalb wird die öffentliche Navigation
als eigene Anfrage ohne Sitzungscookie geladen. Sonstige Anfragen folgen dem
bisherigen Pfad. Die Shell enthält keine privaten Daten.

## Prüfungen

- `pnpm typecheck`, `pnpm build`.
- `tsx scripts/test-mobile-access.ts`: 79 Checks, einschließlich externer
  Startnavigation und negativer API-/Frame-/Funnel-Kontrollen.
- `tsx scripts/test-remote-terminal-electron.ts --tablet-layout-only`: 13 Checks
  mit nativem Electron, echten Git-Ordnern außerhalb des Stammordners, gekoppeltem
  HTTPS-Browser, Touch-Eingaben, Tastatur, Reload und responsiven Größen.
- `tsx scripts/test-mobile-browser.ts`: 60 Checks, externe Navigation mit aktivem Service
  Worker, Kaltstart in neuem Fenster ohne Sitzungscookie sowie bestehende
  Offline-/Widerrufs-/Wiederverbindungsprüfungen und HTTP-503-Shell-Fallback.

Automatisierung misst Chromium auf Windows. Die Installation und der Start über
den Android-Launcher müssen zusätzlich auf dem echten Tablet bestätigt werden.
Vier `origin_not_allowed`-Ablehnungen der persönlichen Instanz um 21:36 Uhr
passen zum gemeldeten Fehler; die konkrete Tablet-Anfrage wird nicht protokolliert.
Logs und Aktivierungsbeleg liegen unter `test-results/tablet-*`.

## Gesamtlauf und Aktivierung

`pnpm verify` wurde vollständig angestoßen und endete mit Exit 1 am bereits
bekannten Codex-Quota-Fixture (`7 Tage: 75 % übrig`, Terminal-Home-Ablauf).
50 fokussierte Suiten/2.387 Checks, 197 Desktop-Electron-, 60 Mobile-Browser-,
39 Workbench-Browser- und 13 Layout/Import-Checks bestehen; im anschließenden
Remote-Terminal-Lauf 141 bestanden, ein Timeout. Die danach verketteten Suiten
wurden nicht ausgeführt. Keine vollständige Repository-Freigabe.

Persönliche Instanz seit 21:49 Uhr, PID 50472, aus
`test-results/operator-tablet-polish-20260913-214947-4c343de5-focused`.
Native Fenstergröße 1600 × 1100. Sechs Agenten, fünf Repositories und vorhandene
Gerätekopplung unverändert. Privater HTTPS-Startaufruf 200; gleichartige
Cross-Site-API-Anfrage bleibt 403. Build-Hashes im Neustartbeleg geprüft.
Für bestehende PWA-Installationen einmal ADE im Browser laden, danach sämtliche
ADE-Tabs und App-Fenster schließen und die PWA neu starten, damit der neue Worker
aktiviert wird. Kein Commit/Push durch diese Arbeit.
