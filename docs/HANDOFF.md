# ADE — aktuelle Übergabe

## Tablet-Arbeitsplatz: Windows-Abnahme und Neustart (12. September 2026)

Freigaben, Startwiederholung, native Codex-Rückfragen mit Live-Aktivität sowie
haltbare Ergebnisdateien und Ergebnisseiten sind implementiert. Vollständiges
`pnpm verify`: 2.770 Prüfungen bestanden, zusätzlich 5 reale Codex-Prüfungen.
Die geprüfte ADE-Kopie läuft mit dem persönlichen Profil; private HTTPS-Adresse,
bestehende Samsung-Kopplung, fünf Projekte und sechs Agentenprofile sind geprüft.
Physisches Samsung/DeX und das nicht antwortende Ubuntu bleiben offen.
[Teilziele](TABLET_WORKSPACE_GOALS.md), [Abnahme und Operatorzustand](TABLET_WORKSPACE_RESULTS.md).
Die darunter genannten älteren Gesamtprüfungen gelten für ihre damaligen Stände.

Stand: 12. September 2026. Frühere Zwischenstände bleiben im
[Checkpoint-Archiv](archived/HANDOFF_2026-09-10_CHECKPOINT.md).

## Checkpoint vor dem vom Benutzer geplanten PC-Neustart

Der Benutzer hat jetzt ausdrücklich Speichern, Commit und Push des aktuellen
Tablet-Arbeitsstands beauftragt. Er startet Windows anschliessend selbst neu,
um das hängende WSL wiederherzustellen. Ein separater WSL-Neustart durch ADE
wird deshalb nicht mehr vorgezogen. Die lokale Sicherung des aktuellen
Konfigurations-/Gerätespeichers samt Audit und OS-geschütztem Schlüsselspeicher
ist in `test-results/pre-reboot-state.json` verzeichnet; persönliche Daten und
Schlüssel bleiben ausserhalb des Git-Repositories. Die feste geprüfte Releasekopie
und Ergebnisdateien bleiben auf dem PC erhalten.

Nach dem PC-Neustart hier fortsetzen:

1. `wsl --status` und `wsl -d Ubuntu --exec /bin/true` mit begrenzter Wartezeit
   prüfen. Ein Windows-Neustart ist noch kein Nachweis eines funktionierenden WSL.
2. ADE mit dem vorhandenen persönlichen Profil starten. Die feste geprüfte
   Kopie steht unter `test-results/operator-tablet-20260912-f9372d2e-verified`;
   die Prozessnummern dieser Übergabe gelten nur vor dem Windows-Neustart.
3. Ubuntu-Agenten Hermes General und Sentinel öffnen und deren tatsächliche
   Interaktion prüfen. Native Codex-Arbeit und Fragen sind bereits separat abgenommen.
4. Auf dem Samsung Tailscale einschalten und
   <https://number-cruncher.tailfc0b86.ts.net/> öffnen. Bestehende Kopplung verwenden;
   physische Projekt-/Agent-Auswahl, Tastatur/DeX, Live-Aktivität und Antworten prüfen.
5. A5 und das Gesamtgoal erst nach diesen Nachweisen abschliessen.

Die letzte vollständige Abnahme bleibt gültig: 2.770 Verify-Prüfungen plus
5 echte Codex-Prüfungen; danach wurden keine Anwendungs-/Testsourcen geändert.

## Neuer Folgeauftrag: Live-Runs und Rückfragen

Der Auftrag umfasst PC und Tablet. Native Codex-Rückfragen sind im Arbeitsstand
implementiert; Protokolltests, reale Windows-Inferenz und Electron/Tablet-UI sind
geprüft. Details und Grenzen: [LIVE_RUN_INTERACTION_PLAN](LIVE_RUN_INTERACTION_PLAN.md).
Aktuell hängt WSL bereits bei `wsl --status` und Ubuntu `/bin/true` (je 15 s);
WslService und vmcompute laufen. Der Benutzer plant nun selbst einen PC-Neustart.
Es wurde kein WSL-Dienst oder Ubuntu-Prozess zur Wiederherstellung beendet.

Historische Bestandsaufnahme vom Vorabend: PID 39428 wurde um 22:58:19 lokal aus dem
Repository gestartet; die frühere PID 51956 läuft nicht mehr. Das Main-Log
meldet um 22:58 und 22:59 einen `EADDRINUSE`-Fehler auf `127.0.0.1:4317`.
Bei der späteren Prüfung war kein Listener erreichbar; ein Bind-/Close-Test
bestätigte einen wieder freien Port. Keine aktiven Runs/Tasks und keine
Terminal-Kindprozesse beim Prüfen. Kein Neustart und keine Änderung an
Gerätefreigaben, Tailscale oder Cursor-Einstellungen in dieser Bestandsaufnahme.
Die neue Prüfung und der Neustart sind inzwischen erfolgt; die folgenden
älteren Neustartangaben sind historische Belege vom Morgen.

## Aktuelle persönliche Instanz

PID **23884**, gestartet am 12. September um **02:06:10 Europe/Zurich**, sichtbares
Fenster `ade`. Feste geprüfte Kopie `test-results/operator-tablet-20260912-f9372d2e-verified`.
Private HTTPS-Adresse, bestehende Samsung-Identität und tatsächliche Projekt-/Git-
Ansicht bestanden. Genau `projects:write`, `projectGit:write`, `projectGit:publish`
wurden ergänzt, bisherige Ressourcenauswahl und Schlüssel erhalten. Kein Debug-Port
offen. Vollständige Messungen, Backup und Grenzen: [Tablet-Abnahme](TABLET_WORKSPACE_RESULTS.md).
Samsung ist noch offline; Hermes General und Sentinel benötigen die ausstehende
Ubuntu-Wiederherstellung. Vor einem weiteren Neustart aktive Arbeit erneut prüfen.

## Historischer Onboarding-Auftrag vom 11. September

Der Folgeauftrag „weiter verbessern mit Goals, Commit/Push und Neustart“ ist als
S0–S3 umgesetzt: [Onboarding-Goal](ONBOARDING_GOALS.md). Am PC führt **Einrichtung**
durch Projektordner, native CLI-/Anmeldeprüfung, optionale Tablet-Kopplung und
Freigaben. Ein Agent-Profil ist für den Projekteinstieg nicht erforderlich.
**Projektarbeit auswählen**, **Dateilesen auswählen** und **Push/PR auswählen**
ergänzen nur den Freigabeentwurf; erst explizites Speichern ändert das Gerät.

Mobile **Settings** zeigt zuerst PC-/Browser-Build und **Einrichtung auf diesem
Gerät** mit den genau fehlenden Schaltern. Offline, fehlgeschlagene Antworten und
alte Hosts mit unbekannter Kennung werden nicht als aktueller Erfolg angezeigt.
Eine Build-Abweichung lädt die Seite nicht automatisch neu. CLI-Anmeldung ist
separat zu prüfen. Verträge: [Architektur](ARCHITECTURE.md), [SPEC](SPEC.md).

Der vorherige Projektablauf T0–T7 bleibt erhalten: Stamm → Branch/Checkout → CLI
mit optionalem Profil → Git. Ergebnisdateien liegen unter Graph → Dateien dieses
Runs oder Projekte → Workspace öffnen → Ergebnisse. Dateien kommen aus der
ursprünglichen Aufgaben-Arbeitskopie. Der neue A4-Stand sichert erfasste Dateien
zusätzlich dauerhaft; die Grenzen sind in der aktuellen Tablet-Abnahme beschrieben.
[Projekt-Goal](PROJECT_WORKFLOW_GOALS.md), [aktueller Umfang](STATUS.md).

## Abnahme und Dokumentation

Vollständiges **pnpm verify: 2.651 Checks grün**, Exit 0. Drei TypeScript-Projekte,
41 fokussierte Suiten mit 2.058 Checks, Produktionsbuild und 593 echte Electron-/
Chromium-/Visual-Checks. Log: `test-results/onboarding-verify.log`. Darin 26 neue
fokussierte Setup-Checks und 37 echte Desktop-/Browser-Setup-Checks. Negative
Kontrollen für fehlende Rechte, Build-Abweichung, alten Host, Statusfehler und
Verbindungsverlust enden mit erfolgreicher Wiederherstellung. Danach wurden
keine Anwendungssourcen geändert. Vorherige 2.588 Checks vom 10. September sind
historische Projekt-Abnahme, keine neue Plattformbehauptung.

Der [User-Guide](USER_GUIDE.md) enthält neue echte Bilder 25–27. Quellen und
Fixture-Grenzen: `docs/media/user-guide/capture*.json`. CLI/Tailscale sind
kontrollierte lokale Fixtures; die Browserkopplung und Host-Anfragen sind echt.
Keine Provider-Inferenz und keine physische Samsung-/DeX-Messung durch diese Tests.
[Dokumentationsaudit](DOCUMENTATION_AUDIT.md): 65 Markdown-Dateien unter docs,
222 relative Ziele gültig; keine weitere Archivierung gültiger Verträge nötig.

Task-Commits S0 `58abdfe`, S1 `cb442e5`, S2 `4288a32`; S3 dokumentiert hier Abnahme
und Neustart. Die Task-Commits werden gemeinsam auf `main` ausgeliefert.

## Historische Testinstanz vom 11. September

ADE lief ab **11. September 2026, 06:49:59 Europe/Zurich**, PID **51956**, aus
`test-results/operator-release-4288a32`. Sichtbares Desktop-Fenster `ade`, Listener
nur `127.0.0.1:4317`. Private Adresse `https://number-cruncher.tailfc0b86.ts.net/`
liefert HTTP 200. Mobile-Assets `index-DD_tWgKd.js` / `index-mfBmhnOz.css` wurden
über HTTPS heruntergeladen und stimmen bytegenau mit dem verifizierten Build
überein. Main und Mobile tragen Quellkennung **3147fc1fa3170895ceab** (kein Git-SHA).
Nachweis: `test-results/onboarding-final-restart.json`.

Vor dem Ersetzen der bisherigen PID 65456 aus `operator-release-cb42dbb`: keine
laufenden Runs, queued/running Tasks, aktiven Leases oder Terminal-Kindprozesse.
Kopplungs-/Freigabendatei und Tailscale Serve unverändert. Konfigurationssicherung:
`%APPDATA%/ade/ade/config.json.before-onboarding-final-4288a32`.
Entwicklungsbuilds verändern die feste laufende Kopie nicht. Bei einem weiteren
Neustart aktive Arbeit erneut prüfen. Für die neuen Ansichten Chrome am Tablet
nach dem Sichern etwaiger Entwürfe neu laden; keine neue Kopplung nötig.

Das Samsung besass damals bereits `workspace:read` für Dateiabruf sowie seine bisherigen
Terminal-/Verwaltungsrechte. `projects:write`, `projectGit:write` und
`projectGit:publish` waren damals noch nicht erteilt. Für den vollen Projektablauf am
PC **Einrichtung → Freigaben prüfen → Samsung → Projektarbeit auswählen**, Auswahl
prüfen und **Verwaltungsrechte speichern**. Push/PR separat auswählen, wenn gewünscht.
Es wurden keine persönlichen Rechte automatisch erweitert.

Der ursprüngliche Bild-/Excel-Run ist `0531376b-559a-49f7-8d98-02d14573b109`,
Task `9c816cef-783d-403c-ba1b-a9354e0506b1`, abgeschlossen. Antwortquelle weiterhin
`recovered-cli`. Der genaue Bildmodellname wurde nicht gemeldet; der separat
angefragte API-Aufruf scheiterte am Kontingent. Kein neuer Modelllauf.
Nach diesem Neustart wurden PNG (2.261.193 Bytes), XLSX (5.626 Bytes) und Markdown
(1.611 Bytes) erneut erfolgreich gelesen. Nachweis:
`test-results/onboarding-operator-files-after-restart.log`.

## Getrennte Folgearbeiten

- Physisch Samsung/Chrome: Tastatur, DeX, Drehung und Netzwechsel vollständig messen.
- WSL-Bereitschaft: `/bin/true` am 10. September nach 15 Sekunden weiter ohne Antwort;
  nur der eigene Probeprozess beendet, kein WSL-Neustart. Logs `test-results/t6-wsl-probe.*`.
  Dieser Auftrag hat den WSL-Zustand nicht verändert und keine neue WSL-Abnahme erbracht.
- Dauerhafte Ergebnisdatei-Aufbewahrung, ältere Archive und Pagination ausbauen.
- Live-GitHub-PR, andere Plattformen und ein breiterer Accessibility-/Sprachaudit
  benötigen eigene Ausführungsevidenz. [Priorisierung](ROADMAP.md).
- Die früher automatisch abgelehnte Löschung des temporären Profils
  `ade-terminal-electron-2xyWJu` wurde nicht erneut versucht; es bleibt liegen.

Historische Goal-6-Messungen bleiben unverändert. Tests verwenden isolierte
Repositories und verändern weder die persönlichen Hauptcheckouts noch fremde Dienste.
