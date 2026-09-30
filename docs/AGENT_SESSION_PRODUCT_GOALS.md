# Goal 34 — ADE als eigenständige Sitzungsverwaltung auf Linux und Windows

Stand: 30. September 2026. Der Benutzer möchte ADE weiterentwickeln und hat
die Erstellung und anschliessend die Umsetzung dieser Arbeitsziele beauftragt.
**Umsetzung von 34.1–34.3 fortgeführt; vollständige Plattformabnahmen offen.**
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
Architekturumbau in 34.6. Alle nachfolgenden Checkboxen sind offen.

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
Die nächste Linux-Lieferung ergänzt geschützte Prompt-/Diktatübergabe, gespeicherte
Profile und einen integrierten Agent-/Tablet-Treiber. Neue Sitzungen erhalten
den Schutz; laufende Sitzungen bleiben unverändert. Die Gesamt-Abnahme verlangt
weiterhin Windows- und physische Tablet-Nachweise, der unabhängige Host folgt
separat in 34.6.

- [ ] Zuerst eine Fähigkeitsmatrix pro Plattform, Adapter und Sitzungsart aus
  aktuellem Code und Nachweisen erstellen: starten, beobachten, Eingabe senden,
  Rückfrage beantworten, unterbrechen, beenden und nativ fortsetzen. Unterstützt,
  nicht unterstützt und nicht gemessen unterscheiden; keine Versionsannahmen.
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

- [ ] `pnpm activate` plattformgerecht erweitern: Gate, Profilbackup, reguläres
  Beenden, `out.prev`, Rollback und bestätigter Wiederanlauf unter Linux.
  Den bestehenden Windows-Weg als Regression prüfen. Aktive Arbeit blockiert
  eine unterbrechende Aktualisierung mit klarer Begründung.
- [ ] Opt-in-Autostart nach Benutzeranmeldung und Tray-Wiederöffnung unter
  Hyprland und Windows prüfen; doppelter Start erzeugt keinen zweiten Profileigentümer.
- [ ] Optionales Wachhalten während aktiver Arbeit vorsehen. Bildschirmsperre
  bleibt möglich; Inhibitor wird nach Ende/Fehler freigegeben. Keine globale
  Abschaltung des normalen Ruhemodus.
- [ ] App-Neustart, Host-Neustart und Prozessverlust unterscheiden. Unterbrochene
  Arbeit explizit anzeigen, Kopplungen erhalten und keine unbekannte Eingabe
  oder privilegierte Aktion automatisch wiederholen.

**Abnahme:** Disposable-Profile belegen Update, fehlgeschlagenen Start mit
Rollback, aktive Arbeit als Neustartblocker und erhaltenes Pairing auf beiden
Plattformen. Omarchy- und Windows-Proben belegen Anmeldung, Sperren, Tray und Rückkehr.
Schlafender/ausgeschalteter Rechner
wird als nicht erreichbar behandelt; Wake-on-LAN ist kein Bestandteil.

## Goal 34.4 — Ein Einstieg für Entscheidungen und Eingriffe

- [ ] Bestehende Arbeitsübersicht, Rückfragen und Morgenüberblick zusammenführen:
  „Braucht dich“, „Arbeitet“, „Bereit zur Prüfung“ und „Unterbrochen“.
  Unbekannter Zustand bleibt unbekannt; Terminalruhe ist kein Fertignachweis.
- [ ] Pro Eintrag Projekt, Sitzung/Aufgabe, letzte bestätigte Aktivität und
  nächste mögliche Aktion zeigen; mit einem Schritt zur richtigen Detailansicht.
- [ ] Antworten, weitere Anweisungen, Eingabeübernahme und Abbruch anhand der
  tatsächlichen Adapterfähigkeiten anbieten. Eingreifen in einen laufenden Turn
  muss unterstützt und bestätigt sein; keine universelle Pause vortäuschen.
- [ ] Eingaben an Host, Sitzung und gegebenenfalls Frage/Turn binden; Entwürfe
  beim Wechsel erhalten, bei unklarer Zustellung eine gezielte Statusprüfung
  anbieten. Bestehende Speicher-/Datenschutzverträge nicht pauschal erweitern.
- [ ] Drei Projekte mit arbeitender, wartender und unterbrochener Sitzung testen;
  Tastatur/Fokus, leere Liste, Fehler, Offline und schmale Ansicht abdecken.

**Abnahme:** Derselbe Zustand führt auf PC und Tablet zur selben Zielarbeit.
Veraltete Fragen und fremde Sitzungen können keine Antwort erhalten. Die echte
Codex-Probe bestätigt mindestens Rückfrage → Antwort → Fortsetzung; weitere
Adapter werden gesondert gemessen. Managed-Workspace-Leases bleiben erhalten.

## Goal 34.5 — Benachrichtigungen, die unterwegs helfen

- [ ] Für das tatsächliche Tablet die Voraussetzungen für Web Push prüfen;
  Berechtigungs-/Installationsablauf und erreichbaren Zustellweg dokumentieren.
- [ ] Opt-in je Gerät für Rückfrage, Fehler und fertiges Ergebnis; Duplikate
  begrenzen und Benachrichtigung mit passender Detailansicht verbinden.
- [ ] Auf dem Sperrbildschirm standardmässig nur neutrale Hinweise ohne Prompts,
  Code, Hostpfade oder vertrauliche Projektnamen zeigen. Öffnen prüft erneut die
  Geräteberechtigung; die Nachricht selbst erteilt keine Freigabe.
- [ ] Widerruf beendet weitere Zustellungen; Push-Ausfälle verändern keine
  Arbeit. Offline-Aufträge werden nicht implizit zur späteren Ausführung vorgemerkt.

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

**Nächster Arbeitsstart: 34.2.** Sitzungsmodell und Adapterfähigkeiten für Linux
und Windows abgleichen, fehlende Mehrsitzungs-/Plattformnachweise identifizieren
und den kleinsten durchgehenden Sitzungsablauf implementieren und prüfen.
34.1 ergänzt danach bzw. während der Integrationsarbeit den eigenständigen
Tablet-Zugriff. Ein lokaler Konflikt mit einer fremden Anwendung bestimmt weder
das Produktmodell noch die Entwicklungspriorität.
Die frühere Sandboxeinschränkung gilt in der fortgesetzten Sitzung nicht mehr.
Persönliche Inbetriebnahme und echte Netzabnahmen werden separat protokolliert.
