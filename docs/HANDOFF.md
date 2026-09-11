# ADE — aktuelle Übergabe

Stand: 11. September 2026. Frühere Zwischenstände bleiben im
[Checkpoint-Archiv](archived/HANDOFF_2026-09-10_CHECKPOINT.md).

## Aktueller Auftrag und Ergebnis

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
ursprünglichen Aufgaben-Arbeitskopie, kein historisches unveränderliches Archiv.
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

## Persönliche Testinstanz

ADE läuft seit **11. September 2026, 06:49:59 Europe/Zurich**, PID **51956**, aus
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

Das Samsung besitzt bereits `workspace:read` für Dateiabruf sowie seine bisherigen
Terminal-/Verwaltungsrechte. `projects:write`, `projectGit:write` und
`projectGit:publish` sind weiterhin nicht erteilt. Für den vollen Projektablauf am
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
