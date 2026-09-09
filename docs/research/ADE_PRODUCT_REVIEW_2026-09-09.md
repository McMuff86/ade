# ADE: Produktreview und nächste Verbesserungen

Stand: 9. September 2026. Untersucht: Repository bei `8433e7d`, aktuelle
Desktop-/Mobile-Oberfläche, vorhandene ausführbare Nachweise und die Rückmeldungen
aus der heutigen Samsung-/Chrome-Nutzung. Dazu gezielte Recherche in offiziellen
Browser-, Tailscale-, W3C- und VS-Code-Dokumentationen.

Dies ist eine priorisierte Entscheidungsvorlage. Die unten vorgeschlagenen
Produktänderungen sind **noch nicht implementiert**. In dieser Lieferung entstehen
Guide, Screenshots und eine bereinigte Dokumentationsstruktur.

## Empfehlung

Als nächsten Slice **„Vom ersten Start zum funktionierenden Projektterminal“**
umsetzen: eine geführte Einrichtung, eine eindeutige Eingabe-/Sitzungsanzeige und
eine nachvollziehbare Anzeige des tatsächlichen Arbeitsorts. Parallel zur Abnahme
auf dem echten Samsung die Tastaturfälle systematisch durchgehen. Anschliessend
den Weg „Änderungen sichern und später weiterarbeiten“ verbessern.

Weitere Ansichten allein lösen die bisher beobachteten Probleme nicht. ADE bietet
mittlerweile die passenden Einstiege; die Verknüpfung von Einrichtung, Auswahl,
Start, Wiederaufnahme und Datensicherung bleibt die grösste Reibungsquelle.

## Was inzwischen vorhanden ist

- **Projekte** öffnet den Workspace vor der CLI-Wahl; Codex, Claude CLI und Grok
  CLI können unabhängig vom Workspace-Profil gestartet werden.
- **Neues Projekt** legt direkt ein natives Git-Projekt unter dem konfigurierten
  PC-Stammordner an und startet das Codex-Profil. Unterbrochene Anlage ist fortsetzbar.
- **Overview → Terminal öffnen** startet das gespeicherte Profil im eigenen
  Agent-Ordner. Hermes-/OpenClaw-Dashboards besitzen einen separaten privaten Link.
- Remote-Terminals zeigen Farben/Cursor, übernehmen direkte Eingaben und bieten
  eine explizite Tastaturaktion sowie kompaktes Layout bei kleinerem sichtbarem Viewport.
- Gerätefreigaben, exklusive Eingabesteuerung, Wiederverbindung und begrenzte
  persistente Terminal-/Auftragsentwürfe existieren bereits.

Nachweise: [Projekteinstieg](../PROJECT_ENTRY_RESULTS.md),
[Assistenten](../ASSISTANT_ACCESS_RESULTS.md),
[Tastaturaktivierung](../TERMINAL_KEYBOARD_ACTIVATION_RESULTS.md),
[Projektstart](../TABLET_PROJECT_START_RESULTS.md). Letzter vorhandener vollständiger
Windows-Lauf: **2.148 Checks**. Die heutige qualitative Rückmeldung „schaut … nicht
schlecht aus“ ist positives Bedienfeedback, aber keine vollständige Geräteabnahme.

## Priorisierte Befunde

P0 bedeutet: vor breiterem Onboarding bearbeiten. P1: nächster Alltagsslice.
P2: nach Messung/Produktentscheidung. Aufwand S/M/L ist eine relative Schätzung,
kein Terminversprechen. Codepfade sind die überprüften Fundstellen, keine
Behauptung über noch nicht ausgeführte Provider-/Geräteprüfungen.

| ID | Prio / Aufwand | Befund und Evidenz | Vorschlag | Abnahmekriterium |
|---|---|---|---|---|
| R1 | P0 / M | Einrichtung verteilt sich auf Harnesses, Profile, Projektdefaults, Mobile Access und Gerätefreigaben. [Settings](../../src/renderer/settings/SettingsModal.tsx), [ProjectStart](../../src/mobile/ProjectStart.tsx). | Eine Start-Checkliste mit direkt erreichbaren Korrekturaktionen: CLI vorhanden → angemeldet → Speicherort → Gerät → passende Rechte → erstes Terminal. | Neues leeres Profil: Nutzer erreicht ohne Dokumentensuche sein erstes Terminal. Jeder fehlende Schritt hat genau eine passende Aktion; ein nicht geprüftes Login wird nicht grün. |
| R2 | P0 / S–M | Vor dem ersten CLI-Start steht „Die Sitzung läuft auf deinem PC weiter“, während darunter „Keine verfügbaren interaktiven Sitzungen“ steht. Im [aktuellen Screenshot](../media/user-guide/08-workspace-cli.png) reproduziert; [RemoteTerminalPane](../../src/mobile/RemoteTerminalPane.tsx). | Zustände „Noch nicht gestartet“, „Start läuft“, „Verbunden · Eingabe hier/am PC“, „Beendet“, „Offline“ sauber unterscheiden. Primäre Aktion aus dem Zustand ableiten. | Screenshot-/E2E-Fälle mit null, einer beendeten und einer laufenden Sitzung; kein Weiterlaufen-Hinweis ohne passende laufende Sitzung. |
| R3 | P0 / M | Samsung-Tastatur musste nach Verdichtung nachgebessert werden. Chromium-Geometrie und Fokus sind geprüft, reale IME-/DeX-Wechsel nur teilweise beobachtet. [Keyboard results](../TERMINAL_KEYBOARD_RESULTS.md), [Activation flow](../../scripts/helpers/terminalKeyboardActivationFlow.ts). | Feste physische Abnahmematrix, messbare Ende-zu-Ende-Eingabelatenz, gut sichtbare Eingabeübernahme/Tastaturaktion. Keine weitere Layoutverdichtung ohne diese Gegenprobe. | Alle unten genannten Gerätefälle protokolliert; keine verlorenen/doppelten Eingaben; Cursor sichtbar; Tastatur nach Android-Zurück erneut aufrufbar. |
| R4 | P1 / M–L | Stammordner und Agent-Worktree sind verschiedene Orte. [Projects](../../src/mobile/Projects.tsx), [Repository scopes](../REPOSITORY_SCOPES_PLAN.md). „Dateien bleiben dort“ im Startdialog kann als „alles liegt im Hauptordner“ gelesen werden. | Verständliche Anzeige „Arbeitskopie · Branch …“ mit Speicher-/Sicherungsdetails und geführtem Weg zum Prüfen/Übernehmen. Hostpfade bleiben am Desktop. | Eine Datei entsteht nachweislich in der angezeigten Arbeitskopie. Nutzer findet sie nach Wiederöffnung, sichert sie und erkennt, ob der Hauptstand/Remote sie bereits enthält. Kein impliziter Commit/Merge/Push. |
| R5 | P1 / M | Neues Projekt ist fest mit Codex verbunden; bestehende Projekte erlauben mehrere CLIs. [ProjectStart](../../src/mobile/ProjectStart.tsx), [Projects](../../src/mobile/Projects.tsx). | Beim Projektstart dieselbe „Arbeiten mit“-Auswahl verwenden, zuletzt verwendete Wahl anbieten; gespeichertes Profil und frische CLI deutlich benennen. | Neues Projekt mit verfügbarem Codex/Claude/Grok sowie Shell öffnet genau eine Sitzung im richtigen Workspace; fehlende CLI bietet Korrektur statt halb erfolgreichem Start. |
| R6 | P1 / M | Fenster schliessen, Tablet trennen und Host neu starten haben unterschiedliche Folgen. Kein allgemeines Wiederbeleben interaktiver Prozesse nach Host-Neustart. [Session results](../SESSION_WORKSPACE_RESULTS.md). | „Weiterarbeiten“ nach Projekt/Profil mit Laufstatus und Startzeit; beendete Unterhaltung nur über nachgewiesene providerspezifische Resume-Funktion anbieten. | Browser-Reload verwendet dieselbe PTY; Host-Neustart zeigt „beendet/unterbrochen“ und erzeugt erst auf Klick eine neue Sitzung. Niemals einen neuen Prozess als fortgesetztes Gespräch ausgeben. |
| R7 | P1 / M–L | Mobile-Dateien werden vom laufenden Host gehalten; ein Build plus Tablet-Reload genügt nicht. Autostart/Updater fehlen, Version steht bei `0.1.0`. [Mobile guide](../goal8/MOBILE_CONNECT_GUIDE.md), [package.json](../../package.json). | Build-/Commit-Kennung und Client/Host-Abgleich sichtbar machen. Danach geführtes Update nur bei passender Arbeitssituation; optional Loginstart als eigener Slice. | Alte Client-/Host-Kombination erkennbar; Update zeigt betroffene Sitzungen und bestätigt die neue Instanz. Kein überraschender Verlust aktiver PTYs. |
| R8 | P1 / S–M | Terminal-/Auftragsentwürfe überleben Reload, Datei-/Profilentwürfe nur den Seitenbesuch. [AgentWorkspace](../../src/mobile/AgentWorkspace.tsx), [Workbench results](../REMOTE_WORKBENCH_RESULTS.md). | Unterschied sichtbar machen; begrenzte lokale Datei-Entwürfe mit Revision und expliziter Konfliktprüfung erwägen. | Reload/Offline/Revision geändert jeweils belegt; nie stiller Verlust und kein automatisches Überschreiben neuerer PC-Dateien. |
| R9 | P1 / M | Assistenten-TUI und Dashboard sind erreichbar, deren Einrichtung ist Expertenarbeit mit Profil, Backend, Startbefehl, URL und separater Anmeldung. [Assistant access](../ASSISTANT_ACCESS.md). | Einrichtungsvorlagen für gespeicherte Hermes-/OpenClaw-Profile mit zwei separaten Tests „Terminal starten“ und „Dashboard erreichen“. | Erfolg nur für tatsächlich geprüfte Umgebung/Adresse; eigener TUI-Ordner, kein Pflichtrepo; fehlender Dashboard-Login verständlich. Keine erfundene gemeinsame Sessionhistorie. |
| R10 | P1 / M | Deutsch/Englisch und Agent-/Profil-/Workspace-Begriffe sind gemischt. Desktop Settings ist schmal und lang; Pairing erfordert Scrollen. [Neue Screenshots](../USER_GUIDE.md). | Kernabläufe sprachlich vereinheitlichen; Settings in klar benannte Aufgaben gliedern; Agent-Profil als optionale erweiterte Einstellung erklären. | Ein Anfänger kann die drei Einstiege anhand der Beschriftung unterscheiden; Tablet und Desktop verwenden dieselben Begriffe für dieselbe Aktion. |
| R11 | P2 / M | Juli-Designreview enthält weiterhin prüfenswerte Kontrast-, Schriftgrössen-, Zielgrössen- und Formularhinweise. Historische Messwerte sind keine heutige Kontrastprüfung. | Aktuelle Dark-/Light-Prüfung mit Tastatur, Zoom, Touch, Fokus und langen Fehlermeldungen; danach gezielte Korrekturen. | Messprotokoll pro relevanter Komponente, Fehler-/Leerlaufzustand und Theme; keine pauschale WCAG-Behauptung aufgrund einzelner 44-px-Buttons. |
| R12 | P2 / M | Desktop Overview besitzt bereits „Aktuelle Arbeit / Historie / Alles“; archivierte Runs sind noch nicht im UI durchsuchbar. Mobile Overview bietet diesen Desktop-Filter nicht. [Desktop](../../src/renderer/overview/OverviewView.tsx), [Mobile](../../src/mobile/Overview.tsx), [STATUS](../STATUS.md). | Den bestehenden Historienbegriff mobil nachvollziehbar machen; später einen begrenzten Archivbrowser ergänzen. | Entfernte Katalogeinträge erscheinen nicht als aktive Startziele; deren historische Arbeit bleibt verständlich. Archivierte und lediglich abgeschlossene Runs sind unterscheidbar. |

## Externe Recherche: Folgerungen für ADE

Zusätzliche Beobachtung zu **R2**: Nach dem CLI-Start kann die Dateiansicht noch
„Keine laufende Sitzung“ zeigen ([Bild 11](../media/user-guide/11-workspace-files.png)).
`AgentWorkspace` lädt seinen Overview-Status beim Öffnen bzw. expliziten Refresh;
der Terminalstart aktualisiert diesen eigenen Status nicht. In der Abnahme daher
auch **Terminal starten → Dateien → Sitzung am PC beenden → Dateien** prüfen.
Eine Aussage über laufende Arbeit sollte aktuell sein oder ihren Prüfzeitpunkt zeigen.

**Android-Viewport und Tastatur.** Chrome beschreibt seit Android-Version 108
standardmässig die Verkleinerung des sichtbaren Viewports beim Öffnen der Tastatur,
während der Layout-Viewport bestehen bleiben kann. Deshalb bildet ein normales
Playwright-Fenster-Resize diesen Fall nicht ausreichend ab. ADEs getrennte
VisualViewport-Probe ist der passende Ansatz; die physische Tastaturaktivierung
bleibt zusätzlich zu testen. [Chrome: Viewport resize behavior](https://developer.chrome.com/blog/viewport-resize-behavior).

**Berührbare Ziele und sichtbarer Fokus.** WCAG 2.2 AA nennt für Pointer-Ziele
24 × 24 CSS-Pixel beziehungsweise bestimmte Abstands-/Ausnahmefälle. ADEs 44-Pixel-
Ziel für die Tastenleiste ist ein zusätzlicher Komfortanspruch. Fokus soll nicht
vollständig durch eigene UI verdeckt werden. Daraus folgt ein Test des gesamten
Dialogs inklusive Bedienung und Fehlermeldungen, nicht nur der Terminalhöhe.
[W3C Target Size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum),
[W3C Focus Not Obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html).

**Verbunden ist nicht gleich erreichbar.** Tailscale kann Android-Apps von Routing
und DNS ausschliessen. Das erklärt, warum ein grüner VPN-Status allein keine
Browsererreichbarkeit belegt; im heutigen Nutzerfall half ein Tailscale-Neustart,
die genaue technische Ursache wurde dabei nicht bewiesen. ADE sollte die
Diagnose in PC-Host, privates HTTPS, Gerätekopplung und Funktionsrechte aufteilen.
Private Serve-Freigaben bleiben der aktuelle Zugang; ein öffentlicher Tunnel ist
kein sinnvoller Standard-„Fix“. [Android-Ausnahmen](https://tailscale.com/docs/features/client/android-app-split-tunneling),
[Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve).

**Sitzungsbegriffe.** VS Code trennt Wiederverbinden mit einem vorhandenen Prozess
von einem Prozessneustart mit wiederhergestellter Umgebung. Diese Unterscheidung
ist für ADE nützlich: das Wiederanzeigen eines Terminals, ein neuer CLI-Prozess
und das Wiederaufnehmen einer Anbieter-Unterhaltung sind drei verschiedene
Versprechen. Daraus folgt R6; nicht die Behauptung, ADE habe bereits VS Codes
Persistenzfunktionen. [VS Code Terminal Advanced](https://code.visualstudio.com/docs/terminal/advanced).

## Physische Abnahme auf dem Samsung

Das Gerät wurde vom Nutzer als „Samsung Galaxy S10 Ultra“ bezeichnet. Exakte
Modell-/Android-/One-UI-/Chrome-Version bei der Messung aus den Einstellungen
übernehmen; nicht aus Screenshot oder Bezeichnung erraten.

| Fall | Was gemessen bzw. beobachtet werden soll |
|---|---|
| Querformat, normale Samsung-Tastatur | Erstes Antippen, Tippen, Tastatur schliessen, erneutes Antippen, Cursor/letzte Zeile sichtbar |
| Hochformat | Terminalhöhe, keine seitlich unerreichbaren Aktionen, Dialog schliessen ohne Fokusverlust |
| DeX sowie externe Tastatur | Kein unnötiger Kompaktmodus; Enter, Tab, Esc, Ctrl+C, Pfeile; Wechsel zurück zur Bildschirmtastatur |
| Texteingabe | Umlaute, IME-Komposition, Backspace, längerer Paste, mehrzeiliger Composer; keine Doppelzeichen |
| Verbindungswechsel | WLAN → anderes WLAN/Hotspot, App im Hintergrund, Display gesperrt, Tailscale reconnect |
| PC übernimmt / Sitzung beendet | Sichtbare Zustandsänderung; Tablet sendet nichts mehr; erneuter bewusster Start möglich |
| Latenz | Mindestens 30 Zeichen pro Konfiguration: Taste bis sichtbares Echo; Median/p95 plus PC-Antwortzeit, WLAN/Route und lokale CLI erfassen |

Vorgeschlagener Komfortwert für die aktive Sitzung: p95 des sichtbaren Echos
unter 200 ms im guten lokalen WLAN, keine dauerhafte Verzögerung über 500 ms.
Das sind **neue Produktziele**, keine bereits gemessenen Garantien. Zusätzlich
mit echtem Codex und mindestens dem gespeicherten Hermes-Profil testen; lokale
Fixtures beweisen Transport und Darstellung, nicht die Anbieteranmeldung.

## Technische Altlasten gezielt nachprüfen

Der [Professionalisierungsreview vom Juli](../PROFESSIONALIZATION_REVIEW_2026-07-26.md)
vermischt ursprüngliche Befunde und spätere Erledigungsnotizen. Bereits umgesetzt
sind unter anderem atomare Config-Saves, die strengere IPC-Grenze, schlankere
Renderer-Views und begrenzte Run-Retention. Diese Punkte erneut als komplett
fehlend zu planen wäre falsch.

Nachprüfliste aus dem damaligen Bericht: Single-Instance-/Mehrprozessschutz,
Schema-/Downgrade-Sicherheit, Dashboard-Abmeldung ohne Agent-Löschung, Kill-
Eskalation und Archiveinsicht. Im aktuellen `src/main/index.ts` gibt es keinen
`requestSingleInstanceLock`-Aufruf; das allein ist noch kein reproduzierter
Datenverlustnachweis. Vor einer Schweregrad-Einstufung mit zwei Instanzen auf
**demselben isolierten Testprofil** messen. Die hier verwendeten Screenshot-
Instanzen besitzen absichtlich getrennte Profile.

Eine SQLite-Migration wird nicht pauschal als nächster Schritt empfohlen.
Erst reale Speicher-/Latenzmessungen mit aktiver Retention und Archivnutzung
rechtfertigen diesen Aufwand. Ebenso bleiben Public Relay, weitere Plattformen
und native Mobile-Apps spätere Entscheidungen anhand belegter Grenzen.

## Vorgeschlagene Reihenfolge für die Besprechung

1. **Einfach anfangen:** R1, R2 und die physische Abnahme R3. Ziel: Ein neuer
   Nutzer kommt zuverlässig vom frischen ADE zum beschreibbaren Terminal.
2. **Arbeit behalten:** R4, R6 und R8. Ziel: Arbeitsort, Sicherung, Wiederaufnahme
   und Entwürfe sind verständlich und überprüfbar.
3. **Auswahl und Betrieb vereinheitlichen:** R5, R7, R9 und R10. Ziel: derselbe
   einfache Ablauf für Projekte und persönliche Assistenten, klarer Hostzustand.
4. **Nach Messung ausbauen:** R11/R12 und offene Plattform-/Release-Kriterien.

Dokumentationsentscheidungen und unverändert erhaltene Nachweise stehen im
[Dokumentationsaudit](../DOCUMENTATION_AUDIT.md). Die konkrete Nutzeranleitung
mit aktuellen Bildern ist der [User-Guide](../USER_GUIDE.md).
