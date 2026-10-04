# ADE implementation status

Kurzüberblick (4. Oktober 2026): Goal 34.1–34.5 unter nativem Linux
implementiert und geprüft; 34.6 bis H2b implementiert, H2a/H2b noch ohne
produktive Verdrahtung. Letztes `pnpm verify` **31/0/16 nicht gemessen**,
**114 Suiten / 4.735 Checks**. Windows-, physische Tablet- und weitere native
Adapterabnahmen offen. GitHub-CI: Linux- und Windows-Job grün seit den
Testkorrekturen vom 4. Oktober (zuvor Windows rot seit 30. September). Übersicht je Teilziel:
[ROADMAP](ROADMAP.md#aktueller-stand-4-oktober-2026). Abschnitte unten sind
datiert und reichen bis zum 29. September zurück; die ältere Lieferchronik liegt
im [Archiv](archived/STATUS_2026-10-04_CHECKPOINT.md).

## Goal 34.6 H2b: nativer Linux-Schlüsselbund (4. Oktober 2026)

H2a als `61322f3` committet; H2b ergänzt den nativen Secret-Service-Anschluss
und begrenzten Kindprozess, GNOME-Protektion, Sperr-/Dienst-/Schlüsselwechsel
und Retry. Private GNOME-/D-Bus-Integration unter Node und Electron-Node-Modus;
keine Tests am persönlichen Schlüsselbund. **Weiterhin ohne produktive
Verdrahtung**: H2c Store-Migration/Konsumenten und H2d Oberfläche/Startblockaden
sind offen. Windows, WSL-Modelle, macOS und Packaging nicht gemessen.
Grenzprüfung **219 Module**; neuer Prozess-/Monitor-Vertrag **21 Checks**.
Native Integration **42/0**; finales `pnpm verify` am 4. Oktober:
**31/0/16 nicht gemessen**, **114 Suiten / 4.735 Checks**.
Aktuelle Abnahme: [HANDOFF](HANDOFF.md); Vertrag: [HOST_SECRETS_H2](HOST_SECRETS_H2.md).

## Goal 34.6 H2a: isolierter Secrets-Tresor-Kern (3. Oktober 2026)

H0/H1 abgeschlossen; H2 begonnen. `HostSecretVault` implementiert AES-256-GCM,
begrenzte atomare Speicherung, Schlüsselzustände und einen wiederaufnehmbaren
Migrationsempfänger. **Noch nicht produktiv verdrahtet:** tatsächlicher
Secret-Service-Anschluss, Altstore-Sender, UI und Startblockaden folgen.
Produktiv bleiben die drei bisherigen safeStorage-Stores bestehen; der
unabhängige Host-Prozess beginnt erst mit H3. Neue Suite **59/0** unter Linux,
Host-Grenze **215 Module / 18 Checks**. Windows und nativer Schlüsselbund in
H2a nicht gemessen. Vertrag und nächste Schritte: [HOST_SECRETS_H2](HOST_SECRETS_H2.md).
Finales `pnpm verify`: **30/0/16 nicht gemessen**, **113 Suiten / 4.714 Checks**;
Details und Betriebszustand: [HANDOFF](HANDOFF.md).

## Gelöschte Projektordner und wiederholbarer Projektstart (2. Oktober 2026)

Ein am PC gelöschter Projektordner (ENOENT) wird auf Desktop und Tablet aus der
Liste ausgeblendet und als „N Projekt(e) nicht mehr gefunden“ gemeldet; die
Registrierung bleibt. „Aus ADE entfernen“ deregistriert nach Bestätigung nur
Repository, Projekt-Arbeitsordner und Zuordnungen (Desktop `project:removeMissing`,
Tablet signiert/idempotent/auditiert über `/api/v1/projects/remove-missing`);
abgelehnt bei laufendem Terminal oder verweisenden Runs/Agenten/Zuordnungen und
wenn der Ordner wieder existiert. Listen prüfen beim Zurückkehren neu (≤ alle 5 s).
Tablet-Projektstart: Nach endgültiger Ablehnung (auch gespeicherter Replay)
„Erneut versuchen“ mit neuem Schlüssel; ungewisse Zustellung behält den Schlüssel.
Nachweise: Vertrag `test-missing-projects.ts` **36/0**, Tablet-Browser **13/0**,
Desktop-Electron **8/0**; `pnpm verify` **30/0/16 nicht gemessen**, **4.596 Checks**. Nur lesend gegen die persönliche Konfiguration geprüft:
`idee-2026-10-02-0235` würde ausgeblendet und wäre entfernbar. Physische
Tablet-Abnahme und Windows offen.

## Projekt-Stammordner nach Neustart wieder gültig (2. Oktober 2026)

Behoben: Nach einem Neustart meldete das Tablet „Der Projekt-Stammordner hat sich
geändert“, obwohl `/home/mcmuff/Work` unverändert war. btrfs vergab dem Subvolume
eine neue Geräte-Nummer (55 → 57); die gespeicherte Ordner-Kennung enthielt sie.
Kennungen bestehen jetzt aus Inode und Erstellzeit (`directoryIdentity.ts`);
gespeicherte Werte werden beim Laden einmalig übernommen. Ein ersetzter Ordner
wird weiterhin abgelehnt. Fokussiert **18/0**, `pnpm verify` **28/0/16 nicht
gemessen**, **4.559 Checks**. Nur-lesende Prüfung gegen die persönliche
Konfiguration: Stammordner und drei Projekt-Arbeitsordner passen nach Übernahme.

## Goal 34.5: Wartezeit nach Push-Test sichtbar (1. Oktober 2026)

Der Status liefert `testRetryAfterMs` relativ zur Hostantwort; „Testnachricht
senden“ bleibt bis Ablauf gesperrt und zeigt einen Countdown, eine abgewiesene
Wiederholung erscheint als Statushinweis statt Sammelfehler. Verträge **64/0**,
Chromium/HTTPS **30/0**, Verify **22:22 CEST: 28/0/16 nicht gemessen**,
105 Suiten / 4.485 Checks. Commit `5ea398f`; physische Tablet-Prüfung offen.

## Goal 34.3: unterbrochene Arbeit mit Ursache (1. Oktober 2026)

Unterbrochene Sitzungen und Aufgaben nennen, wie ADE zuvor endete: Rechner neu
gestartet, ADE beendet, ADE unerwartet beendet oder unbekannt. Nichts wird
wiederholt oder fortgesetzt; Kopplungen bleiben erhalten. Doppelstart erzeugt
keinen zweiten Profileigentümer. Linux: Lebenszyklus **24/0**, Betrieb **54/0**,
Aktivierungstreiber **21/0**, Verify **28/0/16 nicht gemessen**, 106 Suiten /
4.531 Checks. Echter Rechnerneustart, Windows und physische Anmeldung/Sperre
offen. [Nachweis](HANDOFF.md).

## Physischer Push-Testempfang bestätigt (1. Oktober 2026)

Benutzer bestätigt den Empfang der ADE-Testnachricht auf dem Android-Tablet.
Chrome-Screenshot zeigt Opt-in und Provider-Annahme; Host-Audit bestätigt
Ausführung. Eine weitere Testanforderung nach rund 16 Sekunden wurde durch die
30-Sekunden-Sperre abgewiesen und irreführend als allgemeiner Fehler angezeigt.
Hintergrund-/Sperrbildschirmempfang und echte Aufgabenereignisse bleiben offen;
die gezielte Wartezeitanzeige ist inzwischen umgesetzt (Abschnitt oben). [Nachweis und Grenzen](HANDOFF.md).

## Push-Anmeldung: nachvollziehbare Fehler und Statusprüfung

Korrektur nach physischer Tablet-Rückmeldung: getrennte Hilfe für Berechtigung,
Hintergrundkomponente, Browser-Anmeldung und Host-Ablehnung. Statusladen bestätigt
auch unveränderten Zustand; der Test bleibt sichtbar und erklärt seine Sperre.
Gezielter Chromium-/HTTPS-Test **27/0** mit simuliertem Push-Dienst. Vollständiges
Verify **12:30:58 CEST: 28/0/16 nicht gemessen**, 105 Suiten / 4.477 Checks.
Aktiviert **12:32:53 CEST**, Gate **14/0/1**, echtes HTTPS :8443 **200** mit
21 passenden Dateien, Pairing/Push-Vault erhalten. Physische Tablet-Fehlerursache
und Empfang waren damals offen; der Testempfang ist inzwischen bestätigt (oben). [Aktueller Nachweis](HANDOFF.md).

## Goal 34.5: erste mobile Push-Lieferung (1. Oktober 2026)

Geräte-Opt-in, Kategorien, Test, verschlüsselte Abonnements/VAPID, neutrale
Meldungen, Widerruf, Duplikatbegrenzung und erneut autorisierte Detailnavigation
für bestätigte ADE-Aufgaben-/Run-Ereignisse implementiert. Android Chrome/Google
ist der erste Transport; keine automatische Interpretation interaktiver CLIs.
Verträge **56/0**, Chromium-/HTTPS-Ablauf mit simuliertem Push-Dienst **19/0**,
Mobile-Protokoll **114/0**. Vollständiges Verify **10:32:37 CEST: 28/0/16 nicht
gemessen**, **105 Suiten / 4.477 Checks**. Persönlich aktiviert um **10:35:46 CEST** über `pnpm activate`, Gate **14/0/1
nicht gemessen**; echtes HTTPS auf **:8443**, HTML und 21 passende Dateien geprüft.
Kopplung und Serve-Konfiguration erhalten, OpenClaw :443 weiter HTTPS 200.
Physischer Testempfang inzwischen bestätigt; Hintergrundempfang und native Windows-Abnahme offen.
Stabilisierung am Abend: spätere bestätigte Nachricht mit gleichem Tag meldet sich
erneut (`renotify`), Burst-/Duplikatgrenzen, neutrale Texte aller Kategorien,
Antippen offline ohne Vormerkung, widerrufenes Gerät ohne Zugriff und unterbrochene
Arbeit (34.3) als neutrale Fehlermeldung belegt. Verträge **74/0**, Browser **33/0**,
Verify **23:19:14 CEST: 28/0/16 nicht gemessen**, **106 Suiten / 4.541 Checks**.
[Nachweise, Erstlauffehler und Grenzen](HANDOFF.md).

## Goal 34.4: Entscheidungen auf Desktop und Tablet (1. Oktober 2026)

Gemeinsame Übersicht mit bestätigten Fragen, Ergebnissen, CLI-Zuständen,
Prozessverlust und Morgenübergaben implementiert. Direkte Detailnavigation,
aktuelle Gerätefreigaben, Tastatur/Fokus, Offline-/Fehlerzustände geprüft.
Zusätzlich tatsächlichen Fokusfehler beim Fortsetzen eines Gesprächs behoben.
Vollständiges Verify **10:06:08 CEST: 27/0/16 nicht gemessen**, **104 Suiten /
4.417 Checks**. Zusammen mit 34.3/34.5 um **10:35:46 CEST** persönlich aktiviert;
keine neue physische Android-/Windows-Abnahme. [Belege und Grenzen](HANDOFF.md).
Abends ergänzt: Entscheidungen direkt in der Übersicht nach gemeldeten
Fähigkeiten (beantworten, abbrechen, anweisen, Eingabe übernehmen; keine Pause),
fensterlokale Entwürfe und höchstens einmalige Zustellprüfung. Linux-Treiber
**56/0**, Verify **22:49:25 CEST: 28/0/16 nicht gemessen**, **105 Suiten /
4.507 Checks**. Noch nicht aktiviert; echte Codex-, Windows- und
Tablet-Abnahme offen.

## Goal 34.3: Betrieb und Start (1. Oktober 2026)

Lokale Opt-ins für Login-Autostart (Linux XDG / Windows-API), Tray ohne mobilen
Zugriff und angefordertes Wachhalten implementiert. Keine automatische
Wiederholung unterbrochener Arbeit. Linux-Betriebsvertrag **54/0**, tatsächlicher
Desktop-Dateiprüfer/GIO-Argumenttransport erfolgreich, Electron-/Tablet **92/0**,
Agent-/Tablet **33/0**. Windows-Adaptertests sind kein Windows-Betriebsnachweis;
physische Anmeldung/Sperre und Tablet-Hintergrundzustellung bleiben offen.

`pnpm verify` **1. Oktober, 09:23:52 CEST**: **27/0/16 nicht gemessen**,
**103 Suiten / 4.381 Checks**, drei Typechecks und isolierte Builds. Archiv:
`test-results/goal343-operation-20261001/`. Zusammen mit 34.4/34.5 persönlich
aktiviert am 1. Oktober um **10:35:46 CEST**.
Auftrag bis möglichst 34.5 läuft weiter; [Betriebsdetails und Grenzen](HANDOFF.md).

## Goal 34.2: native Linux-Prompts und Agent-Profile (30. September 2026, spätabends)

Neue feste native Linux-Codex-/Claude-/Grok-Sitzungen unterstützen geschützte
Promptübergabe ohne verbleibende Shell nach CLI-Ende. Gespeicherte Profile werden
für Codex/Claude/Qwen ausserhalb des Workspaces übertragen; bestehende Codex-
Anweisungen bleiben erhalten. Desktop-Profilablauf **39/0**, neuer Tablet-Ablauf
**29/0** mit vier nativen CLI-Fixtures, Wiederverbindung, verlorener Bestätigung,
Datei-/Difflesen und Rückfragen. Fokussiert: **28** Prompt-, **12** Profilargument-,
**12** Konfigurations- und **30** Prozesschecks. Echte Codex-TUI-/Modellprobe
**0.159.0 / gpt-5.6-sol / high bestanden**. [Nachweise und Grenzen](AGENT_SESSION_PLATFORM_RESULTS.md).

Vollständiges `pnpm verify` am **30. September 2026 um 23:02:15 CEST**:
**27 bestanden / 0 Fehler / 16 nicht gemessen**, **102 Suiten / 4.325 Checks**,
drei Typechecks, beide isolierten Builds, Browser-/Electron-Abläufe und
Linux-Aktivierung **15/0**. Archiv: `test-results/goal34-linux-profiles-20260930/`
mit Vollbericht, Schrittlogs, positiver nativer Codex-Probe und Tablet-Bildern.
Die 16 nicht gemessenen Schritte besitzen explizite Plattformgründe. Kein
vollständiger Windows- oder physischer Android-Nachweis wird daraus abgeleitet.

**Persönlich aktiviert am 1. Oktober um 08:14 CEST** über `pnpm activate`,
Gate **13/0/1 nicht gemessen**, Backup und `out.prev` geprüft. Neuer Host
**2666350**, HTTPS auf **:8443** und sieben Assets mit gültigem Zertifikat
bestätigt; Kopplungsdaten und Serve-Konfiguration unverändert, OpenClaw **:443**
weiter HTTPS 200. Tablet neu laden und neue Codex-Sitzung starten. Zunächst
blockierte eine nach Codex-Ende verbliebene leere Shell; nur diese wurde nach
Prozessprüfung geschlossen. [Betriebsnachweis und Fehlerverlauf](HANDOFF.md).
Vollständige Plattformabnahme, weitere reale CLIs und physisches Android bleiben
offen. Goal 34.6 folgt separat.

## Benannte Weblinks im Tablet-Terminal (30. September 2026, Abend)

Der Android-Screenshot zeigte einen unterstrichenen Codex-Link „Knuckles Pi
öffnen“, dessen OSC-8-Ziel bisher aus der Übertragung entfernt wurde. Main liefert
jetzt geprüfte HTTP(S)-Ziele getrennt von Terminal-Steuersequenzen und zugeordnet
zu den tatsächlichen Zellen. Antippen zeigt die vollständige Adresse; explizites
Öffnen verwendet einen neuen Tab. **Links** und **Verlauf** sind ebenfalls
bedienbar, inklusive Tastatur/Fokusrückkehr und schmaler Ansicht. Lokale Dateiziele,
Zugangsdaten und redigierte Ziele bleiben ausgeschlossen. [Vertrag](TERMINAL_MEDIA.md).

Fokussierter Linux-Electron-/Browserlauf **87/0**, inklusive neun neuer
Link-Bedienprüfungen; alle drei Typechecks und beide isolierten Builds bestanden.
Parser-Suite **77/0**; abschliessendes `pnpm verify` **25 bestanden / 0 Fehler /
17 nicht gemessen**, **102 Suiten / 4.304 Checks**. Belege:
`test-results/terminal-hyperlinks-20260930/`. Erster Aktivierungsversuch an der
laufenden Knuckles-Pi-Sitzung sicher blockiert. Nach deren Ende durch den Benutzer
**um 21:29 CEST aktiviert**, mit Backup, Rollback und Gate **13/0/1 nicht gemessen**.
Reales HTTPS samt neuem Terminal-Modul geprüft, Geräte-Vault und Serve-Konfiguration
unverändert. Tablet neu laden, bestehende Kopplung weiterverwenden.
Aktueller Betriebsnachweis in [HANDOFF](HANDOFF.md).
Neue Windows- und physische Android-Abnahme der Korrektur bleiben offen.

## Goal 34: Linux-Aktivierung, Agent-Sitzungen und Tablet-Zugang (30. September 2026)

ADE bleibt eine eigenständige Sitzungsverwaltung auf nativen Linux-/Windows-Hosts.
OpenClaw ist keine Produktabhängigkeit. [Produktziele](AGENT_SESSION_PRODUCT_GOALS.md),
[Fähigkeitsmatrix und Nachweise](AGENT_SESSION_PLATFORM_RESULTS.md),
[persönlicher Betriebsstand](HANDOFF.md).

- **34.1:** Persistierte HTTPS-Portwahl 443/8443/10000, exakte Origin in Status,
  Probe, Pairing, Restore und Disable. Fremde Foreground-/Background-Routen bleiben
  erhalten. Funnel bekommt einen eigenen Hinweis und bleibt global ausgeschlossen.
  Main-Stacks bleiben im Log. Mobile-Verträge **108/0**, Mobile Electron **37/0**.
- **34.2:** Linux-Sitzungskern **17/0**, Navigation **14/0**, Startverträge **47/0**,
  kombinierter Port-/Desktop-/Tablet-Treiber mit vier echten Shells **78/0**.
  Native Codex-Rückfrage **5/0** und vollständige native Codex-Browserprobe **16/0**
  (Codex 0.159.0, gpt-5.6-sol/high): Auftrag, Bestätigung, Rückfrage/Antwort,
  Verbindungsverlust, Ergebnis, Host-Neustart und erhaltene Kopplung. Browser/TLS
  im Modelllauf sind Fixtures; es ist keine physische Android-Abnahme.
- **34.3:** `pnpm activate` wählt den Plattformtreiber. Linux erzwingt Gate,
  private Profilbackups vor/nach regulärem Quit, `out.prev` und bestätigten
  Wiederanlauf samt zuvor aktiviertem Listener. Aktive Arbeit blockiert den
  Treiber und zusätzlich den neuen atomaren Quit im Host. Ein fehlgeschlagener
  Start stellt den vorherigen Build wieder her. Reale Electron-Probe **15/0**.
  Der Windows-PowerShell-Weg bleibt erhalten, neue Windows-Abnahme offen.

Vollständiges `pnpm verify` unter Linux: **25 bestanden / 0 Fehler / 17 nicht
gemessen**, **102 Suiten / 4.283 Checks**, drei Typechecks, beide isolierten Builds
und echte Electron-/Browser-Treiber. Vollbericht: `test-results/goal34-full-20260930/final/`;
spätere Aktivierungsgates ersetzen nur den aktuellen `verify/report.json`.

Persönlich aktiviert um **17:13 CEST**, PID **1511026**: private Freigabe auf
**8443**, reale TLS-/Asset-Prüfung und Browserkopplung bestanden. OpenClaws reale
Route auf **443** ist unverändert, weiterhin HTTPS 200. Backups und Belege: HANDOFF.
Linux-Profiltransport und geschützte Promptübergabe sind im späteren Eintrag oben
ergänzt; weitere native CLIs, vollständige Windows- und physische Android-Abnahme
bleiben offen.
Goal 34.2 wird deshalb noch nicht als vollständiges Produktteilziel abgeschlossen.

## ADE-Gespräch unter Linux (29. September 2026)

Das zentrale ADE-Gespräch (Projektbetreuung, Aufträge vorbereiten, Plaudern & Stimme; PC und Tablet)
war hart auf Windows begrenzt (`launchCoordinatorCodex`, `CoordinatorConversation`). Unter Linux/macOS
startet jetzt ein konstanter Node-Starter (`POSIX_COORDINATOR_LAUNCHER`, Electrons eigenes Node, keine
Shell) dieselben zwei Stufen wie das PowerShell-Skript: MCP-Inventar ohne Verbindung, jeden geprüften
Namen nur für diesen Prozess abschalten, dann `codex app-server` mit ADEs Vorgaben; Signale werden
weitergereicht. Die Prüfungen danach (CLI-Version, wirksame Konfiguration, schreibgeschützter Thread
ohne Netz) sind unverändert und gelten auf beiden Systemen.

Nachweis (Omarchy, Codex 0.158.0): Rauchtest mit dem echten CLI bis `thread/start` (kein Modellaufruf) —
Version, wirksame Konfiguration und Thread-Sandbox bestätigt; mit zwei geerbten MCP-Servern ebenso;
**Negativkontrolle** ohne Abschaltung → ADE verweigert. Suite `coordinator-codex-policy` 58/0 (7 neue
Prozessprüfungen: Inventar-Argumente ohne Shell, Abschaltung je Name, cwd/Umgebung, stdio-Durchreichung,
ungültiger Name und fehlschlagendes Inventar stoppen vor dem Server, SIGTERM beendet auch einen hängenden
Server — ohne Weiterleitung FAIL). `conversation-electron` unter Linux **90/0** (vorher nicht gemessen;
das Double greift jetzt auch beim Linux-Start von Koordinator und Worker). `pnpm verify` Linux zweimal
grün: 23 gemessen, 18 Windows-only ausgewiesen. Eine Fokusprüfung („continuation focuses the draft“) wartet
jetzt bis 5 s statt einmal zu stichproben (lief unter Last zu früh).

## Linux-Prüfstand: `pnpm verify` grün, Windows-only ausgewiesen, zwei echte Fehler behoben (29. September 2026)

`pnpm verify` war unter Linux mit 33 roten Schritten wertlos; auf `main` war auch die Linux-CI rot
(`project-publish`). Jetzt: **22 unter Linux gemessene Schritte grün, 19 „nicht gemessen“ mit Grund**
(zweimal in Folge; 2 min 15 s).

- **verify:** Schritte tragen Plattformen; anderswo `not-measured` mit Grund, am Ende gelistet, nie rot
  oder stillschweigend grün. Unter Linux laufen die Treiber auf eigenem `HOME` (die Login-Shell mit
  `mise activate` sortierte die Fixture-CLIs hinter die echten) und auf **einem** von verify
  gestarteten Xvfb (`xvfb-run` je Treiber meldete bei eigenem Aufräumen Exit ≠ 0; Electron braucht
  dort `XDG_SESSION_TYPE=x11`). Fehlt Playwrights Chromium, bricht verify sofort mit dem Befehl ab.
- **Testkorrekturen:** `project-publish` baut das `gh`-Double ausserhalb Windows als Node-Skript
  (41/0 unter Linux); `work-electron` beendet den Renderer unter Linux per SIGKILL
  (`forcefullyCrashRenderer()` tat dort nachweislich nichts); das Rückfragen-Double greift auch beim
  Linux-Start `codex app-server` (Tablet-Rückfragen unter Linux jetzt nachgewiesen).
- **Fehler in ADE behoben:**
  - *Dialog nach Fokusverlust:* Deaktiviert eine Aktion den fokussierten Knopf (Stimmenstudio beim
    Speichern), fällt der Fokus auf `<body>` und Escape schloss den Dialog nicht mehr. `Modal` schliesst
    jetzt den obersten Dialog auch dann. Tab braucht keine Hilfe (Chromium setzt die Navigation am
    verlorenen Element fort; gemessen). Negativkontrolle: ohne Fix scheitert die Prüfung.
  - *Tablet-Modellwahl verschwand:* Eine Profil-Antwort ohne Katalog, die nach dem Katalog eintraf,
    löschte ihn (Race unter Last). Sie behält jetzt den geladenen Katalog desselben Agents.
    Deterministische Prüfung per zweitem Neuladen; ohne Fix FAIL.
- **Neue Produktlücke sichtbar:** Das **ADE-Gespräch (Koordinator) lief nur unter Windows**
  (`launchCoordinatorCodex`) — geschlossen im folgenden Eintrag.
- Enthält PR #19 (Keyring-Schalter), ohne den drei Treiber an der Schlüsselablage scheitern.

## Installation: `pnpm doctor`, Selbstreparatur beim Install, Schlüsselablage unter Hyprland (29. September 2026)

- **`pnpm doctor`** prüft Node (≥ 22), pnpm (Pin 9.15.9), Git, den Electron-Download, ob node-pty
  **in Electron** lädt, die Agent-CLIs und (Linux) den Secret Service. Jeder Fehler nennt den
  Befehl, der ihn behebt; `--fix` repariert Electron-Download und node-pty automatisch.
- **`pnpm install`** ruft `doctor --postinstall` auf: repariert, zeigt den Bericht, lässt die
  Installation nie scheitern; übersprungen mit `CI` oder `ADE_SKIP_POSTINSTALL`.
- **Schlüsselablage:** Auf Desktops, die Chromium nicht kennt (Hyprland, Sway, …), startet ADE
  Electron mit `--password-store=gnome-libsecret` (`src/main/passwordStore.ts`); ein expliziter
  Schalter hat Vorrang.
- `.nvmrc` und `engines.node` legen Node 22 fest.

Nachweis (Omarchy/Hyprland, Linux): frischer Klon, `pnpm install` holt den übersprungenen
Electron-Download selbst nach, danach alles grün. Negativkontrolle: absichtlich zerstörtes
`pty.node` → `doctor` FAIL mit Loader-Meldung, `doctor --fix` baut neu → grün. Neue Suite
`doctor` 20/0. `pnpm verify` unter Linux: 31 rote Schritte, Vergleichslauf auf `main` (3070b1c)
auf derselben Maschine 33 rote — keine neuen. Die Linux-Rotschritte sind Windows-gemessene
Treiber (z. B. „Setup flow is currently measured on native Windows“) und Test-Doubles, die eine
Login-Shell mit `mise activate` hinter die echten CLIs sortiert. Durch die nun verfügbare
Schlüsselablage laufen in `electron-workflow` 16 Prüfungen zusätzlich; die zwei neuen roten
(Grok-Sitzung) haben dieselbe Ursache: das echte `grok` statt des Doubles.

## Import: Klone in Ordner suchen, sichtbare Blocker, gleitende Gültigkeit (29. September 2026)

- **„Klone in Ordner suchen…“** im Import-Formular: ein Ordner wählen (Vorgabe: Projekt-Stammordner),
  ADE füllt alle leeren Repository-Felder — zuerst über den Git-Remote (dieselbe Vergleichsregel wie
  der Planer), sonst über den Ordnernamen (Quell-Ordnername oder Anzeigename, ohne Gross/Klein und
  Satzzeichen). Kein Klon doppelt, kein Namenstreffer gegen einen widersprechenden Remote, mehrdeutige
  Namen bleiben offen. Vorschläge laufen weiter durch Autorisierung und Repository-Probe.
- **„Import blockiert durch: …“** nennt jeden Eintrag, der das Anwenden sperrt, mit Zustand und Grund.
- Die Import-Auswahl verfällt 10 Minuten nach der **letzten** erfolgreichen Vorschau statt nach der Wahl.
- Der Hinweis zu nicht übernommenen Startbefehlen/Dashboards nennt den Agent.
- Enthält den Fix aus PR #18 (Elternordner `agents/` für vorgeschlagene Agent-Homes).

Nachweis (Linux): `workspace-bundle` 213/0 (neu: Zuordnung per Remote/Name, Widerspruch, Mehrdeutigkeit,
keine Doppelvergabe, echter Ordner-Scan mit Git inkl. Symlink/versteckt); `security` 291/0 (neuer
Kanal `workspaceBundle:findClones`, `host`); `electron-workflow` mit neuem Formularlauf (Blocker sichtbar
→ Suche füllt beide Repos → Vorschau „bereit“). Die Prüfung „a completed refresh clears the
stale-preview marker“ suchte das nie angezeigte „Preflight: veraltet“ und konnte nicht scheitern; sie
prüft jetzt „Vorprüfung: veraltet“. `pnpm verify` unter Linux: dieselben 33 roten Schritte wie `main`
auf dieser Maschine, keine neuen.

## Validation repository policy

The completed Goal 6 record on `2D_rpg_jumpnrun` remains immutable historical
evidence. New operator-driven ADE product, managed-run and general-use
validation prefers RhinoClaw. Such runs use disposable ADE worktrees and
branches and must not mutate RhinoClaw's ordinary working tree, `main`, deployed
skill or live Rhino installation without separate operator approval.
Deterministic automated CI/Electron workflows continue to use synthetic local
fixture repositories rather than depending on any personal checkout.

## Known constraints

- Worktree-binding cleanup is exposed but deliberately refuses active leases,
  live sessions and dirty worktrees; unmerged branches remain reachable.
  Repository-catalog deletion and bulk cleanup are not exposed. Agent/category
  deletion removes catalog references without deleting user files.
- The repeatable-run reset targets the orchestrator worktree's HEAD, not a
  repository default branch, and never touches the orchestrator worktree
  itself. Archive refs under `refs/ade/archive/` accumulate one entry per
  reset participant per run and are not pruned automatically. The task time
  budget is coordinator-owned: the timer is not persisted, so after an ADE
  restart interrupted tasks fail through restart recovery rather than through
  the budget. `forceStop` still does not escalate the kill, task PTYs still
  run at 120 columns, and `attempt` never exceeds 1.
- Dashboards whose sign-in redirects through a foreign identity provider
  cannot complete that hop inside the ADE window (the redirect opens in the
  system browser); use `dashboardTarget: 'external'` for such dashboards.
  Clearing a dashboard partition is exposed only through agent deletion; there
  is no "sign out of dashboard" action yet. The channel policy's `audit` lines
  go to the main-process log. Remote requests and device administration additionally
  have their own durable audit journal; general desktop calls do not.
- Workspaces whose root or a component is itself a symlink/junction are now
  unreadable in the Files panel, consistent with the mutation guards. A
  `dashboardCommand` remains operator text executed through a shell; the
  policy marks it, it does not sandbox it.
- Legacy Graph categories and `teamRole` fields are retained to avoid deleting
  user data, but new runs and the Graph renderer do not use them as ownership.
- The event journal, structured results, approvals, messages, artifacts and
  the command log share the atomic JSON config, now written compact. History
  retention bounds it: terminal runs beyond the newest 40 that are older than
  30 days — and, above 4 MiB, the oldest terminal runs regardless — are
  archived to `userData/ade/archive/runs/<runId>.json` and pruned at startup
  and hourly; open, leased and published runs are never pruned, and the
  journal `seq` floor keeps cursors monotonic. Archived runs are no longer
  visible in the Graph or the host API (there is no archive browser yet).
  Renderers receive a slim `OrchestrationView` (no prompts, artifact bodies or
  mailbox texts), coalesced per tick; the renderer still replaces whole slices
  on every broadcast (no `run:events` delta consumer, no `React.memo`).
  Indexed storage is conditional on measured need in Goal 11; bounded retention already exists.
- Team pause does not survive an ADE restart: restart recovery fails runs with
  queued tasks, so a paused run closes fail-closed instead of resuming paused.
  Restart-persistent pause is a separate work item.
- Task provenance (prompt/schema/adapter versions, manifest hash) lives in the
  journaled task-context artifact rather than directly on the task record.
  Restart restoration validates uniqueness, digest and version compatibility
  before reusing the persisted manifest and brief.
- Task transports are deterministic for supported non-interactive CLIs. Native
  Grok Build managed tasks use `--prompt-file` plus `--output-format streaming-json`
  (`grok-json-v1`); ADE renders a live activity feed, extracts the structured
  result from streamed `text` / `end` events, and overlays token/cost
  telemetry fail-closed. `--json-schema` is not used because the CLI accepts
  only inline JSON, which ADE will not interpolate into a shell. Custom
  commands still receive the prompt over stdin.
- Auth status is definitive for Claude, Codex and Grok Build (`grok models`
  login line, a stored ADE `XAI_API_KEY`, or the process environment). Other
  third-party CLIs that lack a stable non-interactive status command report an
  explicit warning; custom command text is never executed or returned by
  diagnostics.
- Windows packaging is x64-first; local/branch artifacts are unsigned and the
  release workflow requires `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` to sign.
  Linux x64 AppImage and Debian targets are locally and hosted package-tested;
  the project-license decision and versioned public release remain gates.
  Auto-update, Linux signing and macOS packages do not exist yet.
- The Windows-GUI→WSL backend is explicit and Windows-only. It requires WSL2
  plus `/bin/bash`, Git, Python 3, `gio` and each selected agent CLI/credential
  inside the distribution. Repository import accepts a Linux absolute path;
  the native folder picker does not browse it. WSL worktrees use a sibling
  `.ade-worktrees` root and ignore the Windows worktree-base setting.
- Managed WSL tasks receive their durable, role-aware `AGENTS.md` snapshot and
  Windows-owned task artifacts through controlled path translation. An
  interactive WSL shell reads repository instructions normally, but ADE does
  not yet inject its Windows-owned memory block into that Linux worktree.
- The global task cap remains four CLIs; a managed run can choose a lower
  worker cap. Native Codex usage arrives with the final turn, so one task can
  overshoot a run token limit and concurrent tasks can consume tokens before a
  just-exceeded limit cancels their siblings. Provider-side account limits are
  still the ultimate real-time spend boundary.
- Codex reports token usage in native JSONL but no billed USD. Cost budgets are
  therefore unavailable for that adapter until the CLI/provider reports cost;
  custom wrappers may supply trusted token/cost fields through the file result.
- Dependency edges transfer Git state: before a dependent repo-backed worker
  launches, ADE prepares its leased worktree with its dependencies' validated
  commits (first parent adopted verbatim, further parents replayed as owned
  deltas in assignment order) and persists the prepared base on the task.
  Validation and integration count only owned deltas, so upstream ranges are
  never duplicated; conflicting parent deltas fail the run closed before the
  dependent launches. This closes the Goal 6 F3/F4 add/add-union failure mode
  and is proven by focused real-Git coordinator tests that reconstruct the
  2-producer→1-consumer topology. The completed live Codex reruns
  `3a2773cc` (F3) and `9bcd8932` (F4) then proved the same contract through
  approval, conflict-free integration, integration review and read-only
  verification: dependent prepared bases matched their upstream tips exactly,
  integrated ranges equaled the union of owned deltas, and both runs had zero
  rollback. The earlier `51bdbaf7` driver interruption and `c3c232c6` external
  DNS outage remain explicitly excluded evidence; protocol and full SHAs are
  in `docs/goal6/F3F4_RETEST.md`. Base preparation and integration cherry-picks
  require a resolvable Git committer identity in the repository's backend, as
  integration always has.
- Git integration requires each changing worker to report every changed path
  and leave HEAD untouched. ADE refuses a report/diff mismatch, creates the
  commit with hooks and signing disabled, and transactionally cherry-picks the
  validated linear ranges from each task's owned base. Merge commits are
  rejected and a conflict aborts the whole sequence. The beta caps one worker
  range at 50 and one run integration at 200 commits.
- Plain-workspace runs keep the same plan/result/approval/verification control
  plane but can only reconcile reports; they do not claim git integration.
- Managed-run verified publishing currently supports only a GitHub `origin` plus an
  installed/authenticated `gh` in the repository's own execution backend. The
  remote default branch must still equal the leased base exactly; ADE does not
  rebase, update an existing conflicting ref, merge, auto-merge or delete a
  remote branch. Multiple origin URLs and multiple/different explicit push URLs
  are rejected; Git URL-rewrite configuration remains part of the trusted local
  Git environment. Completed runs from before the immutable verification
  attestation must be rerun. WSL publication requires `gh` and its login inside
  that distribution; this slice is locally verified on Windows and remains to
  join the next hosted/native-Linux matrix. Push hooks are disabled, so Git-LFS
  or other hook-dependent publication needs a later explicit contract/manual
  path.
- Open-PR inspection currently supports one unambiguous GitHub `origin` and an
  installed/authenticated `gh` in that repository's execution backend. It does
  not fetch remote refs or show provider CI logs yet; unsupported/offline/auth
  states remain separate from the always-local status and commit history.
- Mobile access is opt-in in desktop Settings and remains loopback-only behind
  private Tailscale Serve. Systematic physical phone/tablet and carrier-network acceptance
  must be measured separately from Chromium/Electron automation. The legacy
  environment API cannot run concurrently with the mobile controller.
- The fsynced remote audit has an 8 MiB hard cap; full/broken storage disables
  device authorization until offline maintenance. Device history is capped at
  100 records including revoked tombstones. Maintenance/recovery UI is pending.
- SSE resumes from the journal cursor, resets to an authoritative snapshot
  behind retained history and closes on session expiry, rotation or revocation.
  Fetched content and file/profile drafts stay in memory. The tablet project-start
  delivery adds bounded device storage for task/terminal drafts and pending work
  keys; reload restores them without submitting anything automatically. General
  management-dialog retry state still requires the same open page.
- Electron IPC, runtime configuration and managed-run verified publishing remain
  local. Independent-project commit/merge/push/PR use the dedicated T3–T5 project
  API with explicit device grants. Terminal, file and profile access also use
  dedicated APIs and desktop grants. Direct LAN binds, router forwarding,
  Tailscale Funnel and public tunnels are unsupported.

## Ältere Lieferchronik

Datierte Abschnitte vom 10. bis 28. September 2026 liegen unverändert im
[Archiv-Checkpoint vom 4. Oktober](archived/STATUS_2026-10-04_CHECKPOINT.md).
