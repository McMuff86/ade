# Goal 34 — ADE als eigenständige Sitzungsverwaltung auf Linux und Windows

Stand: 1. Oktober 2026, abends (erstellt am 30. September). Der Benutzer hat
die Erstellung und anschliessend die Umsetzung dieser Arbeitsziele beauftragt.
**34.1–34.5 unter Linux implementiert und fokussiert sowie mit `pnpm verify`
geprüft (zuletzt 28/0/16 nicht gemessen, 106 Suiten / 4.541 Checks); 34.6 nicht
begonnen. Windows-, physische Tablet- und weitere native Adapterabnahmen offen.**
Linux-Desktop-/Tablet-, native Codex- und Aktivierungsnachweise liegen vor;
persönlicher Betriebsstand und echte HTTPS-Prüfung: [HANDOFF](HANDOFF.md); [Nachweise und Wiederaufnahme](AGENT_SESSION_PLATFORM_RESULTS.md#fortsetzung).

## Zielbild

ADE ist ein eigenständiges Produkt zur Verwaltung mehrerer Agent-Sitzungen.
Es läuft nativ unter Linux (hier Omarchy) und nativ unter Windows. Jede ADE-
Instanz verwaltet die Agent-Prozesse, Projekte und Sitzungen auf ihrem Rechner.
Ich kann Sitzungen starten, unterscheiden, beobachten, steuern und wiederfinden,
am Desktop ebenso wie über den gekoppelten Tablet-Zugang der jeweiligen Instanz.
Ein Verbindungsabbruch verliert weder die Arbeit noch die eindeutige Bestätigung
meiner Eingaben. Später läuft die Arbeit unabhängig von der Desktop-Oberfläche
in einem eigenen ADE-Host weiter.

OpenClaw gehört weder zum Produktmodell noch zu seinen Voraussetzungen.
herdr dient nur als konzeptioneller Vergleich. Die Agent-CLIs sind über ihre
jeweiligen Adapter angebunden; Unterstützung wird pro Plattform und Fähigkeit
nachgewiesen. Interaktive Sitzungen funktionieren auch ohne verwalteten Run
oder eingeschaltete ADE-Projektbetreuung.

Linux und Windows sind gleichwertige Produktziele mit getrennten Nachweisen.
Die Entwicklungsreihenfolge darf Linux-Lücken zuerst schliessen, ersetzt aber
keine Windows-Abnahme. Windows-UI mit WSL-Backend sowie Linux unter WSLg bleiben
gesonderte Ausführungsmodelle; macOS ist nicht Gegenstand dieser Lieferung.
Zugriff auf mehrere ADE-Rechner baut auf Goal 28 auf: Jeder Zielhost muss selbst
ADE ausführen und das Gerät autorisieren. Ein gemeinsames Hostverzeichnis wird
dort geplant; eine Migration laufender Prozesse zwischen Betriebssystemen wird
hier nicht vorausgesetzt.

## Ausgangslage und bestehende Verträge

Die Bestandsaufnahme vom 30. September fand herdr 0.8.2 bereits installiert und
Tailscale online. Die private HTTPS-Freigabe auf Port 443 führte zu OpenClaw.
`TailscaleService.inspect(4317)` meldete `conflict`, `serving: false`; am lokalen
Port 4317 bestand kein Listener. Dies ist ausschliesslich ein lokaler
Einrichtungsbefund. Er begründet keine OpenClaw-Integration, keine Abhängigkeit
und kein eigenes Koexistenz-Produktziel. Allgemeine Portkonflikte muss ADE
verständlich behandeln. Vor persönlicher Einrichtung erneut nur lesend prüfen.

ADE besitzt bereits mobile Aufgaben, Gespräche, Rückfragen, Datei-/Diffansichten,
interaktive Terminals und Tray-Betrieb. Der lokale vollständige Prüfbericht vom
29. September enthält 23 bestandene und 18 nicht gemessene Schritte. Insbesondere
die ausführlichen Terminaltreiber und der Remote-Neustart waren Windows-only.
Der Bericht ist historische Evidenz und ersetzt keine neue Abnahme.

Dieses Goal bündelt die **eigenständige Linux-/Windows-Lieferung** bestehender Verträge:

| Grundlage | Fortführung in diesem Plan |
|---|---|
| Goals 7/8: Host API und Mobile Connect | 34.1: eigenständiger privater Zugriff auf den jeweiligen ADE-Host |
| Goals 17/25/27: Terminal, Latenz und Sitzungswechsel | 34.2: mehrere Agent-Sitzungen unter Linux und Windows |
| Goals 10/12: Verfügbarkeit und Neustart | 34.3 und 34.6: Betrieb auf beiden Plattformen, danach unabhängiger Host |
| Goals 26/27/33: Betreuung, Arbeitsübersicht und Übergaben | 34.4: gemeinsamer Einstieg für Entscheidungen |
| Goal 9: mobile Benachrichtigungen | 34.5: begrenzter Benachrichtigungsumfang |

Die ursprünglichen Goals behalten ihre Nummern und Verträge. Insbesondere ist
34.5 keine pauschale Abnahme aller privilegierten Freigaben aus Goal 9.
Hostwechsel zwischen mehreren Rechnern (Goals 28–30) bleibt ein eigener Track.

## Reihenfolge und Abhängigkeiten

| Prio | Teilziel | Sichtbares Ergebnis | Voraussetzung |
|---|---|---|---|
| P0, zuerst | 34.2 Agent-Sitzungen | Mehrere Sitzungen auf Linux und Windows eindeutig verwalten | Bestehendes Sitzungsmodell; 34.1 für reale Fernzugriffsabnahme |
| P0 | 34.1 ADE-Zugriff | Den jeweiligen ADE-Rechner eigenständig vom Tablet erreichen | Bestehende Host API; keine weitere Agentenverwaltung erforderlich |
| P1 | 34.3 Plattformbetrieb | Start nach Anmeldung, Tray, sichere Aktualisierung und Recovery auf Linux/Windows | 34.2 als Regression; isolierte Vorarbeit vorher möglich |
| P1 | 34.4 Entscheidungen und Eingriffe | Ein Einstieg zeigt, wo ich gebraucht werde | 34.2 und bestehende Betreuungs-/Rückfragenverträge |
| P2 | 34.5 Mobile Benachrichtigungen | Rückfragen und Ergebnisse erreichen mich bei geschlossener Ansicht | 34.1, Ereignisse aus 34.4, bekanntes Tablet/Browser |
| P2 | 34.6 Unabhängiger ADE-Host | Desktop schliessen/neustarten beendet keine Host-Sitzung | 34.2/34.3; schriftlicher Architekturentscheid vor Umbau |

Die erste nutzbare Lieferung umfasst 34.1–34.3. Sie wartet nicht auf den
Architekturumbau in 34.6. Abgehakte Checkboxen tragen ihren Plattformvorbehalt
(derzeit Linux); keine Teilabnahme ist damit insgesamt erteilt.

## Goal 34.1 — Eigenständiger Zugriff auf den jeweiligen ADE-Host

- [ ] Aktuelle Route, Listener und ADE-Profil ohne Ausgabe von Geheimnissen
  erfassen; vorhandene fremde Freigaben unverändert erhalten.
- [ ] Einrichtung auf einem frischen Linux- und Windows-Host mit installiertem
  ADE und den dokumentierten Transportvoraussetzungen prüfen. Der bestehende
  private Tailscale-Transport bleibt Grundlage; OpenClaw/herdr werden nicht benötigt.
- [ ] Hostidentität, Zieladresse und Gerätefreigabe eindeutig anzeigen. Ein
  Windows-Host führt seine Sitzungen selbst aus, ebenso ein Linux-Host.
- [ ] Belegte Ports/Freigaben verständlich melden. Eine explizite alternative
  Endpunktwahl nur mit durchgängiger Konfiguration, exakter Origin-Prüfung,
  Pairing und Nachweisen anbieten; keine fremde Freigabe automatisch ersetzen.
- [ ] Einrichtung zeigt Zieladresse, tatsächliche Erreichbarkeit und konkrete
  Konflikte. Ausschalten entfernt nur die nachweislich ADE gehörende Freigabe.
- [ ] Negativkontrollen: fremde Route, Funnel, falscher Origin/Host, widerrufenes
  Gerät und abgelaufene Kopplung; abschliessend erfolgreiche neue Kopplung.

**Abnahme:** Je ein nativer Linux- und Windows-ADE-Host besteht TLS-Prüfung,
Pairing, Neuladen, Widerruf und den Negativtest einer belegten Freigabe.
Das Tablet erreicht die jeweilige ADE-Instanz auch ausserhalb des Heim-WLANs.
Persönliche Inbetriebnahme wird als eigener Schritt protokolliert; eine andere
Agentenverwaltung muss weder installiert noch gestartet sein.

## Goal 34.2 — Mehrere Agent-Sitzungen unter Linux und Windows verwalten

Erster Umsetzungsschritt: [Fähigkeitsmatrix, portabler Sitzungstreiber und
Prüfstand](AGENT_SESSION_PLATFORM_RESULTS.md). Der kombinierte Linux-Desktop-/Tablet-Treiber besteht 78/0; die native Codex-Browserprobe 16/0 und der Linux-Aktivierungstreiber 15/0. Die vollständigen
Teilzielkriterien unten bleiben offen; aktuelle Nachweise stehen im Prüfstand.
Die Linux-Lieferung vom 30. September ergänzt geschützte Prompt-/Diktatübergabe,
gespeicherte Profile und einen integrierten Agent-/Tablet-Treiber; seit dem
1. Oktober um 08:14 CEST persönlich aktiviert. Die Fortführung bis 34.5 bestätigt
den Agent-/Tablet-Treiber mit **40/0** und die Sitzungsnavigation mit **95/0**. Neue Sitzungen erhalten
den Schutz; laufende Sitzungen bleiben unverändert. Die Gesamt-Abnahme verlangt
weiterhin Windows- und physische Tablet-Nachweise, der unabhängige Host folgt
separat in 34.6.

- [x] Zuerst eine Fähigkeitsmatrix pro Plattform, Adapter und Sitzungsart aus
  aktuellem Code und Nachweisen erstellen: starten, beobachten, Eingabe senden,
  Rückfrage beantworten, unterbrechen, beenden und nativ fortsetzen. Unterstützt,
  nicht unterstützt und nicht gemessen unterscheiden; keine Versionsannahmen.
  *Erstellt und fortgeschrieben in der [Fähigkeitsmatrix](AGENT_SESSION_PLATFORM_RESULTS.md#fähigkeiten-vorhandener-code-und-tatsächliche-grenzen);
  die Windows-Spalte ist dort ausdrücklich als nicht gemessen geführt.*
- [ ] Mehrere unabhängige Sitzungen über Projekte hinweg starten und wechseln.
  Jede Sitzung besitzt eindeutige Host-/Sitzungsidentität, Workspace, Agent und
  bestätigten Zustand. Entwürfe und Eingaben dürfen nie zur Nachbarsitzung gelangen.

- [ ] Windows-spezifische Terminal-Fixtures durch portable bzw. echte Linux-PTY-
  Fixtures ergänzen und die passenden Schritte in `scripts/verify.ts` aktivieren.
- [ ] Projekt öffnen, Agent/Shell starten, schreiben, Rückfrage beantworten,
  Datei/Diff lesen und Sitzung wiederfinden unter Linux und Windows prüfen.
- [ ] Desktop/Tablet-Übernahme, abgelaufenen Eingabebesitz, Verbindungsabbruch,
  Browser-Neuladen und verlorene Antwort nach akzeptierter Eingabe prüfen:
  kein Doppelstart, keine doppelte Eingabe, unklarer Status bleibt sichtbar.
- [ ] Touch-Tastatur, Hoch-/Querformat, Fokus, 44-px-Bedienziele und längere
  Texte am tatsächlichen Tablet prüfen; Diktat/Bilder separat nach Fähigkeiten
  ausweisen. Tablet-Modell, OS, Browser und Version vor Geräteabnahme erfassen.
- [ ] Native Agent-Proben je CLI getrennt aufzeichnen; mit Codex beginnen.
  Claude/Grok oder andere Adapter nur bei eigener Evidenz als unterstützt melden.

**Abnahme:** Mindestens drei parallele Sitzungen in zwei Projekten auf jedem
Zielbetriebssystem, mit getrennten nativen Proben je freigegebenem Agent-Adapter.
Electron/Playwright mit Linux-PTYs bzw. Windows-ConPTY, fokussierte Vertragsprüfungen
und `pnpm verify` bestehen je Plattform. Eine reale Tablet-/Mobilfunkprobe bestätigt den Ablauf
und erfasst Eingabe-/Wiederverbindungszeiten mit Szenario und Versionen. Simulation,
native CLI-Probe und physisches Gerät werden getrennt ausgewiesen.

## Goal 34.3 — Verlässlicher Betrieb unter Linux und Windows

Implementierungsstand 1. Oktober: lokale Einstellungen für Login-Autostart,
optionalen Tray ohne mobilen Zugriff und angefordertes Wachhalten ergänzt.
Linux-XDG-Dateivertrag und injizierter Windows-Adapter fokussiert geprüft;
physische Anmeldung/Sperre und native Windows-Abnahme bleiben offen. Die
Checkboxen unten beschreiben weiterhin die vollständige Plattformabnahme.

Stabilisierung am 1. Oktober (abends): ADE unterscheidet nun, wie der vorherige
Profileigentümer endete (Rechner neu gestartet, ADE beendet, ADE unerwartet
beendet, unbekannt), und zeigt das bei unterbrochenen Sitzungen auf PC und
Tablet; Aufgaben erhalten den passenden Fehlergrund. Nichts wird wiederholt
oder fortgesetzt. Der Linux-Aktivierungstreiber belegt zusätzlich Doppelstart,
SIGKILL-Absturz und reguläres Beenden mit offener Shell, jeweils mit erhaltener
Kopplung. [Nachweise](AGENT_SESSION_PLATFORM_RESULTS.md).

- [ ] `pnpm activate` plattformgerecht erweitern: Gate, Profilbackup, reguläres
  Beenden, `out.prev`, Rollback und bestätigter Wiederanlauf unter Linux.
  Den bestehenden Windows-Weg als Regression prüfen. Aktive Arbeit blockiert
  eine unterbrechende Aktualisierung mit klarer Begründung.
  *Linux im Disposable-Profil belegt (Treiber 21/0); Windows-Regression offen.*
- [ ] Opt-in-Autostart nach Benutzeranmeldung und Tray-Wiederöffnung unter
  Hyprland und Windows prüfen; doppelter Start erzeugt keinen zweiten Profileigentümer.
  *Doppelstart unter Linux belegt; physische Anmeldung/Tray und Windows offen.*
- [ ] Optionales Wachhalten während aktiver Arbeit vorsehen. Bildschirmsperre
  bleibt möglich; Inhibitor wird nach Ende/Fehler freigegeben. Keine globale
  Abschaltung des normalen Ruhemodus.
  *Freigabe nach Ende, Opt-out, Fehler und Beenden fokussiert belegt (54/0);
  physische Sperr-/Ruheprobe und Windows offen.*
- [x] App-Neustart, Host-Neustart und Prozessverlust unterscheiden. Unterbrochene
  Arbeit explizit anzeigen, Kopplungen erhalten und keine unbekannte Eingabe
  oder privilegierte Aktion automatisch wiederholen.
  *Linux: Absturz und Beenden in Electron/Tablet belegt, Rechnerneustart nur
  mit injizierter Boot-Kennung (24/0); echter Neustart und Windows offen.*

**Abnahme:** Disposable-Profile belegen Update, fehlgeschlagenen Start mit
Rollback, aktive Arbeit als Neustartblocker und erhaltenes Pairing auf beiden
Plattformen. Omarchy- und Windows-Proben belegen Anmeldung, Sperren, Tray und Rückkehr.
Schlafender/ausgeschalteter Rechner
wird als nicht erreichbar behandelt; Wake-on-LAN ist kein Bestandteil.

## Goal 34.4 — Ein Einstieg für Entscheidungen und Eingriffe

Implementiert und vollständig geprüft am **1. Oktober, 10:06 CEST**: gemeinsamer
Entscheidungseinstieg mit Run-Rückfragen, CLI-Zuständen, Prozessverlust und offenen
Morgenübergaben; aktuelle Gerätefreigaben begrenzen die Tablet-Projektion.
Verify **27/0/16 nicht gemessen**, **104 Suiten / 4.417 Checks**. Projektion
**28/0**, Sitzungsnavigation **95/0**, Agent-/Tablet **40/0** mit Tastatur,
Fokus, leerer Liste, Fehler, Offline und schmaler Ansicht. Detailaktionen nutzen
bestehende Frage-/Sitzungs-/Lease-Verträge. Persönlich aktiviert am 1. Oktober um **10:35:46 CEST**; keine neue reale
Codex-Rückfrage-/Android-Abnahme. [Belege](HANDOFF.md).

Ergänzt am **1. Oktober abends**: Entscheidungen direkt in der Übersicht
(Rückfrage beantworten, Run abbrechen, weitere Anweisung, Eingabe übernehmen)
anhand der von Main gemeldeten Fähigkeiten; Drei-Projekte-Ablauf, Entwurfs-
bindung und Negativkontrollen im Linux-Treiber. Offen bleiben für die Abnahme:
echte Codex-Probe Rückfrage → Antwort → Fortsetzung, native Windows-Messung und
physisches Tablet. [Belege](AGENT_SESSION_PLATFORM_RESULTS.md).

- [x] Bestehende Arbeitsübersicht, Rückfragen und Morgenüberblick zusammenführen:
  „Braucht dich“, „Arbeitet“, „Bereit zur Prüfung“ und „Unterbrochen“.
  Unbekannter Zustand bleibt unbekannt; Terminalruhe ist kein Fertignachweis.
- [x] Pro Eintrag Projekt, Sitzung/Aufgabe, letzte bestätigte Aktivität und
  nächste mögliche Aktion zeigen; mit einem Schritt zur richtigen Detailansicht.
- [x] Antworten, weitere Anweisungen, Eingabeübernahme und Abbruch anhand der
  tatsächlichen Adapterfähigkeiten anbieten. Eingreifen in einen laufenden Turn
  muss unterstützt und bestätigt sein; keine universelle Pause vortäuschen.
  *Umgesetzt unter Linux:* Main liefert je Zeile Aktionen mit Sperrgrund; Turn-
  Unterbrechung ist für interaktive CLIs ausdrücklich nicht unterstützt.
- [x] Eingaben an Host, Sitzung und gegebenenfalls Frage/Turn binden; Entwürfe
  beim Wechsel erhalten, bei unklarer Zustellung eine gezielte Statusprüfung
  anbieten. Bestehende Speicher-/Datenschutzverträge nicht pauschal erweitern.
  *Umgesetzt:* Bindung an Host-Identität, Sitzung/Prozess bzw. Run/Task/Frage;
  interaktive CLIs besitzen keine Turn-Identität. Entwürfe nur im Speicher des
  offenen Fensters; Prüfung wiederholt dieselbe Zustellung höchstens einmal.
- [x] Drei Projekte mit arbeitender, wartender und unterbrochener Sitzung testen;
  Tastatur/Fokus, leere Liste, Fehler, Offline und schmale Ansicht abdecken.
  *Linux-Electron-/Tablet-Treiber; Windows nicht gemessen.*

**Abnahme:** Derselbe Zustand führt auf PC und Tablet zur selben Zielarbeit.
Veraltete Fragen und fremde Sitzungen können keine Antwort erhalten. Die echte
Codex-Probe bestätigt mindestens Rückfrage → Antwort → Fortsetzung; weitere
Adapter werden gesondert gemessen. Managed-Workspace-Leases bleiben erhalten.

## Goal 34.5 — Benachrichtigungen, die unterwegs helfen

Erste Implementierung am 1. Oktober: gerätebezogenes Web Push für bestätigte
ADE-Aufgaben-/Run-Ereignisse, verschlüsselte lokale VAPID-/Aboverwaltung,
neutrale Texte, Kategorien, Testnachricht, Widerruf und erneute Zielautorisierung.
Fokussierte Verträge **56/0**, echter Chromium-/HTTPS-/Journalablauf **19/0** mit
ersetztem Browser-Abonnement und Push-Provider. Vollständiges Verify am
1. Oktober um **10:32:37 CEST: 28/0/16 nicht gemessen**, **105 Suiten / 4.477 Checks**.
Android Chrome/Google ist der erste Transport; interaktive CLI-Ereignisse und
andere Push-Dienste sind nicht daraus abgeleitet. Die konkrete Tablet-/Chrome-
Version und Installation bleiben angefragt, physische Hintergrundzustellung
und neue native Windows-Abnahme offen. Persönlich aktiviert um **10:35:46 CEST**, HTTPS und unveränderte Kopplung
geprüft. [Betriebsnachweis](HANDOFF.md).

- [ ] Für das tatsächliche Tablet die Voraussetzungen für Web Push prüfen;
  Berechtigungs-/Installationsablauf und erreichbaren Zustellweg dokumentieren.
- [x] Opt-in je Gerät für Rückfrage, Fehler und fertiges Ergebnis; Duplikate
  begrenzen und Benachrichtigung mit passender Detailansicht verbinden.
  *(Linux-Vertrag/Browser mit simuliertem Provider; physisch offen.)*
- [x] Auf dem Sperrbildschirm standardmässig nur neutrale Hinweise ohne Prompts,
  Code, Hostpfade oder vertrauliche Projektnamen zeigen. Öffnen prüft erneut die
  Geräteberechtigung; die Nachricht selbst erteilt keine Freigabe.
  *(Ausgelieferter Worker im Vertragstest; Sperrbildschirm am Gerät offen.)*
- [x] Widerruf beendet weitere Zustellungen; Push-Ausfälle verändern keine
  Arbeit. Offline-Aufträge werden nicht implizit zur späteren Ausführung vorgemerkt.
  *(Vertrag und Chromium-/HTTPS-Ablauf; physisch offen.)*

Stabilisierung am 1. Oktober abends: Der Worker meldet eine spätere bestätigte
Nachricht mit gleichem Tag erneut (`renotify: true`), statt sie still zu ersetzen.
Neue Belege: alle Kategorien/Sprachen neutral, Ziel immer die Run-Detailansicht
mit offenen Rückfragen, pfadartige Ziele verworfen, Burst auf fünf Nachrichten
begrenzt ohne spätere Wiederholung, unterbrochene Arbeit aus 34.3 als genau eine
neutrale Fehlermeldung, Antippen offline stellt nichts in eine Warteschlange,
widerrufenes Gerät öffnet nichts. Verträge **74/0**, Browser **33/0**, Verify
**28/0/16 nicht gemessen**, **106 Suiten / 4.541 Checks**. Abnahme unten bleibt offen.

**Abnahme:** Reales Tablet mit geschlossener ADE-Ansicht: Nachricht empfangen,
richtige Sitzung öffnen, Berechtigungsentzug und Duplikatunterdrückung prüfen.
Desktop-Notification oder Browser-Mock allein gelten nicht als mobile Abnahme.

## Goal 34.6 — Arbeit läuft in einem unabhängigen ADE-Host

- [ ] Architekturentscheid vorbereiten: langlebiger Host besitzt PTYs, Adapter,
  Orchestrierung und Journal; Desktop und Tablet sind Clients. Bestehenden
  `AdeApplicationService` weiterverwenden und Electron-Abhängigkeiten erfassen.
- [ ] Vor Umsetzung Prozess-/Profilbesitz, lokale Client-Authentifizierung,
  Secret-Service-Zugriff, IPC-Ersatz, Versionskompatibilität, Migration und
  Rollback in Architektur und Spezifikation festlegen. Keine zweite schreibende
  Instanz und kein Kopieren entschlüsselter Zugangsdaten in Konfigurationsdateien.
- [ ] Linux-Benutzerdienst und Windows-Hintergrundprozess in der angemeldeten
  Benutzersitzung mit demselben Lebenszyklusvertrag implementieren. „Oberfläche
  schliessen“ und „Host und Arbeit beenden“ bleiben unterscheidbar.
- [ ] Desktop-Neustart bei laufender Aufgabe mit identischer Sitzung nachweisen.
  Host-Crash/Reboot beendet ursprüngliche Prozesse: sichere Recovery und nur
  nachgewiesenes natives Resume anbieten, keine Prozesskontinuität behaupten.

**Abnahme je Linux und Windows:** CLI und verwaltete Aufgabe laufen während Desktop-Schliessen und
erneutem Anmelden des Clients weiter; Tablet bleibt verbunden. Host-Crash,
Versionskonflikt, Doppelstart und Rollback besitzen ausführbare Negativkontrollen.
Unbeaufsichtigter Betrieb vor Benutzeranmeldung bleibt ein gesonderter Vertrag.

## Gemeinsame Lieferregeln und nächster Arbeitsstart

Jedes Teilziel dokumentiert Implementierung, automatisierte Nachweise, native
Laufzeitprobe, physische Geräteabnahme und persönliche Aktivierung separat.
Ein offener Pflichtnachweis verhindert die vollständige Abnahme des Teilziels.
Neue Funktionen behalten strikte IPC-/Gerätegrenzen, Loopback-Listener,
Signatur/Idempotenz/Audit, begrenzte Artefakte und wahrheitsgemässe Zustände.

Für Codeänderungen gelten fokussierte Tests während der Umsetzung und
`pnpm verify` vor repositoryweiter Fertigmeldung. Nicht gemessene Plattformen
werden mit Grund ausgewiesen. Builds gehen während laufender persönlicher ADE-
Instanz nach `test-results/verify-build`; Aktivierung erfolgt über das dafür
geprüfte `pnpm activate`. Produktverträge in ARCHITECTURE/SPEC werden gemeinsam
mit ihrer Umsetzung aktualisiert; dieser Plan ändert sie noch nicht.

**Nächster Arbeitsstart (Stand 1. Oktober abends):** 34.1–34.5 sind unter Linux
umgesetzt. Als nächste Codearbeit folgt der schriftliche Architekturentscheid
für 34.6 (unabhängiger Host). Parallel offen bleiben die Abnahmen, die keine
weitere Implementierung ersetzen kann: native Windows-Läufe für 34.2–34.5,
physisches Tablet (gesperrt/geschlossene Ansicht, Mobilfunk, Touch), echte
Codex-Rückfrage über den Entscheidungseinstieg, echter Rechnerneustart sowie
weitere native CLI-Adapter. Ein lokaler Konflikt mit einer fremden Anwendung
bestimmt weder das Produktmodell noch die Entwicklungspriorität.
Persönliche Inbetriebnahme und echte Netzabnahmen werden separat protokolliert.
