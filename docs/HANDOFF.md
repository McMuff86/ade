# ADE — aktuelle Übergabe

## Aktueller Folgeauftrag vom 11. September

Der Nutzer beauftragt weitere Verbesserungen mit Goals, Commit/Push und Neustart.
S1 Desktop-Einrichtung ist mit 16 echten Electron-Checks, Typprüfung und Build
abgenommen. S2 Mobile-Status/Build/Freigaben und S3 Gesamtprüfung folgen laut
[Onboarding-Goal](ONBOARDING_GOALS.md). Noch kein neuer Operator-Neustart oder Push;
der unten dokumentierte Build cb42dbb bleibt die persönliche Instanz.

Stand: 10. September 2026. Frühere widersprüchliche Zwischenstände bleiben im
[Checkpoint-Archiv](archived/HANDOFF_2026-09-10_CHECKPOINT.md).

## Auftrag und Umsetzung

Der Nutzer beauftragte Projekt-Stamm → Branch/Checkout → CLI mit optionalem
Profil → Git, mit einem Commit je abgeschlossenem Task und einem gemeinsamen
Push am Ende. Ergänzt wurde direkter Ergebnisdatei-Zugriff aus Graph und Projekt.
[Goal und Abnahmen](PROJECT_WORKFLOW_GOALS.md), [Verträge](ARCHITECTURE.md),
[aktueller Umfang](STATUS.md), [User-Guide](USER_GUIDE.md).

T0–T7 sind für native Windows umgesetzt und abgenommen. T7 ist `b2ca131`, T5 `4e79efd`,
T4 `d3a4d9f`, T3b `731998d`. Der frühere T3b-Stash wurde vollständig übernommen
und entfernt. T6 `cb42dbb` schliesst Gesamtverifikation, Fehlerkorrekturen und
Dokumentpflege ab. Die Task-Commits bilden die gemeinsame Auslieferung auf main;
der geprüfte Operator-Neustart ist unten dokumentiert. Noch keine neue WSL-Freigabe.

Dateien: Graph → Dateien dieses Runs oder Projekte → Workspace öffnen → Ergebnisse.
Neue Aufgaben erhalten einen begrenzten Vorher-/Nachher-Vergleich. Frühere Runs
zeigen unbekannte/gemeldete Zuordnung; Dateien können dennoch heruntergeladen
werden. Es sind aktuelle Dateien der ursprünglichen Aufgaben-Arbeitskopie, kein
separates historisches Dateiarchiv und keine automatische Integration in main.

## Verifikation und Dokumentation

Vollständiges `pnpm verify`: **2.588 Checks grün**, Exit 0. Drei TypeScript-Projekte,
40 fokussierte Suiten mit 2.032 Checks, Produktionsbuild und 556 echte Electron-/
Chromium-/Visual-Checks. Log: `test-results/project-goal-verify.log`; Aufteilung in
STATUS. Die frühere 2.148-Check-Basis vom 9. September ist historisch.
Datei/API jetzt 57, Run-Datei-Browserflow 24; fehlerhafter Download nach Dateiänderung
fordert korrekt zur Aktualisierung auf, anschliessender Download erfolgreich.

14 Einstiegsbilder wurden mit dem Produktionsbuild neu aufgenommen; zusätzliche
Branch-/Git-/Run-Bilder dokumentieren die jeweiligen echten Prüfflows. Quellen:
`docs/media/user-guide/capture*.json`. Modelle/Tailscale sind kontrollierte
Fixtures, Tastatur-Geometrie simuliert. Physische Samsung-Messung bleibt separat.

Der [Dokumentationsaudit](DOCUMENTATION_AUDIT.md) hält Rollen und Archivierung
fest; das [Produktreview vom 10. September](research/ADE_PRODUCT_REVIEW_2026-09-10.md)
priorisiert die nächste Besprechung. Gültige PLAN-/RESULTS-Verträge bleiben aktiv.
64 Markdown-Dateien und 213 lokale Dokumentziele geprüft; 24 Guide-Bilder vorhanden.

## Persönliche Testinstanz

ADE läuft seit **10. September 2026, 23:22:09 Europe/Zurich**, PID **65456**, aus
der festen geprüften Kopie `test-results/operator-release-cb42dbb`. Das Desktop-
Fenster ist sichtbar; Listener ausschliesslich `127.0.0.1:4317`. Der private
HTTPS-Zugang liefert HTTP 200 und die erwarteten Mobile-Assets
`index-DA4ypnQM.js` / `index-BRgqlnJr.css`. Main-Build-Hash stimmt mit dem verifizierten
Build überein. Nachweis: `test-results/project-final-restart.json`.

Vor dem Ersetzen der alten PID 67208: keine laufenden Runs, queued/running Tasks,
aktiven Leases oder Terminal-Kindprozesse. Kopplungs-/Freigabendatei und Tailscale-
Serve-Konfiguration sind unverändert. Konfigurationssicherung:
`%APPDATA%/ade/ade/config.json.before-project-final-cb42dbb`.
Entwicklungsbuilds verändern diese feste Kopie nicht. Bei weiteren Neustarts
laufende Arbeit erneut prüfen. Chrome am Tablet für den neuen Stand neu laden.

Das Samsung besitzt bereits `workspace:read` für den Dateiabruf. Die zusätzlichen
`projects:write`, `projectGit:write` und `projectGit:publish` sind noch nicht erteilt;
für profilfreies Öffnen, Branch/Git bzw. Push/PR setzt der Benutzer die passenden
Schalter ausdrücklich unter Settings → Verbundene Geräte. Der Guide nennt die
sichtbaren Bezeichnungen. Es wurden keine Gerätefreigaben still erweitert.

Der ursprüngliche Bild-/Excel-Run ist `0531376b-559a-49f7-8d98-02d14573b109`,
Task `9c816cef-783d-403c-ba1b-a9354e0506b1`, abgeschlossen. Seine wiederhergestellte
Antwort ist als `recovered-cli` gekennzeichnet. Der genaue Bildmodellname war vom
integrierten Werkzeug nicht gemeldet; der separate angefragte API-Aufruf scheiterte
am Kontingent. Keine nachträgliche Modellbestätigung und kein erneuter Modelllauf.
Vorherige Konfigurationssicherung:
`%APPDATA%/ade/ade/config.json.before-run-inspection-e07e00b`.
Nach dem finalen Neustart sind PNG (2.261.193 Bytes), XLSX (5.626 Bytes) und
Markdown (1.611 Bytes) erneut erfolgreich gelesen worden. Nachweis:
`test-results/t6-operator-files-after-restart.log`.

## Offene, getrennte Abnahmen

- WSL-Bereitschaft: `/bin/true` nach 15 Sekunden weiter ohne Antwort; erneut am
  10. September geprüft. Nur der eigene Probeprozess wurde beendet, kein WSL-Neustart.
  Logs `test-results/t6-wsl-probe.*`. Kein Rückschluss auf native Linux-/WSLg-Pakete.
- Physisch Samsung/Chrome: Tastatur, DeX, Drehung und Netzwechsel vollständig messen.
- Live-GitHub-PR und weitere Betriebssysteme brauchen eigene Ausführungsevidenz.
- Die früher automatisch abgelehnte Löschung des temporären Profils
  `ade-terminal-electron-2xyWJu` wird nicht erneut versucht. Es bleibt liegen.

Historische Goal-6-Messungen bleiben unverändert. Automatisierte Tests verwenden
synthetische Repositories; reale Folgemessungen bevorzugen isolierte RhinoClaw-
Worktrees und verändern weder dessen Hauptcheckout noch die laufende Installation.
